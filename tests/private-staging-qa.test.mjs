import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { bootstrapSql } from '../db/bootstrap.ts';
import { migrateAccessControl } from '../db/access-migration.ts';
import { migrateContent } from '../db/content-migration.ts';

const repo = new URL('..', import.meta.url).pathname;
const qaId = '0123456789abcdef01234567';
const image = 'ghcr.io/omargad/bangla-adventure@sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2';
const revision = '95b6308ac7ad3d5b6bb2d951df9d65a23ff77107';
const imageId = `sha256:${'c'.repeat(64)}`;
const realId = 'a'.repeat(64);
const cleanCounts = { pendingTopics: 15, pendingLessons: 18, shippedStates: 33, users: 0, approvals: 0, baselines: 0, businessRows: 0, mediaFiles: 0 };

// Implements only the narrow lifecycle command grammar. It never runs Docker or forwards a command.
const dockerStub = String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const env=process.env,a=process.argv.slice(2),state=JSON.parse(fs.readFileSync(env.MOCK_STATE));
if(a.shift()!=='--host'||a.shift()!=='unix://'+env.MOCK_SOCKET)process.exit(91);
fs.appendFileSync(env.MOCK_LOG,JSON.stringify(a)+'\n');
const save=()=>fs.writeFileSync(env.MOCK_STATE,JSON.stringify(state));
const out=x=>process.stdout.write(typeof x==='string'?x+'\n':JSON.stringify(x)+'\n');
const fail=()=>process.exit(92),id=()=>crypto.randomBytes(32).toString('hex');
const get=n=>Object.values(state.containers).find(x=>x.Id===n||x.Name==='/'+n);
const option=(args,key)=>args[args.indexOf(key)+1];
const options=(args,key)=>args.flatMap((x,i)=>x===key?[args[i+1]]:[]);
if(a[0]==='context'){out('unix://'+env.MOCK_SOCKET);process.exit(0)}
if(a[0]==='info'){out(['name=seccomp','name=rootless']);process.exit(0)}
if(a[0]==='image'){out([{Id:env.MOCK_IMAGE_ID,RepoDigests:[env.MOCK_IMAGE],Config:{Labels:{'org.opencontainers.image.revision':env.MOCK_WRONG_PIN?'wrong':env.MOCK_REVISION}}}]);process.exit(0)}
if(a[0]==='ps'){
 const vf=a.find(x=>x.startsWith('volume='));
 if(vf)out(Object.values(state.containers).filter(x=>x.Mounts.some(m=>m.Name===vf.slice(7))).map(x=>x.Id).join('\n'));
 else out(a.includes('--no-trunc')?env.MOCK_REAL_ID:env.MOCK_REAL_ID.slice(0,12));
 process.exit(0);
}
const kind=a[0],op=a[1],name=a[2];
if(op==='inspect'){
 const x=kind==='container'?get(name):state[kind+'s'][name]||Object.values(state[kind+'s']).find(x=>x.Id===name);
 if(!x)process.exit(1);out([x]);process.exit(0);
}
if(kind==='network'&&op==='create'){
 const name=a.at(-1),labels=Object.fromEntries(options(a,'--label').map(x=>x.split('=')));
 state.networks[name]={Id:id(),Name:name,Internal:a.includes('--internal'),Driver:'bridge',Labels:labels,Containers:{}};save();out(state.networks[name].Id);process.exit(0);
}
if(kind==='volume'&&op==='create'){
 const name=a.at(-1),mountpoint=path.join(env.MOCK_FOLDER,'volumes',name);fs.mkdirSync(mountpoint,{recursive:true});
 state.volumes[name]={Name:name,Driver:'local',Options:null,Labels:Object.fromEntries(options(a,'--label').map(x=>x.split('='))),Mountpoint:mountpoint};save();out(name);process.exit(0);
}
if(kind==='container'&&op==='create'){
 const name=option(a,'--name'),role=name.endsWith('-proxy')?'proxy':'app';
 if(role==='proxy'&&env.MOCK_FAIL_PROXY_CREATE)fail();
 const network=option(a,'--network'),imageIndex=a.indexOf(env.MOCK_IMAGE);if(imageIndex<0)fail();
 const mounts=options(a,'--mount').map(v=>{const m=Object.fromEntries(v.split(',').map(s=>s.split('=')));return {Type:m.type,...(m.type==='volume'?{Name:m.source,Source:state.volumes[m.source].Mountpoint}:{Source:m.source}),Destination:m.target,RW:!('readonly'in m)}});
 const x={Id:id(),Name:'/'+name,Image:env.MOCK_IMAGE_ID,Config:{Image:env.MOCK_IMAGE,Labels:Object.fromEntries(options(a,'--label').map(x=>x.split('='))),User:option(a,'--user'),Env:options(a,'--env'),Entrypoint:role==='proxy'?['node']:['scripts/docker-start.sh'],Cmd:role==='proxy'?a.slice(imageIndex+1):['node','next']},HostConfig:{PortBindings:{},PublishAllPorts:false,Privileged:false,VolumesFrom:null,Devices:[],CapDrop:options(a,'--cap-drop'),SecurityOpt:options(a,'--security-opt'),ReadonlyRootfs:a.includes('--read-only')},NetworkSettings:{Ports:null,Networks:{[network]:{NetworkID:state.networks[network].Id}}},Mounts:mounts,role};
 if(a.some(x=>['--publish','-p','--publish-all','-P','--privileged','--volumes-from'].includes(x)))fail();
 state.containers[name]=x;save();out(x.Id);process.exit(0);
}
if(a[0]==='cp'){
 const [source,destination]=a.slice(1),[target,inside]=destination.split(':'),x=get(target);
 if(!x||x.role!=='app'||inside!=='/app/public/robots.txt'||(fs.statSync(source).mode&511)!==420)fail();
 x.proof=JSON.parse(fs.readFileSync(source));save();process.exit(0);
}
if(kind==='container'&&op==='start'){
 const x=get(name);if(!x)fail();
 x.NetworkSettings.Ports={'3000/tcp':null};
 const network=Object.keys(x.NetworkSettings.Networks)[0];state.networks[network].Containers[x.Id]={Name:x.Name.slice(1)};
 if(x.role==='app'){
  if(!x.proof||x.proof.expectedrevision!==env.MOCK_REVISION)fail();
  x.db=path.join(x.Mounts[0].Source,'bangla-adventures.db');if(!env.MOCK_DEFER_DB_UNTIL_HEALTH)fs.copyFileSync(env.MOCK_TEMPLATE,x.db);
 }else{
  const socket=path.join(x.Mounts.find(m=>m.Destination==='/runtime').Source,'http.sock');
  fs.writeFileSync(socket,'offline socket sentinel');x.socket=socket;
 }
 save();out(x.Id);process.exit(0);
}
if(a[0]==='exec'){
 const offset=a[1]==='-i'?2:1,x=get(a[offset]);if(!x)fail();
 if(x.Id===env.MOCK_REAL_ID){out({verified:true,counts:{...JSON.parse(env.MOCK_COUNTS),...(env.MOCK_DIRTY_STAGE?{users:1}:{})}});process.exit(0)}
 if(x.role==='proxy'){
  const app=Object.values(state.containers).find(y=>y.role==='app');if(!app?.proof||app.proof.qa_id!==x.Config.Labels['io.bangla.private-qa.id'])fail();
  const probe=a.join(' ');if(!probe.includes("path:'/robots.txt'"))fail();
  if(env.MOCK_DEFER_DB_UNTIL_HEALTH&&probe.includes("path:'/api/health'")&&!fs.existsSync(app.db))fs.copyFileSync(env.MOCK_TEMPLATE,app.db);
  process.exit(0);
 }
 const input=fs.readFileSync(0,'utf8').replaceAll('/app/.data/bangla-adventures.db',x.db);
 const args=a.slice(offset+1);if(args[0]!=='node'||args[1]!=='--input-type=module'||args[2]!=='-')fail();
 const result=cp.spawnSync(process.execPath,args.slice(1),{input,cwd:env.MOCK_REPO,encoding:'utf8',env});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??93);
}
if(kind==='container'&&op==='rm'){
 const x=get(a.at(-1));if(!x||!x.role)fail();
 for(const network of Object.values(state.networks))delete network.Containers[x.Id];
 if(x.socket)fs.rmSync(x.socket,{force:true});delete state.containers[x.Name.slice(1)];save();out(x.Id);process.exit(0);
}
if(kind==='network'&&op==='rm'){
 const x=Object.values(state.networks).find(x=>x.Id===name);if(!x||Object.keys(x.Containers).length)fail();delete state.networks[x.Name];save();out(name);process.exit(0);
}
if(kind==='volume'&&op==='rm'){
 if(!state.volumes[name]||Object.values(state.containers).some(x=>x.Mounts.some(m=>m.Name===name)))fail();
 fs.rmSync(state.volumes[name].Mountpoint,{recursive:true,force:true});delete state.volumes[name];save();out(name);process.exit(0);
}
fail();
`;

async function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'bangla-qa-test-')),stage=path.join(root,'private-staging'),bin=path.join(root,'bin'),daemon=path.join(root,'docker.sock');
  mkdirSync(stage,{mode:0o700});mkdirSync(path.join(stage,'tools'));mkdirSync(bin);
  writeFileSync(path.join(stage,'.private-staging-marker'),'bangla-adventures-private-staging-v1\n',{mode:0o600});
  copyFileSync(new URL('../scripts/private-staging-proxy.mjs',import.meta.url),path.join(stage,'tools/private-staging-proxy.mjs'));
  const template=path.join(root,'template.db'),db=new Database(template);db.exec(bootstrapSql);migrateAccessControl(db);migrateContent(db);db.close();
  // Offline Docker emulation uses regular sentinel files; production retains strict Unix-socket tests.
  writeFileSync(daemon,'fake rootless socket');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const stateFile=path.join(root,'state.json'),log=path.join(root,'commands.jsonl');
  const real={Id:realId,Name:'/real-stage-app',Image:imageId,Config:{Labels:{'com.docker.compose.project':'bangla-adventures-staging','com.docker.compose.service':'app'}},HostConfig:{PortBindings:{}},Mounts:[{Type:'volume',Name:'bangla-adventures-staging_bangla-data',Destination:'/app/.data',RW:true},{Type:'bind',Source:path.join(stage,'tools/private-staging-verify.mjs'),Destination:'/app/staging-tools/private-staging-verify.mjs',RW:false}]};
  writeFileSync(stateFile,JSON.stringify({containers:{'real-stage-app':real},networks:{},volumes:{}}));
  const script=path.join(root,'qa.sh');writeFileSync(script,readFileSync(new URL('../scripts/private-staging-qa.sh',import.meta.url),'utf8').replace('readonly stage=/opt/bangla-adventures/private-staging',`readonly stage=${stage}`).replace('readonly socketDaemon=/run/user/1002/docker.sock',`readonly socketDaemon=${daemon}`).replace('[ -S \"$socketDaemon\" ]','[ -f \"$socketDaemon\" ]').replace('[ -S \"$socket\" ]','[ -f \"$socket\" ]'));
  writeFileSync(path.join(bin,'docker'),`#!${process.execPath}\n${dockerStub}`,{mode:0o755});
  writeFileSync(path.join(bin,'id'),'#!/bin/sh\ncase "$1" in -un) echo deployer;; -u) echo 1002;; *) exit 99;; esac\n',{mode:0o755});
  writeFileSync(path.join(bin,'stat'),'#!/bin/sh\ncase "$2" in %u) echo 1002;; %u:%a) printf "1002:"; /usr/bin/stat -c %a "${@: -1}";; *) exec /usr/bin/stat "$@";; esac\n'.replace('#!/bin/sh','#!/bin/bash'),{mode:0o755});
  const env={...process.env,PATH:`${bin}:${process.env.PATH}`,NODE_NO_WARNINGS:'1',MOCK_FOLDER:root,MOCK_STATE:stateFile,MOCK_LOG:log,MOCK_SOCKET:daemon,MOCK_REPO:repo,MOCK_TEMPLATE:template,MOCK_IMAGE:image,MOCK_IMAGE_ID:imageId,MOCK_REAL_ID:realId,MOCK_REVISION:revision,MOCK_COUNTS:JSON.stringify(cleanCounts)};
  const state=()=>JSON.parse(readFileSync(stateFile));
  const run=(action,id=qaId,changes={})=>spawnSync('bash',[script,action,id],{env:{...env,...changes},encoding:'utf8',timeout:20000});
  const calls=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  const qaDb=()=>new Database(Object.values(state().containers).find(x=>x.role==='app').db);
  return {root,stage,stateFile,state,run,calls,qaDb};
}
const okay=result=>{assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim());};

function acceptanceIdentities(f) {
  const db=f.qaDb();
  for(const kind of ['parent','teacher','admin'])db.prepare('INSERT INTO adults(id,email,display_name,password_hash,role,teacher_status,approval_status)VALUES(?,?,?,?,?,?,?)').run(`fixture-${kind}`,`qa-${qaId}${kind==='parent'?'':`-${kind}`}@example.invalid`,`QA ${kind}`,'fixture-hash','parent',kind==='teacher'?'pending':'none','pending');
  for(let index=1;index<=4;index++)db.prepare('INSERT INTO students(id,username,display_name,password_hash,approval_status)VALUES(?,?,?,?,?)').run(`fixture-student-${index}`,`qa-${qaId}-student${index===1?'':`-${index}`}`,`QA Student ${index}`,'fixture-hash','pending');
  db.close();
}

function acceptanceClass(f) {
  const db=f.qaDb();
  db.prepare("UPDATE adults SET approval_status='approved',role=CASE WHEN id='fixture-teacher' THEN 'teacher' ELSE role END,teacher_status=CASE WHEN id='fixture-teacher' THEN 'approved' ELSE teacher_status END WHERE id IN ('fixture-parent','fixture-teacher')").run();
  db.prepare("UPDATE students SET approval_status='approved' WHERE id IN ('fixture-student-1','fixture-student-2','fixture-student-3')").run();
  db.prepare("INSERT INTO classes(id,teacher_id,name,join_code)VALUES('fixture-class','fixture-teacher','QA River Journeys','QA-RIVER')").run();
  for(let index=1;index<=3;index++){
    db.prepare('INSERT INTO class_students(id,class_id,display_name,token_hash)VALUES(?,?,?,?)').run(`fixture-roster-${index}`,'fixture-class',`QA Student ${index}`,`fixture-token-${index}`);
    db.prepare('INSERT INTO student_class_enrollments(id,student_id,class_id,class_student_id)VALUES(?,?,?,?)').run(`fixture-enrollment-${index}`,`fixture-student-${index}`,'fixture-class',`fixture-roster-${index}`);
    for(const date of ['2026-10-30','2026-11-06'])db.prepare('INSERT INTO class_attendance(id,class_id,student_id,session_date,present,recorded_by)VALUES(?,?,?,?,?,?)').run(`fixture-attendance-${index}-${date}`,'fixture-class',`fixture-student-${index}`,date,index===3?0:1,'fixture-teacher');
  }
  db.prepare("INSERT INTO parent_student_links(id,parent_id,student_id)VALUES('fixture-family','fixture-parent','fixture-student-1')").run();
  const questions=JSON.stringify([{prompt:'What travels on a river?',options:['Boat','Train'],answer:0},{prompt:'Which month begins the Bengali year?',options:['Boishakh','Poush'],answer:0}]);
  for(let index=1;index<=2;index++)db.prepare('INSERT INTO class_activities(id,class_id,title,questions_json,created_by,approval_status,reviewed_by)VALUES(?,?,?,?,?,?,?)').run(`fixture-activity-${index}`,'fixture-class',`QA River Activity ${index}`,questions,'fixture-teacher',index===1?'approved':'pending',index===1?'fixture-admin':null);
  for(let index=1;index<=2;index++)db.prepare('INSERT INTO activity_submissions(id,activity_id,student_id,answers_json,score,total)VALUES(?,?,?,?,?,?)').run(`fixture-result-${index}`,'fixture-activity-1',`fixture-roster-${index}`,'[0,0]',index===1?2:1,2);
  for(const audience of ['all','parents','students'])db.prepare('INSERT INTO class_announcements(id,class_id,body,audience,author_id)VALUES(?,?,?,?,?)').run(`fixture-announcement-${audience}`,'fixture-class',`QA River notice for ${audience}`,audience,'fixture-teacher');
  const topic=db.prepare("SELECT * FROM topic_versions WHERE topic_id='pohela-boishakh'").get();
  db.prepare("UPDATE topic_versions SET status='superseded',reviewed_by='fixture-admin' WHERE id=?").run(topic.id);
  db.prepare("INSERT INTO topic_versions(id,topic_id,version,data_json,status,baseline,created_by,reviewed_by)VALUES('fixture-topic-v2','pohela-boishakh',2,?,'approved',0,'fixture-teacher','fixture-admin')").run(topic.data_json);
  db.prepare("UPDATE lesson_versions SET status='approved',reviewed_by='fixture-admin' WHERE lesson_id='hello-me'").run();
  db.prepare("INSERT INTO content_approvals(id,content_type,content_id,status,baseline,changed_by,changed_at)VALUES('fixture-lesson-review','lesson','hello-me','approved',0,'fixture-admin','2026-11-06T00:00:00Z')").run();
  db.close();
}

 test('disposable QA remains isolated, approves only browser-created parent/student, and cleans up idempotently',async t=>{
  const f=await fixture(t),prepared=okay(f.run('prepare'));
  assert.equal(prepared.prepared,true);assert.deepEqual(prepared.qa,{users:0,pendingTopics:15,pendingLessons:18});
  assert.equal(statSync(path.join(f.stage,'qa',qaId,'proof.json')).mode&0o777,0o644,'node can read only the synthetic public proof');
  assert.equal(prepared.socket,path.join(f.stage,'qa',qaId,'runtime/http.sock'));
  let db=f.qaDb();db.prepare("INSERT INTO adults(id,email,display_name,password_hash,approval_status)VALUES('qa-parent',?,'QA Parent','fixture-hash','pending')").run(`qa-${qaId}@example.invalid`);db.close();
  assert.equal(okay(f.run('verify')).qa.users,1);
  db=f.qaDb();db.prepare("INSERT INTO students(id,username,display_name,password_hash,approval_status)VALUES('qa-student',?,'QA Student','fixture-hash','pending')").run(`qa-${qaId}-student`);db.close();
  assert.deepEqual(okay(f.run('approve-fixtures')),{verified:true,qaId,approvedAdults:1,approvedStudents:1,noContentApprovals:true});
  db=f.qaDb();assert.equal(db.prepare('SELECT approval_status FROM adults').get().approval_status,'approved');assert.equal(db.prepare('SELECT approval_status FROM students').get().approval_status,'approved');assert.equal(db.prepare('SELECT count(*) n FROM content_approvals').get().n,0);db.close();
  assert.equal(okay(f.run('verify')).qa.users,2);
  assert.equal(okay(f.run('cleanup')).removed,true);assert.equal(okay(f.run('cleanup')).removed,true);
  assert.deepEqual(Object.keys(f.state().containers),['real-stage-app']);assert.deepEqual(f.state().volumes,{});assert.deepEqual(f.state().networks,{});assert.equal(existsSync(path.join(f.stage,'qa',qaId)),false);
  assert.ok(f.calls().filter(x=>x[0]==='ps'&&x.some(y=>y.includes('compose.project'))).every(x=>x.includes('--no-trunc')));
  assert.ok(f.calls().filter(x=>x[0]==='container'&&x[1]==='rm').every(x=>x.at(-1)!==realId));
 });

 test('invalid IDs, altered stage marker and unpinned images refuse before resource creation',async t=>{
  const f=await fixture(t);
  assert.notEqual(f.run('prepare','../stage').status,0);assert.equal(f.calls().length,0);
  writeFileSync(path.join(f.stage,'.private-staging-marker'),'wrong\n');assert.notEqual(f.run('prepare').status,0);assert.equal(f.calls().length,0);
  writeFileSync(path.join(f.stage,'.private-staging-marker'),'bangla-adventures-private-staging-v1\n');assert.notEqual(f.run('prepare',qaId,{MOCK_WRONG_PIN:'1'}).status,0);
  assert.equal(f.calls().some(x=>x[1]==='create'),false);
 });

 test('a partial prepare failure removes only its owned ephemeral app, network and volume',async t=>{
  const f=await fixture(t),result=f.run('prepare',qaId,{MOCK_FAIL_PROXY_CREATE:'1'});assert.notEqual(result.status,0);
  assert.match(result.stderr,/PRIVATE_QA_DIAGNOSTIC:prepare:prepare-proxy/,'only a fixed phase is exposed for controller diagnostics');
  assert.deepEqual(Object.keys(f.state().containers),['real-stage-app']);assert.deepEqual(f.state().networks,{});assert.deepEqual(f.state().volumes,{});assert.equal(existsSync(path.join(f.stage,'qa',qaId)),false);
  assert.equal(okay(f.run('cleanup')).removed,true);
 });

 test('a static identity marker alone cannot race the fresh database initialization',async t=>{
  const f=await fixture(t),prepared=okay(f.run('prepare',qaId,{MOCK_DEFER_DB_UNTIL_HEALTH:'1'}));
  assert.deepEqual(prepared.qa,{users:0,pendingTopics:15,pendingLessons:18});
  const probes=f.calls().filter(x=>x[0]==='exec'&&x.join(' ').includes("path:'/robots.txt'"));
  assert.ok(probes.length>0&&probes.every(x=>x.join(' ').includes("path:'/api/health'")));
  assert.equal(okay(f.run('cleanup')).removed,true);
 });

 test('changed mounts refuse approval and cleanup instead of touching another data volume',async t=>{
  const f=await fixture(t);okay(f.run('prepare'));const state=f.state(),app=Object.values(state.containers).find(x=>x.role==='app'),original=app.Mounts[0].Name;
  app.Mounts[0].Name='bangla-adventures-staging_bangla-data';writeFileSync(f.stateFile,JSON.stringify(state));
  const prior=f.calls().length;assert.notEqual(f.run('approve-fixtures').status,0);assert.notEqual(f.run('cleanup').status,0);
  assert.equal(f.calls().slice(prior).some(x=>x[1]==='rm'),false,'foreign mount blocks every removal before the app');
  app.Mounts[0].Name=original;writeFileSync(f.stateFile,JSON.stringify(state));okay(f.run('cleanup'));
 });

 test('unexpected identities refuse approval and failure cleanup leaves real staging untouched',async t=>{
  const f=await fixture(t);okay(f.run('prepare'));const db=f.qaDb();db.prepare("INSERT INTO adults(id,email,display_name,password_hash)VALUES('unexpected','other@example.invalid','Other','fixture-hash')").run();db.close();
  assert.notEqual(f.run('approve-fixtures').status,0);assert.deepEqual(Object.keys(f.state().containers),['real-stage-app']);assert.deepEqual(f.state().volumes,{});
  assert.equal(okay(f.run('cleanup')).removed,true);
 });

 test('cleanup removes its owned QA resources even when real-stage cleanliness subsequently fails',async t=>{
  const f=await fixture(t);okay(f.run('prepare'));
  assert.notEqual(f.run('cleanup',qaId,{MOCK_DIRTY_STAGE:'1'}).status,0,'dirty real stage is reported as failure');
  assert.deepEqual(Object.keys(f.state().containers),['real-stage-app']);assert.deepEqual(f.state().volumes,{});assert.deepEqual(f.state().networks,{});
  assert.equal(existsSync(path.join(f.stage,'qa',qaId)),false,'cleanup is not blocked by unrelated stage verification');
  assert.equal(okay(f.run('cleanup')).removed,true);
 });

 test('an existing QA ID is refused without replacing or deleting its resources',async t=>{
  const f=await fixture(t);okay(f.run('prepare'));const prior=f.calls().length,before=f.state();
  assert.notEqual(f.run('prepare').status,0);assert.deepEqual(f.state(),before);
  assert.equal(f.calls().slice(prior).some(x=>x[1]==='rm'||x[1]==='create'),false);
  okay(f.run('cleanup'));
 });

 test('four-role bootstrap grants only the fixed namespace administrator and supports a bounded connected class',async t=>{
  const f=await fixture(t);okay(f.run('prepare'));acceptanceIdentities(f);
  assert.equal(okay(f.run('verify')).qa.users,7);
  assert.deepEqual(okay(f.run('bootstrap-admin')),{verified:true,qaId,bootstrapAdmin:true,approvedAdults:1,approvedStudents:0,noContentApprovals:true});
  let db=f.qaDb();
  assert.deepEqual(db.prepare('SELECT role,approval_status FROM adults WHERE id=?').get('fixture-admin'),{role:'admin',approval_status:'approved'});
  assert.equal(db.prepare("SELECT count(*) n FROM adults WHERE approval_status='pending'").get().n,2);
  assert.equal(db.prepare("SELECT count(*) n FROM students WHERE approval_status='pending'").get().n,4);
  assert.equal(db.prepare('SELECT count(*) n FROM content_approvals').get().n,0);db.close();
  acceptanceClass(f);
  assert.deepEqual(okay(f.run('verify')).qa,{users:7,pendingTopics:14,pendingLessons:17});
  db=f.qaDb();assert.equal(db.prepare("SELECT approval_status FROM students WHERE id='fixture-student-4'").get().approval_status,'pending');db.close();
  assert.equal(okay(f.run('cleanup')).removed,true);assert.deepEqual(Object.keys(f.state().containers),['real-stage-app']);
 });

 test('class membership and parent access cannot escape the fixed roster even inside QA',async t=>{
  const f=await fixture(t);okay(f.run('prepare'));acceptanceIdentities(f);okay(f.run('bootstrap-admin'));acceptanceClass(f);
  let db=f.qaDb();db.prepare("UPDATE parent_student_links SET student_id='fixture-student-2'").run();db.close();
  assert.notEqual(f.run('verify').status,0,'the parent is limited to the first fixed child');
  db=f.qaDb();db.prepare("UPDATE parent_student_links SET student_id='fixture-student-1'").run();db.prepare("UPDATE student_class_enrollments SET student_id='fixture-student-4' WHERE student_id='fixture-student-3'").run();db.close();
  assert.notEqual(f.run('verify').status,0,'the pending fourth student cannot be put in the class');
  assert.equal(okay(f.run('cleanup')).removed,true);assert.deepEqual(Object.keys(f.state().containers),['real-stage-app']);
 });

 test('the private baseline detects rewritten shipped content even with a matching forged source fingerprint',async t=>{
  const f=await fixture(t);okay(f.run('prepare'));const db=f.qaDb();
  const topic=db.prepare("SELECT * FROM topic_versions WHERE topic_id!='pohela-boishakh' LIMIT 1").get();
  const data=JSON.parse(topic.data_json);data.qaTamper=true;
  const normalize=x=>Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])])):x;
  const fingerprint=createHash('sha256').update(JSON.stringify(normalize(data))).digest('hex');
  db.prepare('UPDATE topic_versions SET data_json=? WHERE id=?').run(JSON.stringify(data),topic.id);
  db.prepare("UPDATE shipped_content_state SET last_source_fingerprint=? WHERE content_type='topic' AND content_id=?").run(fingerprint,topic.topic_id);db.close();
  assert.notEqual(f.run('verify').status,0,'a self-consistent rewrite still differs from the prepare-time immutable snapshot');
  assert.equal(okay(f.run('cleanup')).removed,true);assert.deepEqual(Object.keys(f.state().containers),['real-stage-app']);
 });

 test('a redirected shared deployment lock refuses before QA resource creation or stage reads',async t=>{
  const f=await fixture(t),sentinel=path.join(f.root,'unrelated-lock');writeFileSync(sentinel,'retain');
  symlinkSync(sentinel,path.join(f.stage,'.deploy.lock'));
  const result=f.run('prepare');assert.notEqual(result.status,0);assert.match(result.stderr,/PRIVATE_QA_DIAGNOSTIC:prepare:stage-lock/);
  assert.equal(f.calls().some(value=>value[1]==='create'||value[0]==='exec'),false);
  assert.equal(readFileSync(sentinel,'utf8'),'retain');assert.deepEqual(Object.keys(f.state().containers),['real-stage-app']);
 });
