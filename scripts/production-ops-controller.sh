#!/usr/bin/env bash
# Runs one production operation on the VPS for the vps-production-ops and vps-production-status
# workflows: install (or update) the user timers and prove them, status, or backup-now with the
# deploy key, or scheduled-status with the status key, which the server limits to status.
#
#   bash scripts/production-ops-controller.sh install|status|backup-now|scheduled-status
#
# The server address and account come from the DEPLOY_HOST and DEPLOY_USER secrets and are never
# printed. The key and the server host key are checked against their pins, in the same way as
# scripts/deploy.sh, before any connection. Only fixed status fields and codes are printed.
# install also sends the public halves of the deploy key and of STATUS_SSH_PUBLIC_KEY, so the
# installer can add the status key's restricted line to authorized_keys; never a private key.
set -euo pipefail
set +x
umask 077
fail() { printf 'production operations: %s\n' "$*" >&2; exit 1; }
# Settings may live at repository level or in the workflow's environment (production or production-status).
missing() { fail "the $1 is missing (add it to the repository or to this workflow's environment)."; }
[ "$#" -eq 1 ] || fail 'usage: production-ops-controller.sh install|status|backup-now|scheduled-status'
action="$1"
case "$action" in install|status|backup-now|scheduled-status) ;; *) fail 'the action must be install, status, backup-now or scheduled-status.' ;; esac
[ "${DEPLOY_ENABLED:-false}" = true ] || fail 'production is not enabled (the DEPLOY_ENABLED variable must be true).'
[ "${GITHUB_REPOSITORY:-}" = omargad/Bangla-Adventure ] && [ "${GITHUB_REF:-}" = refs/heads/main ] || \
  fail 'only the main branch of the project repository may run production operations.'
[ -n "${DEPLOY_HOST:-}" ] || missing 'secret DEPLOY_HOST'
[ -n "${DEPLOY_USER:-}" ] || missing 'secret DEPLOY_USER'
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || fail 'the DEPLOY_HOST secret is invalid.'
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail 'the DEPLOY_USER secret is invalid.'
port="${DEPLOY_PORT:-22}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port > 0 && 10#$port <= 65535)) || fail 'invalid SSH port.'
# The operations are fixed to the production folder and the rootless daemon the deploy uses.
[ "${DEPLOY_PATH:-/opt/bangla-adventures}" = /opt/bangla-adventures ] || fail 'production operations need DEPLOY_PATH=/opt/bangla-adventures.'
[ -z "${DEPLOY_DOCKER_CONTEXT:-}" ] || fail 'production operations use the rootless socket; leave DEPLOY_DOCKER_CONTEXT unset.'
[ "${DEPLOY_DOCKER_HOST:-unix:///run/user/1002/docker.sock}" = unix:///run/user/1002/docker.sock ] || \
  fail 'production operations need DEPLOY_DOCKER_HOST=unix:///run/user/1002/docker.sock.'
host_fingerprint="${DEPLOY_HOST_FINGERPRINT:-SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8}"
key_fingerprint="${DEPLOY_KEY_FINGERPRINT:-SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ}"
[[ "$host_fingerprint" =~ ^SHA256:[a-zA-Z0-9+/]{43}$ ]] || fail 'DEPLOY_HOST_FINGERPRINT must be a SHA256 fingerprint.'
[[ "$key_fingerprint" =~ ^SHA256:[a-zA-Z0-9+/]{43}$ ]] || fail 'DEPLOY_KEY_FINGERPRINT must be a SHA256 fingerprint.'
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly ops=/opt/bangla-adventures/ops
work="$(mktemp -d)"
incoming=''
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$incoming" =~ ^/opt/bangla-adventures/ops/\.incoming\.[a-zA-Z0-9]{12}$ ]]; then
    on_server "if [ -d $(quote "$incoming") ] && [ ! -L $(quote "$incoming") ] && [ \"\$(stat -c %u:%a -- $(quote "$incoming"))\" = 1002:700 ]; then rm -rf -- $(quote "$incoming"); fi" \
      </dev/null >/dev/null 2>&1 || status=1
  fi
  rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# The status key's public line: one ssh-ed25519 key, no options, at most a plain one-word comment.
# Sets status_blob and status_fingerprint. The installer writes its own fixed comment.
status_public() {
  local value="$1" pattern='^ssh-ed25519 ([A-Za-z0-9+/]{68})( [A-Za-z0-9@._-]{1,64})?$' listed
  case "$value" in *$'\n'*|*$'\r'*) fail 'the STATUS_SSH_PUBLIC_KEY variable must be a single line: the contents of status_key.pub.' ;; esac
  [[ "$value" =~ $pattern ]] || fail 'the STATUS_SSH_PUBLIC_KEY variable must be one ssh-ed25519 public key line without options, as in status_key.pub; a comment may use only letters, digits and @._-'
  status_blob="${BASH_REMATCH[1]}"
  printf 'ssh-ed25519 %s\n' "$status_blob" > "$work/status_public"
  listed="$(ssh-keygen -l -E sha256 -f "$work/status_public" 2>/dev/null)" || fail 'the STATUS_SSH_PUBLIC_KEY variable is not a valid SSH public key.'
  [[ "$listed" =~ ^256\ (SHA256:[a-zA-Z0-9+/]{43})\ .*\(ED25519\)$ ]] || fail 'the STATUS_SSH_PUBLIC_KEY variable is not a valid ed25519 public key.'
  status_fingerprint="${BASH_REMATCH[1]}"
}
# Surrounding blanks and a final line break from a pasted file are not part of the key.
status_variable="${STATUS_SSH_PUBLIC_KEY:-}"
status_variable="${status_variable#"${status_variable%%[![:space:]]*}"}"
status_variable="${status_variable%"${status_variable##*[![:space:]]}"}"
status_blob=''
status_fingerprint=''
if [ "$action" = scheduled-status ]; then
  # The daily alert runs without a reviewer, so it never holds the deploy key: its own key is
  # installed with a forced command that can only run status (docs/PRODUCTION_OPERATIONS.md).
  [ -z "${DEPLOY_SSH_KEY:-}" ] || fail 'the scheduled status check must not receive the DEPLOY_SSH_KEY secret.'
  [ -n "${STATUS_SSH_KEY:-}" ] || missing 'secret STATUS_SSH_KEY'
  [ -n "$status_variable" ] || missing 'variable STATUS_SSH_PUBLIC_KEY'
  [ "$status_variable" != remove ] || fail 'the STATUS_SSH_PUBLIC_KEY variable is remove, so the server has no status key; set a new key and run install, or disable this workflow.'
  status_public "$status_variable"
  [ "$status_fingerprint" != "$key_fingerprint" ] || fail 'the status key must not be the deploy key.'
  ssh_key="$STATUS_SSH_KEY"
  key_fingerprint="$status_fingerprint"
  key_name=STATUS_SSH_PUBLIC_KEY
else
  [ -n "${DEPLOY_SSH_KEY:-}" ] || missing 'secret DEPLOY_SSH_KEY'
  ssh_key="$DEPLOY_SSH_KEY"
  key_name=DEPLOY_KEY_FINGERPRINT
  # Only install changes the status key; unset leaves authorized_keys alone, remove deletes its line.
  if [ "$action" = install ] && [ -n "$status_variable" ] && [ "$status_variable" != remove ]; then
    status_public "$status_variable"
    [ "$status_fingerprint" != "$key_fingerprint" ] || fail 'the status key must not be the deploy key.'
  fi
fi
[ -n "${DEPLOY_KNOWN_HOSTS:-}" ] || missing 'variable DEPLOY_KNOWN_HOSTS'
case "$DEPLOY_KNOWN_HOSTS" in *'PRIVATE KEY'*|*'-----BEGIN'*) fail 'DEPLOY_KNOWN_HOSTS must hold only public host-key lines.' ;; esac
printf '%s\n' "$ssh_key" | tr -d '\r' > "$work/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" | tr -d '\r' > "$work/provided_hosts"
unset ssh_key DEPLOY_SSH_KEY STATUS_SSH_KEY DEPLOY_KNOWN_HOSTS GITHUB_TOKEN GH_TOKEN
# The key and host checks of scripts/deploy.sh: the derived public key must match its pin, every
# retained known_hosts line must match the host pin, and the lines must cover this host and port.
ssh-keygen -y -P '' -f "$work/key" > "$work/public_key" 2>/dev/null || fail 'the private key could not be read (an unencrypted CI key is required).'
key_type=''
key_blob=''
read -r key_type key_blob _ < "$work/public_key" || true
[[ "$key_type" =~ ^[a-z0-9][a-z0-9@.-]{0,63}$ && "$key_blob" =~ ^[A-Za-z0-9+/]+={0,2}$ ]] && ((${#key_blob} >= 16 && ${#key_blob} <= 16384)) || \
  fail 'could not read the public half of the private key.'
if [ "$action" = scheduled-status ]; then
  # The private key's own public half must be exactly the key that install restricted to status.
  [ "$key_type $key_blob" = "ssh-ed25519 $status_blob" ] || fail 'the STATUS_SSH_KEY secret does not match the STATUS_SSH_PUBLIC_KEY variable.'
elif [ -n "$status_blob" ]; then
  [ "$status_blob" != "$key_blob" ] || fail 'the status key must not be the deploy key.'
fi
actual="$(ssh-keygen -l -E sha256 -f "$work/public_key" 2>/dev/null | awk '{print $2}')" || fail 'could not fingerprint the private key.'
[ "$actual" = "$key_fingerprint" ] || fail "the key fingerprint does not match $key_name."
: > "$work/known_hosts"
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  [[ "$line" =~ ^[[:space:]]*@ ]] && fail 'host key markers are not allowed; provide the pinned host key directly.'
  printf '%s\n' "$line" > "$work/host_line"
  actual="$(ssh-keygen -l -E sha256 -f "$work/host_line" 2>/dev/null | awk '{print $2}')" || fail 'a known_hosts entry is not a valid SSH host key.'
  [ "$actual" = "$host_fingerprint" ] || fail 'a known_hosts fingerprint does not match DEPLOY_HOST_FINGERPRINT.'
  printf '%s\n' "$line" >> "$work/known_hosts"
done < "$work/provided_hosts"
[ -s "$work/known_hosts" ] || fail 'no verified host key was provided.'
lookup="$DEPLOY_HOST"
[ "$port" = 22 ] || lookup="[$DEPLOY_HOST]:$port"
ssh-keygen -F "$lookup" -f "$work/known_hosts" >/dev/null 2>&1 || fail 'the verified known_hosts entries do not cover the deploy host and port.'
ssh_options=(-F /dev/null -T -i "$work/key" -p "$port" -o BatchMode=yes -o IdentitiesOnly=yes
  -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no
  -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o GlobalKnownHostsFile=/dev/null
  -o "UserKnownHostsFile=$work/known_hosts" -o ForwardAgent=no -o ClearAllForwardings=yes
  -o PermitLocalCommand=no -o ControlMaster=no -o ControlPath=none -o ConnectTimeout=20
  -o ConnectionAttempts=1 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)
# shellcheck disable=SC2029
on_server() { ssh "${ssh_options[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$@"; }

# Prints only fixed fields; codes are checked against the fixed code shape first.
summarise() {
  python3 - "$1" "$2" <<'PY'
import json,re,sys
kind,path=sys.argv[1:]
code=re.compile(r'[a-z0-9][a-z0-9-]{0,63}')
def codes(value):
    return ','.join(c for c in value if isinstance(c,str) and code.fullmatch(c))[:600] if isinstance(value,list) else 'invalid'
try:
    raw=open(path,'rb').read(1048576).decode().strip().splitlines()
    value=json.loads(raw[-1]) if raw else None
except (OSError,ValueError,UnicodeError):
    value=None
if not isinstance(value,dict) or value.get('scope')!='production-operations':
    print(f'{kind}: no valid result was returned.');raise SystemExit(1)
print(f"{kind}: {value.get('status') if value.get('status') in ('passed','healthy','failed','deferred') else 'invalid'}; codes: {codes(value.get('codes')) or 'none'}")
for part in ('backup','monitor','offsite'):
    item=value.get(part)
    if isinstance(item,dict):
        age=item.get('ageSeconds');age=f'{age/3600:.1f} h ago' if type(age) in (int,float) else 'never'
        state=item.get('status') if item.get('status') in ('passed','healthy','failed','deferred','missing','not-configured','invalid') else 'invalid'
        print(f'  {part}: {state}, {age}; codes: {codes(item.get("codes")) or "none"}')
if isinstance(value.get('timers'),dict):
    print('  timers: '+', '.join(f"{k} {'active' if v is True else 'inactive'}" for k,v in value['timers'].items() if k in ('backup','monitor','offsite')))
if isinstance(value.get('initialRuns'),dict):
    print('  initial runs: '+', '.join(k for k in value['initialRuns'] if k in ('backup','offsite','monitor')))
if kind=='install' and value.get('verified') is True:
    key=value.get('statusKey')
    print('  status key: '+(key if key in ('installed','replaced','already-present','removed','already-absent','unchanged') else 'unknown'))
if kind=='install' and value.get('verified') is not True:
    print('  rollback: '+(value.get('rollback') if value.get('rollback') in ('none','complete','incomplete','failed') else 'unknown'))
raise SystemExit(0 if value.get('verified') is True else 1)
PY
}

case "$action" in
  install)
    mkdir "$work/payload"
    names=()
    for source in scripts/production-ops.sh scripts/production-ops.py scripts/production-ops-install.sh scripts/production-ops-install.py \
      deploy/production-ops/ba-production-{backup,monitor,offsite}.{service,timer}; do
      [ -f "$root/$source" ] && [ ! -L "$root/$source" ] || fail 'a reviewed production operations file is missing.'
      names+=("${source##*/}")
      cp -- "$root/$source" "$work/payload/${source##*/}"
    done
    # Public halves only: the deploy key shows which authorized_keys sshd reads; null leaves it alone.
    python3 - "$key_type $key_blob" "$status_variable" "$status_blob" > "$work/payload/status-key.json" <<'PY' || fail 'could not prepare the status key request.'
import json,sys
deploy,variable,blob=sys.argv[1:]
status=None if variable=='' else 'remove' if variable=='remove' else 'ssh-ed25519 '+blob
print(json.dumps({'deployKey':deploy,'statusKey':status},separators=(',',':')))
PY
    names+=(status-key.json)
    case "$status_variable" in
      '') printf 'status key: not requested (STATUS_SSH_PUBLIC_KEY is unset), so authorized_keys stays as it is.\n' ;;
      remove) printf 'status key: removal requested.\n' ;;
      *) printf 'status key: %s requested.\n' "$status_fingerprint" ;;
    esac
    # A private incoming folder in ops/, never in backups/; the installer promotes it under the deploy lock.
    incoming="$(on_server "set -eu; umask 077; [ \"\$(id -u)\" = 1002 ]; [ -f /opt/bangla-adventures/.deploy.lock ]; \
[ -d $ops ] || mkdir $ops; [ ! -L $ops ] && [ \"\$(stat -c %u:%a $ops)\" = 1002:700 ]; mktemp -d $ops/.incoming.XXXXXXXXXXXX" \
      </dev/null 2>"$work/ssh.log")" || fail 'could not create the private incoming folder; production must be deployed first.'
    [[ "$incoming" =~ ^/opt/bangla-adventures/ops/\.incoming\.[a-zA-Z0-9]{12}$ ]] || { incoming=''; fail 'the server returned an unexpected incoming folder.'; }
    tar -C "$work/payload" -cf - -- "${names[@]}" | on_server "test ! -L $(quote "$incoming") && test \"\$(stat -c %u:%a -- $(quote "$incoming"))\" = 1002:700 && \
tar --extract --file - --directory $(quote "$incoming") --no-same-owner --no-same-permissions" > "$work/transfer.log" 2>&1 || fail 'the transfer of the operations files failed.'
    if on_server "bash $(quote "$incoming/production-ops-install.sh") $(quote "$incoming")" </dev/null > "$work/result.json" 2> "$work/install.log"; then
      summarise install "$work/result.json" || fail 'the installation did not report success.'
    else
      summarise install "$work/result.json" > "$work/summary.txt" || true
      cat "$work/summary.txt"
      # Restoration is claimed only when the installer reports it.
      case "$(sed -n 's/^  rollback: //p' "$work/summary.txt")" in
        none) fail 'the installation failed before anything on the server was changed.' ;;
        complete) fail 'the installation failed; the previous jobs and files were restored.' ;;
        incomplete) fail 'the installation failed while a deployment held the lock; the earlier timers were restarted but the new files stayed. Run install again after the deployment.' ;;
        failed) fail "the installation failed and its rollback did not finish; check the timers on the server (systemctl --user list-timers 'ba-production-*') and run install again." ;;
        *) fail "the installation gave no usable result; check the timers on the server (systemctl --user list-timers 'ba-production-*') and run install again." ;;
      esac
    fi
    ;;
  status|scheduled-status)
    # The status key's forced command runs this same command whatever is sent.
    if on_server "bash $ops/tools/production-ops.sh status" </dev/null > "$work/result.json" 2> "$work/status.log"; then
      summarise status "$work/result.json" || fail 'production operations status is failing.'
    else
      summarise status "$work/result.json" || true
      fail 'production operations status is failing.'
    fi
    ;;
  backup-now)
    # Run through the installed service: it survives a dropped connection and logs to the journal.
    on_server 'bash -s' > "$work/run.txt" 2> "$work/run.log" <<'REMOTE' || fail 'the backup could not be started.'
set -eu
[ "$(id -u)" = 1002 ]
export XDG_RUNTIME_DIR=/run/user/1002 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1002/bus
test -f /opt/bangla-adventures/ops/installation.json
started="$(date +%s)"
systemctl --user start ba-production-backup.service || true
exit_status="$(systemctl --user show ba-production-backup.service --property=ExecMainStatus --value)"
printf '{"started":%s,"exitStatus":"%s"}\n' "$started" "${exit_status//[^0-9]/}"
bash /opt/bangla-adventures/ops/tools/production-ops.sh status || true
REMOTE
    head -n 1 "$work/run.txt" > "$work/run.json"
    tail -n +2 "$work/run.txt" > "$work/result.json"
    summarise status "$work/result.json" || true
    python3 - "$work/run.json" "$work/result.json" <<'PY' || fail 'the backup did not pass; see the codes above and the server journal (journalctl --user -u ba-production-backup).'
import json,sys
run=json.load(open(sys.argv[1]));status=json.loads(open(sys.argv[2]).read().strip().splitlines()[-1])
backup=status.get('backup') or {}
fresh=type(run.get('started')) is int and type(backup.get('checkedAtEpoch')) in (int,float) and backup['checkedAtEpoch']>=run['started']
if run.get('exitStatus')=='75':print('backup-now: deferred, because a deployment or another backup holds the deploy lock.');raise SystemExit(1)
print('backup-now: '+('passed' if run.get('exitStatus')=='0' and fresh and backup.get('status')=='passed' else 'failed'))
raise SystemExit(0 if run.get('exitStatus')=='0' and fresh and backup.get('status')=='passed' else 1)
PY
    ;;
esac
