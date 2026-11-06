#!/usr/bin/env bash
# Acceptance only: reuse the healthy pinned private stage; all classroom work is disposable QA.
set -euo pipefail
set +x
umask 077
fail() { printf 'private acceptance: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 0 ] || fail 'This pinned acceptance controller accepts no arguments.'
[ "${DEPLOY_ENABLED:-false}" = false ] || fail 'Production deployment must remain disabled.'
[ "${REPOSITORY_GATE_CONFIRMED:-}" = disabled ] || fail 'Repository gate must precede environment credentials.'
[ "${GITHUB_REPOSITORY:-}" = omargad/Bangla-Adventure ] && [ "${GITHUB_REF:-}" = refs/heads/main ] || fail 'Only the audited repository main branch is allowed.'
[ -n "${DEPLOY_SSH_KEY:-}" ] && [ -n "${DEPLOY_KNOWN_HOSTS:-}" ] || fail 'Pinned deployment credentials are missing.'
case "$DEPLOY_KNOWN_HOSTS" in *'PRIVATE KEY'*|*'-----BEGIN'*) fail 'Public known_hosts contains misplaced private credentials.' ;; esac
# The address and account come from repository secrets; the host-key pin below proves identity.
[[ "${DEPLOY_HOST:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || fail 'The DEPLOY_HOST repository secret is missing or invalid.'
[[ "${DEPLOY_USER:-}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail 'The DEPLOY_USER repository secret is missing or invalid.'
readonly host="$DEPLOY_HOST" user="$DEPLOY_USER" port=22
# Uploaded evidence names this fixed alias, never the server address.
readonly host_alias=bangla-adventures-vps
readonly key_pin='SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ'
readonly host_pin='SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8'
readonly image='ghcr.io/omargad/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13'
readonly revision=a709cb3d2bc9fb0a271e6814bc96d1f16444c94f
readonly origin=http://127.0.0.1:3001
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"; chmod 700 "$work"
incoming='' tunnel_pid='' qa_hook='' qa_id='' evidence='' phase=credentials cleanup_verified=false
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
cleanup() {
  local status=$?
  trap - EXIT
  if [ -n "$tunnel_pid" ]; then kill "$tunnel_pid" 2>/dev/null || true; wait "$tunnel_pid" 2>/dev/null || true; fi
  if [ -n "$qa_hook" ] && [ -x "$qa_hook" ]; then
    if "$qa_hook" cleanup "$qa_id" > "$work/cleanup.json" 2> "$work/cleanup.log"; then
      cleanup_verified=true
      [ -z "$evidence" ] || cp -- "$work/cleanup.json" "$evidence/qa-cleanup.json"
    else status=1; printf 'private acceptance: owned QA cleanup could not be verified.\n' >&2; fi
  fi
  if [[ "$incoming" =~ ^/opt/bangla-adventures/\.private-acceptance-payload\.[a-zA-Z0-9]{12}$ ]]; then
    ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" \
      "if [ -d $(quote "$incoming") ] && [ ! -L $(quote "$incoming") ] && [ \"\$(realpath -e -- $(quote "$incoming"))\" = $(quote "$incoming") ] && [ \"\$(stat -c '%u:%a' -- $(quote "$incoming"))\" = 1002:700 ]; then rm -rf -- $(quote "$incoming"); fi" </dev/null >/dev/null 2>&1 || status=1
  fi
  if [ -n "$evidence" ]; then
    printf '{"overall":"%s","phase":"%s","qaCleanupVerified":%s}\n' "$([ "$status" -eq 0 ] && printf passed || printf failed)" "$phase" "$cleanup_verified" > "$evidence/attempt-status.json"
  fi
  rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' > "$work/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" | tr -d '\r' > "$work/provided_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS REGISTRY_PASSWORD GITHUB_TOKEN GH_TOKEN
chmod 600 "$work/key" "$work/provided_hosts"
ssh-keygen -y -P '' -f "$work/key" > "$work/public_key" 2>/dev/null || fail 'The deployment key must be readable and unencrypted for CI.'
actual="$(ssh-keygen -l -E sha256 -f "$work/public_key" 2>/dev/null | awk '{print $2}')" || fail 'Deployment key fingerprint failed.'
[ "$actual" = "$key_pin" ] || fail 'Deployment key fingerprint does not match the supplied public key.'
: > "$work/known_hosts"
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  [[ "$line" =~ ^[[:space:]]*@ ]] && fail 'known_hosts marker directives are not allowed.'
  IFS=$' \t' read -r names key_type key_data comment <<< "$line"
  [ "$key_type" = ssh-ed25519 ] || fail 'The pinned ED25519 server key is required.'
  [[ "$key_data" =~ ^[a-zA-Z0-9+/]+={0,2}$ ]] || fail 'Invalid server public-key encoding.'
  printf '%s\n' "$line" > "$work/host_line"
  actual="$(ssh-keygen -l -E sha256 -f "$work/host_line" 2>/dev/null | awk '{print $2}')" || fail 'Server key fingerprint failed.'
  [ "$actual" = "$host_pin" ] || fail 'Server key fingerprint does not match the verified VPS.'
  ssh-keygen -F "$host" -f "$work/host_line" >/dev/null 2>&1 || fail 'The verified public key does not cover the configured VPS address.'
  # Keep only the configured address and verified PUBLIC server key, never comments or a private key.
  printf '%s %s %s\n' "$host" "$key_type" "$key_data" >> "$work/known_hosts"
done < "$work/provided_hosts"
[ -s "$work/known_hosts" ] || fail 'No pinned server public key was supplied.'
sort -u "$work/known_hosts" -o "$work/known_hosts"
[ "$(wc -l < "$work/known_hosts")" -eq 1 ] || fail 'Only one verified server key is expected.'

ssh_options=(-F /dev/null -T -i "$work/key" -p "$port"
  -o BatchMode=yes -o IdentitiesOnly=yes -o PreferredAuthentications=publickey
  -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=yes
  -o UpdateHostKeys=no -o GlobalKnownHostsFile=/dev/null -o "UserKnownHostsFile=$work/known_hosts"
  -o ForwardAgent=no -o PermitLocalCommand=no -o ControlMaster=no -o ControlPath=none
  -o ConnectTimeout=15 -o ConnectionAttempts=1 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)

require_free_local_port() {
  python3 - <<'PORT'
import socket
with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as probe:
 try: probe.bind(('127.0.0.1',3001))
 except OSError: raise SystemExit('Runner loopback port 3001 must be free.')
PORT
}
# Read-only inventory is repeated after every exercise. No Compose up/restart/pull is used here.
remote_inventory() {
  ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" 'bash -s' > "$1" 2> "$work/inventory.log" <<'INVENTORY'
set -euo pipefail
# UID 1002 pins the deployment account whatever its configured name.
[ "$(id -u)" = 1002 ]
stage=/opt/bangla-adventures/private-staging
image=ghcr.io/omargad/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13
revision=a709cb3d2bc9fb0a271e6814bc96d1f16444c94f
[ -S /run/user/1002/docker.sock ] && [ "$(stat -c %u /run/user/1002/docker.sock)" = 1002 ]
docker() { command env -u DOCKER_HOST -u DOCKER_CONTEXT docker --host unix:///run/user/1002/docker.sock "$@"; }
[ "$(docker context inspect rootless --format '{{.Endpoints.docker.Host}}')" = unix:///run/user/1002/docker.sock ]
docker info --format '{{json .SecurityOptions}}' | python3 -c 'import json,sys;assert "name=rootless" in json.load(sys.stdin)'
[ -d "$stage" ] && [ ! -L "$stage" ] && [ "$(realpath -e "$stage")" = "$stage" ] && [ "$(stat -c '%u:%a' "$stage")" = 1002:700 ]
[ -S "$stage/runtime/http.sock" ] && [ ! -L "$stage/runtime/http.sock" ]
python3 - "$stage" "$image" "$revision" <<'MANIFEST'
import hashlib,json,os,re,sys
from pathlib import Path
root=Path(sys.argv[1]);assert (root/'.private-staging-marker').read_bytes()==b'bangla-adventures-private-staging-v1\n'
for name in ('.private-staging-marker','release.json'):
 p=root/name;assert p.is_file() and not p.is_symlink() and p.stat().st_uid==1002
assert (root/'tools').is_dir() and not (root/'tools').is_symlink() and (root/'tools').stat().st_uid==1002
x=json.loads((root/'release.json').read_text())
assert all(x.get(k)==v for k,v in dict(scope='private-staging',phase='healthy',image=sys.argv[2],revision=sys.argv[3],project='bangla-adventures-staging',volume='bangla-adventures-staging_bangla-data',origin='http://127.0.0.1:3001').items())
assert set(x['files'])=={'compose.yaml','tools/private-staging-proxy.mjs','tools/private-staging-remote.sh','tools/private-staging-verify.mjs','tools/private-staging-drill.sh','tools/private-staging-qa.sh'}
for name,digest in x['files'].items():
 p=root/name;assert p.is_file() and not p.is_symlink() and p.resolve()==p and p.stat().st_uid==1002
 assert re.fullmatch('[a-f0-9]{64}',digest) and hashlib.sha256(p.read_bytes()).hexdigest()==digest
MANIFEST
image_id="$(docker image inspect "$image" | python3 -c 'import json,sys;x,=json.load(sys.stdin);assert sys.argv[1] in x["RepoDigests"] and x["Config"]["Labels"]["org.opencontainers.image.revision"]==sys.argv[2];print(x["Id"])' "$image" "$revision")"
mapfile -t ids < <(docker ps --all --quiet --no-trunc --filter label=com.docker.compose.project=bangla-adventures-staging)
[ "${#ids[@]}" -eq 2 ]
for id in "${ids[@]}"; do [[ "$id" =~ ^[a-f0-9]{64}$ ]]; done
app_id="$(docker inspect "${ids[@]}" | python3 -c '
import json,sys
rows=json.load(sys.stdin);stage,image,imageid=sys.argv[1:];assert len(rows)==2
seen=set();app=None
for x in rows:
 c=x["Config"];h=x["HostConfig"];l=c["Labels"];role=l["com.docker.compose.service"]
 assert l["com.docker.compose.project"]=="bangla-adventures-staging" and role in {"app","proxy"} and role not in seen;seen.add(role)
 assert c["Image"]==image and x["Image"]==imageid and c["User"]=="node" and x["State"]["Running"] and x["State"]["Health"]["Status"]=="healthy"
 assert not h.get("PortBindings") and not h.get("PublishAllPorts") and not h.get("Privileged") and h["NetworkMode"]=="bangla-adventures-staging_default"
 assert all(not p for p in (x["NetworkSettings"].get("Ports") or {}).values())
 assert set(x["NetworkSettings"]["Networks"])=={"bangla-adventures-staging_default"}
 mounts=x["Mounts"];assert len(mounts)==2
 expected=({("volume","bangla-adventures-staging_bangla-data","/app/.data",True),("bind",stage+"/tools/private-staging-verify.mjs","/app/staging-tools/private-staging-verify.mjs",False)} if role=="app" else {("bind",stage+"/runtime","/runtime",True),("bind",stage+"/tools/private-staging-proxy.mjs","/app/staging-tools/private-staging-proxy.mjs",False)})
 assert {(m["Type"],m.get("Name") if m["Type"]=="volume" else m["Source"],m["Destination"],m["RW"]) for m in mounts}==expected
 if role=="app":app=x["Id"]
 else:assert h["ReadonlyRootfs"]
assert seen=={"app","proxy"};print(app)
' "$stage" "$image" "$image_id")"
# Existing verifier is read-only by default and returns no business rows.
docker exec "$app_id" node /app/staging-tools/private-staging-verify.mjs | python3 -c '
import json,re,sys
x=json.load(sys.stdin);assert x["verified"] is True and x["counts"]==dict(pendingTopics=15,pendingLessons=18,shippedStates=33,users=0,approvals=0,baselines=0,businessRows=0,mediaFiles=0)
assert re.fullmatch("[a-f0-9]{64}",x["stateDigest"])
print(json.dumps(dict(scope="private-staging-acceptance",verified=True,image=sys.argv[1],revision=sys.argv[2],rootless=True,publishedPorts=0,stageHealthy=True,stage=dict(users=0,pendingTopics=15,pendingLessons=18,stateDigest=x["stateDigest"],appId=sys.argv[3]))))
' "$image" "$revision" "$app_id"
INVENTORY
  python3 - "$1" "$image" "$revision" <<'VALIDATE_INVENTORY'
import json,re,sys
x=json.load(open(sys.argv[1]));expected=dict(scope='private-staging-acceptance',verified=True,image=sys.argv[2],revision=sys.argv[3],rootless=True,publishedPorts=0,stageHealthy=True)
assert set(x)==set(expected)|{'stage'} and all(type(x[k]) is type(v) and x[k]==v for k,v in expected.items())
s=x['stage'];assert set(s)=={'users','pendingTopics','pendingLessons','stateDigest','appId'}
assert all(type(s[k]) is int and s[k]==v for k,v in dict(users=0,pendingTopics=15,pendingLessons=18).items())
assert all(isinstance(s[k],str) and re.fullmatch('[a-f0-9]{64}',s[k]) for k in ('stateDigest','appId'))
VALIDATE_INVENTORY
}
phase=inventory
remote_inventory "$work/stage-before.json" || fail 'Read-only inventory refused; no payload was uploaded.'
evidence="${PRIVATE_ACCEPTANCE_EVIDENCE_DIR:?An isolated acceptance evidence directory is required.}"
[ ! -e "$evidence" ] && [ ! -L "$evidence" ] || fail 'Acceptance evidence directory must be new.'
mkdir -m 700 -- "$evidence"
cp -- "$work/stage-before.json" "$evidence/stage-before.json"
read -r _ key_type key_data < "$work/known_hosts"
printf '%s %s %s\n' "$host_alias" "$key_type" "$key_data" > "$evidence/staging_known_hosts"
phase=payload
mkdir "$work/payload"
sources=(scripts/private-staging-qa.sh scripts/private-staging-rollback.sh scripts/deploy-remote.sh scripts/private-staging-verify.mjs scripts/private-staging-ops.sh scripts/private-staging-ops.py scripts/private-staging-ops-check.py scripts/private-staging-ops-install.sh scripts/private-staging-ops-install.py)
# Operations unit sources are fixed reviewed files, copied flat for its installer.
for unit in ba-private-stage-backup.service ba-private-stage-backup.timer ba-private-stage-monitor.service ba-private-stage-monitor.timer; do sources+=("deploy/private-staging-ops/$unit"); done
names=()
for source in "${sources[@]}"; do
  [ -f "$root/$source" ] && [ ! -L "$root/$source" ] || fail 'A required reviewed acceptance helper is missing.'
  name="${source##*/}"; names+=("$name"); cp -- "$root/$source" "$work/payload/$name"
done
incoming="$(ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" 'umask 077; mktemp -d /opt/bangla-adventures/.private-acceptance-payload.XXXXXXXXXXXX' 2> "$work/ssh.log")" || fail 'Could not create the private acceptance incoming directory.'
[[ "$incoming" =~ ^/opt/bangla-adventures/\.private-acceptance-payload\.[a-zA-Z0-9]{12}$ ]] || fail 'Unexpected acceptance payload directory.'
tar -C "$work/payload" -cf - -- "${names[@]}" | ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" \
  "test -d $(quote "$incoming") && test ! -L $(quote "$incoming") && test \"\$(realpath -e -- $(quote "$incoming"))\" = $(quote "$incoming") && test \"\$(stat -c '%u:%a' -- $(quote "$incoming"))\" = 1002:700 && tar --extract --file - --directory $(quote "$incoming") --no-same-owner --no-same-permissions" > "$work/transfer.log" 2> "$work/ssh.log" || fail 'Acceptance helper transfer failed.'
phase=helper-install
# Update only the managed QA helper and its manifest hash. Hold the same lock as staging/ops.
ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" "bash -s -- $(quote "$incoming")" > "$work/install.json" 2> "$work/install.log" <<'INSTALL'
set -euo pipefail
[ "$(id -u)" = 1002 ]
stage=/opt/bangla-adventures/private-staging
[ -d "$stage" ] && [ ! -L "$stage" ] && [ "$(stat -c '%u:%a' "$stage")" = 1002:700 ]
[ -f "$stage/.deploy.lock" ] && [ ! -L "$stage/.deploy.lock" ] && [ "$(stat -c %u "$stage/.deploy.lock")" = 1002 ]
exec 9> "$stage/.deploy.lock"
flock -w 120 9
python3 - "$stage" "$1" <<'INSTALL_PY'
import hashlib,json,os,re,signal,stat,sys,tempfile
from pathlib import Path
OWNER=1002
IMAGE='ghcr.io/omargad/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13'
REVISION='a709cb3d2bc9fb0a271e6814bc96d1f16444c94f'
root,incoming=map(Path,sys.argv[1:]);helper=root/'tools/private-staging-qa.sh';manifest=root/'release.json'
def regular(p):
 assert p.is_file() and not p.is_symlink() and p.resolve()==p and p.stat().st_uid==OWNER
 return p.read_bytes()
def validate():
 assert root.is_dir() and not root.is_symlink() and root.resolve()==root and root.stat().st_uid==OWNER and stat.S_IMODE(root.stat().st_mode)==0o700
 assert regular(root/'.private-staging-marker')==b'bangla-adventures-private-staging-v1\n'
 tools=root/'tools';assert tools.is_dir() and not tools.is_symlink() and tools.resolve()==tools and tools.stat().st_uid==OWNER
 x=json.loads(regular(manifest))
 expected=dict(scope='private-staging',phase='healthy',image=IMAGE,revision=REVISION,project='bangla-adventures-staging',volume='bangla-adventures-staging_bangla-data',origin='http://127.0.0.1:3001')
 assert all(x.get(k)==v for k,v in expected.items())
 assert set(x['files'])=={'compose.yaml','tools/private-staging-proxy.mjs','tools/private-staging-remote.sh','tools/private-staging-verify.mjs','tools/private-staging-drill.sh','tools/private-staging-qa.sh'}
 for name,digest in x['files'].items(): assert re.fullmatch('[a-f0-9]{64}',digest) and hashlib.sha256(regular(root/name)).hexdigest()==digest
 return x
assert re.fullmatch(r'/opt/bangla-adventures/\.private-acceptance-payload\.[a-zA-Z0-9]{12}',str(incoming))
assert incoming.is_dir() and not incoming.is_symlink() and incoming.resolve()==incoming and incoming.stat().st_uid==OWNER and stat.S_IMODE(incoming.stat().st_mode)==0o700
new=regular(incoming/'private-staging-qa.sh');old=regular(helper);old_mode=stat.S_IMODE(helper.stat().st_mode);old_manifest=regular(manifest)
x=validate();updated=json.loads(json.dumps(x));updated['files']['tools/private-staging-qa.sh']=hashlib.sha256(new).hexdigest()
def replace(p,data,mode):
 fd,tmp=tempfile.mkstemp(prefix='.acceptance-',dir=p.parent)
 try:
  with os.fdopen(fd,'wb') as output: output.write(data);output.flush();os.fsync(output.fileno())
  os.chmod(tmp,mode);os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def interrupted(*_):raise RuntimeError('interrupted helper transaction')
for number in (signal.SIGHUP,signal.SIGINT,signal.SIGTERM):signal.signal(number,interrupted)
try:
 replace(helper,new,0o644)
 replace(manifest,(json.dumps(updated,sort_keys=True)+'\n').encode(),0o600)
 assert validate()==updated
 assert {k:v for k,v in updated['files'].items() if k!='tools/private-staging-qa.sh'}=={k:v for k,v in x['files'].items() if k!='tools/private-staging-qa.sh'}
except BaseException:
 replace(helper,old,old_mode);replace(manifest,old_manifest,0o600);validate();raise
print(json.dumps(dict(kind='private-staging-acceptance-install',verified=True,qaHelperUpdated=True,manifestPreserved=True,applicationRecreated=False)))
INSTALL_PY
INSTALL
python3 - "$work/install.json" <<'INSTALL_RESULT'
import json,sys
assert json.load(open(sys.argv[1]))==dict(kind='private-staging-acceptance-install',verified=True,qaHelperUpdated=True,manifestPreserved=True,applicationRecreated=False)
INSTALL_RESULT
cp -- "$work/install.json" "$evidence/helper-install.json"
export_ops_failure() {
  python3 - "$1" "$2" "$evidence/operations-failure.json" <<'OPS_FAILURE'
import json,sys
from pathlib import Path
allowed=set("ambiguous-resource backup-directory-initialization backup-job-failed backup-metadata backup-metadata-failed backup-stale-or-future backup-unverified clean-stage-required command-failed command-unavailable-or-timeout container-count container-exposure container-hardening container-mounts container-scope container-unhealthy disk-low drill-directory-initialization drill-resource-exists drill-volume-in-use exercise-state-or-cleanup fault-not-observed health-unavailable helper-cleanup-failed helper-id helper-identity helper-name-exists image-pin initial-operations-check initial-service-deferred-or-failed install-failed installation-hash installation-scope installation-tools installation-unit-hash installation-units interrupted invalid-action invalid-aggregates invalid-install-arguments loaded-unit-path lock-owner network-scope non-rootless-daemon operation-failed oversize-command-result payload-path port-exposed release-files release-hash release-scope resume-failed rootless-socket snapshot-failed snapshot-unverified source-still-in-use stage-marker stage-unhealthy-before-install stage-unhealthy-before-maintenance timer-not-enabled transaction-busy transport-scope unit-marker unmanaged-ops-tool unmanaged-user-unit unsafe-directory unsafe-file unsafe-unit-directory-home-type unsafe-unit-directory-home-owner unsafe-unit-directory-home-writable unsafe-unit-directory-config-type unsafe-unit-directory-config-owner unsafe-unit-directory-config-writable unsafe-unit-directory-systemd-type unsafe-unit-directory-systemd-owner unsafe-unit-directory-systemd-writable unsafe-unit-directory-user-type unsafe-unit-directory-user-owner unsafe-unit-directory-user-writable user-bus user-runtime user-unit-path volume-scope writers-not-stopped wrong-user".split())
try:
 raw=Path(sys.argv[2]).read_bytes();assert len(raw)<=65536
 x=json.loads(raw);action=sys.argv[1]
 if action=='status'and x.get('scope')=='private-staging-operations'and x.get('action')=='status'and x.get('verified')is True:
  x=next((x['reports'][k]for k in ('backup','monitor','exercise')if x.get('reports',{}).get(k,{}).get('verified')is False),None)
  if x is None:raise ValueError('No failed report')
  action=x.get('action')
 assert action in {'install','backup','monitor','exercise','status'}and x.get('scope')=='private-staging-operations'and x.get('action')==action and x.get('verified')is False and x.get('status')in {'failed','deferred'}
 codes=x.get('codes');assert isinstance(codes,list)and 1<=len(codes)<=16 and all(type(code)is str and code in allowed for code in codes)
 Path(sys.argv[3]).write_text(json.dumps(dict(scope='private-staging-operations',action=action,verified=False,status=x['status'],codes=codes))+'\n')
except(OSError,ValueError,AssertionError,TypeError,KeyError,AttributeError):pass
OPS_FAILURE
}
phase=operations
ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" "bash $(quote "$incoming/private-staging-ops-install.sh") $(quote "$incoming")" > "$work/ops-install.json" 2> "$work/ops-install.log" || { export_ops_failure install "$work/ops-install.json"; fail 'Operational installation failed; raw logs withheld.'; }
ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" 'bash /opt/bangla-adventures/private-staging/tools/private-staging-ops.sh exercise' > "$work/ops-exercise.json" 2> "$work/ops-exercise.log" || { export_ops_failure exercise "$work/ops-exercise.json"; fail 'Operational failure recovery exercise failed; raw logs withheld.'; }
ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" 'bash /opt/bangla-adventures/private-staging/tools/private-staging-ops.sh status' > "$work/ops-status.json" 2> "$work/ops-status.log" || { export_ops_failure status "$work/ops-status.json"; fail 'Operational monitor status failed; raw logs withheld.'; }
export_ops_failure status "$work/ops-status.json"
python3 - "$work" "$evidence" <<'OPS_RESULT'
import json,math,re,time,sys
from pathlib import Path
work,out=map(Path,sys.argv[1:]);install=json.loads((work/'ops-install.json').read_text());exercise=json.loads((work/'ops-exercise.json').read_text());status=json.loads((work/'ops-status.json').read_text())
base=dict(scope='private-staging-operations',verified=True)
def numeric(x):return type(x)in(int,float)and math.isfinite(x)
def report(x,action,keys):
 expected={**base,'status':'healthy'if action=='monitor'else'passed'}
 assert set(x)==set(expected)|{'action'}|set(keys) and all(type(x.get(k)) is type(v) and x[k]==v for k,v in expected.items()) and x['action']==action
report(install,'install',{'timers','initialBackupVerified','initialMonitorVerified','localOnly','retentionCount','backupSchedule','monitorIntervalSeconds','initialRuns'})
assert install['timers']==dict(backup=True,monitor=True) and install['initialBackupVerified'] is True and install['initialMonitorVerified'] is True and install['localOnly'] is True and install['retentionCount']==14 and install['backupSchedule']=='03:30 UTC daily' and install['monitorIntervalSeconds']==300
assert set(install['initialRuns'])=={'backup','monitor'}
for name,keys in [('backup',{'invocationId','checkedAtEpoch','archiveSha256'}),('monitor',{'invocationId','checkedAtEpoch','backupAgeSeconds'})]:
 receipt=install['initialRuns'][name];assert set(receipt)==keys and re.fullmatch('[a-f0-9]{32}',receipt['invocationId']) and numeric(receipt['checkedAtEpoch'])and abs(time.time()-receipt['checkedAtEpoch'])<900
 if name=='backup':assert re.fullmatch('[a-f0-9]{64}',receipt['archiveSha256'])
 else:assert numeric(receipt['backupAgeSeconds'])and -300<=receipt['backupAgeSeconds']<=129600
report(exercise,'exercise',{'checkedAtEpoch','checks','codes','invocationId'})
assert exercise['invocationId']is None
checks={'writersQuiesced','applicationResumedHealthy','expectedBackupFailureObserved','logicalDataUnchanged','realBackupArchivesUnchanged','disposableVolumeRemoved'}
assert set(exercise['checks'])==checks and all(v is True for v in exercise['checks'].values()) and exercise['codes']==[]
assert numeric(exercise['checkedAtEpoch']) and abs(time.time()-exercise['checkedAtEpoch'])<900
# The installed status wrapper is reduced to the allowlisted monitor proof, never copied verbatim.
report(status,'status',{'reports'})
assert set(status['reports'])=={'backup','monitor','exercise'}
monitor=status['reports']['monitor'];report(monitor,'monitor',{'checkedAtEpoch','checks','codes','measures','invocationId'})
assert re.fullmatch('[a-f0-9]{32}',monitor['invocationId'])
checks={'applicationHealth','containersHealthy','noPublishedPorts','diskSpace','backupVerified','backupFresh','lastBackupRunPassed'}
assert set(monitor['checks'])==checks and all(v is True for v in monitor['checks'].values()) and monitor['codes']==[]
assert numeric(monitor['checkedAtEpoch']) and abs(time.time()-monitor['checkedAtEpoch'])<900
assert set(monitor['measures'])=={'freeDiskBytes','backupAgeSeconds'} and type(monitor['measures']['freeDiskBytes'])is int and monitor['measures']['freeDiskBytes']>=0 and numeric(monitor['measures']['backupAgeSeconds'])and -300<=monitor['measures']['backupAgeSeconds']<=129600
(out/'operations.json').write_text(json.dumps(dict(install=install,exercise=exercise,monitor=monitor))+'\n')
OPS_RESULT
remote_inventory "$work/stage-after-operations.json" || fail 'The actual stage failed verification after operational checks.'
phase=rollback
rollback_id="$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" "bash $(quote "$incoming/private-staging-rollback.sh") $rollback_id" > "$work/rollback.json" 2> "$work/rollback.log" || {
  python3 - "$work/rollback.log" "$evidence/rollback-failure.json" "$rollback_id" <<'ROLLBACK_FAILURE'
import json,re,sys
from pathlib import Path
allowed={'platform','export','clone','known-good','candidate','engine','verify','cleanup'}
try:
 raw=Path(sys.argv[1]).read_bytes();assert len(raw)<=262144 and re.fullmatch('[a-f0-9]{24}',sys.argv[3])
 prefix='PRIVATE_ROLLBACK_DIAGNOSTIC:'
 phase=next((line[len(prefix):]for line in raw.decode().splitlines()if line.startswith(prefix)and line[len(prefix):]in allowed),None)
 if phase:Path(sys.argv[2]).write_text(json.dumps(dict(kind='private-staging-rollback',verified=False,runId=sys.argv[3],phase=phase))+'\n')
except(OSError,ValueError,AssertionError,UnicodeError):pass
ROLLBACK_FAILURE
  fail 'Isolated failed-release rollback rehearsal failed; raw logs withheld.'
}
python3 - "$work/rollback.json" "$image" "$rollback_id" "$work/stage-before.json" <<'ROLLBACK_RESULT'
import json,re,sys
x=json.load(open(sys.argv[1]));checks={'candidateUnhealthy','automaticRollback','previousImageRestored','configurationRestored','environmentRestored','scriptRestored','dataUnchanged','healthRestored','sourceStageUnchanged','cleanupComplete'}
assert set(x)=={'kind','verified','runId','checks','sourceStage','publishedPorts','previousImage','candidateImageId','beforeStateDigest','afterStateDigest','candidateHealthStatus'}
assert x['kind']=='private-staging-rollback' and x['verified'] is True and x['runId']==sys.argv[3] and x['publishedPorts']==0 and x['previousImage']==sys.argv[2] and x['candidateHealthStatus']==503
assert set(x['checks'])==checks and all(v is True for v in x['checks'].values()) and x['sourceStage']==dict(users=0,pendingTopics=15,pendingLessons=18)
assert re.fullmatch('sha256:[a-f0-9]{64}',x['candidateImageId']) and re.fullmatch('[a-f0-9]{64}',x['beforeStateDigest']) and x['beforeStateDigest']==x['afterStateDigest']==json.load(open(sys.argv[4]))['stage']['stateDigest']
ROLLBACK_RESULT
cp -- "$work/rollback.json" "$evidence/rollback.json"
remote_inventory "$work/stage-after-rollback.json" || fail 'The actual stage failed verification after the isolated rollback.'
phase=qa-prepare
qa_id="$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
qa_socket="/opt/bangla-adventures/private-staging/qa/$qa_id/runtime/http.sock"
qa_hook="$work/qa-controller"
python3 - "$qa_hook" "$work/qa-config.json" "$qa_id" "$image" "$user@$host" "${ssh_options[@]}" <<'HOOK'
import json,os,sys
hook,config,qid,image,destination=sys.argv[1:6]
with open(config,'w') as output:json.dump(dict(ssh=['ssh',*sys.argv[6:],'-o','ClearAllForwardings=yes',destination],id=qid,image=image),output)
source=r'''#!/usr/bin/env python3
import json,re,subprocess,sys
from pathlib import Path
action='invalid'
helper_codes={'arguments','platform','stage-lock','real-stage','prepare-path','prepare-network','prepare-volume','prepare-app','prepare-proof-copy','prepare-app-start','prepare-proxy','prepare-proxy-start','prepare-ready','verify-resources','verify-database','approve-fixtures','bootstrap-admin','cleanup'}
codes={'invalid-request','remote-exit','remote-timeout','invalid-json','identity-mismatch','attestation-mismatch','counts-mismatch','prepare-mismatch','bootstrap-mismatch','cleanup-mismatch','local-operation-failed'}
def fail(code,exit_code=None,helper_code=None):
 if code not in codes:code='local-operation-failed'
 if helper_code not in helper_codes:helper_code=None
 entry=dict(action=action,code=code,remoteExitCode=exit_code if type(exit_code)is int and 0<=exit_code<=255 else None,helperCode=helper_code)
 print('Private acceptance hook refused: '+action+'/'+code+(('/'+helper_code)if helper_code else ''),file=sys.stderr)
 raise SystemExit(1)
def helper_code(text):
 prefix=f'PRIVATE_QA_DIAGNOSTIC:{action}:'
 return next((line[len(prefix):]for line in reversed(text.splitlines())if line.startswith(prefix)and line[len(prefix):]in helper_codes),None)
def clean(x):return type(x)is dict and set(x)=={'users','pendingTopics','pendingLessons'}and all(type(x[k])is int and x[k]==v for k,v in dict(users=0,pendingTopics=15,pendingLessons=18).items())
try:
 cfg=json.loads(Path(__file__).with_name('qa-config.json').read_text())
 if len(sys.argv)!=3 or sys.argv[1]not in {'prepare','verify','bootstrap-admin','cleanup'} or sys.argv[2]!=cfg['id'] or not re.fullmatch('[a-f0-9]{24}',cfg['id']):fail('invalid-request')
 action=sys.argv[1]
 response=subprocess.run([*cfg['ssh'],f"bash /opt/bangla-adventures/private-staging/tools/private-staging-qa.sh {action} {cfg['id']}"],input='',text=True,capture_output=True,timeout=240)
 if response.returncode:fail('remote-exit',response.returncode,helper_code(response.stderr))
 try:x=json.loads(response.stdout)
 except ValueError:fail('invalid-json')
 if not isinstance(x,dict)or x.get('verified')is not True or x.get('qaId')!=cfg['id']:fail('identity-mismatch')
 if action in {'prepare','verify'}:
  if x.get('kind')!='bangla-private-qa' or x.get('imageDigest')!=cfg['image'].split('@')[1]or x.get('baseURL')!='http://127.0.0.1:3001'or x.get('isolated')is not True or not clean(x.get('actualStage'))or x.get('socket')!=f"/opt/bangla-adventures/private-staging/qa/{cfg['id']}/runtime/http.sock":fail('attestation-mismatch')
  qa=x.get('qa',{})
  if set(qa)!={'users','pendingTopics','pendingLessons'}or type(qa.get('users'))is not int or not 0<=qa['users']<=7 or type(qa.get('pendingTopics'))is not int or qa['pendingTopics']not in {14,15}or type(qa.get('pendingLessons'))is not int or qa['pendingLessons']not in {17,18}:fail('counts-mismatch')
  if action=='prepare'and(x.get('prepared')is not True or qa!=dict(users=0,pendingTopics=15,pendingLessons=18)):fail('prepare-mismatch')
  safe={k:x[k]for k in ('verified','kind','qaId','imageDigest','baseURL','isolated','socket','actualStage','qa')}
  if action=='prepare':safe['prepared']=True
 elif action=='bootstrap-admin':
  expected=dict(verified=True,qaId=cfg['id'],bootstrapAdmin=True,approvedAdults=1,approvedStudents=0,noContentApprovals=True)
  if set(x)!=set(expected)or any(type(x[k])is not type(v)or x[k]!=v for k,v in expected.items()):fail('bootstrap-mismatch')
  safe=expected
 else:
  if set(x)!={'verified','qaId','removed','actualStage'}or x.get('removed')is not True or not clean(x.get('actualStage')):fail('cleanup-mismatch')
  safe={k:x[k]for k in ('verified','qaId','removed','actualStage')}
 print(json.dumps(safe))
except subprocess.TimeoutExpired:fail('remote-timeout')
except(OSError,ValueError,TypeError,KeyError):fail('local-operation-failed')
'''
with open(hook,'w')as output:output.write(source)
os.chmod(hook,0o700)
HOOK
"$qa_hook" prepare "$qa_id" > "$work/qa-prepare.json" || fail 'Disposable four-role QA preparation refused.'
phase=qa-tunnel
require_free_local_port
ssh "${ssh_options[@]}" -o ClearAllForwardings=no -o ExitOnForwardFailure=yes -o GatewayPorts=no \
  -N -L "127.0.0.1:3001:$qa_socket" "$user@$host" > "$work/tunnel.log" 2>&1 &
tunnel_pid=$!
ready=false
for attempt in {1..30}; do
  kill -0 "$tunnel_pid" 2>/dev/null || fail 'Disposable QA SSH tunnel could not open.'
  status="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "$origin/api/health" 2>/dev/null || true)"
  if [ "$status" = 200 ]; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || fail 'Disposable QA health did not become ready.'
phase=role-browser
mkdir "$work/browser-evidence"
if ! PRIVATE_QA_ID="$qa_id" PRIVATE_QA_CONTROLLER="$qa_hook" PRIVATE_QA_BASE_URL="$origin" PRIVATE_QA_ARTIFACTS="$work/browser-evidence" \
  node "$root/tests/staging/browser-role-acceptance.mjs" > "$work/browser.log" 2>&1; then
  python3 - "$work/browser.log" "$evidence/browser-failure.json" <<'BROWSER_FAILURE'
import json,sys
from pathlib import Path
steps={'verify-clean-clone','browser-start','fixture-signups','bootstrap-admin','admin-login','account-approvals','role-logins','curriculum-review','class-setup','activity-review','class-records','topic-review','student-work','role-screens','final-assertions','cleanup'}
operations={'navigate','hydrate-form','fill-identity','fill-password','submit','destination','server-session','cookie','reload','loaded-data','api','screenshot','guard','bootstrap'}
codes={'acceptance-api-status','acceptance-assertion-failed','browser-operation-failed','guard-refused'}
try:
 raw=Path(sys.argv[1]).read_bytes();assert len(raw)<=262144
 for line in reversed(raw.decode().splitlines()):
  try:x=json.loads(line)
  except ValueError:continue
  if not isinstance(x,dict)or x.get('kind')!='disposable-qa-role-acceptance':continue
  assert x.get('passed')is False and x.get('failedStep')in steps and type(x.get('cleanupVerified'))is bool
  safe={k:x[k]for k in ('passed','failedStep','cleanupVerified')}
  for k,allowed in [('failedOperation',operations),('errorCode',codes)]:
   if k in x:assert x[k]in allowed;safe[k]=x[k]
  if 'loginResponseStatus'in x:assert type(x['loginResponseStatus'])is int and(x['loginResponseStatus']==0 or 100<=x['loginResponseStatus']<=599);safe['loginResponseStatus']=x['loginResponseStatus']
  Path(sys.argv[2]).write_text(json.dumps(safe)+'\n');break
except(OSError,ValueError,AssertionError,TypeError):pass
BROWSER_FAILURE
  fail 'Four-role browser acceptance failed; raw logs and partial screenshots withheld.'
fi
phase=qa-cleanup
"$qa_hook" cleanup "$qa_id" > "$work/cleanup.json" || fail 'Disposable QA cleanup could not be verified.'
cleanup_verified=true
cp -- "$work/cleanup.json" "$evidence/qa-cleanup.json"
qa_hook=''
phase=final-inventory
remote_inventory "$work/stage-after.json" || fail 'Final actual-stage verification failed.'
python3 - "$work/stage-before.json" "$work/stage-after.json" <<'UNCHANGED'
import json,sys
before,after=(json.load(open(p))for p in sys.argv[1:]);assert before==after,'Actual stage image, app ID or logical database state changed.'
UNCHANGED
cp -- "$work/stage-after.json" "$evidence/stage-after.json"
# Copy exactly the complete, validated synthetic success report and known PNG files. Never raw logs/traces.
python3 - "$work/browser-evidence/role-acceptance-$qa_id" "$evidence" "$revision" "$image" <<'BROWSER_RESULT'
import json,struct,sys
from pathlib import Path
source,out=map(Path,sys.argv[1:3]);assert source.is_dir()and not source.is_symlink()
names={'admin-pending-users.png','admin-class-publication.png','teacher-students.png','teacher-results.png','teacher-attendance.png','teacher-announcements.png','teacher-lessons.png','student-learning.png','student-results.png','student-topic.png','student-lesson.png','parent-learning.png'}
assert {p.name for p in source.iterdir()}==names|{'result.json'}
report=source/'result.json';assert report.is_file()and not report.is_symlink()and report.stat().st_size<65536
x=json.loads(report.read_text())
expected_keys={'kind','passed','origin','revision','imageDigest','roles','scenario','cleanupVerified','actualStageAfterCleanup','screenshotCount'}
assert set(x)in(expected_keys,expected_keys|{'loginResponseStatus'})and x.get('loginResponseStatus',200)==200 and x['kind']=='disposable-qa-role-acceptance' and x['passed']is True and x['origin']=='http://127.0.0.1:3001' and x['revision']==sys.argv[3]and x['imageDigest']==sys.argv[4].split('@')[1]and x['cleanupVerified']is True and x['actualStageAfterCleanup']==dict(users=0,pendingTopics=15,pendingLessons=18)and x['screenshotCount']==12
assert isinstance(x['roles'],list)and len(x['roles'])==4
role_keys={'role','realFormLogin','secureHttpOnlyCookie','cookieSurvivedReload','serverSessionAuthenticated','fullyLoadedScreens'}
assert {r['role']for r in x['roles']}=={'admin','teacher','student','parent'}
assert all(set(r)==role_keys and all(r[k]is True for k in role_keys-{'role'})for r in x['roles'])
scenario=dict(fixtureAdults=3,fixtureStudents=4,enrolledStudents=3,pendingAccounts=1,classes=1,publishedActivities=1,pendingActivities=1,submissions=2,attendanceSessions=2,attendanceMarks=6,announcements=3,linkedChildren=1,accountApprovalFlow=True,teacherCannotPublish=True,activityHiddenUntilApproved=True,topicEditHiddenUntilApproved=True,parentOnlyLinkedChild=True,audienceFiltering=True,resultsMatchAcrossRoles=True,bundledAudioAvailable=True,lessonAvailable=True,unexpectedBrowserErrors=0,fullyLoadedDashboards=True)
assert set(x['scenario'])==set(scenario)and all(type(x['scenario'][k])is type(v)and x['scenario'][k]==v for k,v in scenario.items())
images={}
for name in names:
 p=source/name;assert p.is_file()and not p.is_symlink()and 32<p.stat().st_size<4000000
 data=p.read_bytes();assert data[:8]==b'\x89PNG\r\n\x1a\n'and data[12:16]==b'IHDR'
 width,height=struct.unpack('>II',data[16:24]);assert 300<=width<=5000 and 200<=height<=20000
 images[name]=data
screens=out/'synthetic-role-screens';screens.mkdir(mode=0o700)
for name,data in images.items():(screens/name).write_bytes(data)
(out/'roles.json').write_text(json.dumps(x)+'\n')
BROWSER_RESULT
phase=completed
printf 'Private acceptance passed: operational backup/monitor, isolated failed-release rollback and four-role QA; actual stage remains zero users and 33 pending contents.\n'
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '## Private acceptance\n\nPinned revision `%s`: operational local backup/monitor checks, isolated automatic rollback and all four synthetic role walkthroughs passed. The disposable classroom was removed. Actual stage: **0 users, 15 pending topics, 18 pending lessons**, unchanged logical state and application container. Published VPS ports: **0**. Production deployment remains disabled.\n' "$revision" >> "$GITHUB_STEP_SUMMARY"
fi
