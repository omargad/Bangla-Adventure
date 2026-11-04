import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { seedConnectedDemo, DEMO_ID } from "../scripts/seed-connected-demo.ts";
import { gradeAnswers } from "../lib/classroom.ts";
import { bootstrapSql } from "../db/bootstrap.ts";
import { migrateAccessControl } from "../db/access-migration.ts";
import { migrateContent } from "../db/content-migration.ts";
import { hashPassword } from "../lib/password.ts";

test("connected demo has coherent grades, attendance, pending users and no duplicate writes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bangla-connected-demo-test-"));
  const file = path.join(dir, "test.db");
  try {
    const result = await seedConnectedDemo(file, { mode: "local", apply: true, localPassword: randomBytes(32).toString("hex"), date: "2026-11-05" });
    assert.equal(result.status, "applied");
    const db = new Database(file);
    try {
      assert.deepEqual(db.pragma("foreign_key_check"), []);
      assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
      assert.equal(db.prepare("SELECT count(*) n FROM student_class_enrollments WHERE active=1").get().n, 6);
      assert.equal(db.prepare("SELECT count(*) n FROM students WHERE approval_status='pending'").get().n, 1);
      assert.equal(db.prepare("SELECT count(*) n FROM adults WHERE approval_status='pending'").get().n, 2);
      const camel = db.prepare("SELECT * FROM students WHERE username='camel'").get();
      const frank = db.prepare("SELECT * FROM adults WHERE email='franksamo@gmail.com'").get();
      assert.deepEqual(db.prepare("SELECT student_id FROM parent_student_links WHERE parent_id=?").all(frank.id), [{ student_id: camel.id }]);
      const work = db.prepare("SELECT s.*, a.questions_json FROM activity_submissions s JOIN class_activities a ON a.id=s.activity_id").all();
      assert.equal(work.length, 16);
      for (const row of work) {
        const grade = gradeAnswers(JSON.parse(row.questions_json), JSON.parse(row.answers_json));
        assert.equal(row.score, grade.score); assert.equal(row.total, grade.total);
      }
      const camelWork = db.prepare("SELECT s.score,s.total FROM activity_submissions s JOIN student_class_enrollments e ON e.class_student_id=s.student_id WHERE e.student_id=?").all(camel.id);
      assert.equal(camelWork.length, 3);
      assert.equal(camelWork.reduce((n,r)=>n+r.total-r.score,0), 1);
      assert.deepEqual(db.prepare("SELECT count(*) recorded,sum(present) attended FROM class_attendance WHERE student_id=?").get(camel.id), { recorded: 3, attended: 3 });
      assert.equal(db.prepare("SELECT count(*) n FROM class_activities WHERE status='open'").get().n,1);
      assert.equal(db.prepare("SELECT count(*) n FROM class_announcements").get().n,3);
      const dump = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM ${name}`).all()]);
      // Demonstration actions must survive an accidental rerun.
      db.prepare("UPDATE students SET approval_status='approved' WHERE username='demo.pending-student'").run();
      const before = dump();
      assert.equal((await seedConnectedDemo(file,{ mode:"live",apply:true })).status,"already-applied");
      assert.deepEqual(dump(),before);
      assert.equal(db.prepare("SELECT count(*) n FROM demo_seed_runs WHERE id=?").get(DEMO_ID).n,1);
    } finally { db.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("live mode refuses a missing database and local mode refuses an existing file",async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"bangla-connected-demo-guards-"));
  const file=path.join(dir,"test.db");
  try {
    await assert.rejects(seedConnectedDemo(file,{mode:"live",apply:true}),/already exist/);
    await seedConnectedDemo(file,{mode:"local",apply:true,localPassword:randomBytes(32).toString("hex")});
    await assert.rejects(seedConnectedDemo(file,{mode:"local",apply:true,localPassword:"unused-test-password"}),/fresh file/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("live-mode rehearsal backs up existing data, preserves credentials, and dry-run writes nothing",async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"bangla-connected-demo-rehearsal-"));
  const file=path.join(dir,"existing.db");
  const db=new Database(file);
  try{
    db.exec(bootstrapSql);migrateAccessControl(db);migrateContent(db);
    const hash=hashPassword(randomBytes(32).toString("hex"));
    for(const [key,email,role] of [["admin","admin@admin.com","admin"],["teacher","timmarco@gmail.com","teacher"],["parent","franksamo@gmail.com","parent"]])db.prepare("INSERT INTO adults(id,email,display_name,role,teacher_status,password_hash,approval_status) VALUES(?,?,?,?,?,?,'approved')").run(key,email,key,role,role==="teacher"?"approved":"none",hash);
    db.prepare("INSERT INTO students(id,username,display_name,password_hash,approval_status) VALUES('existing-camel','camel','Camel',?,'approved')").run(hash);
    db.prepare("INSERT INTO classes(id,teacher_id,name,join_code) VALUES('existing-class','teacher','Demo Class','ABC234')").run();
    db.prepare("INSERT INTO class_students(id,class_id,display_name,token_hash) VALUES('existing-roster','existing-class','Camel','unusable-fixture-token')").run();
    db.prepare("INSERT INTO student_class_enrollments(id,student_id,class_id,class_student_id) VALUES('existing-enrolment','existing-camel','existing-class','existing-roster')").run();
    const before=db.prepare("SELECT * FROM adults ORDER BY id").all();
    assert.equal((await seedConnectedDemo(file,{mode:"live"})).status,"dry-run");
    assert.equal(db.prepare("SELECT count(*) n FROM class_activities").get().n,0);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='demo_seed_runs'").get(),undefined);
    const applied=await seedConnectedDemo(file,{mode:"live",apply:true});
    assert.equal(applied.status,"applied");
    const backup=new Database(applied.backupPath,{readonly:true});
    try{assert.deepEqual(backup.prepare("SELECT * FROM adults ORDER BY id").all(),before);assert.equal(backup.prepare("SELECT count(*) n FROM class_activities").get().n,0);}finally{backup.close();}
    assert.deepEqual(db.prepare("SELECT * FROM adults WHERE id IN ('admin','teacher','parent') ORDER BY id").all(),before);
    assert.equal(db.prepare("SELECT password_hash FROM students WHERE id='existing-camel'").get().password_hash,hash);
    assert.equal(db.prepare("SELECT id FROM student_class_enrollments WHERE student_id='existing-camel'").get().id,"existing-enrolment");
    assert.equal(db.prepare("SELECT count(*) n FROM activity_submissions WHERE student_id='existing-roster'").get().n,3);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
