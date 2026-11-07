"""Off-site rehearsal: the runner controller with a stub transport, and the server script with a stub
Docker. No SSH, Docker or restic is used."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / 'scripts/private-staging-offsite-rehearsal.sh'
INCOMING = '/opt/bangla-adventures/.offsite-rehearsal-payload.Fixture12ABC'
KEY_PIN = 'SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ'
HOST_PIN = 'SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rehearsal = load('offsite_rehearsal', 'scripts/private-staging-offsite-rehearsal.py')
stage = rehearsal.stage
prod = rehearsal.prod


def staging_part(status='passed', codes=()):
    return {'status': status, 'checkedAtEpoch': time.time() - 7200, 'lastSuccessEpoch': time.time() - 7200, 'codes': list(codes),
            'timerEnabled': True, 'timerActive': True, 'lastTriggerEpoch': time.time() - 7200, 'serviceFailed': False}


def server_result(**changes):
    now = time.time()
    value = {
        'scope': 'private-staging-offsite-rehearsal', 'verified': True, 'status': 'passed', 'checkedAtEpoch': now, 'durationSeconds': 14.2, 'codes': [],
        'steps': {name: 'passed' for name in rehearsal.STEPS},
        'archive': {'createdEpoch': now - 5 * 3600, 'bytes': 312_400_000, 'sha256': 'a' * 64, 'files': 214},
        'restic': {'version': '0.19.1', 'network': 'none', 'imagePulled': True, 'snapshotId': 'b' * 64},
        'retention': {'keepDaily': 14, 'keepWeekly': 8, 'keepMonthly': 6, 'dryRun': True, 'kept': 1, 'wouldRemove': 0},
        'restore': {'sha256Matches': True, 'archiveVerified': True},
        'cleanup': {'repositoryRemoved': True, 'passwordRemoved': True, 'restoredFilesRemoved': True, 'workspaceRemoved': True,
                    'helpersRemoved': True, 'earlierWorkspacesRemoved': 0},
        'staging': {'installationValid': True, 'backup': staging_part(), 'monitor': {**staging_part('healthy'), 'checkedAtEpoch': now - 120}},
    }
    value.update(changes)
    return value


TRANSPORT = r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:];tool=Path(sys.argv[0]).name;log=Path(os.environ['FIXTURE_LOG'])
def record(kind,**extra):
 with log.open('a') as f:f.write(json.dumps(dict(kind=kind,args=args,**extra))+'\n')
if tool=='ssh-keygen':
 if '-y' in args:print('ssh-ed25519 RklYVFVSRQ== fixture')
 elif '-F' in args:
  names=Path(args[args.index('-f')+1]).read_text().split()[0].split(',')
  sys.exit(0 if args[args.index('-F')+1] in names else 1)
 elif '-l' in args:
  public=Path(args[args.index('-f')+1]).name=='public_key'
  pin=os.environ['FIXTURE_KEY_PIN'] if public else os.environ['FIXTURE_HOST_PIN']
  print('256',pin,'fixture (ED25519)')
 sys.exit(0)
if tool!='ssh':sys.exit(93)
command=args[-1];data=sys.stdin.buffer.read()
if os.environ.get('FIXTURE_CONNECT_FAIL'):
 record('refused');print('example-user@192.0.2.10: Permission denied (publickey). SECRET_MUST_NOT_LEAK',file=sys.stderr);sys.exit(255)
if 'mktemp -d' in command:record('incoming',command=command);print(os.environ['FIXTURE_INCOMING'])
elif 'tar --extract' in command:
 record('upload',command=command);Path(os.environ['FIXTURE_TAR']).write_bytes(data)
elif 'private-staging-offsite-rehearsal.py' in command:
 record('rehearsal',command=command,stdin=len(data))
 print('192.0.2.10 example-user SECRET_MUST_NOT_LEAK',file=sys.stderr)
 sys.stdout.write(os.environ['FIXTURE_RESULT']);sys.exit(int(os.environ.get('FIXTURE_EXIT','0')))
elif 'rm -rf' in command:
 record('cleanup',command=command);sys.exit(int(os.environ.get('FIXTURE_CLEANUP_EXIT','0')))
else:record('unexpected',command=command);sys.exit(94)
'''


class ControllerTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='offsite-rehearsal-controller-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        (self.root / 'bin').mkdir()
        transport = self.root / 'bin/transport'
        transport.write_text(TRANSPORT)
        transport.chmod(0o700)
        for name in ('ssh', 'ssh-keygen'):
            (self.root / 'bin' / name).symlink_to(transport)
        self.log = self.root / 'calls.jsonl'
        self.env = {
            'PATH': str(self.root / 'bin') + ':' + os.environ['PATH'], 'HOME': str(self.root),
            'CONFIRM_OFFSITE_REHEARSAL': 'true', 'DEPLOY_ENABLED': 'false', 'REPOSITORY_GATE_CONFIRMED': 'disabled',
            'GITHUB_REPOSITORY_ID': '1436643374', 'GITHUB_REF': 'refs/heads/main',
            'DEPLOY_HOST': '192.0.2.10', 'DEPLOY_USER': 'example-user', 'DEPLOY_SSH_KEY': 'SECRET_MUST_NOT_LEAK private key',
            'DEPLOY_KNOWN_HOSTS': '192.0.2.10 ssh-ed25519 RklYVFVSRQ== public fixture comment',
            'FIXTURE_LOG': str(self.log), 'FIXTURE_TAR': str(self.root / 'payload.tar'), 'FIXTURE_INCOMING': INCOMING,
            'FIXTURE_KEY_PIN': KEY_PIN, 'FIXTURE_HOST_PIN': HOST_PIN, 'FIXTURE_RESULT': json.dumps(server_result()),
            'OFFSITE_REHEARSAL_EVIDENCE_DIR': str(self.root / 'evidence'), 'GITHUB_STEP_SUMMARY': str(self.root / 'step-summary.md'),
        }

    def run_controller(self, **changes):
        env = {key: value for key, value in {**self.env, **changes}.items() if value is not None}
        result = subprocess.run(['bash', str(CONTROLLER)], env=env, capture_output=True, text=True, timeout=60)
        output = result.stdout + result.stderr
        for secret in ('SECRET_MUST_NOT_LEAK', '192.0.2.10', 'example-user', '/opt/bangla-adventures', '/home/'):
            self.assertNotIn(secret, output)
        for path in self.root.joinpath('evidence').rglob('*') if self.root.joinpath('evidence').exists() else []:
            self.assertNotIn(b'SECRET_MUST_NOT_LEAK', path.read_bytes())
            self.assertNotIn(b'192.0.2.10', path.read_bytes())
        calls = [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []
        return result.returncode, output, calls

    def test_every_gate_refuses_before_connecting(self):
        for changes, message in [
            ({'CONFIRM_OFFSITE_REHEARSAL': None}, 'not confirmed'),
            ({'CONFIRM_OFFSITE_REHEARSAL': 'false'}, 'not confirmed'),
            ({'DEPLOY_ENABLED': 'true'}, 'production deployment must remain disabled'),
            ({'REPOSITORY_GATE_CONFIRMED': None}, 'repository gate'),
            ({'GITHUB_REPOSITORY_ID': '99'}, 'only the main branch of the project repository'),
            ({'GITHUB_REF': 'refs/heads/feature'}, 'only the main branch of the project repository'),
            ({'DEPLOY_HOST': None}, 'DEPLOY_HOST secret is missing'),
            ({'DEPLOY_USER': 'Bad User'}, 'DEPLOY_USER secret is missing or invalid'),
            ({'DEPLOY_SSH_KEY': None}, 'pinned deployment credentials'),
            ({'DEPLOY_KNOWN_HOSTS': '-----BEGIN OPENSSH PRIVATE KEY-----'}, 'only public host-key lines'),
            ({'FIXTURE_KEY_PIN': 'SHA256:' + 'A' * 43}, 'deploy key fingerprint does not match'),
            ({'FIXTURE_HOST_PIN': 'SHA256:' + 'A' * 43}, 'host key does not match'),
            ({'DEPLOY_KNOWN_HOSTS': '198.51.100.7 ssh-ed25519 RklYVFVSRQ=='}, 'does not cover the DEPLOY_HOST secret'),
            ({'DEPLOY_KNOWN_HOSTS': '192.0.2.10 ssh-rsa RklYVFVSRQ=='}, 'ED25519 server key'),
        ]:
            with self.subTest(changes=changes):
                self.log.unlink(missing_ok=True)
                status, output, calls = self.run_controller(**changes)
                self.assertNotEqual(status, 0)
                self.assertIn(message, output)
                self.assertEqual([call for call in calls if call['kind'] != 'keygen'], [], 'no SSH connection was made')
        self.assertFalse((self.root / 'evidence').exists())

    def test_a_passing_rehearsal_uploads_the_reviewed_tools_runs_them_cleanly_and_removes_them(self):
        status, output, calls = self.run_controller()
        self.assertEqual(status, 0, output)
        self.assertEqual([call['kind'] for call in calls], ['incoming', 'upload', 'rehearsal', 'cleanup'])
        for call in calls:
            options = call['args']
            self.assertEqual(options[-2], 'example-user@192.0.2.10')
            for option in ('StrictHostKeyChecking=yes', 'BatchMode=yes', 'IdentitiesOnly=yes', 'GlobalKnownHostsFile=/dev/null',
                           'UpdateHostKeys=no', 'ClearAllForwardings=yes', 'ForwardAgent=no'):
                self.assertIn(option, options)
        self.assertIn('[ "$(id -u)" = 1002 ]', calls[0]['command'])
        self.assertIn('mktemp -d /opt/bangla-adventures/.offsite-rehearsal-payload.XXXXXXXXXXXX', calls[0]['command'])
        # The rehearsal runs from the payload in an emptied environment, with isolated Python.
        command = calls[2]['command']
        self.assertTrue(command.startswith('env -i HOME="$HOME" PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 python3 -I '), command)
        self.assertIn(f"'{INCOMING}/private-staging-offsite-rehearsal.py' '{INCOMING}'", command)
        self.assertEqual(calls[2]['stdin'], 0)
        self.assertIn(f"rm -rf -- '{INCOMING}'", calls[3]['command'])
        self.assertTrue(calls[3]['command'].endswith(f"test ! -e '{INCOMING}'"))
        with tarfile.open(self.root / 'payload.tar') as archive:
            names = sorted(archive.getnames())
            self.assertEqual(names, ['private-staging-offsite-rehearsal.py', 'private-staging-ops.py', 'production-ops.py'])
            for name in names:
                self.assertEqual(archive.extractfile(name).read(), (ROOT / 'scripts' / name).read_bytes(), name)
        lines = output.splitlines()
        self.assertEqual(lines[0], 'off-site rehearsal: passed; codes: none')
        patterns = [
            r'  newest staging archive: 312\.4 MB, created 5\.0 h ago, 214 files; SHA-256 and archive verification passed',
            r'  restic 0\.19\.1 \(pinned image, no network, pulled now\): image passed, init passed, backup passed, check --read-data passed',
            r'  retention preview \(forget --dry-run, keep 14 daily, 8 weekly, 6 monthly\): passed; 1 kept, 0 would be removed',
            r'  restore to a temporary folder: passed; SHA-256 equals the original: yes; archive verification \(SQLite integrity\): passed',
            r'  clean-up: passed; throwaway repository, password and restored files removed and shown to be gone; left by earlier runs and removed: 0',
            r'  private staging backup timer: enabled, active, last triggered 2\.0 h ago; last run passed 2\.0 h ago, last success 2\.0 h ago; codes: none',
            r'  private staging monitor timer: enabled, active, last triggered 2\.0 h ago; last run healthy 0\.0 h ago, last success 2\.0 h ago; codes: none',
            r'  private staging operations installation: valid',
            r'result: \{.*\}',
            r'off-site rehearsal: passed; nothing was sent off the server and nothing of the rehearsal remains on it\.',
        ]
        self.assertEqual(len(lines), len(patterns) + 1, output)
        for line, pattern in zip(lines[1:], patterns):
            self.assertRegex(line, '^' + pattern + '$')
        result = json.loads(lines[-2][len('result: '):])
        self.assertTrue(result['verified'])
        self.assertEqual(json.loads((self.root / 'evidence/result.json').read_text()), result)
        self.assertEqual((self.root / 'evidence/summary.txt').read_text(), '\n'.join(lines[:9]) + '\n')
        self.assertIn('## Off-site rehearsal', (self.root / 'step-summary.md').read_text())

    def test_the_json_result_keeps_only_allowlisted_fields(self):
        value = server_result()
        value['secret'] = 'SECRET_MUST_NOT_LEAK'
        value['archive']['path'] = '/home/example-user/SECRET_MUST_NOT_LEAK'
        value['codes'] = ['SECRET MUST NOT LEAK', 'fine-code']
        value['status'] = 'failed'
        value['verified'] = False
        value['staging']['backup']['codes'] = ['/opt/bangla-adventures/private-staging']
        status, output, _ = self.run_controller(FIXTURE_RESULT=json.dumps(value), FIXTURE_EXIT='1')
        self.assertEqual(status, 1)
        result = json.loads(next(line for line in output.splitlines() if line.startswith('result: '))[len('result: '):])
        self.assertEqual(set(result), {'scope', 'verified', 'status', 'checkedAtEpoch', 'durationSeconds', 'codes', 'steps', 'archive',
                                       'restic', 'retention', 'restore', 'cleanup', 'staging'})
        self.assertEqual(result['codes'], ['fine-code'])
        self.assertEqual(result['staging']['backup']['codes'], [])
        self.assertEqual(set(result['archive']), {'createdEpoch', 'bytes', 'sha256', 'files'})

    def test_a_failed_step_fails_the_run_names_the_step_and_still_removes_the_tools(self):
        steps = {name: 'passed' for name in rehearsal.STEPS}
        steps.update(check='failed', retention='not-run', restore='not-run', verify='not-run')
        value = server_result(verified=False, status='failed', codes=['rehearsal-check-failed'], steps=steps,
                              restore={'sha256Matches': False, 'archiveVerified': False})
        value['retention'].update(kept=None, wouldRemove=None)
        status, output, calls = self.run_controller(FIXTURE_RESULT=json.dumps(value), FIXTURE_EXIT='1')
        self.assertEqual(status, 1)
        self.assertIn('off-site rehearsal: failed; codes: rehearsal-check-failed', output)
        self.assertIn('check --read-data FAILED', output)
        self.assertIn('retention preview (forget --dry-run, keep 14 daily, 8 weekly, 6 monthly): not run\n', output)
        self.assertIn('SHA-256 equals the original: no', output)
        self.assertIn('removed and shown to be gone', output)
        self.assertIn('the rehearsal failed; see the codes above', output)
        self.assertEqual(calls[-1]['kind'], 'cleanup')

    def test_a_cleanup_failure_on_the_server_is_reported(self):
        value = server_result(verified=False, status='failed', codes=['cleanup-failed'])
        value['steps']['cleanup'] = 'failed'
        value['cleanup'].update(repositoryRemoved=False, workspaceRemoved=False)
        status, output, _ = self.run_controller(FIXTURE_RESULT=json.dumps(value), FIXTURE_EXIT='1')
        self.assertEqual(status, 1)
        self.assertIn('clean-up: FAILED; throwaway repository, password and restored files NOT all shown to be removed', output)

    def test_a_deferred_run_says_to_run_it_again(self):
        steps = {name: 'not-run' for name in rehearsal.STEPS}
        steps['cleanup'] = 'passed'
        value = server_result(verified=False, status='deferred', codes=['transaction-busy'], steps=steps)
        status, output, _ = self.run_controller(FIXTURE_RESULT=json.dumps(value), FIXTURE_EXIT='75')
        self.assertEqual(status, 1)
        self.assertIn('off-site rehearsal: deferred; codes: transaction-busy', output)
        self.assertIn('held the staging lock for 10 minutes', output)

    def test_a_server_that_returns_no_valid_result_prints_nothing_of_it(self):
        for result in ['SECRET_MUST_NOT_LEAK', '', json.dumps({'scope': 'other', 'secret': 'SECRET_MUST_NOT_LEAK'})]:
            with self.subTest(result=result[:20]):
                status, output, calls = self.run_controller(FIXTURE_RESULT=result, FIXTURE_EXIT='1')
                self.assertEqual(status, 1)
                self.assertIn('no valid result', output)
                self.assertEqual(calls[-1]['kind'], 'cleanup')

    def test_ssh_errors_are_replaced_by_a_fixed_message(self):
        status, output, calls = self.run_controller(FIXTURE_CONNECT_FAIL='1')
        self.assertEqual(status, 1)
        self.assertIn('could not connect over SSH', output)
        self.assertEqual([call['kind'] for call in calls], ['refused'])

    def test_tools_that_cannot_be_shown_removed_fail_the_run(self):
        status, output, _ = self.run_controller(FIXTURE_CLEANUP_EXIT='1')
        self.assertEqual(status, 1)
        self.assertIn('could not be shown to be removed', output)


class FakeDocker:
    """Answers the Docker commands the rehearsal sends, and acts on the throwaway folder as they would."""

    def __init__(self, test, fail=None, stop_at=None):
        self.test = test
        self.fail = fail or {}
        self.stop_at = stop_at
        self.containers = {}
        self.calls = []
        self.started = []
        self.image_present = True
        self.snapshot = 'c' * 64

    def __call__(self, *args, data=None, timeout=240, okay=False, extra_env=None):
        self.calls.append(args)
        returncode, stdout = self.answer(list(args), data)
        if returncode and not okay:
            raise stage.Refused('command-failed')
        return subprocess.CompletedProcess(args, returncode, stdout, '')

    @staticmethod
    def option(options, name):
        return [options[i + 1] for i, value in enumerate(options[:-1]) if value == name]

    def mount(self, options, target):
        for value in self.option(options, '--mount'):
            fields = dict(item.split('=', 1) for item in value.split(',') if '=' in item)
            if fields.get('target') == target:
                return Path(fields['source']) if fields.get('type') == 'bind' else fields['source']
        return None

    def answer(self, args, data):
        if args[:1] == ['ps']:
            label = args[args.index('--filter') + 1]
            return 0, ''.join(cid + '\n' for cid, value in self.containers.items() if label == 'label=io.bangla.scope=' + value['scope'])
        if args[:2] == ['container', 'inspect']:
            value = self.containers.get(args[2])
            return (0, json.dumps([{'Id': args[2], 'Config': {'Labels': {'io.bangla.scope': value['scope']}}}])) if value else (1, '')
        if args[:2] == ['container', 'rm']:
            if self.fail.get('remove'):
                return 1, ''
            self.containers.pop(args[3], None)
            return 0, ''
        if args[:2] == ['image', 'inspect']:
            if not self.image_present:
                return 1, ''
            digest = prod.RESTIC_IMAGE.rpartition('@')[2]
            return 0, json.dumps([{'RepoDigests': ['restic/restic@' + digest]}])
        if args[:1] == ['pull']:
            self.image_present = True
            return 0, ''
        if args[:2] == ['container', 'create']:
            options = args[2:]
            cid = os.urandom(32).hex()
            scope = self.option(options, '--label')[0].split('=', 1)[1]
            self.containers[cid] = {'scope': scope, 'options': options}
            return 0, cid + '\n'
        if args[:2] == ['container', 'start']:
            return self.start(self.containers[args[-1]]['options'], data)
        raise AssertionError(args)

    def start(self, options, data):
        entry = self.option(options, '--entrypoint')[0]
        index = options.index(entry) + 2  # Past the entrypoint and the image.
        command = options[index:]
        self.started.append((entry, command, options))
        name = 'cleanup' if entry == 'sh' else ('inspect-' + command[1]) if entry == 'python3' else command[0]
        if self.stop_at == name:
            raise stage.Stopped()
        if name in self.fail:
            return self.fail[name], 'SECRET_MUST_NOT_LEAK'
        if entry == 'sh':
            work = self.mount(options, '/work')
            for child in ('repository', 'restore', 'scratch'):
                if (work / child).exists():
                    for path in sorted((work / child).rglob('*'), reverse=True):
                        path.rmdir() if path.is_dir() else path.unlink()
                    (work / child).rmdir()
            return 0, ''
        if name == 'inspect-source':
            return 0, json.dumps({'archive': ARCHIVE, 'sha256': 'a' * 64, 'sha256Matches': True, 'verified': True, 'files': 9,
                                  'createdEpoch': time.time() - 3600, 'bytes': 4096})
        if name == 'inspect-restored':
            self.test.assertEqual(command[2:], [ARCHIVE, 'a' * 64])
            restored = self.mount(options, '/restore') / 'backups' / ARCHIVE
            self.test.assertTrue(restored.is_file())
            digest = self.fail.get('restored-digest', 'a' * 64)
            return 0, json.dumps({'archive': ARCHIVE, 'sha256': digest, 'sha256Matches': digest == 'a' * 64,
                                  'verified': not self.fail.get('restored-unverified'), 'files': 9, 'createdEpoch': None, 'bytes': 4096})
        repository = self.mount(options, '/repository')
        if name == 'init':
            (repository / 'config').write_text('encrypted')
            return 0, 'created restic repository'
        if name == 'backup':
            (repository / 'data').mkdir()
            (repository / 'data/pack').write_text('encrypted pack')
            return 0, json.dumps({'message_type': 'summary', 'snapshot_id': self.snapshot})
        if name == 'snapshots':
            return 0, json.dumps([{'id': self.snapshot, 'paths': ['/backups/' + ARCHIVE], 'hostname': prod.RESTIC_HOST, 'tags': [prod.RESTIC_TAG]}])
        if name == 'check':
            return 0, 'no errors were found'
        if name == 'forget':
            return 0, json.dumps([{'host': prod.RESTIC_HOST, 'keep': [{'id': self.snapshot}], 'remove': None}])
        if name == 'restore':
            target = self.mount(options, '/restore') / 'backups'
            target.mkdir()
            (target / ARCHIVE).write_bytes(b'archive')
            return 0, ''
        raise AssertionError(command)


ARCHIVE = 'bangla-data-20261107T033000123456Z-0123456789ab.tar.gz'


class ServerTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='offsite-rehearsal-server-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        self.stage_dir = self.root / 'private-staging'
        self.stage_dir.mkdir(mode=0o700)
        (self.stage_dir / 'ops').mkdir(mode=0o700)
        (self.stage_dir / '.deploy.lock').write_text('')
        self.payload = '/opt/bangla-adventures/.offsite-rehearsal-payload.Fixture12ABC'
        self.platform_calls = 0

        def platform(operations=True):
            self.assertFalse(operations, 'the rehearsal needs no installed staging operations')
            self.platform_calls += 1

        def acquire_lock():
            return os.open(self.stage_dir / '.deploy.lock', os.O_RDWR)

        for name, value in {'STAGE': self.stage_dir, 'OPS': self.stage_dir / 'ops', 'platform': platform, 'volume': lambda name: None,
                            'acquire_lock': acquire_lock, 'private_dir': lambda path: None,
                            'validate_installation': lambda: None, 'IMAGE': 'ghcr.io/omargad/bangla-adventure@' + stage.IMAGE_DIGEST}.items():
            patcher = patch.object(stage, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(rehearsal, 'HERE', Path(self.payload))
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(rehearsal.Rehearsal, 'userctl', lambda self, *args: subprocess.CompletedProcess(args, 1, '', ''))
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_rehearsal(self, docker):
        with patch.object(stage, 'docker', docker):
            value, status = rehearsal.main(['private-staging-offsite-rehearsal.py', self.payload])
        text = json.dumps(value)
        self.assertNotIn('SECRET_MUST_NOT_LEAK', text)
        self.assertNotIn(str(self.root), text, 'no server path is reported')
        self.assertEqual([entry.name for entry in self.stage_dir.iterdir() if rehearsal.WORKSPACE.fullmatch(entry.name)], [],
                         'no throwaway folder is left')
        self.assertEqual(docker.containers, {}, 'no helper container is left')
        return value, status

    def test_the_rehearsal_backs_up_checks_previews_restores_and_removes_everything(self):
        docker = FakeDocker(self)
        value, status = self.run_rehearsal(docker)
        self.assertEqual(status, 0, value)
        self.assertEqual((value['status'], value['codes']), ('passed', []))
        self.assertEqual(value['steps'], {name: 'passed' for name in rehearsal.STEPS})
        self.assertEqual(value['retention'], {'keepDaily': 14, 'keepWeekly': 8, 'keepMonthly': 6, 'dryRun': True, 'kept': 1, 'wouldRemove': 0})
        self.assertEqual(value['restore'], {'sha256Matches': True, 'archiveVerified': True})
        self.assertTrue(all(value['cleanup'][key] for key in ('repositoryRemoved', 'passwordRemoved', 'restoredFilesRemoved', 'workspaceRemoved', 'helpersRemoved')))
        self.assertEqual(value['restic']['snapshotId'], docker.snapshot)
        self.assertEqual(self.platform_calls, 2, 'the scope is checked again while holding the lock')
        restic = [(command, options) for entry, command, options in docker.started if entry == '/usr/bin/restic']
        self.assertEqual([command[0] for command, _ in restic], ['init', 'backup', 'snapshots', 'check', 'forget', 'restore'])
        for command, options in restic:
            with self.subTest(command=command[0]):
                # The production job's container: pinned image, uid 1000, group 0 for the password, nothing else.
                self.assertEqual(options[options.index('--entrypoint') + 2], prod.RESTIC_IMAGE)
                for pair in (('--network', 'none'), ('--cap-drop', 'ALL'), ('--security-opt', 'no-new-privileges:true'),
                             ('--user', '1000:1000'), ('--group-add', '0'), ('--env', 'RESTIC_REPOSITORY=local:/repository'),
                             ('--env', 'RESTIC_PASSWORD_FILE=/run/secrets/restic-password')):
                    self.assertIn(list(pair), [options[i:i + 2] for i in range(len(options) - 1)])
                self.assertIn('--read-only', options)
                self.assertNotIn('--privileged', options)
                self.assertFalse(any('RESTIC_PASSWORD=' in item for item in options), 'the password never travels on a command line')
                mounts = docker.option(options, '--mount')
                self.assertTrue(any(item.endswith('target=/run/secrets/restic-password,readonly') for item in mounts))
                backups = [item for item in mounts if 'target=/backups' in item]
                self.assertEqual(backups, [f'type=volume,source={stage.BACKUPS},target=/backups,readonly'] if command[0] == 'backup' else [])
        commands = {command[0]: command for command, _ in restic}
        self.assertEqual(commands['backup'], ['backup', '--json', '--quiet', '--host', prod.RESTIC_HOST, '--tag', prod.RESTIC_TAG, '--', '/backups/' + ARCHIVE])
        self.assertEqual(commands['check'], ['check', '--read-data'])
        self.assertIn('--dry-run', commands['forget'])
        self.assertNotIn('--prune', commands['forget'])
        self.assertEqual(commands['forget'][commands['forget'].index('--keep-daily'):],
                         ['--keep-daily', '14', '--keep-weekly', '8', '--keep-monthly', '6'])
        self.assertEqual(commands['restore'], ['restore', docker.snapshot, '--target', '/restore', '--verify', '--quiet'])
        # Every helper ran without a network, and the throwaway folder's password stayed in its file.
        for entry, command, options in docker.started:
            self.assertEqual(docker.option(options, '--network'), ['none'])

    def test_the_password_is_random_private_and_only_mounted(self):
        seen = []
        docker = FakeDocker(self)
        real = docker.start

        def start(options, data):
            password = docker.mount(options, '/run/secrets/restic-password')
            if password:
                info = password.lstat()
                seen.append((password.read_text(), oct(info.st_mode & 0o777), oct(password.parent.lstat().st_mode & 0o777)))
            return real(options, data)
        docker.start = start
        self.run_rehearsal(docker)
        first = seen[0][0]
        self.assertRegex(first, r'^[A-Za-z0-9_-]{64}\n$')
        self.assertTrue(all(item == (first, '0o640', '0o700') for item in seen))
        docker = FakeDocker(self)
        seen.clear()
        real = docker.start
        docker.start = start
        self.run_rehearsal(docker)
        self.assertNotEqual(seen[0][0], first, 'each run makes a new password')

    def test_a_failing_step_stops_the_rehearsal_and_still_removes_everything(self):
        for step, code in [('init', 'rehearsal-init-failed'), ('backup', 'rehearsal-backup-failed'), ('check', 'rehearsal-check-failed'),
                           ('forget', 'rehearsal-retention-preview-failed'), ('restore', 'rehearsal-restore-failed'),
                           ('inspect-source', 'archive-unreadable'), ('inspect-restored', 'restored-archive-unreadable')]:
            with self.subTest(step=step):
                value, status = self.run_rehearsal(FakeDocker(self, fail={step: 1}))
                self.assertEqual((status, value['status'], value['codes']), (1, 'failed', [code]))
                self.assertEqual(value['steps']['cleanup'], 'passed')
                self.assertTrue(value['cleanup']['workspaceRemoved'] and value['cleanup']['repositoryRemoved'])
                failed = [name for name, state in value['steps'].items() if state == 'failed']
                self.assertEqual(len(failed), 1)
                later = list(rehearsal.STEPS)[list(rehearsal.STEPS).index(failed[0]) + 1:-1]
                self.assertTrue(all(value['steps'][name] == 'not-run' for name in later))
        value, _ = self.run_rehearsal(FakeDocker(self, fail={'backup': 12}))
        self.assertEqual(value['codes'], ['rehearsal-password-wrong'], 'restic exit codes keep their meaning')

    def test_a_restored_copy_that_differs_or_fails_verification_fails(self):
        value, status = self.run_rehearsal(FakeDocker(self, fail={'restored-digest': 'd' * 64}))
        self.assertEqual((status, value['codes'], value['restore']['sha256Matches']), (1, ['rehearsal-restore-mismatch'], False))
        value, status = self.run_rehearsal(FakeDocker(self, fail={'restored-unverified': True}))
        self.assertEqual((status, value['codes'], value['restore']), (1, ['rehearsal-restore-unverified'], {'sha256Matches': True, 'archiveVerified': False}))

    def test_a_stop_request_at_any_step_is_recorded_and_everything_is_removed(self):
        for step in ('inspect-source', 'init', 'backup', 'check', 'forget', 'restore', 'inspect-restored'):
            with self.subTest(step=step):
                value, status = self.run_rehearsal(FakeDocker(self, stop_at=step))
                self.assertEqual((status, value['codes']), (1, ['interrupted']))
                self.assertTrue(value['cleanup']['workspaceRemoved'] and value['cleanup']['passwordRemoved'] and value['cleanup']['helpersRemoved'])

    def test_a_backup_without_a_snapshot_summary_is_named_after_its_step(self):
        # The production helper that reads the summary raises the production tool's own refusal.
        docker = FakeDocker(self)
        real = docker.start

        def start(options, data):
            entry = docker.option(options, '--entrypoint')[0]
            result = real(options, data)
            return (0, 'no summary') if entry == '/usr/bin/restic' and options[options.index(entry) + 2] == 'backup' else result
        docker.start = start
        value, status = self.run_rehearsal(docker)
        self.assertEqual((status, value['codes'], value['steps']['backup']), (1, ['rehearsal-backup-failed'], 'failed'))

    def test_a_stop_request_while_the_folder_is_made_still_removes_it(self):
        real = os.mkdir

        def mkdir(path, mode=0o777, **kwargs):
            real(path, mode, **kwargs)
            if rehearsal.WORKSPACE.fullmatch(Path(path).name):
                raise stage.Stopped()
        with patch.object(rehearsal.os, 'mkdir', mkdir):
            value, status = self.run_rehearsal(FakeDocker(self))
        self.assertEqual((status, value['codes'], value['steps']['cleanup']), (1, ['interrupted'], 'passed'))
        self.assertTrue(value['cleanup']['workspaceRemoved'])

    def test_a_stop_request_while_the_staging_status_is_read_still_returns_the_result(self):
        def stopped(self):
            raise stage.Stopped()
        with patch.object(rehearsal.Rehearsal, 'staging_status', stopped):
            value, status = self.run_rehearsal(FakeDocker(self))
        self.assertEqual((status, value['status'], value['staging']), (0, 'passed', None))

    def test_a_real_stop_signal_during_a_step_runs_the_cleanup_without_interruption(self):
        docker = FakeDocker(self)
        real = docker.start
        cleanups = []

        def start(options, data):
            entry = docker.option(options, '--entrypoint')[0]
            command = options[options.index(entry) + 2:]
            if command[:1] == ['check']:
                os.kill(os.getpid(), signal.SIGTERM)
                time.sleep(5)
            if entry == 'sh':
                os.kill(os.getpid(), signal.SIGTERM)  # A second request during the clean-up is ignored.
                cleanups.append(True)
            return real(options, data)
        docker.start = start
        previous = {number: signal.getsignal(number) for number in (signal.SIGTERM, signal.SIGHUP)}
        try:
            for number in previous:
                signal.signal(number, stage.interrupted)
            value, status = self.run_rehearsal(docker)
        finally:
            for number, handler in previous.items():
                signal.signal(number, handler)
        self.assertEqual((status, value['codes'], value['steps']['check']), (1, ['interrupted'], 'failed'))
        self.assertEqual(cleanups, [True])
        self.assertTrue(value['cleanup']['workspaceRemoved'])

    def test_a_stop_signal_while_a_helper_is_removed_waits_for_the_removal_and_is_not_lost(self):
        docker = FakeDocker(self)
        real = docker.answer
        sent = []

        def answer(args, data):
            if args[:2] == ['container', 'rm'] and not sent:
                sent.append(True)
                os.kill(os.getpid(), signal.SIGTERM)
                time.sleep(0.2)  # Still blocked: the removal finishes first.
            return real(args, data)
        docker.answer = answer
        previous = {number: signal.getsignal(number) for number in (signal.SIGTERM, signal.SIGHUP)}
        try:
            for number in previous:
                signal.signal(number, stage.interrupted)
            value, status = self.run_rehearsal(docker)
        finally:
            for number, handler in previous.items():
                signal.signal(number, handler)
        self.assertEqual((status, value['codes']), (1, ['interrupted']))
        self.assertEqual(value['steps']['archive'], 'failed', 'the run stopped right after the first helper was removed')
        self.assertTrue(value['cleanup']['workspaceRemoved'])

    def test_a_cleanup_that_cannot_be_proven_fails_the_run(self):
        docker = FakeDocker(self, fail={'cleanup': 1})
        with patch.object(stage, 'docker', docker):
            value, status = rehearsal.main(['private-staging-offsite-rehearsal.py', self.payload])
        self.assertEqual((status, value['status']), (1, 'failed'))
        self.assertIn('cleanup-failed', value['codes'])
        self.assertEqual(value['steps']['cleanup'], 'failed')
        self.assertFalse(value['cleanup']['repositoryRemoved'])
        self.assertFalse(value['cleanup']['workspaceRemoved'])
        self.assertTrue(value['cleanup']['passwordRemoved'], 'the password goes even when other files stay')

    def test_a_folder_left_by_a_killed_run_is_removed_first(self):
        left = self.stage_dir / ('.offsite-rehearsal-' + 'e' * 24)
        (left / 'repository/data').mkdir(parents=True)
        (left / 'repository/data/pack').write_text('encrypted')
        (left / 'password').write_text('old')
        unrelated = self.stage_dir / '.offsite-rehearsal-notours'
        unrelated.mkdir()
        value, status = self.run_rehearsal(FakeDocker(self))
        self.assertEqual(status, 0)
        self.assertEqual(value['cleanup']['earlierWorkspacesRemoved'], 1)
        self.assertFalse(left.exists())
        self.assertTrue(unrelated.exists(), 'only folders named like its own are removed')

    def test_a_busy_staging_lock_defers_without_creating_anything(self):
        docker = FakeDocker(self)

        def busy():
            raise stage.Refused('transaction-busy')
        with patch.object(stage, 'acquire_lock', busy), patch.object(rehearsal, 'LOCK_WAIT', 0), patch.object(rehearsal.time, 'sleep', lambda _: None):
            value, status = self.run_rehearsal(docker)
        self.assertEqual((status, value['status'], value['codes']), (75, 'deferred', ['transaction-busy']))
        self.assertEqual(docker.calls, [], 'nothing was created or removed while another run may hold the lock')
        self.assertTrue(all(state == 'not-run' for name, state in value['steps'].items() if name != 'cleanup'))

    def test_a_wrong_payload_or_an_unsafe_platform_is_refused_before_docker(self):
        docker = FakeDocker(self)
        with patch.object(stage, 'docker', docker):
            value, status = rehearsal.main(['private-staging-offsite-rehearsal.py', '/tmp/elsewhere'])
        self.assertEqual((status, value['codes']), (1, ['payload-path']))

        def unsafe(operations=True):
            raise stage.Refused('wrong-user')
        with patch.object(stage, 'docker', docker), patch.object(stage, 'platform', unsafe):
            value, status = rehearsal.main(['private-staging-offsite-rehearsal.py', self.payload])
        self.assertEqual((status, value['codes']), (1, ['wrong-user']))
        self.assertEqual(docker.calls, [])

    def test_the_restic_image_is_pulled_only_when_missing_and_must_carry_the_pinned_digest(self):
        docker = FakeDocker(self)
        docker.image_present = False
        value, status = self.run_rehearsal(docker)
        self.assertEqual(status, 0)
        self.assertTrue(value['restic']['imagePulled'])
        self.assertIn(('pull', '--quiet', prod.RESTIC_IMAGE), docker.calls)
        docker = FakeDocker(self)
        value, status = self.run_rehearsal(docker)
        self.assertFalse(value['restic']['imagePulled'])
        self.assertFalse(any(call[0] == 'pull' for call in docker.calls))
        docker = FakeDocker(self)
        docker.answer_image = docker.answer

        def other(args, data):
            if args[:2] == ['image', 'inspect']:
                return 0, json.dumps([{'RepoDigests': ['restic/restic@sha256:' + '0' * 64]}])
            return docker.answer_image(args, data)
        docker.answer = other
        value, status = self.run_rehearsal(docker)
        self.assertEqual((status, value['codes']), (1, ['restic-image-unavailable']))

    def test_low_disk_is_refused_before_the_repository_is_made(self):
        docker = FakeDocker(self)
        with patch.object(rehearsal.Rehearsal, 'free_bytes', lambda self: 10):
            value, status = self.run_rehearsal(docker)
        self.assertEqual((status, value['codes']), (1, ['disk-low']))
        self.assertFalse(any(entry == '/usr/bin/restic' for entry, _, _ in docker.started))

    def test_the_staging_timers_and_reports_are_only_read(self):
        ops = self.stage_dir / 'ops'
        (ops / 'last-backup.json').write_text(json.dumps({'scope': 'private-staging-operations', 'action': 'backup', 'verified': True,
                                                          'status': 'passed', 'checkedAtEpoch': 1_900_000_000, 'codes': []}))
        (ops / 'last-monitor.json').write_text(json.dumps({'scope': 'private-staging-operations', 'action': 'monitor', 'verified': False,
                                                           'status': 'failed', 'checkedAtEpoch': 1_900_000_100, 'codes': ['disk-low', 'BAD CODE']}))
        before = {path.name: path.read_bytes() for path in ops.iterdir()}
        sent = []

        def userctl(self, *args):
            sent.append(args)
            if args[0] == 'show':
                return subprocess.CompletedProcess(args, 0, 'LastTriggerUSec=@1900000000\n', '')
            return subprocess.CompletedProcess(args, 0 if args[0] in ('is-enabled', 'is-active') else 1, '', '')
        with patch.object(rehearsal.Rehearsal, 'userctl', userctl), patch.object(stage, 'regular', lambda path, owner=1002: None):
            value, _ = self.run_rehearsal(FakeDocker(self))
        self.assertEqual(value['staging']['backup'], {'status': 'passed', 'checkedAtEpoch': 1_900_000_000, 'lastSuccessEpoch': 1_900_000_000,
                                                      'codes': [], 'timerEnabled': True, 'timerActive': True,
                                                      'lastTriggerEpoch': 1_900_000_000, 'serviceFailed': False})
        self.assertEqual(value['staging']['monitor']['status'], 'failed')
        self.assertIsNone(value['staging']['monitor']['lastSuccessEpoch'])
        self.assertEqual(value['staging']['monitor']['codes'], ['disk-low', 'invalid-report'])
        self.assertTrue(value['staging']['installationValid'])
        self.assertEqual({args[0] for args in sent}, {'is-enabled', 'is-active', 'is-failed', 'show'}, 'systemd is only queried')
        self.assertEqual({path.name: path.read_bytes() for path in ops.iterdir()}, before)

    def test_every_rehearsal_code_is_documented(self):
        import ast
        text = (ROOT / 'docs/PRODUCTION_OPERATIONS.md').read_text()
        section = text[text.index('\n## Off-site rehearsal\n'):text.index('\n## Reading status\n')]
        documented = set(re.findall(r'`([a-z0-9][a-z0-9-]*)`', section))
        codes = {'interrupted', 'operation-failed', 'command-failed', 'command-unavailable-or-timeout', 'helper-id', 'helper-identity',
                 'helper-cleanup-failed', 'rehearsal-repository-missing', 'rehearsal-repository-locked', 'rehearsal-password-wrong'}
        for node in ast.walk(ast.parse((ROOT / 'scripts/private-staging-offsite-rehearsal.py').read_text())):
            if isinstance(node, ast.Call):
                name = getattr(node.func, 'attr', getattr(node.func, 'id', ''))
                values = node.args[1:2] if name in ('require', 'step') else node.args if name == 'Refused' else []
                codes |= {value.value for value in values if isinstance(value, ast.Constant) and isinstance(value.value, str)}
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and re.fullmatch(r'[a-z]+(-[a-z]+)*-(failed|unreadable)', node.value):
                codes.add(node.value)
        # A systemctl verb, and a refusal the read-only status report turns into "missing".
        codes = {code.replace('offsite-', 'rehearsal-', 1) for code in codes} - {'is-failed', 'unsafe-file'}
        self.assertEqual(sorted(codes - documented), [])
        for code in ('rehearsal-repository-missing', 'rehearsal-repository-locked', 'rehearsal-password-wrong'):
            self.assertEqual(prod.restic_code({'rehearsal-repository-missing': 10, 'rehearsal-repository-locked': 11, 'rehearsal-password-wrong': 12}[code], 'x'),
                             code.replace('rehearsal-', 'offsite-'))

    def test_forget_preview_counts(self):
        output = json.dumps([{'keep': [{'id': 'a'}, {'id': 'b'}], 'remove': [{'id': 'c'}]}, {'keep': [{'id': 'd'}], 'remove': None}])
        self.assertEqual(rehearsal.forget_counts(output, 'a'), (3, 1))
        for bad in ('not json', json.dumps({'keep': []}), json.dumps([{'keep': [{'id': 'x'}]}])):
            with self.assertRaises(stage.Refused):
                rehearsal.forget_counts(bad, 'a')

    def test_the_script_reuses_the_reviewed_pins_and_never_hard_codes_another_image(self):
        source = (ROOT / 'scripts/private-staging-offsite-rehearsal.py').read_text()
        self.assertNotRegex(source, r'sha256:[0-9a-f]{64}')
        self.assertNotRegex(source, r'\b\d{1,3}(\.\d{1,3}){3}\b')
        self.assertNotIn('--prune', source)
        self.assertNotIn('PRODUCTION_OPS_', source)
        controller = CONTROLLER.read_text()
        staging = (ROOT / 'scripts/private-staging.sh').read_text()
        for pin in (KEY_PIN, HOST_PIN):
            self.assertIn(pin, controller)
            self.assertIn(pin, staging)
        # The address is written only into the private known_hosts file, never to the output.
        printed = [line for line in controller.splitlines() if re.search(r'(printf|echo)[^\n]*\$\{?(DEPLOY_HOST|DEPLOY_USER|host|user)\b', line)]
        self.assertEqual(printed, ["  printf '%s %s %s\\n' \"$host\" \"$key_type\" \"$key_data\" >> \"$work/known_hosts\""])


if __name__ == '__main__':
    unittest.main()
