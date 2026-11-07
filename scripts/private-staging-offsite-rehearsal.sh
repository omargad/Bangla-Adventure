#!/usr/bin/env bash
# Off-site copy rehearsal on the VPS for the vps-offsite-rehearsal workflow
# (docs/PRODUCTION_OPERATIONS.md#off-site-rehearsal). It needs no client credentials: the newest
# verified private staging archive goes into a throwaway encrypted restic repository on the server,
# which is checked, previewed for retention, restored and compared, then removed.
#
#   bash scripts/private-staging-offsite-rehearsal.sh
#
# The same gates as private staging and acceptance: an explicit confirmation, production deployment
# still disabled, the production repository's main branch, and the pinned deploy key and server host
# key, all checked before any connection. The address and account come from the DEPLOY_HOST and
# DEPLOY_USER secrets and are never printed; only fixed summary lines and a JSON result with
# allowlisted fields are shown.
set -euo pipefail
set +x
umask 077
fail() { printf 'off-site rehearsal: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 0 ] || fail 'this controller accepts no arguments.'
[ "${CONFIRM_OFFSITE_REHEARSAL:-}" = true ] || fail 'not confirmed: tick "confirm_offsite_rehearsal" when starting the workflow. Nothing was contacted.'
[ "${DEPLOY_ENABLED:-false}" = false ] || fail 'production deployment must remain disabled (the rehearsal uses private staging, which exists only until go-live).'
[ "${REPOSITORY_GATE_CONFIRMED:-}" = disabled ] || fail 'the repository gate must precede the environment credentials.'
# The production repository is recognised by its numeric ID, which a transfer or rename keeps; only a
# re-created repository sets PRODUCTION_REPOSITORY_ID (docs/REPOSITORY_TRANSFER.md).
[ -n "${GITHUB_REPOSITORY_ID:-}" ] && [ "$GITHUB_REPOSITORY_ID" = "${PRODUCTION_REPOSITORY_ID:-1436643374}" ] && [ "${GITHUB_REF:-}" = refs/heads/main ] || \
  fail 'only the main branch of the project repository may run the rehearsal.'
[[ "${DEPLOY_HOST:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || fail 'the DEPLOY_HOST secret is missing or invalid (set it as a repository secret or a production environment secret, named exactly DEPLOY_HOST).'
[[ "${DEPLOY_USER:-}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail 'the DEPLOY_USER secret is missing or invalid (set it as a repository secret or a production environment secret, named exactly DEPLOY_USER).'
[ -n "${DEPLOY_SSH_KEY:-}" ] && [ -n "${DEPLOY_KNOWN_HOSTS:-}" ] || fail 'the pinned deployment credentials (DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS) are missing.'
case "$DEPLOY_KNOWN_HOSTS" in *'PRIVATE KEY'*|*'-----BEGIN'*) fail 'DEPLOY_KNOWN_HOSTS must hold only public host-key lines.' ;; esac
readonly host="$DEPLOY_HOST" user="$DEPLOY_USER" port=22
# The pins of scripts/private-staging.sh and scripts/private-staging-acceptance.sh.
readonly key_pin='SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ'
readonly host_pin='SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8'
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
work="$(mktemp -d)"
chmod 700 "$work"
incoming=''
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
cleanup() {
  local status=$?
  trap - EXIT
  # The uploaded tools are removed, and shown to be gone, whatever happened.
  if [[ "$incoming" =~ ^/opt/bangla-adventures/\.offsite-rehearsal-payload\.[a-zA-Z0-9]{12}$ ]]; then
    if ! ssh "${ssh_options[@]}" "$user@$host" \
      "if [ -d $(quote "$incoming") ] && [ ! -L $(quote "$incoming") ] && [ \"\$(stat -c %u:%a -- $(quote "$incoming"))\" = 1002:700 ]; then rm -rf -- $(quote "$incoming"); fi; test ! -e $(quote "$incoming")" \
      </dev/null >/dev/null 2>&1; then
      printf 'off-site rehearsal: the uploaded tools could not be shown to be removed from the server.\n' >&2
      status=1
    fi
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
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS GITHUB_TOKEN GH_TOKEN
chmod 600 "$work/key" "$work/provided_hosts"
ssh-keygen -y -P '' -f "$work/key" > "$work/public_key" 2>/dev/null || fail 'the DEPLOY_SSH_KEY secret must be an unencrypted private key.'
actual="$(ssh-keygen -l -E sha256 -f "$work/public_key" 2>/dev/null | awk '{print $2}')" || fail 'could not fingerprint the DEPLOY_SSH_KEY secret.'
[ "$actual" = "$key_pin" ] || fail 'the deploy key fingerprint does not match the pinned key.'
: > "$work/known_hosts"
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  [[ "$line" =~ ^[[:space:]]*@ ]] && fail 'host key markers are not allowed in DEPLOY_KNOWN_HOSTS.'
  IFS=$' \t' read -r _ key_type key_data _ <<< "$line"
  [ "$key_type" = ssh-ed25519 ] || fail 'the pinned ED25519 server key is required.'
  [[ "$key_data" =~ ^[a-zA-Z0-9+/]+={0,2}$ ]] || fail 'invalid server public-key encoding.'
  printf '%s\n' "$line" > "$work/host_line"
  actual="$(ssh-keygen -l -E sha256 -f "$work/host_line" 2>/dev/null | awk '{print $2}')" || fail 'could not fingerprint a DEPLOY_KNOWN_HOSTS line.'
  [ "$actual" = "$host_pin" ] || fail 'the server host key does not match the pinned VPS key.'
  ssh-keygen -F "$host" -f "$work/host_line" >/dev/null 2>&1 || fail 'the verified host key does not cover the DEPLOY_HOST secret.'
  # Only the configured address and the verified public key, never comments.
  printf '%s %s %s\n' "$host" "$key_type" "$key_data" >> "$work/known_hosts"
done < "$work/provided_hosts"
[ -s "$work/known_hosts" ] || fail 'DEPLOY_KNOWN_HOSTS holds no verified host key.'
sort -u "$work/known_hosts" -o "$work/known_hosts"
[ "$(wc -l < "$work/known_hosts")" -eq 1 ] || fail 'only one verified server key is expected.'

ssh_options=(-F /dev/null -T -i "$work/key" -p "$port"
  -o BatchMode=yes -o IdentitiesOnly=yes -o PreferredAuthentications=publickey
  -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=yes
  -o UpdateHostKeys=no -o GlobalKnownHostsFile=/dev/null -o "UserKnownHostsFile=$work/known_hosts"
  -o ForwardAgent=no -o ClearAllForwardings=yes -o PermitLocalCommand=no -o ControlMaster=no -o ControlPath=none
  -o ConnectTimeout=20 -o ConnectionAttempts=1 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)

# The rehearsal and the two reviewed tools it uses as libraries, unchanged.
mkdir "$work/payload"
names=()
for source in scripts/private-staging-offsite-rehearsal.py scripts/private-staging-ops.py scripts/production-ops.py; do
  [ -f "$root/$source" ] && [ ! -L "$root/$source" ] || fail 'a reviewed rehearsal file is missing.'
  names+=("${source##*/}")
  cp -- "$root/$source" "$work/payload/${source##*/}"
done
# ssh exits 255 for its own errors, whose messages can name the server: they are never printed.
incoming="$(ssh "${ssh_options[@]}" "$user@$host" "set -eu; umask 077; [ \"\$(id -u)\" = 1002 ]; mktemp -d /opt/bangla-adventures/.offsite-rehearsal-payload.XXXXXXXXXXXX" \
  </dev/null 2> "$work/ssh.log")" || {
  [ "$?" -ne 255 ] || fail 'could not connect over SSH: check the DEPLOY_HOST secret and that the server is running.'
  fail 'could not create the private payload folder as the deployment user (UID 1002).'
}
[[ "$incoming" =~ ^/opt/bangla-adventures/\.offsite-rehearsal-payload\.[a-zA-Z0-9]{12}$ ]] || { incoming=''; fail 'the server returned an unexpected payload folder.'; }
tar -C "$work/payload" -cf - -- "${names[@]}" | ssh "${ssh_options[@]}" "$user@$host" \
  "test -d $(quote "$incoming") && test ! -L $(quote "$incoming") && test \"\$(stat -c %u:%a -- $(quote "$incoming"))\" = 1002:700 && tar --extract --file - --directory $(quote "$incoming") --no-same-owner --no-same-permissions" \
  > "$work/transfer.log" 2>&1 || fail 'the transfer of the rehearsal tools failed.'
# A clean environment: nothing from the login shell can change where it works or which Docker it uses.
result=0
ssh "${ssh_options[@]}" "$user@$host" \
  "env -i HOME=\"\$HOME\" PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 python3 -I $(quote "$incoming/private-staging-offsite-rehearsal.py") $(quote "$incoming")" \
  </dev/null > "$work/result.json" 2> "$work/rehearsal.log" || result=$?
if [ "$result" -eq 255 ] && [ ! -s "$work/result.json" ]; then
  fail 'the SSH connection was lost during the rehearsal; the server removes the throwaway repository when the connection drops, and the next run removes anything a lost run left. Run it again.'
fi

# Prints fixed lines only, from validated fields; the JSON result is rebuilt from the same fields.
evidence="${OFFSITE_REHEARSAL_EVIDENCE_DIR:-}"
summary=0
python3 - "$work/result.json" "$work/summary.txt" "$work/clean.json" <<'PY' || summary=$?
import json,math,re,sys,time
source,text,clean=sys.argv[1:]
code=re.compile(r'[a-z0-9][a-z0-9-]{0,63}');hexa=re.compile(r'[0-9a-f]{64}')
STEPS=('archive','image','init','backup','check','retention','restore','verify','cleanup')
def num(v):return type(v) in (int,float) and math.isfinite(v)
def epoch(v):return v if num(v) and v>0 else None
def flag(v):return v is True
def codes(v):return [c for c in v if isinstance(c,str) and code.fullmatch(c)][:16] if isinstance(v,list) else ['invalid-report']
try:
    lines=open(source,'rb').read(1048576).decode().strip().splitlines()
    raw=json.loads(lines[-1]) if lines else None
except (OSError,ValueError,UnicodeError):
    raw=None
if not isinstance(raw,dict) or raw.get('scope')!='private-staging-offsite-rehearsal':
    print('off-site rehearsal: no valid result was returned.');raise SystemExit(3)
def part(name):
    v=raw.get(name);return v if isinstance(v,dict) else {}
status=raw.get('status') if raw.get('status') in ('passed','failed','deferred') else 'invalid'
steps={k:(part('steps').get(k) if part('steps').get(k) in ('passed','failed','not-run') else 'invalid') for k in STEPS}
archive=part('archive');restic=part('restic');retention=part('retention');restore=part('restore');cleanup=part('cleanup')
size=archive.get('bytes') if type(archive.get('bytes')) is int and archive.get('bytes')>=0 else None
snapshot=restic.get('snapshotId') if isinstance(restic.get('snapshotId'),str) and hexa.fullmatch(restic['snapshotId']) else None
count=lambda v:v if type(v) is int and 0<=v<100000 else None
value={'scope':'private-staging-offsite-rehearsal','verified':raw.get('verified') is True and status=='passed','status':status,
       'checkedAtEpoch':epoch(raw.get('checkedAtEpoch')),'durationSeconds':raw.get('durationSeconds') if num(raw.get('durationSeconds')) else None,
       'codes':codes(raw.get('codes')),'steps':steps,
       'archive':{'createdEpoch':epoch(archive.get('createdEpoch')),'bytes':size,
                  'sha256':archive.get('sha256') if isinstance(archive.get('sha256'),str) and hexa.fullmatch(archive['sha256']) else None,
                  'files':count(archive.get('files'))},
       'restic':{'version':restic.get('version') if isinstance(restic.get('version'),str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',restic['version']) else None,
                 'network':'none' if restic.get('network')=='none' else 'invalid','imagePulled':flag(restic.get('imagePulled')),'snapshotId':snapshot},
       'retention':{k:count(retention.get(k)) for k in ('keepDaily','keepWeekly','keepMonthly','kept','wouldRemove')}|{'dryRun':flag(retention.get('dryRun'))},
       'restore':{k:flag(restore.get(k)) for k in ('sha256Matches','archiveVerified')},
       'cleanup':{k:flag(cleanup.get(k)) for k in ('repositoryRemoved','passwordRemoved','restoredFilesRemoved','workspaceRemoved','helpersRemoved')}
                 |{'earlierWorkspacesRemoved':count(cleanup.get('earlierWorkspacesRemoved'))},
       'staging':None}
staging=raw.get('staging')
if isinstance(staging,dict):
    value['staging']={'installationValid':flag(staging.get('installationValid'))}
    for name in ('backup','monitor'):
        item=staging.get(name) if isinstance(staging.get(name),dict) else {}
        value['staging'][name]={'status':item.get('status') if item.get('status') in ('passed','healthy','failed','deferred','missing','invalid') else 'invalid',
            'checkedAtEpoch':epoch(item.get('checkedAtEpoch')),'lastSuccessEpoch':epoch(item.get('lastSuccessEpoch')),'codes':codes(item.get('codes')),
            'timerEnabled':flag(item.get('timerEnabled')),'timerActive':flag(item.get('timerActive')),
            'lastTriggerEpoch':epoch(item.get('lastTriggerEpoch')),'serviceFailed':flag(item.get('serviceFailed'))}
now=time.time()
def ago(v):return 'never' if v is None else f'{(now-v)/3600:.1f} h ago'
def show(v):return ','.join(v) or 'none'
def mark(k):return {'passed':'passed','failed':'FAILED','not-run':'not run'}.get(steps[k],'invalid')
out=[f"off-site rehearsal: {status}; codes: {show(value['codes'])}"]
a=value['archive']
out.append(f"  newest staging archive: {'unknown size' if size is None else f'{size/1e6:.1f} MB'}, created {ago(a['createdEpoch'])}, {a['files'] if a['files'] is not None else '?'} files; SHA-256 and archive verification {mark('archive')}")
out.append(f"  restic {value['restic']['version'] or '?'} (pinned image, no network{', pulled now' if value['restic']['imagePulled'] else ''}): image {mark('image')}, init {mark('init')}, backup {mark('backup')}, check --read-data {mark('check')}")
r=value['retention']
out.append(f"  retention preview (forget --dry-run, keep {r['keepDaily']} daily, {r['keepWeekly']} weekly, {r['keepMonthly']} monthly): {mark('retention')}"
           +(f"; {r['kept']} kept, {r['wouldRemove']} would be removed" if r['kept'] is not None and r['wouldRemove'] is not None else ''))
out.append(f"  restore to a temporary folder: {mark('restore')}; SHA-256 equals the original: {'yes' if value['restore']['sha256Matches'] else 'no'}; archive verification (SQLite integrity): {'passed' if value['restore']['archiveVerified'] else 'not passed'}")
c=value['cleanup'];removed=all(c[k] for k in ('repositoryRemoved','passwordRemoved','restoredFilesRemoved','workspaceRemoved','helpersRemoved'))
out.append(f"  clean-up: {mark('cleanup')}; throwaway repository, password and restored files {'removed and shown to be gone' if removed else 'NOT all shown to be removed'}; left by earlier runs and removed: {c['earlierWorkspacesRemoved'] if c['earlierWorkspacesRemoved'] is not None else '?'}")
if value['staging'] is None:
    out.append('  private staging timers: not read')
else:
    for name in ('backup','monitor'):
        s=value['staging'][name]
        out.append(f"  private staging {name} timer: {'enabled' if s['timerEnabled'] else 'not enabled'}, {'active' if s['timerActive'] else 'inactive'}, last triggered {ago(s['lastTriggerEpoch'])};"
                   f" last run {s['status']} {ago(s['checkedAtEpoch'])}, last success {ago(s['lastSuccessEpoch'])}; codes: {show(s['codes'])}{'; service failed' if s['serviceFailed'] else ''}")
    out.append(f"  private staging operations installation: {'valid' if value['staging']['installationValid'] else 'NOT valid (run VPS private acceptance to reinstall)'}")
open(text,'w').write('\n'.join(out)+'\n')
open(clean,'w').write(json.dumps(value,separators=(',',':'))+'\n')
raise SystemExit(0 if value['verified'] else 2 if status=='deferred' else 1)
PY
[ "$summary" -ne 3 ] || fail 'the server returned no valid result; nothing secret was printed. Run it again; a lost run is cleaned up by the next one.'
cat "$work/summary.txt"
printf 'result: '
cat "$work/clean.json"
if [ -n "$evidence" ]; then
  [ ! -e "$evidence" ] && [ ! -L "$evidence" ] || fail 'the evidence folder must be new.'
  mkdir -m 700 -- "$evidence"
  cp -- "$work/summary.txt" "$evidence/summary.txt"
  cp -- "$work/clean.json" "$evidence/result.json"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { printf '## Off-site rehearsal\n\n```text\n'; cat "$work/summary.txt"; printf '```\n'; } >> "$GITHUB_STEP_SUMMARY"
fi
case "$summary" in
  0) printf 'off-site rehearsal: passed; nothing was sent off the server and nothing of the rehearsal remains on it.\n' ;;
  2) fail 'deferred: a staging backup, deploy or check held the staging lock for 10 minutes. Run it again later (not around 03:30 UTC, the staging backup).' ;;
  *) fail 'the rehearsal failed; see the codes above and docs/PRODUCTION_OPERATIONS.md#off-site-rehearsal.' ;;
esac
