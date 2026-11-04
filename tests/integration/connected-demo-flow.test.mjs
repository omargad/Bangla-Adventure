import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(path.join(tmpdir(), "bangla-connected-demo-flow-"));
const database = path.join(dir, "demo.db");
const password = randomBytes(32).toString("hex");
const base = "http://127.0.0.1:3259";
const env = { ...process.env, DATABASE_PATH: database, DEMO_LOCAL_PASSWORD: password, PLATFORM_MODE: "legacy" };
let server, db, classId;
const cookies = {};
const send = (route, role, method="GET", body) => fetch(base+route, {
  method, redirect:"manual", headers:{...(cookies[role] ? {cookie:cookies[role]} : {}), ...(body ? {"Content-Type":"application/json"} : {})},
  ...(body ? {body:JSON.stringify(body)} : {}),
});
const json = async(route,role) => {const r=await send(route,role);assert.equal(r.status,200,route);return r.json();};

before(async()=>{
  execFileSync(process.execPath,["--import","tsx","scripts/seed-connected-demo.ts","--local","--apply"],{env,stdio:"pipe"});
  db=new Database(database);classId=db.prepare("SELECT id FROM classes WHERE name='Demo Class'").get().id;
  server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3259"],{env,stdio:["ignore","pipe","pipe"]});
  let output="";server.stdout.on("data",chunk=>output+=chunk);server.stderr.on("data",chunk=>output+=chunk);
  const until=Date.now()+60000;
  while(Date.now()<until){
    if(server.exitCode!==null)throw new Error(`App exited: ${output}`);
    try{if((await fetch(base+"/api/health")).ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.equal((await fetch(base+"/api/health")).status,200);
  for(const [role,email] of [["admin","admin@admin.com"],["teacher","timmarco@gmail.com"],["parent","franksamo@gmail.com"],["student",null]]){
    const response=await send(role==="student"?"/api/student/sign-in":"/api/auth/sign-in",null,"POST",email?{email,password}:{username:"camel",password});
    assert.equal(response.status,200,`local ${role} login`);
    cookies[role]=response.headers.getSetCookie().find(value=>value.startsWith(role==="student"?"ba_student_session=":"ba_adult_session=")).split(";")[0];
  }
}, {timeout:90000});

after(async()=>{
  db?.close();
  if(server && server.exitCode===null){server.kill("SIGTERM");await new Promise(resolve=>server.once("exit",resolve));}
  rmSync(dir,{recursive:true,force:true});
});

test("all four roles see one coherent seeded journey, with the correct access boundaries",async()=>{
  const users=await json("/api/admin/users","admin");
  assert.equal(users.approvals.total,3);
  const classes=await json("/api/classes","teacher");
  assert.equal(classes.classes.length,1);
  assert.equal(classes.classes[0].studentCount,6);
  assert.equal(classes.classes[0].activityCount,4);
  const {gradebook}=await json(`/api/classes/${classId}/grades`,"teacher");
  assert.equal(gradebook.rows.length,6);
  const teacherCamel=gradebook.rows.find(row=>row.student.displayName==="Camel");
  assert.equal(teacherCamel.done,3);
  assert.deepEqual(teacherCamel.attendance,{attended:3,recorded:3});
  const student=await json("/api/student/feed","student");
  assert.equal(student.metrics.completedActivities,3);
  assert.equal(student.metrics.assignedActivities,4);
  const family=await json("/api/family","parent");
  assert.equal(family.children.length,1);
  assert.equal(family.children[0].displayName,"Camel");
  assert.equal(family.children[0].metrics.averagePercent,student.metrics.averagePercent);
  assert.equal(teacherCamel.averagePercent,student.metrics.averagePercent);
  assert.equal(family.children[0].classes[0].activities.length,4);
  assert.ok(!JSON.stringify(family).includes("Maya Rahman"));
  assert.ok(!JSON.stringify(family).includes("Learners: revisit"));
  assert.ok(!JSON.stringify(student).includes("Families: ask"));
  const admin=await json("/api/admin/results","admin");
  assert.equal(admin.classes.find(c=>c.id===classId).submissionCount,16);
  assert.equal((await send("/api/admin/users","teacher")).status,403);
  assert.equal((await send(`/api/classes/${classId}/grades`,"parent")).status,403);
  assert.equal((await send("/api/student/submit","parent","POST",{activityId:"anything",answers:[]})).status,401);
  for(const [route,role] of [["/admin","admin"],["/teach","teacher"],["/student","student"],["/family","parent"]]){
    const response=await send(route,role);assert.equal(response.status,200,`page ${route}`);assert.ok((await response.text()).includes("Bangla"));
  }
});

test("approval and a new Camel submission flow through the app and survive seed rerun",async()=>{
  const pending=db.prepare("SELECT id FROM students WHERE username='demo.pending-student'").get();
  assert.equal((await send(`/api/admin/users/${pending.id}`,"admin","PATCH",{kind:"student",action:"approve"})).status,200);
  assert.equal((await json("/api/admin/users","admin")).approvals.total,2);
  const activity=db.prepare("SELECT * FROM class_activities WHERE status='open'").get();
  const answers=JSON.parse(activity.questions_json).map(q=>q.answer);
  const submitted=await send("/api/student/submit","student","POST",{activityId:activity.id,answers});
  assert.equal(submitted.status,200);
  assert.equal((await submitted.json()).score,answers.length);
  const student=await json("/api/student/feed","student");
  const family=await json("/api/family","parent");
  assert.equal(student.metrics.completedActivities,4);
  assert.equal(family.children[0].metrics.completedActivities,4);
  assert.equal(family.children[0].metrics.averagePercent,student.metrics.averagePercent);
  assert.equal((await json(`/api/classes/${classId}/grades`,"teacher")).gradebook.rows.find(row=>row.student.displayName==="Camel").done,4);
  const rerun=JSON.parse(execFileSync(process.execPath,["--import","tsx","scripts/seed-connected-demo.ts","--live","--apply"],{env,encoding:"utf8"}));
  assert.equal(rerun.status,"already-applied");
  assert.equal((await json("/api/student/feed","student")).metrics.completedActivities,4);
  assert.equal((await json("/api/admin/users","admin")).approvals.total,2);
});
