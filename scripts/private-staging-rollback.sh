#!/usr/bin/env bash
# Exercises the unchanged deployment engine against a disposable, portless clone.
# RUN_ID is a fresh 24-lowercase-hex namespace. No credentials are accepted.
set -Eeuo pipefail
set +x
umask 077
readonly stage=/opt/bangla-adventures/private-staging
readonly daemon=unix:///run/user/1002/docker.sock
readonly image=ghcr.io/omargad/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13
readonly revision=a709cb3d2bc9fb0a271e6814bc96d1f16444c94f
phase=platform
diagnostic() { printf 'PRIVATE_ROLLBACK_DIAGNOSTIC:%s\n' "$phase" >&2; }
trap diagnostic ERR
fail() { diagnostic; printf 'private rollback rehearsal: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 1 ] && [[ "$1" =~ ^[a-f0-9]{24}$ ]] || fail 'a fresh 24-character hexadecimal ID is required.'
readonly run_id="$1" prefix="ba-private-rollback-$1"
readonly root="$stage/rollback/$run_id" project="$prefix" volume="$prefix-data" network="${prefix}_default"
readonly builder="$prefix-builder" initializer="$prefix-init" candidate="$prefix:unhealthy"
readonly source_dir="/tmp/ba-private-rollback-$run_id" source_tmp="/tmp/ba-private-rollback-$run_id/snapshot.db"
readonly export_token="$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
readonly payload="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
owned_dir() { [ -d "$1" ] && [ ! -L "$1" ] && [ "$(realpath -e -- "$1")" = "$1" ] && [ "$(stat -c '%u:%a' -- "$1")" = 1002:700 ]; }
docker() { command env -u DOCKER_CONTEXT -u DOCKER_HOST docker --host "$daemon" "$@"; }
compose() { (cd "$root" && env -u APP_IMAGE -u COMPOSE_PROJECT_NAME -u COMPOSE_FILE -u DOCKER_CONTEXT DOCKER_HOST="$daemon" docker compose --env-file "$root/.env" --project-name "$project" --file "$root/compose.yaml" "$@"); }

[ "$(id -un)" = deployer ] && [ "$(id -u)" = 1002 ] || fail 'the dedicated deploy user is required.'
owned_dir "$stage" && [ -f "$stage/.private-staging-marker" ] && [ ! -L "$stage/.private-staging-marker" ] || fail 'the managed private stage is unavailable.'
[ "$(cat "$stage/.private-staging-marker")" = bangla-adventures-private-staging-v1 ] || fail 'the staging marker changed.'
[[ "$payload" =~ ^/opt/bangla-adventures/\.private-acceptance-payload\.[a-zA-Z0-9]{12}$ ]] && owned_dir "$payload" || fail 'helpers must come from the owned acceptance payload.'
for file in deploy-remote.sh private-staging-verify.mjs; do
  [ -f "$payload/$file" ] && [ ! -L "$payload/$file" ] && [ "$(stat -c %u -- "$payload/$file")" = 1002 ] || fail 'a reviewed helper is missing or linked.'
done
[ -S /run/user/1002/docker.sock ] && [ ! -L /run/user/1002/docker.sock ] && [ "$(stat -c %u /run/user/1002/docker.sock)" = 1002 ] || fail 'the fixed rootless socket is unavailable.'
docker info --format '{{json .SecurityOptions}}' | python3 -c 'import json,sys;assert "name=rootless" in json.load(sys.stdin)' || fail 'the selected engine is not rootless.'
image_id="$(docker image inspect "$image" | python3 -c 'import json,sys;x,=json.load(sys.stdin);assert sys.argv[1] in x["RepoDigests"];assert x["Config"]["Labels"]["org.opencontainers.image.revision"]==sys.argv[2];print(x["Id"])' "$image" "$revision")" || fail 'the exact tested image is unavailable.'
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'the tested image ID is invalid.'
[ ! -L "$stage/.deploy.lock" ] && [ -f "$stage/.deploy.lock" ] && [ "$(stat -c %u "$stage/.deploy.lock")" = 1002 ] || fail 'the staging lock is not an owned regular file.'
exec 8> "$stage/.deploy.lock"
flock -n 8 || fail 'another staging operation is running.'

source_id="$(docker ps --all --quiet --no-trunc --filter label=com.docker.compose.project=bangla-adventures-staging --filter label=com.docker.compose.service=app)"
[[ "$source_id" =~ ^[a-f0-9]{64}$ ]] || fail 'exactly one source staging app is required.'
docker container inspect "$source_id" | python3 -c '
import json,sys
x,=json.load(sys.stdin)
assert x["Id"]==sys.argv[1] and x["Image"]==sys.argv[2] and x["State"]["Running"] and x["State"]["Health"]["Status"]=="healthy"
assert x["Config"]["User"]=="node" and not x["HostConfig"].get("Privileged") and x["HostConfig"]["NetworkMode"]=="bangla-adventures-staging_default"
assert x["Config"]["Labels"]["com.docker.compose.project"]=="bangla-adventures-staging" and x["Config"]["Labels"]["com.docker.compose.service"]=="app"
assert not x["HostConfig"].get("PortBindings") and not x["HostConfig"].get("PublishAllPorts")
assert len(x["Mounts"])==2
assert any(m["Type"]=="volume" and m["Name"]=="bangla-adventures-staging_bangla-data" and m["Destination"]=="/app/.data" for m in x["Mounts"])
assert any(m["Type"]=="bind" and m["Source"]==sys.argv[3]+"/tools/private-staging-verify.mjs" and m["Destination"]=="/app/staging-tools/private-staging-verify.mjs" and not m["RW"] for m in x["Mounts"])
' "$source_id" "$image_id" "$stage" || fail 'the source staging app identity changed.'
source_before="$(docker exec "$source_id" node /app/staging-tools/private-staging-verify.mjs)" || fail 'the source staging state is not clean.'
source_digest="$(python3 - "$source_before" <<'PY'
import json,re,sys
x=json.loads(sys.argv[1]);assert x['verified'] is True
assert x['counts']==dict(pendingTopics=15,pendingLessons=18,shippedStates=33,users=0,approvals=0,baselines=0,businessRows=0,mediaFiles=0)
assert re.fullmatch('[a-f0-9]{64}',x['stateDigest']);print(x['stateDigest'])
PY
)" || fail 'the source staging aggregate is unexpected.'

if [ ! -e "$stage/rollback" ] && [ ! -L "$stage/rollback" ]; then mkdir -m 700 -- "$stage/rollback"; fi
owned_dir "$stage/rollback" || fail 'the private rehearsal parent is unsafe.'
[ ! -e "$root" ] && [ ! -L "$root" ] || fail 'the rehearsal namespace already exists.'
for pair in "container:$builder" "container:$initializer" "volume:$volume" "network:$network" "image:$candidate"; do
  if docker "${pair%%:*}" inspect "${pair#*:}" >/dev/null 2>&1; then fail 'a rehearsal resource already exists.'; fi
done
[ -z "$(docker ps --all --quiet --filter "label=com.docker.compose.project=$project")" ] || fail 'the rehearsal project is already in use.'
mkdir -m 700 -- "$root"
printf 'bangla-private-rollback:%s\n' "$run_id" > "$root/.rollback-marker"
engine_pid='' candidate_id='' created_volume=false created_image=false source_export=false
labels=(--label io.bangla.scope=private-rollback --label "io.bangla.private-rollback.id=$run_id")

inspect_graph() {
  local ids
  ids="$(docker ps --all --quiet --no-trunc --filter "label=com.docker.compose.project=$project")"
  if [ -n "$ids" ]; then
    local -a selected=()
    while IFS= read -r cid; do [[ "$cid" =~ ^[a-f0-9]{64}$ ]] || return 1; selected+=("$cid"); done <<< "$ids"
    docker inspect "${selected[@]}" | python3 -c '
import json,sys
project,runid,vol,network,root,good,bad=sys.argv[1:]
for c in json.load(sys.stdin):
 l=c["Config"].get("Labels") or {};h=c["HostConfig"]
 assert l.get("com.docker.compose.project")==project and l.get("io.bangla.scope")=="private-rollback" and l.get("io.bangla.private-rollback.id")==runid
 assert l.get("com.docker.compose.service")=="app" and l.get("io.bangla.private-rollback.phase") in ("previous","candidate")
 assert c["Config"]["Image"] in (good,bad) and c["Config"]["User"]=="node"
 assert not h.get("PortBindings") and not h.get("PublishAllPorts") and not h.get("Privileged")
 assert not h.get("CapAdd") and "ALL" in h["CapDrop"] and any(v.startswith("no-new-privileges") for v in h["SecurityOpt"])
 assert all(not v for v in (c.get("NetworkSettings",{}).get("Ports") or {}).values())
 assert h["NetworkMode"]==network and list(c["NetworkSettings"]["Networks"])==[network]
 m=c["Mounts"];assert len(m) in (2,3) and len({v["Destination"] for v in m})==len(m)
 assert all(v["Destination"] in ("/app/.data","/app/staging-tools/private-staging-verify.mjs","/backups") for v in m)
 assert any(v["Type"]=="volume" and v["Name"]==vol and v["Destination"]=="/app/.data" for v in m)
 assert any(v["Destination"]=="/app/staging-tools/private-staging-verify.mjs" for v in m)
 for v in m:
  if v["Destination"]=="/app/staging-tools/private-staging-verify.mjs":assert v["Type"]=="bind" and v["Source"]==root+"/private-staging-verify.mjs" and not v["RW"]
  if v["Destination"]=="/backups":assert v["Type"]=="bind" and v["Source"]==root+"/backups"
' "$project" "$run_id" "$volume" "$network" "$root" "$image" "$candidate" || return 1
  fi
  for kind in volume network; do
    local name="$volume";[ "$kind" != network ] || name="$network"
    if docker "$kind" inspect "$name" >/dev/null 2>&1; then
      docker "$kind" inspect "$name" | python3 -c 'import json,sys;x,=json.load(sys.stdin);l=x.get("Labels") or {};assert l.get("io.bangla.scope")=="private-rollback" and l.get("io.bangla.private-rollback.id")==sys.argv[1];assert sys.argv[2]!="network" or x["Internal"]' "$run_id" "$kind" || return 1
    fi
  done
}
owned_container() {
  docker container inspect "$1" | python3 -c 'import json,sys;x,=json.load(sys.stdin);l=x["Config"].get("Labels") or {};assert l.get("io.bangla.scope")=="private-rollback" and l.get("io.bangla.private-rollback.id")==sys.argv[1] and x["Name"]=="/"+sys.argv[2]' "$run_id" "$1"
}
remove_source_export() {
  docker exec -i "$source_id" node --input-type=module - "$source_dir" "$export_token" <<'JS'
import fs from 'node:fs';
const [dir,token]=process.argv.slice(2);
if(!/^\/tmp\/ba-private-rollback-[a-f0-9]{24}$/.test(dir)||!(/^[a-f0-9]{32}$/).test(token))process.exit(1);
if(!fs.existsSync(dir))process.exit(0);
const stat=fs.lstatSync(dir),owner=dir+'/.owner';
if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)process.exit(1);
const marker=fs.lstatSync(owner);
if(!marker.isFile()||marker.isSymbolicLink()||marker.uid!==process.getuid()||(marker.mode&0o777)!==0o600||fs.readFileSync(owner,'utf8')!==token)process.exit(1);
const names=fs.readdirSync(dir);
if(names.some(n=>!['.owner','snapshot.db'].includes(n)))process.exit(1);
for(const name of names){const s=fs.lstatSync(dir+'/'+name);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid())process.exit(1);}
for(const name of names)fs.unlinkSync(dir+'/'+name);
fs.rmdirSync(dir);
JS
}
cleanup() {
  local status=$?
  phase=cleanup
  trap - EXIT
  if [ -n "$engine_pid" ] && kill -0 "$engine_pid" 2>/dev/null; then kill -TERM "$engine_pid" 2>/dev/null || true; wait "$engine_pid" 2>/dev/null || true; fi
  if [ "$source_export" = true ]; then remove_source_export >/dev/null 2>&1 || status=1; fi
  if ! owned_dir "$root" || [ ! -f "$root/.rollback-marker" ] || [ -L "$root/.rollback-marker" ] || [ "$(stat -c '%u:%a' "$root/.rollback-marker")" != 1002:600 ] || [ "$(cat "$root/.rollback-marker" 2>/dev/null)" != "bangla-private-rollback:$run_id" ] || ! inspect_graph; then
    diagnostic
    printf 'private rollback rehearsal: cleanup ownership verification failed.\n' >&2
    exit 1
  fi
  if [ -f "$root/compose.yaml" ]; then compose down --volumes --remove-orphans >/dev/null 2>&1 || status=1; fi
  for name in "$builder" "$initializer"; do
    if docker container inspect "$name" >/dev/null 2>&1; then owned_container "$name" && docker container rm -f "$name" >/dev/null 2>&1 || status=1; fi
  done
  if [ "$created_image" = true ] && docker image inspect "$candidate" >/dev/null 2>&1; then
    docker image inspect "$candidate" | python3 -c 'import json,sys;x,=json.load(sys.stdin);l=x["Config"]["Labels"];assert l["io.bangla.scope"]=="private-rollback" and l["io.bangla.private-rollback.id"]==sys.argv[1] and x["Id"]==sys.argv[2]' "$run_id" "$candidate_id" && docker image rm "$candidate" >/dev/null 2>&1 || status=1
  fi
  if [ "$created_volume" = true ] && docker volume inspect "$volume" >/dev/null 2>&1; then
    [ -z "$(docker ps --all --quiet --filter "volume=$volume")" ] && docker volume rm "$volume" >/dev/null 2>&1 || status=1
  fi
  # Backup archives inside this owned disposable directory belong to mapped uid1000.
  if [ -d "$root/backups" ]; then
    if [ -L "$root/backups" ] || [ "$(realpath -e "$root/backups")" != "$root/backups" ]; then status=1
    else docker run --rm --network none --user root --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add CHOWN --security-opt no-new-privileges:true --entrypoint sh --mount "type=bind,source=$root/backups,target=/backups" "$image" -c 'rm -rf -- /backups/* /backups/.[!.]* /backups/..?* && chown 0:0 /backups && chmod 0700 /backups' >/dev/null 2>&1 || status=1
    fi
  fi
  if [ "$status" -eq 0 ]; then rm -rf -- "$root"; else printf 'private rollback rehearsal: owned recovery files retained.\n' >&2; fi
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A disconnected runner must not interrupt the engine halfway through automatic recovery.
trap '' HUP

# Online SQLite backup is made outside .data, then removed; the live source never stops.
phase=export
source_export=true
docker exec -i "$source_id" node --input-type=module - "$source_dir" "$export_token" <<'JS' >/dev/null
import Database from 'better-sqlite3';
import fs from 'node:fs';
const [dir,token]=process.argv.slice(2),file=dir+'/snapshot.db';
if(!/^\/tmp\/ba-private-rollback-[a-f0-9]{24}$/.test(dir)||!(/^[a-f0-9]{32}$/).test(token))process.exit(1);
fs.mkdirSync(dir,{mode:0o700});
fs.writeFileSync(dir+'/.owner',token,{flag:'wx',mode:0o600});
const db=new Database('/app/.data/bangla-adventures.db',{readonly:true,fileMustExist:true});
try{await db.backup(file);fs.chmodSync(file,0o600);}finally{db.close();}
JS
docker cp "$source_id:$source_tmp" "$root/snapshot.db" >/dev/null
chmod 600 "$root/snapshot.db"
remove_source_export >/dev/null
source_export=false
phase=clone
docker volume create "${labels[@]}" --label "com.docker.compose.project=$project" "$volume" >/dev/null
created_volume=true
inspect_graph || fail 'the new clone volume is not owned.'
docker run --rm --name "$initializer" "${labels[@]}" --network none --user root --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --security-opt no-new-privileges:true --entrypoint sh --mount "type=volume,source=$volume,target=/clone" --mount "type=bind,source=$root,target=/fixture,readonly" "$image" -c 'mkdir -p /clone/media && cp /fixture/snapshot.db /clone/bangla-adventures.db && chmod 0700 /clone /clone/media && chmod 0600 /clone/bangla-adventures.db && chown -R 1000:1000 /clone' >/dev/null
cp -- "$payload/private-staging-verify.mjs" "$root/private-staging-verify.mjs"
chmod 644 "$root/private-staging-verify.mjs"
cp -- "$payload/deploy-remote.sh" "$root/deploy-remote.sh"
printf '\n# Previous disposable fixture configuration.\n' >> "$root/deploy-remote.sh"
chmod 600 "$root/deploy-remote.sh"
printf 'PUBLIC_ORIGIN=http://127.0.0.1:3001\nCOMPOSE_PROJECT_NAME=%s\nAPP_IMAGE=%s\n' "$project" "$image" > "$root/.env"
python3 - "$root" "$project" "$volume" "$run_id" <<'PY'
import json,pathlib,sys
root,project,volume,runid=sys.argv[1:]
labels={'io.bangla.scope':'private-rollback','io.bangla.private-rollback.id':runid,'io.bangla.private-rollback.phase':'previous'}
value={'name':project,'services':{'app':{'image':'${APP_IMAGE:?APP_IMAGE required}','user':'node','init':True,'restart':'no','environment':{'NODE_ENV':'production','PORT':'3000','PLATFORM_MODE':'legacy','DATABASE_PATH':'/app/.data/bangla-adventures.db','MEDIA_ROOT':'/app/.data/media','PUBLIC_ORIGIN':'http://127.0.0.1:3001','NEXT_TELEMETRY_DISABLED':'1'},'volumes':[{'type':'volume','source':'data','target':'/app/.data'},{'type':'bind','source':root+'/private-staging-verify.mjs','target':'/app/staging-tools/private-staging-verify.mjs','read_only':True}],'labels':labels,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>{console.log('status='+r.status);process.exit(r.status===200?0:1)},()=>process.exit(1))"],'interval':'1s','timeout':'2s','start_period':'1s','retries':3}}},'volumes':{'data':{'name':volume,'external':True}},'networks':{'default':{'internal':True,'labels':{'io.bangla.scope':'private-rollback','io.bangla.private-rollback.id':runid}}}}
pathlib.Path(root,'compose.yaml').write_text(json.dumps(value))
PY
phase=known-good
compose config --quiet >/dev/null
compose up --detach --no-build --wait --wait-timeout 45 app >/dev/null 2>&1 || fail 'the known-good clone did not become healthy.'
inspect_graph || fail 'the running clone is not isolated.'
before="$(compose exec -T app node /app/staging-tools/private-staging-verify.mjs --expected-state-digest "$source_digest")" || fail 'the clone does not match the clean source.'
before_digest="$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["stateDigest"])' "$before")"
compose_hash="$(sha256sum "$root/compose.yaml" | cut -d' ' -f1)"
script_hash="$(sha256sum "$root/deploy-remote.sh" | cut -d' ' -f1)"
env_hash="$(sha256sum "$root/.env" | cut -d' ' -f1)"

# A never-started, unmounted trusted container becomes a local failing fixture image.
phase=candidate
docker container create --name "$builder" "${labels[@]}" --network none --user node "$image" >/dev/null
owned_container "$builder" || fail 'the candidate builder is not owned.'
docker inspect "$builder" | python3 -c 'import json,sys;x,=json.load(sys.stdin);assert x["Image"]==sys.argv[1] and x["State"]["Status"]=="created" and not x["Mounts"]' "$image_id" || fail 'the candidate builder is not an untouched trusted image.'
candidate_id="$(docker commit --change 'CMD ["node","-e","require(\"node:http\").createServer((q,s)=>{s.writeHead(503);s.end(\"rollback fixture\")}).listen(3000,\"0.0.0.0\")"]' --change 'LABEL io.bangla.scope=private-rollback' --change "LABEL io.bangla.private-rollback.id=$run_id" "$builder" "$candidate")"
[[ "$candidate_id" =~ ^sha256:[a-f0-9]{64}$ ]] && [ "$candidate_id" != "$image_id" ] || fail 'the failing candidate is not a distinct local image.'
created_image=true
docker container rm "$builder" >/dev/null
incoming="$(mktemp -d "$root/.deploy-stage.XXXXXXXXXXXX")"
cp -- "$payload/deploy-remote.sh" "$incoming/deploy-remote.sh"
python3 - "$root/compose.yaml" "$incoming/compose.yaml" <<'PY'
import json,pathlib,sys
x=json.loads(pathlib.Path(sys.argv[1]).read_text());x['services']['app']['labels']['io.bangla.private-rollback.phase']='candidate'
pathlib.Path(sys.argv[2]).write_text(json.dumps(x))
PY
chmod 600 "$incoming/deploy-remote.sh" "$incoming/compose.yaml"
engine_hash="$(sha256sum "$payload/deploy-remote.sh" | cut -d' ' -f1)"
[ "$(sha256sum "$incoming/deploy-remote.sh" | cut -d' ' -f1)" = "$engine_hash" ] || fail 'the release engine copy changed.'
start_epoch="$(date +%s)"
# PUBLIC HTTPS remains mandatory in production CI. Only this portless fixture uses internal health.
phase=engine
bash "$incoming/deploy-remote.sh" "$candidate" '' 1 15 "$daemon" '' true '' false "$root" "$incoming" > "$root/engine.log" 2>&1 &
engine_pid=$!
candidate_status=0
for attempt in {1..120}; do
  if ! kill -0 "$engine_pid" 2>/dev/null; then break; fi
  selected="$(docker ps --quiet --no-trunc --filter "label=com.docker.compose.project=$project" --filter label=io.bangla.private-rollback.phase=candidate)"
  if [[ "$selected" =~ ^[a-f0-9]{64}$ ]] && [ "$(docker inspect --format '{{.Image}}' "$selected")" = "$candidate_id" ]; then
    candidate_status="$(docker exec "$selected" node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1000)}).then(r=>{console.log(r.status);process.exit(0)},()=>process.exit(1))" 2>/dev/null || printf 0)"
    [ "$candidate_status" != 503 ] || break
  fi
  sleep 0.25
done
engine_status=0
wait "$engine_pid" || engine_status=$?
engine_pid=''
[ "$engine_status" -ne 0 ] && [ "$candidate_status" = 503 ] || fail 'the real deployment engine did not reject an observed unhealthy candidate.'
phase=verify
end_epoch="$(( $(date +%s) + 1 ))"
docker events --since "$start_epoch" --until "$end_epoch" --filter type=container --filter "label=com.docker.compose.project=$project" --format '{{json .}}' > "$root/events.jsonl"
python3 - "$root/events.jsonl" "$candidate" "$candidate_id" <<'PY' || fail 'Docker did not report the candidate unhealthy.'
import json,pathlib,sys
events=[json.loads(line) for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if line]
assert any(e.get('Action')=='health_status: unhealthy' and e.get('Actor',{}).get('Attributes',{}).get('io.bangla.private-rollback.phase')=='candidate' and e['Actor']['Attributes'].get('image') in sys.argv[2:] for e in events)
PY
grep -Fq 'failed its health checks; rolling back the image and deployment configuration.' "$root/engine.log" || fail 'the engine health-failure path was not observed.'
grep -Fq "restoring previous image $image and its deployment configuration" "$root/engine.log" || fail 'the engine automatic rollback path was not observed.'
[ "$(sha256sum "$root/compose.yaml" | cut -d' ' -f1)" = "$compose_hash" ] || fail 'previous Compose bytes were not restored.'
[ "$(sha256sum "$root/deploy-remote.sh" | cut -d' ' -f1)" = "$script_hash" ] || fail 'previous deployment-script bytes were not restored.'
[ "$(sha256sum "$root/.env" | cut -d' ' -f1)" = "$env_hash" ] || fail 'previous environment bytes were not restored.'
inspect_graph || fail 'the recovered clone isolation changed.'
recovered="$(compose ps --all --quiet app)"
[[ "$recovered" =~ ^[a-f0-9]{12,64}$ ]] && [ "$(docker inspect --format '{{.Config.Image}}' "$recovered")" = "$image" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$recovered")" = healthy ] || fail 'the previous image was not restored healthy.'
[ "$(compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{console.log(r.status);process.exit(0)},()=>process.exit(1))")" = 200 ] || fail 'the recovered app did not return 200.'
after="$(compose exec -T app node /app/staging-tools/private-staging-verify.mjs --expected-state-digest "$before_digest")" || fail 'the recovered clone data changed.'
after_digest="$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["stateDigest"])' "$after")"
docker exec "$source_id" node /app/staging-tools/private-staging-verify.mjs --expected-state-digest "$source_digest" >/dev/null || fail 'actual staging changed during the rehearsal.'
[ "$(docker inspect --format '{{.State.Health.Status}}' "$source_id")" = healthy ] || fail 'actual staging is not healthy.'
cleanup
trap - EXIT
[ ! -e "$root" ] && [ -z "$(docker ps --all --quiet --filter "label=com.docker.compose.project=$project")" ] || fail 'the disposable rehearsal was not removed.'
! docker volume inspect "$volume" >/dev/null 2>&1 || fail 'the disposable data volume remains.'
! docker network inspect "$network" >/dev/null 2>&1 || fail 'the disposable network remains.'
! docker image inspect "$candidate" >/dev/null 2>&1 || fail 'the disposable candidate image remains.'
printf '{"kind":"private-staging-rollback","verified":true,"runId":"%s","checks":{"candidateUnhealthy":true,"automaticRollback":true,"previousImageRestored":true,"configurationRestored":true,"environmentRestored":true,"scriptRestored":true,"dataUnchanged":true,"healthRestored":true,"sourceStageUnchanged":true,"cleanupComplete":true},"sourceStage":{"users":0,"pendingTopics":15,"pendingLessons":18},"publishedPorts":0,"previousImage":"%s","candidateImageId":"%s","beforeStateDigest":"%s","afterStateDigest":"%s","candidateHealthStatus":503}\n' "$run_id" "$image" "$candidate_id" "$before_digest" "$after_digest"
