#!/usr/bin/env bash
# Private, clean staging only. No host TCP ports are published on the VPS.
set -euo pipefail
set +x
umask 077
fail() { printf 'private staging: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 0 ] || fail 'This pinned staging controller accepts no arguments.'
[ "${DEPLOY_ENABLED:-false}" = false ] || fail 'The production deployment gate must remain disabled.'
[ "${REPOSITORY_GATE_CONFIRMED:-}" = disabled ] || fail 'The repository-context gate must complete before loading production credentials.'
[ "${GITHUB_REPOSITORY:-}" = omargad/Bangla-Adventure ] && [ "${GITHUB_REF:-}" = refs/heads/main ] || fail 'Private staging runs only from the audited repository main branch.'
[ -n "${DEPLOY_SSH_KEY:-}" ] && [ -n "${DEPLOY_KNOWN_HOSTS:-}" ] || fail 'Pinned deployment credentials are missing.'
[ -n "${REGISTRY_PASSWORD:-}" ] || fail 'The temporary read-only registry token is missing.'
[[ "${REGISTRY_USER:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*(\[bot\])?$ ]] || fail 'Invalid registry account name.'
case "$DEPLOY_KNOWN_HOSTS" in *'PRIVATE KEY'*|*'-----BEGIN'*) fail 'The public known_hosts variable contains misplaced private credentials.' ;; esac

readonly host=203.0.113.10 user=deployer port=22
readonly key_pin='SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ'
readonly host_pin='SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8'
readonly image='ghcr.io/omargad/bangla-adventure@sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2'
readonly revision=95b6308ac7ad3d5b6bb2d951df9d65a23ff77107
readonly socket=/opt/bangla-adventures/private-staging/runtime/http.sock
readonly origin=http://127.0.0.1:3001
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
chmod 700 "$work"
incoming='' tunnel_pid='' qa_hook='' qa_id='' evidence=''
attempt_phase=bootstrap
qa_cleanup_verified=false
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
cleanup() {
  local status=$?
  trap - EXIT
  if [ -n "$tunnel_pid" ]; then kill "$tunnel_pid" 2>/dev/null || true; wait "$tunnel_pid" 2>/dev/null || true; fi
  if [ -n "$qa_hook" ] && [ -x "$qa_hook" ]; then
    if "$qa_hook" cleanup "$qa_id" > "$work/qa-cleanup-trap.json"; then
      qa_cleanup_verified=true
      if [ -n "$evidence" ]; then cp -- "$work/qa-cleanup-trap.json" "$evidence/qa-cleanup.json"; fi
    else printf 'private staging: disposable QA cleanup could not be verified.\n' >&2; status=1; fi
  fi
  if [ -n "$evidence" ] && [ -d "$evidence" ]; then
    if [ -f "$work/qa-diagnostics.json" ]; then cp -- "$work/qa-diagnostics.json" "$evidence/qa-diagnostics.json"; fi
    if [ "$status" -ne 0 ]; then
      printf '{"overall":"failed","phase":"%s","qaBrowserLoginVerified":false,"qaCleanupVerified":%s}\n' "$attempt_phase" "$qa_cleanup_verified" > "$evidence/attempt-status.json"
    fi
  fi
  if [[ "$incoming" =~ ^/opt/bangla-adventures/\.private-stage-payload\.[a-zA-Z0-9]+$ ]]; then
    ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" \
      "if [ -d $(quote "$incoming") ] && [ ! -L $(quote "$incoming") ] && [ \"\$(stat -c %u -- $(quote "$incoming"))\" = 1002 ]; then rm -rf -- $(quote "$incoming"); fi" \
      </dev/null >/dev/null 2>&1 || true
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
registry_token="$REGISTRY_PASSWORD"
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
  ssh-keygen -F "$host" -f "$work/host_line" >/dev/null 2>&1 || fail 'The verified public key does not cover the fixed VPS address.'
  # Export only the fixed address and verified PUBLIC server key, never comments or a private key.
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
  python3 - <<'PY'
import socket
with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as probe:
 try: probe.bind(("127.0.0.1",3001))
 except OSError: raise SystemExit("Runner loopback port 3001 must be free before opening the private SSH tunnel.")
PY
}
require_free_local_port

# This first remote operation is strictly read-only. Nothing is uploaded or created until it passes.
if ! ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" 'bash -s' > "$work/inventory.json" 2> "$work/ssh.log" <<'INVENTORY'
set -euo pipefail
phase=identity
fail() { printf '{"scope":"private-staging","inventory":"refused","phase":"%s"}\n' "$phase"; exit 1; }
[ "$(id -un)" = deployer ] && [ "$(id -u)" = 1002 ] || fail
phase=parent-directory
[ -d /opt/bangla-adventures ] && [ ! -L /opt/bangla-adventures ] && [ -w /opt/bangla-adventures ] || fail
[ "$(realpath -e /opt/bangla-adventures)" = /opt/bangla-adventures ] || fail
parent_owner="$(stat -c %u /opt/bangla-adventures)"
case "$parent_owner" in 0|1002) ;; *) fail ;; esac
parent_mode="$(stat -c %a /opt/bangla-adventures)"
(( (8#$parent_mode & 2) == 0 )) || fail
phase=rootless-daemon
[ -S /run/user/1002/docker.sock ] && [ "$(stat -c %u /run/user/1002/docker.sock)" = 1002 ] || fail
docker() { command env -u DOCKER_HOST -u DOCKER_CONTEXT docker --host unix:///run/user/1002/docker.sock "$@"; }
context="$(docker context inspect rootless --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" || fail
[ "$context" = unix:///run/user/1002/docker.sock ] || fail
security="$(docker info --format '{{json .SecurityOptions}}' 2>/dev/null)" || fail
case "$security" in *'"name=rootless"'*) ;; *) fail ;; esac
docker compose version --short >/dev/null 2>&1 || fail
phase=capacity
production_files=0
for filename in .env app.env production.env compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  if [ -e "/opt/bangla-adventures/$filename" ] || [ -L "/opt/bangla-adventures/$filename" ]; then production_files=$((production_files + 1)); fi
done
command -v ss >/dev/null || fail
occupied_ports=0
for port in 3001 8001; do if [ -n "$(ss -H -ltn "sport = :$port")" ]; then occupied_ports=$((occupied_ports + 1)); fi; done
available_kib="$(df -Pk -- /opt/bangla-adventures | awk 'NR==2 {print $4}')"
memory_kib="$(awk '$1=="MemAvailable:" {print $2}' /proc/meminfo)"
[[ "$available_kib" =~ ^[0-9]+$ ]] && [ "$available_kib" -ge 5242880 ] || fail
[[ "$memory_kib" =~ ^[0-9]+$ ]] && [ "$memory_kib" -ge 1048576 ] || fail
phase=existing-stage
stage=/opt/bangla-adventures/private-staging
if [ -e "$stage" ] || [ -L "$stage" ]; then
  [ -d "$stage" ] && [ ! -L "$stage" ] && [ "$(stat -c '%u:%a' "$stage")" = 1002:700 ] || fail
  marker="$stage/.private-staging-marker"
  [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(stat -c %u "$marker")" = 1002 ] || fail
  [ "$(cat "$marker")" = bangla-adventures-private-staging-v1 ] || fail
  [ -d "$stage/tools" ] && [ ! -L "$stage/tools" ] && [ "$(stat -c %u "$stage/tools")" = 1002 ] || fail
  if [ -e "$stage/runtime" ] || [ -L "$stage/runtime" ]; then
    [ -d "$stage/runtime" ] && [ ! -L "$stage/runtime" ] && [ "$(stat -c %u "$stage/runtime")" = 1002 ] || fail
    if [ -e "$stage/runtime/http.sock" ] || [ -L "$stage/runtime/http.sock" ]; then
      [ -S "$stage/runtime/http.sock" ] && [ ! -L "$stage/runtime/http.sock" ] || fail
    fi
  fi
fi
containers="$(docker ps -aq 2>/dev/null)" || fail
phase=container-isolation
unrelated_containers=0
for container in $containers; do
  project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container" 2>/dev/null)" || fail
  name="$(docker inspect --format '{{.Name}}' "$container" 2>/dev/null)" || fail
  if [ "$project" != bangla-adventures-staging ]; then
    case "$name" in /bangla-adventures-staging-*|/bangla-adventures-staging_*) fail ;; esac
    unrelated_containers=$((unrelated_containers + 1)); continue
  fi
  [ -d "$stage" ] || fail
  bindings="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$container" 2>/dev/null)" || fail
  case "$bindings" in null|'{}') ;; *) fail ;; esac
  [ "$(docker inspect --format '{{.HostConfig.PublishAllPorts}}' "$container" 2>/dev/null)" = false ] || fail
  actual_ports="$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$container" 2>/dev/null)" || fail
  python3 -c 'import json,sys;x=json.loads(sys.argv[1]);sys.exit(0 if x is None or (isinstance(x,dict) and all(v is None or v==[] for v in x.values())) else 1)' "$actual_ports" || fail
  [ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container" 2>/dev/null)" = bangla-adventures-staging_default ] || fail
  service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$container" 2>/dev/null)" || fail
  mounts="$(docker inspect --format '{{json .Mounts}}' "$container" 2>/dev/null)" || fail
  python3 - "$stage" "$service" "$mounts" <<'MOUNTS' || fail
import json,sys
stage,service=sys.argv[1:3]
expected={
 "app": {"/app/.data":("volume","bangla-adventures-staging_bangla-data",True), "/app/staging-tools/private-staging-verify.mjs":("bind",stage+"/tools/private-staging-verify.mjs",False)},
 "proxy": {"/runtime":("bind",stage+"/runtime",True), "/app/staging-tools/private-staging-proxy.mjs":("bind",stage+"/tools/private-staging-proxy.mjs",False)},
}.get(service)
mounts=json.loads(sys.argv[3])
if expected is None or len(mounts)!=len(expected): raise SystemExit(1)
for mount in mounts:
 target=mount.get("Destination")
 actual=(mount.get("Type"),mount.get("Name") if mount.get("Type")=="volume" else mount.get("Source"),mount.get("RW"))
 if target not in expected or actual!=expected[target]: raise SystemExit(1)
MOUNTS
done
volumes="$(docker volume ls --format '{{.Name}}' 2>/dev/null)" || fail
phase=volume-isolation
unrelated_volumes=0
for volume in $volumes; do
  project="$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume" 2>/dev/null)" || fail
  case "$volume" in
    bangla-adventures-staging_bangla-data|bangla-adventures-staging-backups) [ "$project" = bangla-adventures-staging ] || fail ;;
    *) [ "$project" != bangla-adventures-staging ] || fail; unrelated_volumes=$((unrelated_volumes + 1)); continue ;;
  esac
  [ -d "$stage" ] || fail
  [ "$(docker volume inspect --format '{{index .Labels "io.bangla.scope"}}' "$volume" 2>/dev/null)" = private-staging ] || fail
  [ "$(docker volume inspect --format '{{.Driver}}' "$volume" 2>/dev/null)" = local ] || fail
  options="$(docker volume inspect --format '{{json .Options}}' "$volume" 2>/dev/null)" || fail
  case "$options" in null|'{}') ;; *) fail ;; esac
done
networks="$(docker network ls --format '{{.Name}}' 2>/dev/null)" || fail
phase=network-isolation
unrelated_networks=0
for network in $networks; do
  project="$(docker network inspect --format '{{index .Labels "com.docker.compose.project"}}' "$network" 2>/dev/null)" || fail
  if [ "$project" != bangla-adventures-staging ]; then
    [ "$network" != bangla-adventures-staging_default ] || fail
    unrelated_networks=$((unrelated_networks + 1)); continue
  fi
  [ -d "$stage" ] && [ "$network" = bangla-adventures-staging_default ] || fail
  [ "$(docker network inspect --format '{{.Internal}}' "$network" 2>/dev/null)" = true ] || fail
  [ "$(docker network inspect --format '{{.Driver}}' "$network" 2>/dev/null)" = bridge ] || fail
done
printf '{"scope":"private-staging","inventory":"passed","uid":1002,"rootless":true,"hostPortsPublished":0,"productionConflict":false,"productionFilesPresent":%s,"occupiedReservedTcpPorts":%s,"unrelatedContainers":%s,"unrelatedVolumes":%s,"unrelatedNetworks":%s,"availableDiskKiB":%s,"availableMemoryKiB":%s}\n' "$production_files" "$occupied_ports" "$unrelated_containers" "$unrelated_volumes" "$unrelated_networks" "$available_kib" "$memory_kib"
INVENTORY
then
  python3 - "$work/inventory.json" <<'REFUSAL'
import json,sys
try:
 x=json.load(open(sys.argv[1]))
 phases={"identity","parent-directory","rootless-daemon","capacity","existing-stage","container-isolation","volume-isolation","network-isolation"}
 if set(x)=={"scope","inventory","phase"} and x["scope"]=="private-staging" and x["inventory"]=="refused" and x["phase"] in phases: print("Read-only inventory refused during "+x["phase"]+".",file=sys.stderr)
except (OSError,ValueError): pass
REFUSAL
  fail 'Read-only SSH inventory failed; no staging payload was uploaded or created.'
fi
python3 - "$work/inventory.json" <<'PY'
import json,sys
expected={"scope":"private-staging","inventory":"passed","uid":1002,"rootless":True,"hostPortsPublished":0,"productionConflict":False}
x=json.load(open(sys.argv[1]))
metrics={"productionFilesPresent","occupiedReservedTcpPorts","unrelatedContainers","unrelatedVolumes","unrelatedNetworks","availableDiskKiB","availableMemoryKiB"}
if set(x)!=set(expected)|metrics or any(x[k]!=v for k,v in expected.items()) or any(type(x[k]) is not int or x[k]<0 for k in metrics): raise SystemExit("Invalid sanitized inventory evidence.")
PY

mkdir "$work/payload"
sources=(deploy/private-staging.compose.yaml scripts/private-staging-proxy.mjs scripts/private-staging-remote.sh scripts/private-staging-verify.mjs scripts/private-staging-drill.sh scripts/private-staging-qa.sh)
names=(compose.yaml private-staging-proxy.mjs private-staging-remote.sh private-staging-verify.mjs private-staging-drill.sh private-staging-qa.sh)
for index in "${!sources[@]}"; do
  [ -f "$root/${sources[$index]}" ] && [ ! -L "$root/${sources[$index]}" ] || fail 'A required regular staging helper is missing.'
  cp -- "$root/${sources[$index]}" "$work/payload/${names[$index]}"
done
incoming="$(ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" 'umask 077; mktemp -d /opt/bangla-adventures/.private-stage-payload.XXXXXXXXXXXX' 2> "$work/ssh.log")" || fail 'Could not create the isolated staging incoming directory.'
[[ "$incoming" =~ ^/opt/bangla-adventures/\.private-stage-payload\.[a-zA-Z0-9]+$ ]] || fail 'Unexpected staging incoming directory.'
tar -C "$work/payload" -cf - -- "${names[@]}" | ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" \
  "test -d $(quote "$incoming") && test ! -L $(quote "$incoming") && test \"\$(stat -c '%u:%a' -- $(quote "$incoming"))\" = 1002:700 && tar --extract --file - --directory $(quote "$incoming") --no-same-owner --no-same-permissions" \
  > "$work/transfer.log" 2> "$work/ssh.log" || fail 'Staging helper transfer failed.'
remote_command="bash $(quote "$incoming/private-staging-remote.sh") $(quote "$image") $(quote "$revision") $(quote "$incoming") $(quote "$REGISTRY_USER")"
if ! printf '%s\n' "$registry_token" | ssh "${ssh_options[@]}" -o ClearAllForwardings=yes "$user@$host" "$remote_command" > "$work/remote.log" 2> "$work/ssh.log"; then
  unset registry_token
  fail 'Private staging remote preparation failed; raw logs are withheld to protect credentials.'
fi
unset registry_token
tail -n 1 "$work/remote.log" > "$work/result.json"
python3 - "$work/result.json" "$image" "$revision" "$socket" <<'PY'
import json,re,sys
x=json.load(open(sys.argv[1]))
expected={"scope":"private-staging","status":"healthy","image":sys.argv[2],"revision":sys.argv[3],"project":"bangla-adventures-staging","origin":"http://127.0.0.1:3001","socket":sys.argv[4],"publishedPorts":0}
def exact(value,template):
 if type(value) is not type(template): return False
 if isinstance(template,dict): return set(value)==set(template) and all(exact(value[k],v) for k,v in template.items())
 return value==template
proof_keys={"cleanVerifier","restartVerifier","restoreDrill","containerReplacement"}
def refuse(): raise SystemExit("Unexpected private staging result or aggregate proof; raw logs will not be exported.")
if set(x)!=set(expected)|proof_keys or not exact({k:x[k] for k in expected},expected): refuse()
counts={"pendingTopics":15,"pendingLessons":18,"shippedStates":33,"users":0,"approvals":0,"baselines":0,"businessRows":0,"mediaFiles":0}
for name,restarted in (("cleanVerifier",False),("restartVerifier",True)):
 proof=x[name]
 checks={"integrity":True,"foreignKeys":True,"unpublished":True,"cleanIdentities":True,"expectedStateMatched":True if restarted else None,"databaseWriteRolledBack":None if restarted else True,"mediaWriteRemoved":None if restarted else True}
 if not isinstance(proof,dict) or set(proof)!={"verified","stateDigest","counts","checks"} or proof.get("verified") is not True: refuse()
 if not isinstance(proof.get("stateDigest"),str) or not re.fullmatch(r"[a-f0-9]{64}",proof["stateDigest"]): refuse()
 if not exact(proof["counts"],counts) or not exact(proof["checks"],checks): refuse()
drill={"verified":True,"checks":{k:True for k in ("sourceUnchanged","cleanSnapshotVerified","probeSnapshotVerified","probeDatabaseRestored","probeMediaRestored","cleanOriginalRestored","integrity","foreignKeys","archivesUnchanged")},"counts":{"pendingTopics":15,"pendingLessons":18,"sourceUsers":0,"probeRecords":3,"probeMediaFiles":2},"artifactsRetained":False,"scope":"disposable clone only"}
if not exact(x["restoreDrill"],drill): refuse()
replacement=x["containerReplacement"]
if not isinstance(replacement,dict) or set(replacement)!={"appReplaced","beforeAppId","afterAppId","stateDigestUnchanged"}: refuse()
if replacement.get("appReplaced") is not True or replacement.get("stateDigestUnchanged") is not True: refuse()
if any(not isinstance(replacement.get(k),str) or not re.fullmatch(r"[a-f0-9]{64}",replacement[k]) for k in ("beforeAppId","afterAppId")): refuse()
if replacement["beforeAppId"]==replacement["afterAppId"] or x["cleanVerifier"]["stateDigest"]!=x["restartVerifier"]["stateDigest"]: refuse()
PY

# Retain only already-validated actual-stage proof, even if later disposable QA fails.
evidence="${PRIVATE_STAGING_EVIDENCE_DIR:?An isolated evidence directory is required.}"
[ ! -L "$evidence" ] || fail 'Evidence directory must not be a symlink.'
mkdir -p -- "$evidence"
chmod 700 "$evidence"
cp -- "$work/inventory.json" "$evidence/inventory.json"
cp -- "$work/result.json" "$evidence/staging-result.json"
cp -- "$work/known_hosts" "$evidence/staging_known_hosts"
printf '{"overall":"in-progress","phase":"stage-tunnel","qaBrowserLoginVerified":false,"qaCleanupVerified":false}\n' > "$evidence/attempt-status.json"
attempt_phase=stage-tunnel

# A real SSH TCP-to-Unix tunnel is tested on the runner; the VPS publishes no TCP listener.
ssh "${ssh_options[@]}" -o ClearAllForwardings=no -o ExitOnForwardFailure=yes -o GatewayPorts=no \
  -N -L "127.0.0.1:3001:$socket" "$user@$host" > "$work/tunnel.log" 2>&1 &
tunnel_pid=$!
ready=false
for attempt in {1..30}; do
  kill -0 "$tunnel_pid" 2>/dev/null || fail 'The private SSH tunnel could not open.'
  status="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "$origin/api/health" 2>/dev/null || true)"
  if [ "$status" = 200 ]; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || fail 'The application did not become healthy through the SSH tunnel.'
http_status() { curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "$@"; }
[ "$(http_status "$origin/welcome")" = 200 ] || fail 'Welcome did not return 200 through the tunnel.'
[ "$(http_status "$origin/api/profiles")" = 401 ] || fail 'Anonymous protected access did not return 401.'
[ "$(http_status -X POST -H 'Content-Type: application/json' -H 'Origin: https://invalid.example' --data '{}' "$origin/api/auth/sign-up")" = 403 ] || fail 'Cross-origin account mutation was not rejected.'
printf '{"transport":"SSH TCP-to-Unix","origin":"%s","health":200,"welcome":200,"protected":401,"crossOriginDenied":403,"stageAccountsCreated":0,"qaBrowserLoginVerified":false}\n' "$origin" > "$evidence/tunnel-probes.json"

# Browser sign-in is tested on a disposable, positively identified QA clone only.
kill "$tunnel_pid" 2>/dev/null || true
wait "$tunnel_pid" 2>/dev/null || true
tunnel_pid=''
qa_id="$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
qa_socket="/opt/bangla-adventures/private-staging/qa/$qa_id/runtime/http.sock"
qa_hook="$work/qa-controller"
attempt_phase=qa-prepare
python3 - "$qa_hook" "$work/qa-config.json" "$qa_id" "$image" "$revision" "${ssh_options[@]}" <<'HOOK'
import json,os,sys
hook,config,qa_id,image,revision=sys.argv[1:6]
with open(config,"w") as output: json.dump({"ssh":["ssh",*sys.argv[6:],"-o","ClearAllForwardings=yes","deployer@203.0.113.10"],"id":qa_id,"image":image,"revision":revision},output)
source=r'''#!/usr/bin/env python3
import json,subprocess,sys
from pathlib import Path
action="invalid"
helper_codes={"arguments","platform","real-stage","prepare-path","prepare-network","prepare-volume","prepare-app","prepare-proof-copy","prepare-app-start","prepare-proxy","prepare-proxy-start","prepare-ready","verify-resources","verify-database","approve-fixtures","cleanup"}
def helper_diagnostic(text):
 if isinstance(text,bytes): text=text.decode("utf-8",errors="ignore")
 if not isinstance(text,str): return None
 prefix=f"PRIVATE_QA_DIAGNOSTIC:{action}:"
 matches=[line[len(prefix):] for line in text.splitlines() if line.startswith(prefix) and line[len(prefix):] in helper_codes]
 return matches[-1] if matches else None
def fail(code="verification-refused",exit_code=None,helper_code=None):
 safe_actions={"invalid","prepare","verify","approve-fixtures","cleanup"}
 codes={"verification-refused","invalid-request","remote-exit","remote-timeout","invalid-json","identity-mismatch","attestation-mismatch","socket-mismatch","counts-mismatch","prepare-mismatch","approval-mismatch","cleanup-mismatch","local-operation-failed"}
 if action not in safe_actions or code not in codes: raise SystemExit("Private QA controller failed safely.")
 helper_code=helper_code if helper_code in helper_codes else None
 entry={"action":action,"code":code,"remoteExitCode":exit_code if type(exit_code) is int and 0<=exit_code<=255 else None,"helperCode":helper_code}
 path=Path(__file__).with_name("qa-diagnostics.json")
 try:
  history=json.loads(path.read_text()) if path.exists() else []
  if not isinstance(history,list): history=[]
  path.write_text(json.dumps((history+[entry])[-8:]))
 except (OSError,ValueError): pass
 suffix=f" helper={helper_code}" if helper_code else ""
 raise SystemExit(f"Private QA controller failed [action={action} code={code}{suffix}]; remote output withheld.")
try:
 cfg=json.loads(Path(__file__).with_name("qa-config.json").read_text())
 if len(sys.argv)!=3 or sys.argv[1] not in {"prepare","verify","approve-fixtures","cleanup"} or sys.argv[2]!=cfg["id"]: fail("invalid-request")
 action=sys.argv[1]
 command=f"bash /opt/bangla-adventures/private-staging/tools/private-staging-qa.sh {action} {cfg['id']}"
 response=subprocess.run([*cfg["ssh"],command],input="",text=True,capture_output=True,timeout=240)
 if response.returncode: fail("remote-exit",response.returncode,helper_diagnostic(response.stderr))
 try: x=json.loads(response.stdout)
 except ValueError: fail("invalid-json")
 if not isinstance(x,dict) or x.get("verified") is not True or x.get("qaId")!=cfg["id"]: fail("identity-mismatch")
 clean={"users":0,"pendingTopics":15,"pendingLessons":18}
 if action in {"prepare","verify"}:
  if x.get("kind")!="bangla-private-qa" or x.get("imageDigest")!=cfg["image"].split("@")[1] or x.get("baseURL")!="http://127.0.0.1:3001" or x.get("isolated") is not True or x.get("actualStage")!=clean: fail("attestation-mismatch")
  if x.get("socket")!=f"/opt/bangla-adventures/private-staging/qa/{cfg['id']}/runtime/http.sock": fail("socket-mismatch")
  qa=x.get("qa",{})
  if set(qa)!={"users","pendingTopics","pendingLessons"} or type(qa.get("users")) is not int or qa["users"] not in {0,1,2} or qa.get("pendingTopics")!=15 or qa.get("pendingLessons")!=18: fail("counts-mismatch")
  if action=="prepare" and (x.get("prepared") is not True or qa["users"]!=0): fail("prepare-mismatch")
  safe={k:x[k] for k in ("verified","kind","qaId","imageDigest","baseURL","isolated","actualStage","qa","socket")}
  if action=="prepare": safe["prepared"]=True
 elif action=="approve-fixtures":
  if x.get("approvedAdults")!=1 or x.get("approvedStudents")!=1 or x.get("noContentApprovals") is not True: fail("approval-mismatch")
  safe={k:x[k] for k in ("verified","qaId","approvedAdults","approvedStudents","noContentApprovals")}
 else:
  if x.get("removed") is not True or x.get("actualStage")!=clean: fail("cleanup-mismatch")
  safe={k:x[k] for k in ("verified","qaId","removed","actualStage")}
 print(json.dumps(safe))
except subprocess.TimeoutExpired as error: fail("remote-timeout",helper_code=helper_diagnostic(error.stderr))
except (OSError,ValueError,KeyError,TypeError): fail("local-operation-failed")
'''
with open(hook,"w") as output: output.write(source)
os.chmod(hook,0o700)
HOOK
"$qa_hook" prepare "$qa_id" > "$work/qa-prepare.json"
attempt_phase=qa-tunnel
require_free_local_port
ssh "${ssh_options[@]}" -o ClearAllForwardings=no -o ExitOnForwardFailure=yes -o GatewayPorts=no \
  -N -L "127.0.0.1:3001:$qa_socket" "$user@$host" > "$work/qa-tunnel.log" 2>&1 &
tunnel_pid=$!
ready=false
for attempt in {1..30}; do
  kill -0 "$tunnel_pid" 2>/dev/null || fail 'The disposable QA tunnel could not open.'
  status="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "$origin/api/health" 2>/dev/null || true)"
  if [ "$status" = 200 ]; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || fail 'The disposable QA clone did not become healthy.'
mkdir "$work/qa-evidence"
attempt_phase=qa-browser
if ! PRIVATE_QA_ID="$qa_id" PRIVATE_QA_CONTROLLER="$qa_hook" PRIVATE_QA_BASE_URL="$origin" PRIVATE_QA_ARTIFACTS="$work/qa-evidence" \
  node "$root/tests/staging/browser-auth-smoke.mjs" > "$work/qa-browser.log" 2>&1; then
  python3 - "$work/qa-browser.log" "$evidence/qa-browser-failure.json" <<'BROWSER_FAILURE'
import json,pathlib,sys
allowed={"configuration","verify-clean-clone","browser-start","guarded-fixture-signups","fixture-approval","parent-browser-login","student-browser-login","final-clone-counts","cleanup"}
try:
 data=pathlib.Path(sys.argv[1]).read_bytes()
 if len(data)>65536: raise ValueError("bounded report required")
 for line in reversed(data.decode("utf-8").splitlines()):
  try: report=json.loads(line)
  except ValueError: continue
  if not isinstance(report,dict) or report.get("kind")!="disposable-qa-browser-auth": continue
  if report.get("passed") is not False or report.get("failedStep") not in allowed or type(report.get("cleanupVerified")) is not bool: break
  safe={key:report[key] for key in ("passed","failedStep","cleanupVerified")}
  pathlib.Path(sys.argv[2]).write_text(json.dumps(safe)+"\n")
  print("Private QA browser report: failedStep="+safe["failedStep"]+"; cleanupVerified="+str(safe["cleanupVerified"]).lower()+".",file=sys.stderr)
  break
except (OSError,ValueError,TypeError): pass
BROWSER_FAILURE
  fail 'Disposable QA browser sign-in validation failed; raw logs are withheld.'
fi
attempt_phase=qa-cleanup
"$qa_hook" cleanup "$qa_id" > "$work/qa-cleanup.json"
qa_cleanup_verified=true
qa_hook=''
cp -- "$work/qa-cleanup.json" "$evidence/qa-cleanup.json"
cp -R -- "$work/qa-evidence" "$evidence/qa-browser"
printf '{"transport":"SSH TCP-to-Unix","origin":"%s","health":200,"welcome":200,"protected":401,"crossOriginDenied":403,"stageAccountsCreated":0,"qaBrowserLoginVerified":true}\n' "$origin" > "$evidence/tunnel-probes.json"
attempt_phase=completed
printf '{"overall":"passed","phase":"completed","qaBrowserLoginVerified":true,"qaCleanupVerified":true}\n' > "$evidence/attempt-status.json"
printf 'private staging: verified pinned image and clean private stage through SSH; health=200, welcome=200, anonymous protected=401, cross-origin=403. No accounts created.\n'
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '## Private staging\n\nPinned revision `%s` is available only through the authenticated SSH tunnel. VPS published TCP ports: **0**.\n\nHealth and welcome: 200; anonymous protected endpoint: 401; cross-origin mutation: 403; actual stage accounts: 0. Parent/student browser sign-in passed on a disposable QA clone; clone removal and unchanged clean stage were verified.\n\nThe access artifact contains a verified public server known-hosts line, sanitized evidence and synthetic QA screenshots. Production deployment remains disabled.\n' "$revision" >> "$GITHUB_STEP_SUMMARY"
fi
