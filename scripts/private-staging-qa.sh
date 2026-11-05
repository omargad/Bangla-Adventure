#!/usr/bin/env bash
# Disposable authentication QA only. Never mount the real staging or production data volume.
set -euo pipefail
set +x
umask 077
readonly stage=/opt/bangla-adventures/private-staging
readonly socketDaemon=/run/user/1002/docker.sock
readonly image=ghcr.io/omargad/bangla-adventure@sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2
readonly revision=95b6308ac7ad3d5b6bb2d951df9d65a23ff77107
readonly digest=sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2
fail() { printf 'private QA refused: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 2 ] || fail 'Expected prepare, verify, approve-fixtures or cleanup and a 24-character hexadecimal ID.'
readonly action="$1" qaId="$2"
case "$action" in prepare|verify|approve-fixtures|cleanup) ;; *) fail 'Unknown action.' ;; esac
[[ "$qaId" =~ ^[a-f0-9]{24}$ ]] || fail 'Invalid QA ID.'
readonly qaRoot="$stage/qa" qaDir="$stage/qa/$qaId"
readonly socket="$qaDir/runtime/http.sock" prefix="ba-private-qa-$qaId"
readonly app="$prefix-app" proxy="$prefix-proxy" network="$prefix-net" volume="$prefix-data"
docker() { command env -u DOCKER_HOST -u DOCKER_CONTEXT docker --host "unix://$socketDaemon" "$@"; }
owned_dir() { [ -d "$1" ] && [ ! -L "$1" ] && [ "$(realpath -e -- "$1")" = "$1" ] && [ "$(stat -c '%u:%a' -- "$1")" = 1002:700 ]; }
platform() {
  [ "$(id -un)" = deployer ] && [ "$(id -u)" = 1002 ] || fail 'The dedicated deployment user is required.'
  owned_dir "$stage" || fail 'The private staging directory is not the expected private directory.'
  [ -f "$stage/.private-staging-marker" ] && [ ! -L "$stage/.private-staging-marker" ] && [ "$(stat -c %u -- "$stage/.private-staging-marker")" = 1002 ] || fail 'Missing owned staging marker.'
  python3 -c 'import pathlib,sys; assert pathlib.Path(sys.argv[1]).read_bytes()==b"bangla-adventures-private-staging-v1\n"' "$stage/.private-staging-marker" || fail 'Staging marker mismatch.'
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
 assert all(not value for value in x["NetworkSettings"].get("Ports",{}).values())
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
  local target
  target="$(inspect_owned container "$app" app)"
  # The only write mode approves two browser-created synthetic identities, never content.
  docker exec -i "$target" node --input-type=module - "$qaId" "$1" <<'JS'
import Database from 'better-sqlite3';
const [id,mode]=process.argv.slice(2), db=new Database('/app/.data/bangla-adventures.db',{readonly:mode!=='approve',fileMustExist:true});
const check=(ok)=>{if(!ok)throw new Error('QA namespace or unpublished content changed');};
try {
 check(/^[a-f0-9]{24}$/.test(id));
 const adults=db.prepare('SELECT email,role,status,teacher_status,must_change_password FROM adults').all(), students=db.prepare('SELECT username,status,must_change_password FROM students').all();
 check(adults.length<=1&&adults.every(x=>x.email===`qa-${id}@example.invalid`&&x.role==='parent'&&x.status==='active'&&x.teacher_status==='none'&&!x.must_change_password));
 check(students.length<=1&&students.every(x=>x.username===`qa-${id}-student`&&x.status==='active'&&!x.must_change_password));
 for(const [table,n] of [['topic_versions',15],['lesson_versions',18]])check(db.prepare(`SELECT count(*) n FROM ${table} WHERE status='pending' AND version=1 AND baseline=0`).get().n===n&&db.prepare(`SELECT count(*) n FROM ${table}`).get().n===n);
 for(const table of ['content_approvals','video_reviews','media_assets','classes','class_activities','class_sources','learner_profiles','assignments','skill_progress','student_topic_progress'])check(db.prepare(`SELECT count(*) n FROM ${table}`).get().n===0);
 if(mode==='approve'){
  check(adults.length===1&&students.length===1);
  db.transaction(()=>{
   check(db.prepare("UPDATE adults SET approval_status='approved' WHERE email=? AND role='parent' AND status='active'").run(`qa-${id}@example.invalid`).changes===1);
   check(db.prepare("UPDATE students SET approval_status='approved' WHERE username=? AND status='active'").run(`qa-${id}-student`).changes===1);
  })();
 }
 console.log(JSON.stringify({users:adults.length+students.length,pendingTopics:15,pendingLessons:18}));
}finally{db.close();}
JS
}
verify_all() {
  qa_path
  inspect_owned network "$network" net >/dev/null
  inspect_owned volume "$volume" data >/dev/null
  inspect_owned container "$app" app >/dev/null
  inspect_owned container "$proxy" proxy >/dev/null
  [ -d "$qaDir/runtime" ] && [ ! -L "$qaDir/runtime" ] && [ "$(realpath -e "$qaDir/runtime")" = "$qaDir/runtime" ] && [ -S "$socket" ] || fail 'QA Unix socket is missing or redirected.'
  qaCounts="$(qa_database inspect)" || fail 'Disposable QA database verification failed.'
  real_stage
}
cleanup_owned() {
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
platform
if [ "$action" != cleanup ]; then real_stage; fi
if [ "$action" = prepare ]; then
  if [ ! -e "$qaRoot" ] && [ ! -L "$qaRoot" ]; then mkdir -m 700 -- "$qaRoot"; fi
  owned_dir "$qaRoot" || fail 'QA parent is not private.'
  [ ! -e "$qaDir" ] && [ ! -L "$qaDir" ] || fail 'QA ID already exists.'
  for pair in "container:$app" "container:$proxy" "network:$network" "volume:$volume"; do
    if docker "${pair%%:*}" inspect "${pair#*:}" >/dev/null 2>&1; then fail 'A QA resource name already exists.'; fi
  done
  mkdir -m 700 -- "$qaDir"
  printf 'bangla-private-qa:%s\n' "$qaId" > "$qaDir/.qa-marker"
  trap 'status=$?; trap - EXIT; if [ "$status" -ne 0 ]; then cleanup_owned || true; fi; exit "$status"' EXIT
  mkdir -m 1777 -- "$qaDir/runtime"
  [ -f "$stage/tools/private-staging-proxy.mjs" ] && [ ! -L "$stage/tools/private-staging-proxy.mjs" ] && [ "$(realpath -e "$stage/tools/private-staging-proxy.mjs")" = "$stage/tools/private-staging-proxy.mjs" ] && [ "$(stat -c %u "$stage/tools/private-staging-proxy.mjs")" = 1002 ] || fail 'The audited staging proxy is missing.'
  cp -- "$stage/tools/private-staging-proxy.mjs" "$qaDir/private-staging-proxy.mjs"
  chmod 644 "$qaDir/private-staging-proxy.mjs"
  printf '{"qa":true,"qa_id":"%s","expectedrevision":"%s"}\n' "$qaId" "$revision" > "$qaDir/proof.json"
  chmod 644 "$qaDir/proof.json"
  labels=(--label io.bangla.scope=private-qa --label "io.bangla.private-qa.id=$qaId")
  remember net "$(docker network create --internal "${labels[@]}" --label io.bangla.private-qa.kind=net "$network")"
  inspect_owned network "$network" net >/dev/null
  docker volume create "${labels[@]}" --label io.bangla.private-qa.kind=data "$volume" >/dev/null
  inspect_owned volume "$volume" data >/dev/null
  remember app "$(docker container create --name "$app" "${labels[@]}" --label io.bangla.private-qa.kind=app --network "$network" --network-alias app --user node --init --cap-drop ALL --security-opt no-new-privileges:true --memory 512m --pids-limit 128 --mount "type=volume,source=$volume,target=/app/.data" --env NODE_ENV=production --env PORT=3000 --env PLATFORM_MODE=legacy --env DATABASE_PATH=/app/.data/bangla-adventures.db --env MEDIA_ROOT=/app/.data/media --env PUBLIC_ORIGIN=http://127.0.0.1:3001 --env NEXT_TELEMETRY_DISABLED=1 "$image")"
  appTarget="$(inspect_owned container "$app" app)"
  docker cp "$qaDir/proof.json" "$appTarget:/app/public/__private-staging-qa.json"
  inspect_owned container "$app" app >/dev/null
  docker container start "$(cat "$qaDir/app.id")" >/dev/null
  remember proxy "$(docker container create --name "$proxy" "${labels[@]}" --label io.bangla.private-qa.kind=proxy --network "$network" --user node --init --read-only --cap-drop ALL --security-opt no-new-privileges:true --memory 128m --pids-limit 64 --entrypoint node --mount "type=bind,source=$qaDir/runtime,target=/runtime" --mount "type=bind,source=$qaDir/private-staging-proxy.mjs,target=/app/staging-tools/private-staging-proxy.mjs,readonly" "$image" /app/staging-tools/private-staging-proxy.mjs)"
  inspect_owned container "$proxy" proxy >/dev/null
  docker container start "$(cat "$qaDir/proxy.id")" >/dev/null
  ready=false
  for attempt in {1..30}; do
    proxyTarget="$(inspect_owned container "$proxy" proxy)"
    if docker exec "$proxyTarget" node -e "require('node:http').get({socketPath:'/runtime/http.sock',path:'/__private-staging-qa.json'},r=>{let s='';r.on('data',x=>s+=x);r.on('end',()=>{try{const x=JSON.parse(s);process.exit(r.statusCode===200&&x.qa===true&&x.qa_id==='$qaId'&&x.expectedrevision==='$revision'?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1))" >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  [ "$ready" = true ] || fail 'QA app did not expose its clone-only identity proof.'
  verify_all
  trap - EXIT
elif [ "$action" = verify ]; then
  verify_all
elif [ "$action" = approve-fixtures ]; then
  qa_path
  trap 'status=$?; trap - EXIT; if [ "$status" -ne 0 ]; then cleanup_owned || true; fi; exit "$status"' EXIT
  verify_all
  qaCounts="$(qa_database approve)" || fail 'Only the two fixed synthetic identities can be approved.'
  verify_all
  trap - EXIT
  printf '{"verified":true,"qaId":"%s","approvedAdults":1,"approvedStudents":1,"noContentApprovals":true}\n' "$qaId"
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
