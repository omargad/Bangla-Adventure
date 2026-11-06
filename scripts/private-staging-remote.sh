#!/usr/bin/env bash
# Purpose-limited private staging transaction. Never invokes the production deployment path.
# IMAGE EXPECTED_REVISION PAYLOAD_DIRECTORY [REGISTRY_USER]; registry password on stdin only.
set -euo pipefail
umask 077
readonly parent='/opt/bangla-adventures'
readonly stage='/opt/bangla-adventures/private-staging'
readonly project='bangla-adventures-staging'
readonly data_volume='bangla-adventures-staging_bangla-data'
readonly backup_volume='bangla-adventures-staging-backups'
readonly socket='unix:///run/user/1002/docker.sock'
readonly allowed_image='ghcr.io/omargad/bangla-adventure@sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2'
readonly allowed_revision='95b6308ac7ad3d5b6bb2d951df9d65a23ff77107'
readonly marker='bangla-adventures-private-staging-v1'
image="${1:?An exact tested image is required.}"
revision="${2:?The expected image revision is required.}"
payload="${3:?An uploaded payload directory is required.}"
registry_user="${4:-}"
fail() { printf 'private staging: %s\n' "$*" >&2; exit 1; }
say() { printf 'private staging: %s\n' "$*"; }
[ "$image" = "$allowed_image" ] && [ "$revision" = "$allowed_revision" ] || fail 'image and revision are outside this reviewed staging release.'
[[ "$registry_user" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*(\[bot\])?$ || -z "$registry_user" ]] || fail 'invalid registry user.'
for command in docker python3 stat realpath flock sha256sum; do command -v "$command" >/dev/null || fail "required command $command is unavailable."; done
[ "$(id -un)" = deployer ] && [ "$(id -u)" = 1002 ] || fail 'only deployer UID 1002 may run this transaction.'
[ "$(uname -m)" = x86_64 ] || fail 'the reviewed private staging host must be x86_64.'
[ -d "$parent" ] && [ ! -L "$parent" ] && [ "$(realpath -e "$parent")" = "$parent" ] || fail 'the deployment parent is not the expected real directory.'
parent_owner="$(stat -c %u "$parent")"
parent_mode="$(stat -c %a "$parent")"
[[ "$parent_owner" = 0 || "$parent_owner" = 1002 ]] && [[ "$parent_mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$parent_mode & 2) == 0 )) && [ -w "$parent" ] && [ -x "$parent" ] || fail 'the deployment parent must be root/deployer-owned, not world-writable, and accessible to deployer.'
[[ "$payload" =~ ^/opt/bangla-adventures/\.private-stage-payload\.[a-zA-Z0-9]+$ ]] || fail 'invalid payload directory.'
[ -d "$payload" ] && [ ! -L "$payload" ] && [ "$(realpath -e "$payload")" = "$payload" ] || fail 'payload must be a real directory under the deployment parent.'
[ "$(stat -c %u "$payload")" = 1002 ] && [ "$(stat -c %a "$payload")" = 700 ] || fail 'payload ownership or permissions are unsafe.'
readonly files=(compose.yaml private-staging-proxy.mjs private-staging-remote.sh private-staging-verify.mjs private-staging-drill.sh private-staging-qa.sh)
for file in "${files[@]}"; do
  [ -f "$payload/$file" ] && [ ! -L "$payload/$file" ] && [ "$(stat -c %u "$payload/$file")" = 1002 ] || fail 'the payload contains a missing, linked or unowned file.'
done
if find "$payload" -mindepth 1 -maxdepth 1 -type l -print -quit | read -r _; then fail 'payload symlinks are not allowed.'; fi
[ -S /run/user/1002/docker.sock ] && [ ! -L /run/user/1002/docker.sock ] || fail 'the expected rootless Docker socket is unavailable.'
[ "$(stat -c %u /run/user/1002/docker.sock)" = 1002 ] && [ "$(realpath -e /run/user/1002/docker.sock)" = /run/user/1002/docker.sock ] || fail 'the Docker socket ownership or path is unexpected.'
unset DOCKER_CONTEXT COMPOSE_PROJECT_NAME COMPOSE_FILE APP_IMAGE PUBLIC_ORIGIN
export DOCKER_HOST="$socket"
security="$(docker info --format '{{json .SecurityOptions}}' 2>/dev/null)" || fail 'the selected Docker daemon is unavailable.'
[[ "$security" == *'"name=rootless"'* ]] || fail 'the selected daemon is not rootless.'
docker compose version >/dev/null || fail 'Docker Compose is unavailable.'
case "$(docker compose up --help 2>/dev/null)" in *--wait-timeout*) ;; *) fail 'Docker Compose 2.17 or later is required.';; esac

login=''
transaction=''
previous=''
previous_revision=''
previous_healthy=false
touched=false
committed=false
keep_transaction=false
compose() { STAGING_IMAGE="$1" docker compose --env-file /dev/null --project-name "$project" --project-directory "$stage" --file "$stage/compose.yaml" "${@:2}"; }
healthy_start() { compose "$1" up --detach --no-build "${@:2}" --wait --wait-timeout 180 app proxy; }
stop_own() { compose "$1" stop proxy app; }
app_id() {
  local selected actual
  selected="$(compose "$1" ps --all --quiet app)" || fail 'could not select the private staging app.'
  [[ "$selected" =~ ^[a-f0-9]{12,64}$ ]] || fail 'exactly one private staging app is required.'
  actual="$(docker inspect --format '{{.Id}}' "$selected")" || fail 'could not inspect the private staging app ID.'
  [[ "$actual" =~ ^[a-f0-9]{64}$ ]] || fail 'the private staging app ID is invalid.'
  printf '%s\n' "$actual"
}
finish() {
  local status=$?
  trap - EXIT
  if [ "$touched" = true ] && [ "$committed" != true ]; then
    stop_own "$image" >/dev/null 2>&1 || true
    if [ "$previous_healthy" = true ]; then
      local artifact
      for artifact in compose.yaml release.json; do cp -p -- "$transaction/$artifact" "$transaction/$artifact.restore" && mv -f -- "$transaction/$artifact.restore" "$stage/$artifact" || keep_transaction=true; done
      for artifact in "${files[@]:1}"; do cp -p -- "$transaction/$artifact" "$transaction/$artifact.restore" && mv -f -- "$transaction/$artifact.restore" "$stage/tools/$artifact" || keep_transaction=true; done
      if [ "$keep_transaction" = false ] && healthy_start "$previous"; then
        say 'restored the previous private staging image/configuration; database/media were not restored.'
      else
        keep_transaction=true
        say 'private staging rollback needs operator recovery; the saved configuration was retained.' >&2
      fi
    else
      write_manifest failed "$image" "$revision" || true
      say 'first private staging release failed and is stopped; its isolated data volume was retained.' >&2
    fi
    status=1
  fi
  [ -z "$login" ] || rm -rf -- "$login"
  if [ -n "$transaction" ] && [ "$keep_transaction" = false ]; then rm -rf -- "$transaction"; fi
  exit "$status"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

lock_stage() {
  [ ! -L "$stage/.deploy.lock" ] || fail 'the staging lock may not be a symlink.'
  if [ -e "$stage/.deploy.lock" ]; then
    [ -f "$stage/.deploy.lock" ] && [ "$(stat -c %u "$stage/.deploy.lock")" = 1002 ] || fail 'the staging lock is not an owned regular file.'
  fi
  exec 9> "$stage/.deploy.lock"
  flock -n 9 || fail 'another private staging transaction is running.'
}

check_volume() {
  local name="$1" labels
  if labels="$(docker volume inspect --format '{{json .Labels}}' "$name" 2>/dev/null)"; then
    python3 - "$labels" "$project" <<'PY' || fail 'a staging volume has unexpected ownership labels.'
import json,sys
v=json.loads(sys.argv[1]) or {}
assert v.get('com.docker.compose.project')==sys.argv[2] and v.get('io.bangla.scope')=='private-staging'
PY
    return 0
  fi
  return 1
}
check_containers() {
  local expected="$1" ids inspection
  ids="$(docker ps --all --quiet --filter "label=com.docker.compose.project=$project")"
  [ -n "$ids" ] || return 0
  local -a selected=()
  while IFS= read -r cid; do [[ "$cid" =~ ^[a-f0-9]{12,64}$ ]] || fail 'unexpected container identifier.'; selected+=("$cid"); done <<< "$ids"
  inspection="$(docker inspect "${selected[@]}")" || fail 'could not inspect private staging containers.'
  python3 - "$inspection" "$expected" "$project" "$data_volume" "$stage" <<'PY' || fail 'private staging container isolation check failed.'
import json,sys
containers=json.loads(sys.argv[1]); image,project,data,stage=sys.argv[2:]
for c in containers:
    cfg=c['Config']; host=c['HostConfig']; labels=cfg.get('Labels') or {}
    service=labels.get('com.docker.compose.service')
    assert labels.get('com.docker.compose.project')==project and service in ('app','proxy')
    assert cfg['Image']==image and cfg.get('User')=='node'
    assert not host.get('PortBindings') and not host.get('PublishAllPorts')
    assert all(not bindings for bindings in (c.get('NetworkSettings',{}).get('Ports') or {}).values())
    assert not host.get('Privileged') and host.get('NetworkMode')==project+'_default'
    mounts=c.get('Mounts',[])
    if service=='app':
        assert len(mounts)==2
        assert any(m.get('Type')=='volume' and m.get('Name')==data and m.get('Destination')=='/app/.data' for m in mounts)
        assert any(m.get('Type')=='bind' and m.get('Source')==stage+'/tools/private-staging-verify.mjs' and m.get('Destination')=='/app/staging-tools/private-staging-verify.mjs' and not m.get('RW') for m in mounts)
    else:
        assert host.get('ReadonlyRootfs') and len(mounts)==2
        assert any(m.get('Type')=='bind' and m.get('Source')==stage+'/runtime' and m.get('Destination')=='/runtime' for m in mounts)
        assert any(m.get('Type')=='bind' and m.get('Source')==stage+'/tools/private-staging-proxy.mjs' and m.get('Destination')=='/app/staging-tools/private-staging-proxy.mjs' and not m.get('RW') for m in mounts)
PY
}
write_manifest() {
  python3 - "$stage" "$1" "$2" "$3" "$project" "$data_volume" <<'PY'
import hashlib,json,os,sys
from pathlib import Path
root=Path(sys.argv[1]); phase,image,revision,project,volume=sys.argv[2:]
paths=['compose.yaml','tools/private-staging-proxy.mjs','tools/private-staging-remote.sh','tools/private-staging-verify.mjs','tools/private-staging-drill.sh','tools/private-staging-qa.sh']
v={'scope':'private-staging','phase':phase,'image':image,'revision':revision,'project':project,'volume':volume,'origin':'http://127.0.0.1:3001','files':{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths}}
tmp=root/'release.json.incoming'
with tmp.open('x') as out: json.dump(v,out,sort_keys=True);out.write('\n')
os.chmod(tmp,0o600);os.replace(tmp,root/'release.json')
PY
}

existing=false
if [ -e "$stage" ] || [ -L "$stage" ]; then
  existing=true
  [ -d "$stage" ] && [ ! -L "$stage" ] && [ "$(realpath -e "$stage")" = "$stage" ] || fail 'existing staging path is not a real directory.'
  [ "$(stat -c %u "$stage")" = 1002 ] && [ "$(stat -c %a "$stage")" = 700 ] || fail 'existing staging directory ownership or permissions are unsafe.'
  [ -f "$stage/.private-staging-marker" ] && [ ! -L "$stage/.private-staging-marker" ] && [ "$(cat "$stage/.private-staging-marker")" = "$marker" ] || fail 'existing stage is unmanaged.'
  lock_stage
  for file in .private-staging-marker release.json compose.yaml; do
    [ -f "$stage/$file" ] && [ ! -L "$stage/$file" ] && [ "$(stat -c %u "$stage/$file")" = 1002 ] || fail 'staging metadata is linked, absent or unowned.'
  done
  for directory in tools runtime; do
    [ -d "$stage/$directory" ] && [ ! -L "$stage/$directory" ] && [ "$(realpath -e "$stage/$directory")" = "$stage/$directory" ] && [ "$(stat -c %u "$stage/$directory")" = 1002 ] || fail 'staging runtime/tools directory is unsafe.'
  done
  if [ -e "$stage/runtime/http.sock" ] || [ -L "$stage/runtime/http.sock" ]; then
    [ -S "$stage/runtime/http.sock" ] && [ ! -L "$stage/runtime/http.sock" ] || fail 'the existing proxy socket is linked or is not a socket.'
  fi
  previous_state="$(python3 - "$stage" "$project" "$data_volume" <<'PY'
import hashlib,json,re,sys
from pathlib import Path
root=Path(sys.argv[1]);v=json.loads((root/'release.json').read_text())
assert v.get('scope')=='private-staging' and v.get('project')==sys.argv[2] and v.get('volume')==sys.argv[3]
assert v.get('origin')=='http://127.0.0.1:3001' and v.get('phase') in ('healthy','failed','prepared')
assert re.fullmatch(r'ghcr\.io/omargad/bangla-adventure@sha256:[a-f0-9]{64}',v['image'])
assert re.fullmatch(r'[a-f0-9]{40}',v['revision']) and v['revision']!='9ca8ac88e3bfe4284d9a8226e044ef808576cdff'
assert v['image']!='ghcr.io/omargad/bangla-adventure@sha256:b86b438eceef512f2505ddd0817629b52f5e4466231ef4f638df049342b0cee5'
expected={'compose.yaml','tools/private-staging-proxy.mjs','tools/private-staging-remote.sh','tools/private-staging-verify.mjs','tools/private-staging-drill.sh','tools/private-staging-qa.sh'}
assert set(v['files'])==expected
for name,digest in v['files'].items():
    p=root/name
    assert p.is_file() and not p.is_symlink() and p.stat().st_uid==1002
    assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
print(v['image']); print(v['revision']); print(v['phase'])
PY
  )" || fail 'the existing staging release manifest is invalid or its managed files changed.'
  mapfile -t prior <<< "$previous_state"
  previous="${prior[0]}"; previous_revision="${prior[1]}"
  [ "${prior[2]}" != healthy ] || previous_healthy=true
  check_volume "$data_volume" || fail 'the managed staging data volume is missing.'
  check_containers "$previous"
else
  [ -z "$(docker ps --all --quiet --filter "label=com.docker.compose.project=$project")" ] || fail 'unmanaged containers already use the staging project.'
  if docker volume inspect "$data_volume" >/dev/null 2>&1 || docker volume inspect "$backup_volume" >/dev/null 2>&1; then fail 'unmanaged staging volumes already exist.'; fi
fi
if docker volume inspect "$backup_volume" >/dev/null 2>&1; then check_volume "$backup_volume" || fail 'backup volume labels are invalid.'; fi

# Registry authentication is temporary and is never written to the operator's Docker config.
if [ -n "$registry_user" ]; then
  login="$(mktemp -d /tmp/bangla-private-registry.XXXXXXXXXX)"
  printf '{"auths":{"ghcr.io":{}}}\n' > "$login/config.json"
  docker --config "$login" login ghcr.io --username "$registry_user" --password-stdin >/dev/null 2>&1 || fail 'temporary registry authentication failed.'
  docker --config "$login" pull "$image" >/dev/null 2>&1 || fail 'the exact staging image could not be pulled.'
  rm -rf -- "$login"; login=''
fi
actual_platform="$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}' 2>/dev/null)" || fail 'the staging image is not cached.'
actual_revision="$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null)" || fail 'the image revision could not be inspected.'
actual_digests="$(docker image inspect "$image" --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null)" || fail 'the image digest could not be inspected.'
[ "$actual_platform" = linux/amd64 ] && [ "$actual_revision" = "$revision" ] || fail 'the image platform or revision differs from the reviewed release.'
case $'\n'"$actual_digests"$'\n' in *$'\n'"$image"$'\n'*) ;; *) fail 'the image does not carry the exact requested digest.';; esac

# Compose is rendered privately for structural validation; no production env files are loaded.
rendered="$(STAGING_IMAGE="$image" docker compose --env-file /dev/null --project-name "$project" --project-directory "$payload" --file "$payload/compose.yaml" config --format json)" || fail 'candidate Compose rendering failed.'
python3 - "$rendered" "$payload" "$image" "$data_volume" "$project" <<'PY' || fail 'candidate Compose configuration violates private staging isolation.'
import json,sys
v=json.loads(sys.argv[1]);stage,image,data,project=sys.argv[2:]
assert v.get('name')==project and set(v['services'])=={'app','proxy'}
assert set(v.get('volumes',{}))=={'bangla-data'} and v['volumes']['bangla-data']['name']==data
assert v.get('networks',{}).get('default',{}).get('internal') is True
for name,s in v['services'].items():
    assert s.get('image')==image and s.get('user')=='node' and not s.get('ports') and not s.get('network_mode')
    assert not s.get('privileged') and not s.get('container_name') and not s.get('pid') and not s.get('ipc')
    assert 'ALL' in s.get('cap_drop',[]) and 'no-new-privileges:true' in s.get('security_opt',[])
    mounts=s['volumes']
    if name=='app':
        e=s['environment'];assert e['PUBLIC_ORIGIN']=='http://127.0.0.1:3001' and e['NODE_ENV']=='production'
        assert e['DATABASE_PATH']=='/app/.data/bangla-adventures.db' and e['MEDIA_ROOT']=='/app/.data/media'
        assert not any(k.startswith('ELEVENLABS') or k.startswith('DEPLOY_') for k in e)
        assert len(mounts)==2
        assert any(m['type']=='volume' and m['source']=='bangla-data' and m['target']=='/app/.data' for m in mounts)
        assert any(m['type']=='bind' and m['source']==stage+'/tools/private-staging-verify.mjs' and m['target']=='/app/staging-tools/private-staging-verify.mjs' and m.get('read_only') for m in mounts)
    else:
        assert s.get('read_only') and s.get('entrypoint')==['node','/app/staging-tools/private-staging-proxy.mjs']
        assert not s.get('environment') and len(mounts)==2
        assert any(m['type']=='bind' and m['source']==stage+'/runtime' and m['target']=='/runtime' for m in mounts)
        assert any(m['type']=='bind' and m['source']==stage+'/tools/private-staging-proxy.mjs' and m['target']=='/app/staging-tools/private-staging-proxy.mjs' and m.get('read_only') for m in mounts)
PY

if [ "$existing" = false ]; then
  mkdir -- "$stage"
  chmod 0700 "$stage"
  printf '%s\n' "$marker" > "$stage/.private-staging-marker"
  mkdir -- "$stage/tools" "$stage/runtime"
  lock_stage
fi
chmod 0755 "$stage/tools"
chmod 1777 "$stage/runtime"

transaction="$(mktemp -d "$stage/.transaction.XXXXXXXXXX")"
if [ "$existing" = true ]; then
  cp -p -- "$stage/compose.yaml" "$stage/release.json" "$transaction/"
  for file in "${files[@]:1}"; do cp -p -- "$stage/tools/$file" "$transaction/$file"; done
  # Only this project is stopped; only its distinct data volume is backed up.
  touched=true
  stop_own "$previous"
  docker volume create --label "com.docker.compose.project=$project" --label io.bangla.scope=private-staging "$backup_volume" >/dev/null
  check_volume "$backup_volume" || fail 'backup volume ownership is invalid.'
  docker run --rm --network none --user root --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --security-opt no-new-privileges:true --entrypoint sh --volume "$backup_volume:/backups" "$previous" -c 'chown 0:0 /backups && chmod 0700 /backups && chown 1000:1000 /backups'
  if ! docker run --rm --network none --user node --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,noexec,nosuid,size=128m --volume "$data_volume:/app/.data:ro" --volume "$backup_volume:/backups" --entrypoint bash "$previous" scripts/backup.sh /backups 14 --application-stopped; then
    healthy_start "$previous" || true
    fail 'the staging backup failed; the candidate was not installed.'
  fi
fi
touched=true
cp -- "$payload/compose.yaml" "$transaction/compose.yaml.incoming"
chmod 0600 "$transaction/compose.yaml.incoming"
mv -f -- "$transaction/compose.yaml.incoming" "$stage/compose.yaml"
for file in "${files[@]:1}"; do
  cp -- "$payload/$file" "$transaction/$file.incoming"
  chmod 0644 "$transaction/$file.incoming"
  mv -f -- "$transaction/$file.incoming" "$stage/tools/$file"
done
[ "$existing" = true ] || write_manifest prepared "$image" "$revision"
healthy_start "$image" || fail 'candidate app/proxy health checks failed.'
check_volume "$data_volume" || fail 'the created staging volume is not project-owned.'
check_containers "$image"
baseline="$(compose "$image" exec -T app node /app/staging-tools/private-staging-verify.mjs --write-probes)" || fail 'the running staging verifier failed.'
digest="$(python3 - "$baseline" <<'PY'
import json,re,sys
v=json.loads(sys.argv[1]);assert v.get('verified') is True and re.fullmatch(r'[a-f0-9]{64}',v['stateDigest']);print(v['stateDigest'])
PY
)" || fail 'the verifier did not return a valid state digest.'
before_app_id="$(app_id "$image")"
stop_own "$image"
drill_result="$(bash "$stage/tools/private-staging-drill.sh" "$image")" || fail 'the isolated backup/restore drill failed.'
healthy_start "$image" --force-recreate || fail 'private staging failed container replacement after the drill.'
after_app_id="$(app_id "$image")"
[ "$before_app_id" != "$after_app_id" ] || fail 'the staging app container was not replaced.'
restarted="$(compose "$image" exec -T app node /app/staging-tools/private-staging-verify.mjs --expected-state-digest "$digest")" || fail 'content state changed across the staging replacement.'
check_containers "$image"
[ -S "$stage/runtime/http.sock" ] && [ ! -L "$stage/runtime/http.sock" ] && [ "$(stat -c %a "$stage/runtime/http.sock")" = 666 ] || fail 'the private transport socket is unavailable or has unexpected permissions.'
evidence="$(python3 - "$baseline" "$drill_result" "$restarted" "$before_app_id" "$after_app_id" "$image" "$revision" "$project" "$stage" <<'PY'
import json,re,sys
baseline,drill,restarted=map(json.loads,sys.argv[1:4]);before,after,image,revision,project,stage=sys.argv[4:]
counts={'pendingTopics','pendingLessons','shippedStates','users','approvals','baselines','businessRows','mediaFiles'}
checks={'integrity','foreignKeys','unpublished','cleanIdentities','expectedStateMatched','databaseWriteRolledBack','mediaWriteRemoved'}
def clean(value):
    assert value.get('verified') is True and re.fullmatch(r'[a-f0-9]{64}',value['stateDigest'])
    assert set(value['counts'])==counts and all(type(n) is int and n>=0 for n in value['counts'].values())
    assert set(value['checks'])==checks and all(n is None or type(n) is bool for n in value['checks'].values())
    return {k:value[k] for k in ('verified','stateDigest','counts','checks')}
first,last=clean(baseline),clean(restarted)
assert first['stateDigest']==last['stateDigest'] and last['checks']['expectedStateMatched'] is True
assert all(first['checks'][k] is True for k in ('integrity','foreignKeys','unpublished','cleanIdentities','databaseWriteRolledBack','mediaWriteRemoved'))
assert re.fullmatch(r'[a-f0-9]{64}',before) and re.fullmatch(r'[a-f0-9]{64}',after) and before!=after
drill_checks={'sourceUnchanged','cleanSnapshotVerified','probeSnapshotVerified','probeDatabaseRestored','probeMediaRestored','cleanOriginalRestored','integrity','foreignKeys','archivesUnchanged'}
assert drill.get('verified') is True and drill.get('artifactsRetained') is False and drill.get('scope')=='disposable clone only'
assert set(drill['checks'])==drill_checks and all(v is True for v in drill['checks'].values())
assert set(drill['counts'])=={'pendingTopics','pendingLessons','sourceUsers','probeRecords','probeMediaFiles'} and all(type(n) is int and n>=0 for n in drill['counts'].values())
safe_drill={k:drill[k] for k in ('verified','checks','counts','artifactsRetained','scope')}
print(json.dumps({'scope':'private-staging','status':'healthy','image':image,'revision':revision,'project':project,'origin':'http://127.0.0.1:3001','socket':stage+'/runtime/http.sock','publishedPorts':0,'cleanVerifier':first,'restartVerifier':last,'restoreDrill':safe_drill,'containerReplacement':{'appReplaced':True,'beforeAppId':before,'afterAppId':after,'stateDigestUnchanged':True}},separators=(',',':')))
PY
)" || fail 'sanitized staging evidence validation failed.'
write_manifest healthy "$image" "$revision"
committed=true
say 'verified private staging health, isolation, persistence and disposable restore drill; no host TCP ports were published.'
printf '%s\n' "$evidence"
