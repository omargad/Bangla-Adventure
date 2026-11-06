from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ops = load('stage_operations', 'scripts/private-staging-ops.py')
checker = load('stage_operations_check', 'scripts/private-staging-ops-check.py')
installer = load('stage_operations_install', 'scripts/private-staging-ops-install.py')


def completed(stdout='', returncode=0):
    return subprocess.CompletedProcess([], returncode, stdout, '')


def aggregates():
    return {'checkedAtEpoch': 2_000_000_000, 'health': True, 'containersHealthy': True,
            'publishedPorts': 0, 'freeDiskBytes': 2 * 1024 ** 3,
            'backup': {'verified': True, 'createdEpoch': 2_000_000_000 - 30}, 'lastBackupRunPassed': True}


class CheckTests(unittest.TestCase):
    def test_healthy_and_failure_conditions_are_independent(self):
        self.assertEqual(checker.evaluate(aggregates())['status'], 'healthy')
        cases = [('health', False, 'health-unavailable'), ('containersHealthy', False, 'container-unhealthy'),
                 ('publishedPorts', 1, 'port-exposed'), ('freeDiskBytes', 10, 'disk-low'),
                 ('lastBackupRunPassed', False, 'backup-job-failed')]
        for key, value, code in cases:
            item = aggregates(); item[key] = value
            result = checker.evaluate(item)
            self.assertFalse(result['verified']); self.assertIn(code, result['codes'])

    def test_stale_future_and_missing_backup_fail_without_raw_fields(self):
        for backup in [{'verified': False, 'createdEpoch': None},
                       {'verified': True, 'createdEpoch': 2_000_000_000 - 36 * 3600 - 1},
                       {'verified': True, 'createdEpoch': 2_000_000_000 + 301}]:
            value = aggregates(); value['backup'] = backup
            result = checker.evaluate(value)
            self.assertFalse(result['verified']); self.assertIn('backup-stale-or-future', result['codes'])
        value = aggregates(); value['secret'] = 'MUST_NOT_LEAK'
        with self.assertRaises(ValueError): checker.evaluate(value)

    def test_boundary_values_and_invalid_boolean_numbers(self):
        value = aggregates(); value['freeDiskBytes'] = 1024 ** 3; value['backup']['createdEpoch'] = value['checkedAtEpoch'] - 36 * 3600
        self.assertTrue(checker.evaluate(value)['verified'])
        for key in ['publishedPorts', 'freeDiskBytes', 'checkedAtEpoch']:
            item = aggregates(); item[key] = True
            with self.assertRaises(ValueError): checker.evaluate(item)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.running = True
        self.metadata = {'verified': True, 'createdEpoch': 2_000_000_000, 'archiveBytes': 20,
                         'sha256': 'a' * 64, 'inventoryDigest': 'b' * 64}
        self.patches = [
            patch.object(ops, 'containers', self.containers), patch.object(ops, 'http_health', return_value=True),
            patch.object(ops, 'ensure_backups', lambda: self.events.append('prepare-backups')),
            patch.object(ops, 'compose', self.compose), patch.object(ops, 'cleanup_helpers', lambda: self.events.append('helpers-gone')),
            patch.object(ops, 'backup_metadata', lambda **_: dict(self.metadata)),
            patch.object(ops, 'write_status', lambda *args: self.events.append('status')),
            patch.object(ops, 'volume', lambda *args, **kwargs: None),
            patch.object(ops.os, 'statvfs', return_value=type('Disk', (), {'f_bavail': 2 * 1024 ** 3, 'f_frsize': 1})()),
        ]
        for item in self.patches: item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])

    def containers(self):
        state = {'Running': self.running, 'Health': {'Status': 'healthy'}}
        return {'app': {'Id': 'a' * 64, 'State': state}, 'proxy': {'Id': 'b' * 64, 'State': state}}

    def compose(self, *args):
        if args[0] == 'stop': self.events.append('stop'); self.running = False
        if args[0] == 'up': self.events.append('up'); self.running = True

    def docker(self, *args, **kwargs):
        if args[:2] == ('volume', 'inspect'): return completed(returncode=1)
        return completed()

    def test_routine_backup_does_not_require_empty_user_data(self):
        def backup(destination, readonly=False):
            self.assertEqual(destination, ops.BACKUPS); self.assertFalse(readonly)
            self.assertFalse(self.running); self.events.append('backup')
            return completed(json.dumps({'verified': True}))
        with patch.object(ops, 'docker', self.docker), patch.object(ops, 'backup_command', backup), patch.object(ops, 'clean_digest', side_effect=AssertionError('routine backups must accept legitimate staging accounts')):
            result = ops.run_maintenance(exercise=False)
        self.assertTrue(result['verified'])
        self.assertLess(self.events.index('stop'), self.events.index('backup'))
        self.assertLess(self.events.index('helpers-gone'), self.events.index('up'))
        self.assertTrue(self.running)

    def test_failed_backup_resumes_healthy_application(self):
        with patch.object(ops, 'docker', self.docker), patch.object(ops, 'backup_command', return_value=completed(returncode=1)):
            with self.assertRaisesRegex(ops.Refused, 'snapshot-failed'): ops.run_maintenance(exercise=False)
        self.assertTrue(self.running); self.assertIn('up', self.events)

    def test_cli_timeout_and_interruption_cleanup_before_resume(self):
        for error in [ops.Refused('command-unavailable-or-timeout'), KeyboardInterrupt()]:
            self.events.clear(); self.running = True
            with patch.object(ops, 'docker', self.docker), patch.object(ops, 'backup_command', side_effect=error):
                with self.assertRaises(type(error)): ops.run_maintenance(exercise=False)
            self.assertTrue(self.running)
            self.assertLess(self.events.index('helpers-gone'), self.events.index('up'))

    def test_partial_stop_still_attempts_recovery_without_backup(self):
        def stop(*args):
            if args[0] == 'stop':
                self.running = False; self.events.append('partial-stop'); raise ops.Refused('command-failed')
            self.compose(*args)
        with patch.object(ops, 'docker', self.docker), patch.object(ops, 'compose', stop), patch.object(ops, 'backup_command') as backup:
            with self.assertRaises(ops.Refused): ops.run_maintenance(exercise=False)
            backup.assert_not_called()
        self.assertTrue(self.running); self.assertIn('up', self.events)

    def test_readonly_fault_is_confined_to_owned_disposable_volume(self):
        calls = []
        def backup(destination, readonly=False):
            self.assertTrue(destination.startswith('bangla-private-ops-drill-')); self.assertNotEqual(destination, ops.BACKUPS)
            self.assertTrue(readonly); self.assertFalse(self.running); calls.append(destination)
            return completed(returncode=1)
        with patch.object(ops, 'docker', self.docker), patch.object(ops, 'backup_command', backup), patch.object(ops, 'isolated_run', return_value=completed()), patch.object(ops, 'clean_digest', return_value='f' * 64):
            result = ops.run_maintenance(exercise=True)
        self.assertTrue(result['verified']); self.assertEqual(len(calls), 1)
        self.assertTrue(all(result['checks'].values())); self.assertTrue(self.running)

    def test_unexpected_fault_success_and_failed_resume_never_report_passed(self):
        with patch.object(ops, 'docker', self.docker), patch.object(ops, 'backup_command', return_value=completed()), patch.object(ops, 'isolated_run', return_value=completed()), patch.object(ops, 'clean_digest', return_value='f' * 64):
            with self.assertRaisesRegex(ops.Refused, 'fault-not-observed'): ops.run_maintenance(exercise=True)
        self.running = True
        def failure(*args):
            if args[0] == 'up': raise ops.Refused('command-failed')
            self.compose(*args)
        with patch.object(ops, 'docker', self.docker), patch.object(ops, 'backup_command', return_value=completed(json.dumps({'verified': True}))), patch.object(ops, 'compose', failure):
            with self.assertRaisesRegex(ops.Refused, 'resume-failed'): ops.run_maintenance(exercise=False)


class HelperTests(unittest.TestCase):
    def tearDown(self):
        ops.OWNED_HELPERS.clear()

    def test_timed_out_helper_is_terminated_by_owned_id(self):
        cid, token = 'c' * 64, 'd' * 24
        name = 'ba-private-stage-ops-' + token
        events = []; exists = False
        def docker(*args, **kwargs):
            nonlocal exists
            if args[:2] == ('container', 'create'):
                exists = True; events.append('create'); return completed(cid)
            if args[:2] == ('container', 'start'):
                events.append('timeout'); raise ops.Refused('command-unavailable-or-timeout')
            if args[:2] == ('container', 'inspect'):
                if not exists: return completed(returncode=1)
                return completed(json.dumps([{'Id': cid, 'Name': '/' + name, 'Config': {'Labels': {'io.bangla.scope': ops.SCOPE, 'io.bangla.ops.id': token}}}]))
            if args[:3] == ('container', 'rm', '--force'):
                self.assertEqual(args[3], cid); events.append('remove-owned'); exists = False; return completed()
            self.fail(str(args))
        with patch.object(ops, 'docker', docker), patch.object(ops.secrets, 'token_hex', return_value=token):
            with self.assertRaisesRegex(ops.Refused, 'command-unavailable-or-timeout'): ops.isolated_run('--network', 'none', ops.IMAGE)
        self.assertEqual(events, ['create', 'timeout', 'remove-owned']); self.assertEqual(ops.OWNED_HELPERS, {})

    def test_foreign_helper_is_not_removed(self):
        cid = 'c' * 64; ops.OWNED_HELPERS[cid] = ('ba-private-stage-ops-' + 'd' * 24, 'd' * 24)
        def docker(*args, **kwargs):
            self.assertEqual(args[:2], ('container', 'inspect'))
            return completed(json.dumps([{'Id': cid, 'Name': '/foreign', 'Config': {'Labels': {}}}]))
        with patch.object(ops, 'docker', docker):
            with self.assertRaisesRegex(ops.Refused, 'helper-identity'): ops.cleanup_helpers()


class InstallerTests(unittest.TestCase):
    def install_fixture(self, folder):
        root = Path(folder); source = root / 'payload'; source.mkdir()
        stage = root / 'stage'; (stage / 'tools').mkdir(parents=True)
        (stage / 'ops').mkdir(); config = root / 'units'; config.mkdir()
        for name in (*installer.TOOLS, *installer.UNITS):
            (source / name).write_bytes(installer.MARKER + b'fixture\n')
        class Payload:
            def __str__(self): return '/opt/bangla-adventures/.private-acceptance-payload.abcdefghijkl'
            def __truediv__(self, name): return source / name
        return stage, config, Payload()

    def test_busy_installation_lock_does_not_stop_timers_or_replace_files(self):
        with tempfile.TemporaryDirectory() as folder:
            stage, config, payload = self.install_fixture(folder)
            with patch.object(installer, 'Path', return_value=payload), patch.object(installer.sys, 'argv', ['install', str(payload)]), patch.object(installer.ops, 'platform'), patch.object(installer.ops, 'private_dir'), patch.object(installer.ops, 'regular'), patch.object(installer.ops, 'healthy', return_value=True), patch.object(installer.ops, 'containers'), patch.object(installer.ops, 'http_health', return_value=True), patch.object(installer.ops, 'systemd_dir', return_value=config), patch.object(installer, 'owned_config'), patch.object(installer.ops, 'OPS', stage / 'ops'), patch.object(installer.ops, 'STAGE', stage), patch.object(installer.ops, 'acquire_lock', side_effect=installer.ops.Refused('transaction-busy')), patch.object(installer, 'userctl') as ctl, patch.object(installer, 'atomic') as replace:
                with self.assertRaisesRegex(installer.ops.Refused, 'transaction-busy'): installer.main()
                ctl.assert_not_called(); replace.assert_not_called()

    def test_installation_file_rollback_holds_lock_until_restoration_finishes(self):
        with tempfile.TemporaryDirectory() as folder:
            stage, config, payload = self.install_fixture(folder)
            events = []; reloads = 0
            fd = os.open(Path(folder) / 'lock', os.O_RDWR | os.O_CREAT, 0o600)
            real_close = os.close
            def close(value): events.append('unlock'); real_close(value)
            def ctl(*args, **kwargs):
                nonlocal reloads
                if args[0] in ('is-enabled', 'is-active'): return completed(returncode=1)
                if args[0] == 'daemon-reload':
                    reloads += 1; events.append('reload-' + str(reloads))
                    if reloads == 1: raise installer.ops.Refused('forced-reload-failure')
                return completed()
            with patch.object(installer, 'Path', return_value=payload), patch.object(installer.sys, 'argv', ['install', str(payload)]), patch.object(installer.ops, 'platform'), patch.object(installer.ops, 'private_dir'), patch.object(installer.ops, 'regular'), patch.object(installer.ops, 'healthy', return_value=True), patch.object(installer.ops, 'containers'), patch.object(installer.ops, 'http_health', return_value=True), patch.object(installer.ops, 'systemd_dir', return_value=config), patch.object(installer, 'owned_config'), patch.object(installer.ops, 'OPS', stage / 'ops'), patch.object(installer.ops, 'STAGE', stage), patch.object(installer.ops, 'acquire_lock', return_value=fd), patch.object(installer, 'userctl', ctl), patch.object(installer.os, 'close', close):
                with self.assertRaisesRegex(installer.ops.Refused, 'forced-reload-failure'): installer.main()
            self.assertLess(events.index('reload-2'), events.index('unlock'))
            self.assertEqual(list((stage / 'tools').iterdir()), [])
            self.assertEqual(list(config.iterdir()), [])

    def test_deferred_or_old_success_receipt_cannot_satisfy_initial_run(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); now = 2_000_000_000
            value = {'scope': ops.SCOPE, 'action': 'backup', 'verified': True, 'checkedAtEpoch': now - 1, 'invocationId': 'f' * 32}
            (root / 'last-backup.json').write_text(json.dumps(value))
            with patch.object(installer.ops, 'OPS', root), patch.object(installer.ops, 'regular'), patch.object(installer, 'userctl', return_value=completed('0')):
                with self.assertRaisesRegex(installer.ops.Refused, 'initial-operations-check'): installer.fresh_service_result('backup', now)
            value['checkedAtEpoch'] = now + 1; (root / 'last-backup.json').write_text(json.dumps(value))
            with patch.object(installer.ops, 'OPS', root), patch.object(installer.ops, 'regular'), patch.object(installer, 'userctl', return_value=completed('75')):
                with self.assertRaisesRegex(installer.ops.Refused, 'initial-service-deferred-or-failed'): installer.fresh_service_result('backup', now)
            with patch.object(installer.ops, 'OPS', root), patch.object(installer.ops, 'regular'), patch.object(installer, 'userctl', return_value=completed('0')):
                self.assertEqual(installer.fresh_service_result('backup', now)['invocationId'], 'f' * 32)

    def test_unit_defaults_are_user_only_utc_and_private(self):
        folder = ROOT / 'deploy/private-staging-ops'
        backup = (folder / 'ba-private-stage-backup.timer').read_text()
        self.assertIn('OnCalendar=*-*-* 03:30:00 UTC', backup)
        self.assertIn('OnUnitActiveSec=5min', (folder / 'ba-private-stage-monitor.timer').read_text())
        for name in ['backup', 'monitor']:
            service = (folder / f'ba-private-stage-{name}.service').read_text()
            self.assertIn('UMask=0077', service); self.assertIn('SuccessExitStatus=75', service)
            self.assertNotIn('User=root', service); self.assertNotIn('/etc/systemd/system', service)

    def test_unit_directories_allow_only_the_users_private_group_to_write(self):
        def info(mode, uid=1002, gid=1002, kind=0o040000):
            return os.stat_result((kind | mode, 0, 0, 1, uid, gid, 0, 0, 0, 0))
        problem = installer.unit_directory_problem
        self.assertIsNone(problem(info(0o700), True, 1002))
        self.assertIsNone(problem(info(0o755), True, None))
        # Ubuntu's 002 umask for a user private group.
        self.assertIsNone(problem(info(0o775), True, 1002))
        self.assertEqual(problem(info(0o775), True, None), 'writable')
        self.assertEqual(problem(info(0o775, gid=100), True, 1002), 'writable')
        self.assertEqual(problem(info(0o757), True, 1002), 'writable')
        self.assertEqual(problem(info(0o1777), True, 1002), 'writable')
        self.assertEqual(problem(info(0o700, uid=0), True, 1002), 'owner')
        self.assertEqual(problem(info(0o700), False, 1002), 'type')
        self.assertEqual(problem(info(0o700, kind=0o120000), True, 1002), 'type')

    def test_private_group_requires_a_group_nobody_else_can_use(self):
        user = installer.ops.pwd.struct_passwd(('deployer', 'x', 1002, 1002, '', '/home/deployer', '/bin/bash'))
        other = installer.ops.pwd.struct_passwd(('someone', 'x', 1003, 1002, '', '/home/someone', '/bin/bash'))
        def group(name, members):
            return installer.grp.struct_group((name, 'x', 1002, members))
        cases = [(group('deployer', []), [user], 1002), (group('deployer', ['deployer']), [user], 1002),
                 (group('deployer', ['someone']), [user], None), (group('staff', []), [user], None),
                 (group('deployer', []), [user, other], None)]
        for entry, users, expected in cases:
            with patch.object(installer.grp, 'getgrgid', return_value=entry), patch.object(installer.ops.pwd, 'getpwall', return_value=users):
                self.assertEqual(installer.private_group(user), expected)
        with patch.object(installer.grp, 'getgrgid', side_effect=KeyError(1002)):
            self.assertIsNone(installer.private_group(user))

    def test_every_specific_unit_directory_code_is_reported_by_acceptance(self):
        script = (ROOT / 'scripts/private-staging-acceptance.sh').read_text()
        for part in installer.UNIT_PARTS:
            for kind in ('type', 'owner', 'writable'):
                self.assertIn(f' unsafe-unit-directory-{part}-{kind} ', script)


if __name__ == '__main__': unittest.main()
