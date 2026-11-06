#!/usr/bin/env bash
# Disposable authentication QA only. Never mount the real staging or production data volume.
set -Eeuo pipefail
set +x
umask 077
readonly stage=/opt/bangla-adventures/private-staging
readonly socketDaemon=/run/user/1002/docker.sock
readonly revision=a709cb3d2bc9fb0a271e6814bc96d1f16444c94f
readonly digest=sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13
# Set by platform from the stage's release manifest: the registry path of the pinned digest.
image=''
diagnostic_action=arguments diagnostic_phase=arguments
diagnostic() { printf 'PRIVATE_QA_DIAGNOSTIC:%s:%s\n' "$diagnostic_action" "$diagnostic_phase" >&2; }
fail() { diagnostic; printf 'private QA refused: %s\n' "$*" >&2; exit 1; }
trap diagnostic ERR
[ "$#" -eq 2 ] || fail 'Expected a fixed QA action and a 24-character hexadecimal ID.'
readonly action="$1" qaId="$2"
case "$action" in prepare|verify|approve-fixtures|bootstrap-admin|cleanup) ;; *) fail 'Unknown action.' ;; esac
diagnostic_action="$action"
[[ "$qaId" =~ ^[a-f0-9]{24}$ ]] || fail 'Invalid QA ID.'
readonly qaRoot="$stage/qa" qaDir="$stage/qa/$qaId"
readonly socket="$qaDir/runtime/http.sock" prefix="ba-private-qa-$qaId"
readonly app="$prefix-app" proxy="$prefix-proxy" network="$prefix-net" volume="$prefix-data"
docker() { command env -u DOCKER_HOST -u DOCKER_CONTEXT docker --host "unix://$socketDaemon" "$@"; }
owned_dir() { [ -d "$1" ] && [ ! -L "$1" ] && [ "$(realpath -e -- "$1")" = "$1" ] && [ "$(stat -c '%u:%a' -- "$1")" = 1002:700 ]; }
platform() {
  diagnostic_phase=platform
  [ "$(id -u)" = 1002 ] || fail 'The dedicated deployment user is required.'
  owned_dir "$stage" || fail 'The private staging directory is not the expected private directory.'
  [ -f "$stage/.private-staging-marker" ] && [ ! -L "$stage/.private-staging-marker" ] && [ "$(stat -c %u -- "$stage/.private-staging-marker")" = 1002 ] || fail 'Missing owned staging marker.'
  python3 -c 'import pathlib,sys; assert pathlib.Path(sys.argv[1]).read_bytes()==b"bangla-adventures-private-staging-v1\n"' "$stage/.private-staging-marker" || fail 'Staging marker mismatch.'
  # The stage was started from the image its release manifest records. Only the reviewed digest is
  # accepted there; its registry path may name a byte-identical copy (docs/REPOSITORY_TRANSFER.md).
  [ -f "$stage/release.json" ] && [ ! -L "$stage/release.json" ] && [ "$(stat -c %u -- "$stage/release.json")" = 1002 ] || fail 'Missing owned staging release manifest.'
  image="$(python3 -c 'import json,re,sys; v=json.load(open(sys.argv[1]))["image"]; assert isinstance(v,str) and re.fullmatch(r"ghcr\.io/[a-z0-9]+(?:-[a-z0-9]+)*/bangla-adventure@"+re.escape(sys.argv[2]),v); print(v)' "$stage/release.json" "$digest")" || fail 'The staging release manifest does not name the pinned image digest.'
  [ -S "$socketDaemon" ] && [ "$(stat -c %u -- "$socketDaemon")" = 1002 ] || fail 'The fixed rootless socket is required.'
  [ "$(docker context inspect rootless --format '{{.Endpoints.docker.Host}}')" = "unix://$socketDaemon" ] || fail 'Rootless context mismatch.'
  docker info --format '{{json .SecurityOptions}}' | python3 -c 'import json,sys; assert "name=rootless" in json.load(sys.stdin)' || fail 'The daemon is not rootless.'
  imageId="$(docker image inspect "$image" | python3 -c 'import json,sys; x,=json.load(sys.stdin); assert sys.argv[1] in x["RepoDigests"]; assert x["Config"]["Labels"]["org.opencontainers.image.revision"]==sys.argv[2]; print(x["Id"])' "$image" "$revision")" || fail 'Pinned image digest or revision mismatch.'
  [[ "$imageId" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Invalid pinned image ID.'
}
qa_path() {
  owned_dir "$qaRoot" && owned_dir "$qaDir" || fail 'The owned QA path is missing or changed.'
  [ -f "$qaDir/.qa-marker" ] && [ ! -L "$qaDir/.qa-marker" ] && [ "$(stat -c '%u:%a' -- "$qaDir/.qa-marker")" = 1002:600 ] || fail 'QA marker ownership changed.'
  [ "$(cat "$qaDir/.qa-marker")" = "bangla-private-qa:$qaId" ] || fail 'QA marker mismatch.'
}
# Full inspect JSON is validated before every container execution, start, copy or removal.
inspect_owned() {
  local kind="$1" name="$2" role="${3:-}" expected=''
  if [ -f "$qaDir/$role.id" ]; then expected="$(cat "$qaDir/$role.id")"; fi
  docker "$kind" inspect "$name" | python3 -c '
import json,sys
x,=json.load(sys.stdin)
kind,name,role,qid,root,image,imageid,net,vol,expected=sys.argv[1:]
labels=x.get("Config",{}).get("Labels",{}) if kind=="container" else x.get("Labels",{})
assert labels.get("io.bangla.scope")=="private-qa" and labels.get("io.bangla.private-qa.id")==qid and labels.get("io.bangla.private-qa.kind")==role
assert not labels.get("com.docker.compose.project")
if kind=="container":
 assert x["Name"]=="/"+name and x["Config"]["Image"]==image and x["Image"]==imageid
 assert not expected or x["Id"]==expected
 h=x["HostConfig"]; assert not h.get("PortBindings") and not h.get("Privileged") and not h.get("VolumesFrom") and not h.get("Devices")
 assert not h.get("PublishAllPorts")
 ports=x["NetworkSettings"].get("Ports")
 assert ports is None or isinstance(ports,dict) and all(not value for value in ports.values())
 assert list(x["NetworkSettings"]["Networks"])==[net] and x["Config"]["User"]=="node"
 assert "ALL" in h["CapDrop"] and any(v.startswith("no-new-privileges") for v in h["SecurityOpt"])
 mounts=x["Mounts"]
 if role=="app":
  assert len(mounts)==1 and mounts[0]["Type"]=="volume" and mounts[0]["Name"]==vol and mounts[0]["Destination"]=="/app/.data" and mounts[0]["RW"]
  env=dict(v.split("=",1) for v in x["Config"]["Env"])
  assert env["DATABASE_PATH"]=="/app/.data/bangla-adventures.db" and env["MEDIA_ROOT"]=="/app/.data/media" and env["PUBLIC_ORIGIN"]=="http://127.0.0.1:3001" and env["PLATFORM_MODE"]=="legacy"
 else:
  assert role=="proxy" and h["ReadonlyRootfs"] and x["Config"]["Entrypoint"]==["node"] and x["Config"]["Cmd"]==["/app/staging-tools/private-staging-proxy.mjs"]
  assert len(mounts)==2
  actual={(m["Source"],m["Destination"],m["Type"],m["RW"]) for m in mounts}
  assert actual=={(root+"/runtime","/runtime","bind",True),(root+"/private-staging-proxy.mjs","/app/staging-tools/private-staging-proxy.mjs","bind",False)}
 print(x["Id"])
elif kind=="network":
 assert x["Name"]==name and x["Internal"] and x["Driver"]=="bridge" and (not expected or x["Id"]==expected)
 allowed=set()
 import pathlib
 for r in ["app","proxy"]:
  p=pathlib.Path(root,r+".id")
  if p.is_file(): allowed.add(p.read_text().strip())
 assert set(x.get("Containers",{})).issubset(allowed)
 print(x["Id"])
else:
 assert kind=="volume" and x["Name"]==name and x["Driver"]=="local" and not x.get("Options")
 print(x["Name"])
' "$kind" "$name" "$role" "$qaId" "$qaDir" "$image" "$imageId" "$network" "$volume" "$expected" || fail 'Resource identity, isolation or mounts changed.'
}
remember() { [[ "$2" =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid resource ID.'; printf '%s\n' "$2" > "$qaDir/$1.id"; }
real_stage() {
  diagnostic_phase=real-stage
  local stageId report
  stageId="$(docker ps -aq --no-trunc --filter label=com.docker.compose.project=bangla-adventures-staging --filter label=com.docker.compose.service=app)"
  [[ "$stageId" =~ ^[a-f0-9]{64}$ ]] || fail 'Exactly one real staging app is required.'
  docker container inspect "$stageId" | python3 -c '
import json,sys
x,=json.load(sys.stdin); l=x["Config"]["Labels"]
assert x["Id"]==sys.argv[1] and x["Image"]==sys.argv[2] and l["com.docker.compose.project"]=="bangla-adventures-staging" and l["com.docker.compose.service"]=="app"
assert not x["HostConfig"].get("PortBindings")
m=x["Mounts"]; assert len(m)==2
assert any(v["Type"]=="volume" and v["Name"]=="bangla-adventures-staging_bangla-data" and v["Destination"]=="/app/.data" for v in m)
assert any(v["Type"]=="bind" and v["Source"]==sys.argv[3]+"/tools/private-staging-verify.mjs" and v["Destination"]=="/app/staging-tools/private-staging-verify.mjs" and not v["RW"] for v in m)
' "$stageId" "$imageId" "$stage" || fail 'Real staging identity changed.'
  report="$(docker exec "$stageId" node /app/staging-tools/private-staging-verify.mjs)" || fail 'Real staging is not clean.'
  printf '%s' "$report" | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["verified"] and x["counts"]==dict(pendingTopics=15,pendingLessons=18,shippedStates=33,users=0,approvals=0,baselines=0,businessRows=0,mediaFiles=0)' || fail 'Real staging is not zero-user, unpublished and clean.'
}
qa_database() {
  local target expected=''
  target="$(inspect_owned container "$app" app)"
  if [ "$1" != capture ]; then
    [ -f "$qaDir/.content-baseline" ] && [ ! -L "$qaDir/.content-baseline" ] && [ "$(stat -c '%u:%a' -- "$qaDir/.content-baseline")" = 1002:600 ] || fail 'The owned QA content baseline is missing.'
    expected="$(cat "$qaDir/.content-baseline")"
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail 'The QA content baseline is invalid.'
  fi
  # Writes only bootstrap the exact fixture administrator or approve the legacy two-user fixture.
  # All classroom records and publication decisions must come through the application's real APIs.
  docker exec -i "$target" node --input-type=module - "$qaId" "$1" "$expected" <<'JS'
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
const [id,mode,expected]=process.argv.slice(2), db=new Database('/app/.data/bangla-adventures.db',{readonly:!['approve','bootstrap-admin'].includes(mode),fileMustExist:true});
const check=(ok)=>{if(!ok)throw new Error('Disposable QA namespace, content or record boundaries changed');};
const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])])):value;
const canonical=value=>JSON.stringify(normalize(value));
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const rows=(table,max)=>{const values=db.prepare(`SELECT * FROM ${table}`).all();check(values.length<=max);return values;};
const set=values=>new Set(values.map(value=>value.id));
const reference=(value,ids,nullable=false)=>nullable&&value===null||ids.has(value);
try {
 check(/^[a-f0-9]{24}$/.test(id)&&['capture','inspect','approve','bootstrap-admin'].includes(mode));
 check(db.pragma('integrity_check',{simple:true})==='ok'&&db.pragma('foreign_key_check').length===0);
 const emails={parent:`qa-${id}@example.invalid`,teacher:`qa-${id}-teacher@example.invalid`,admin:`qa-${id}-admin@example.invalid`};
 const usernames=Array.from({length:4},(_,index)=>`qa-${id}-student${index?`-${index+1}`:''}`);
 const adults=rows('adults',3),students=rows('students',4),adultIds=set(adults),studentIds=set(students),identityIds=new Set([...adultIds,...studentIds]);
 for(const adult of adults){
  const kind=Object.keys(emails).find(key=>emails[key]===adult.email);check(kind&&adult.status==='active'&&!adult.must_change_password&&['pending','approved'].includes(adult.approval_status));
  check(kind==='admin'?['parent','admin'].includes(adult.role)&&adult.teacher_status==='none':kind==='teacher'?(adult.role==='parent'&&adult.teacher_status==='pending'||adult.role==='teacher'&&adult.teacher_status==='approved'):adult.role==='parent'&&adult.teacher_status==='none');
 }
 check(students.every(student=>usernames.includes(student.username)&&student.status==='active'&&!student.must_change_password&&['pending','approved'].includes(student.approval_status)));
 check(students.every(student=>student.username!==usernames[3]||student.approval_status==='pending'));
 const adultByKind=Object.fromEntries(Object.entries(emails).map(([kind,email])=>[kind,adults.find(adult=>adult.email===email)]));
 const adminId=adultByKind.admin?.id,teacherId=adultByKind.teacher?.id,parentId=adultByKind.parent?.id,mainStudent=students.find(student=>student.username===usernames[0]);
 const classroomStudentIds=new Set(students.filter(student=>usernames.slice(0,3).includes(student.username)).map(student=>student.id));
 const staffIds=new Set([adminId,teacherId].filter(Boolean));
 const topics=rows('topic_versions',16),lessons=rows('lesson_versions',18),states=rows('shipped_content_state',33);
 check(topics.filter(topic=>topic.version===1).length===15&&lessons.length===18&&states.length===33);
 const coreTopics=topics.filter(topic=>topic.version===1),topicIds=new Set(coreTopics.map(topic=>topic.topic_id)),lessonIds=new Set(lessons.map(lesson=>lesson.lesson_id));
 check(topicIds.size===15&&lessonIds.size===18&&states.every(state=>state.baseline_json===null&&/^[a-f0-9]{64}$/.test(state.last_source_fingerprint)));
 for(const [kind,values] of [['topic',coreTopics],['lesson',lessons]])for(const value of values){
  const key=value[`${kind}_id`],state=states.find(row=>row.content_type===kind&&row.content_id===key),fingerprint=hash(JSON.parse(value.data_json));
  check(value.version===1&&value.baseline===0&&state?.last_source_fingerprint===fingerprint&&(kind!=='lesson'||value.fingerprint===fingerprint));
  check(kind!=='topic'||value.created_by===null);
  const selected=kind==='topic'?key==='pohela-boishakh':key==='hello-me';
  check(selected?['pending','approved','superseded'].includes(value.status)&&reference(value.reviewed_by,new Set([adminId].filter(Boolean)),true):value.status==='pending'&&value.reviewed_by===null&&value.reviewed_at===null);
 }
 for(const topic of topics.filter(value=>value.version!==1))check(topic.topic_id==='pohela-boishakh'&&topic.version===2&&topic.baseline===0&&topic.created_by===teacherId&&['pending','approved','superseded'].includes(topic.status)&&reference(topic.reviewed_by,new Set([adminId].filter(Boolean)),true));
 const immutable={topics:coreTopics.map(({id,topic_id,version,data_json,baseline,created_by})=>({id,topic_id,version,data_json,baseline,created_by})).sort((a,b)=>a.id.localeCompare(b.id)),lessons:lessons.map(({id,lesson_id,version,data_json,fingerprint,baseline})=>({id,lesson_id,version,data_json,fingerprint,baseline})).sort((a,b)=>a.id.localeCompare(b.id)),states:states.map(normalize).sort((a,b)=>canonical(a).localeCompare(canonical(b)))};
 const contentHash=hash(immutable);
 if(mode!=='capture')check(/^[a-f0-9]{64}$/.test(expected)&&expected===contentHash);
 const classes=rows('classes',1),classIds=set(classes);check(classes.every(value=>value.teacher_id===teacherId));
 const roster=rows('class_students',3),rosterIds=set(roster);check(roster.every(value=>classIds.has(value.class_id)));
 const enrollments=rows('student_class_enrollments',3);
 check(enrollments.every(value=>classroomStudentIds.has(value.student_id)&&classIds.has(value.class_id)&&rosterIds.has(value.class_student_id)&&value.active===1&&roster.some(person=>person.id===value.class_student_id&&person.class_id===value.class_id&&person.display_name===students.find(student=>student.id===value.student_id)?.display_name)));
 const links=rows('parent_student_links',1);check(links.every(value=>value.parent_id===parentId&&value.student_id===mainStudent?.id));
 const activities=rows('class_activities',2),activityIds=set(activities);
 check(activities.every(value=>classIds.has(value.class_id)&&staffIds.has(value.created_by)&&reference(value.reviewed_by,new Set([adminId].filter(Boolean)),true)&&['pending','approved'].includes(value.approval_status)&&value.revision>=1&&value.revision<=2&&JSON.parse(value.questions_json).length===2));
 const submissions=rows('activity_submissions',2);
 check(submissions.every(value=>activityIds.has(value.activity_id)&&rosterIds.has(value.student_id)&&value.total===2&&Number.isInteger(value.score)&&value.score>=0&&value.score<=2));
 const announcements=rows('class_announcements',3);check(announcements.every(value=>classIds.has(value.class_id)&&staffIds.has(value.author_id)&&['all','students','parents'].includes(value.audience)));
 const attendance=rows('class_attendance',6);check(new Set(attendance.map(value=>value.session_date)).size<=2&&attendance.every(value=>classIds.has(value.class_id)&&classroomStudentIds.has(value.student_id)&&staffIds.has(value.recorded_by)&&/^\d{4}-\d{2}-\d{2}$/.test(value.session_date)&&[0,1].includes(value.present)));
 const sources=rows('class_sources',1);check(sources.every(value=>classIds.has(value.class_id)&&staffIds.has(value.created_by)&&reference(value.reviewed_by,new Set([adminId].filter(Boolean)),true)&&['pending','approved'].includes(value.approval_status)));
 const progress=rows('student_topic_progress',3);check(progress.every(value=>classroomStudentIds.has(value.student_id)&&value.topic_id==='pohela-boishakh'));
 const updates=rows('topic_updates',1);check(updates.every(value=>value.topic_id==='pohela-boishakh'&&value.version===2));
 const approvals=rows('content_approvals',4);check(approvals.every(value=>value.changed_by===adminId&&value.baseline===0&&value.status==='approved'&&(value.content_type==='lesson'&&value.content_id==='hello-me'||value.content_type==='topic'&&value.content_id==='pohela-boishakh')));
 const reviews=rows('content_reviews',6);check(reviews.every(value=>[emails.admin,emails.teacher].includes(value.owner_email)&&value.lesson_id==='hello-me'));
 const adultSessions=rows('adult_sessions',12),studentSessions=rows('student_sessions',16),codes=rows('recovery_codes',64);
 check(adultSessions.every(value=>adultIds.has(value.adult_id))&&studentSessions.every(value=>classroomStudentIds.has(value.student_id))&&codes.every(value=>adultIds.has(value.adult_id)));
 const audit=rows('user_audit_events',200),targets=new Set([...identityIds,...classIds,...rosterIds,...activityIds,...sources.map(value=>value.id),...enrollments.map(value=>value.id),...links.map(value=>value.id),'pohela-boishakh','hello-me']);
 check(audit.every(value=>reference(value.actor_id,identityIds,true)&&targets.has(value.target_id)));
 const zeroTables=['video_reviews','media_assets','learner_profiles','assignments','skill_progress','curriculum_drafts','knowledge_sources'];
 for(const table of zeroTables)check(rows(table,0).length===0);
 const known=new Set(['adults','students','topic_versions','lesson_versions','shipped_content_state','classes','class_students','student_class_enrollments','parent_student_links','class_activities','activity_submissions','class_announcements','class_attendance','class_sources','student_topic_progress','topic_updates','content_approvals','content_reviews','adult_sessions','student_sessions','recovery_codes','user_audit_events','content_migration_versions',...zeroTables]);
 for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){check(/^[a-z_]+$/.test(name));if(!known.has(name))check(rows(name,0).length===0);}
 const pendingTopics=topics.filter(value=>value.status==='pending').length,pendingLessons=lessons.filter(value=>value.status==='pending').length;
 check(pendingTopics>=14&&pendingTopics<=15&&pendingLessons>=17&&pendingLessons<=18);
 const noBusiness=()=>classes.length+roster.length+enrollments.length+links.length+activities.length+submissions.length+announcements.length+attendance.length+sources.length+progress.length+updates.length+approvals.length+reviews.length===0&&pendingTopics===15&&pendingLessons===18;
 if(mode==='capture'){check(adults.length===0&&students.length===0&&noBusiness()&&topics.length===15);console.log(contentHash);}
 else if(mode==='bootstrap-admin'){
  check(adults.length===3&&students.length===4&&noBusiness()&&adultSessions.length===0&&studentSessions.length===0);
  check(adultByKind.admin?.role==='parent'&&adults.every(value=>value.approval_status==='pending')&&students.every(value=>value.approval_status==='pending'));
  check(db.prepare("UPDATE adults SET role='admin',approval_status='approved' WHERE id=? AND email=? AND role='parent' AND approval_status='pending'").run(adminId,emails.admin).changes===1);
  console.log(JSON.stringify({users:7,pendingTopics,pendingLessons}));
 }
 if(mode==='approve'){
  check(adults.length===1&&students.length===1&&adultByKind.parent&&mainStudent&&noBusiness());
  db.transaction(()=>{
   check(db.prepare("UPDATE adults SET approval_status='approved' WHERE email=? AND role='parent' AND status='active'").run(`qa-${id}@example.invalid`).changes===1);
   check(db.prepare("UPDATE students SET approval_status='approved' WHERE username=? AND status='active'").run(`qa-${id}-student`).changes===1);
  })();
 }
 if(!['capture','bootstrap-admin'].includes(mode))console.log(JSON.stringify({users:adults.length+students.length,pendingTopics,pendingLessons}));
}finally{db.close();}
JS
}
verify_all() {
  diagnostic_phase=verify-resources
  qa_path
  inspect_owned network "$network" net >/dev/null
  inspect_owned volume "$volume" data >/dev/null
  inspect_owned container "$app" app >/dev/null
  inspect_owned container "$proxy" proxy >/dev/null
  [ -d "$qaDir/runtime" ] && [ ! -L "$qaDir/runtime" ] && [ "$(realpath -e "$qaDir/runtime")" = "$qaDir/runtime" ] && [ -S "$socket" ] || fail 'QA Unix socket is missing or redirected.'
  diagnostic_phase=verify-database
  qaCounts="$(qa_database inspect)" || fail 'Disposable QA database verification failed.'
  real_stage
}
cleanup_owned() {
  diagnostic_phase=cleanup
  qa_path
  local name role target
  # Validate the entire owned graph before removing its first resource.
  for role in proxy app; do
    name="$prefix-$role"
    if docker container inspect "$name" >/dev/null 2>&1; then inspect_owned container "$name" "$role" >/dev/null; fi
  done
  if docker network inspect "$network" >/dev/null 2>&1; then inspect_owned network "$network" net >/dev/null; fi
  if docker volume inspect "$volume" >/dev/null 2>&1; then inspect_owned volume "$volume" data >/dev/null; fi
  for role in proxy app; do
    name="$prefix-$role"
    if docker container inspect "$name" >/dev/null 2>&1; then
      target="$(inspect_owned container "$name" "$role")"
      docker container rm -f "$target" >/dev/null
    fi
  done
  if docker network inspect "$network" >/dev/null 2>&1; then target="$(inspect_owned network "$network" net)"; docker network rm "$target" >/dev/null; fi
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    inspect_owned volume "$volume" data >/dev/null
    [ -z "$(docker ps -aq --filter "volume=$volume")" ] || fail 'QA volume is mounted by an unexpected container.'
    docker volume rm "$volume" >/dev/null
  fi
  qa_path
  rm -rf -- "$qaDir"
}
# EXIT trap: a failed action removes what it owns, then exits with its own status.
cleanup_on_failure() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then cleanup_owned || true; fi
  exit "$status"
}
platform
# Match the deployment and operations lock so their stopped-source backups cannot
# overlap a QA action's real-stage read. The controller holds no outer lock.
diagnostic_phase='stage-lock'
[ ! -L "$stage/.deploy.lock" ] || fail 'The staging lock must not be a symlink.'
if [ -e "$stage/.deploy.lock" ]; then
  [ -f "$stage/.deploy.lock" ] && [ "$(stat -c %u -- "$stage/.deploy.lock")" = 1002 ] || fail 'The staging lock must be an owned regular file.'
fi
exec 9> "$stage/.deploy.lock"
flock -w 30 9 || fail 'A staging operation is still holding the shared lock.'
if [ "$action" != cleanup ]; then real_stage; fi
if [ "$action" = prepare ]; then
  diagnostic_phase=prepare-path
  if [ ! -e "$qaRoot" ] && [ ! -L "$qaRoot" ]; then mkdir -m 700 -- "$qaRoot"; fi
  owned_dir "$qaRoot" || fail 'QA parent is not private.'
  [ ! -e "$qaDir" ] && [ ! -L "$qaDir" ] || fail 'QA ID already exists.'
  for pair in "container:$app" "container:$proxy" "network:$network" "volume:$volume"; do
    if docker "${pair%%:*}" inspect "${pair#*:}" >/dev/null 2>&1; then fail 'A QA resource name already exists.'; fi
  done
  mkdir -m 700 -- "$qaDir"
  printf 'bangla-private-qa:%s\n' "$qaId" > "$qaDir/.qa-marker"
  trap cleanup_on_failure EXIT
  mkdir -m 1777 -- "$qaDir/runtime"
  [ -f "$stage/tools/private-staging-proxy.mjs" ] && [ ! -L "$stage/tools/private-staging-proxy.mjs" ] && [ "$(realpath -e "$stage/tools/private-staging-proxy.mjs")" = "$stage/tools/private-staging-proxy.mjs" ] && [ "$(stat -c %u "$stage/tools/private-staging-proxy.mjs")" = 1002 ] || fail 'The audited staging proxy is missing.'
  cp -- "$stage/tools/private-staging-proxy.mjs" "$qaDir/private-staging-proxy.mjs"
  chmod 644 "$qaDir/private-staging-proxy.mjs"
  printf '{"qa":true,"qa_id":"%s","expectedrevision":"%s"}\n' "$qaId" "$revision" > "$qaDir/proof.json"
  chmod 644 "$qaDir/proof.json"
  labels=(--label io.bangla.scope=private-qa --label "io.bangla.private-qa.id=$qaId")
  diagnostic_phase=prepare-network
  remember net "$(docker network create --internal "${labels[@]}" --label io.bangla.private-qa.kind=net "$network")"
  inspect_owned network "$network" net >/dev/null
  diagnostic_phase=prepare-volume
  docker volume create "${labels[@]}" --label io.bangla.private-qa.kind=data "$volume" >/dev/null
  inspect_owned volume "$volume" data >/dev/null
  diagnostic_phase=prepare-app
  remember app "$(docker container create --name "$app" "${labels[@]}" --label io.bangla.private-qa.kind=app --network "$network" --network-alias app --user node --init --cap-drop ALL --security-opt no-new-privileges:true --memory 512m --pids-limit 128 --mount "type=volume,source=$volume,target=/app/.data" --env NODE_ENV=production --env PORT=3000 --env PLATFORM_MODE=legacy --env DATABASE_PATH=/app/.data/bangla-adventures.db --env MEDIA_ROOT=/app/.data/media --env PUBLIC_ORIGIN=http://127.0.0.1:3001 --env NEXT_TELEMETRY_DISABLED=1 "$image")"
  appTarget="$(inspect_owned container "$app" app)"
  diagnostic_phase=prepare-proof-copy
  docker cp "$qaDir/proof.json" "$appTarget:/app/public/robots.txt"
  inspect_owned container "$app" app >/dev/null
  diagnostic_phase=prepare-app-start
  docker container start "$(cat "$qaDir/app.id")" >/dev/null
  diagnostic_phase=prepare-proxy
  remember proxy "$(docker container create --name "$proxy" "${labels[@]}" --label io.bangla.private-qa.kind=proxy --network "$network" --user node --init --read-only --cap-drop ALL --security-opt no-new-privileges:true --memory 128m --pids-limit 64 --entrypoint node --mount "type=bind,source=$qaDir/runtime,target=/runtime" --mount "type=bind,source=$qaDir/private-staging-proxy.mjs,target=/app/staging-tools/private-staging-proxy.mjs,readonly" "$image" /app/staging-tools/private-staging-proxy.mjs)"
  inspect_owned container "$proxy" proxy >/dev/null
  diagnostic_phase=prepare-proxy-start
  docker container start "$(cat "$qaDir/proxy.id")" >/dev/null
  diagnostic_phase=prepare-ready
  ready=false
  for _ in {1..30}; do
    proxyTarget="$(inspect_owned container "$proxy" proxy)"
    # Static public files can be ready before getDb() creates the fresh database.
    # First attest this clone's marker, then require the database-backed health route.
    if docker exec "$proxyTarget" node -e "require('node:http').get({socketPath:'/runtime/http.sock',path:'/robots.txt'},r=>{let s='';r.on('data',x=>s+=x);r.on('end',()=>{try{const x=JSON.parse(s);if(!(r.statusCode===200&&x.qa===true&&x.qa_id==='$qaId'&&x.expectedrevision==='$revision'))process.exit(1);require('node:http').get({socketPath:'/runtime/http.sock',path:'/api/health'},h=>{h.resume();process.exit(h.statusCode===200?0:1)}).on('error',()=>process.exit(1))}catch{process.exit(1)}})}).on('error',()=>process.exit(1))" >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  [ "$ready" = true ] || fail 'QA app did not expose its clone-only identity proof and database health.'
  qa_database capture > "$qaDir/.content-baseline"
  chmod 0600 "$qaDir/.content-baseline"
  verify_all
  trap - EXIT
elif [ "$action" = verify ]; then
  verify_all
elif [ "$action" = approve-fixtures ]; then
  diagnostic_phase=approve-fixtures
  qa_path
  trap cleanup_on_failure EXIT
  verify_all
  qaCounts="$(qa_database approve)" || fail 'Only the two fixed synthetic identities can be approved.'
  verify_all
  trap - EXIT
  printf '{"verified":true,"qaId":"%s","approvedAdults":1,"approvedStudents":1,"noContentApprovals":true}\n' "$qaId"
  exit 0
elif [ "$action" = bootstrap-admin ]; then
  diagnostic_phase=bootstrap-admin
  qa_path
  trap cleanup_on_failure EXIT
  verify_all
  qaCounts="$(qa_database bootstrap-admin)" || fail 'Only the exact namespace administrator can be bootstrapped.'
  verify_all
  trap - EXIT
  printf '{"verified":true,"qaId":"%s","bootstrapAdmin":true,"approvedAdults":1,"approvedStudents":0,"noContentApprovals":true}\n' "$qaId"
  exit 0
else
  if [ ! -e "$qaDir" ] && [ ! -L "$qaDir" ]; then
    for pair in "container:$app" "container:$proxy" "network:$network" "volume:$volume"; do
      if docker "${pair%%:*}" inspect "${pair#*:}" >/dev/null 2>&1; then fail 'A resource exists without its owned QA path.'; fi
    done
    real_stage
    printf '{"verified":true,"qaId":"%s","removed":true,"actualStage":{"users":0,"pendingTopics":15,"pendingLessons":18}}\n' "$qaId"
    exit 0
  fi
  qa_path
  cleanup_owned
  real_stage
  printf '{"verified":true,"qaId":"%s","removed":true,"actualStage":{"users":0,"pendingTopics":15,"pendingLessons":18}}\n' "$qaId"
  exit 0
fi
printf '{"verified":true,"kind":"bangla-private-qa","qaId":"%s","imageDigest":"%s","baseURL":"http://127.0.0.1:3001","isolated":true,"socket":"%s","actualStage":{"users":0,"pendingTopics":15,"pendingLessons":18},"qa":%s,"prepared":%s}\n' "$qaId" "$digest" "$socket" "$qaCounts" "$([ "$action" = prepare ] && printf true || printf false)"
