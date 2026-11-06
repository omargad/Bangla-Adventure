from __future__ import annotations

import ast
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ops = load('production_operations', 'scripts/production-ops.py')
installer = load('production_operations_install', 'scripts/production-ops-install.py')
NOW = 2_000_000_000
IMAGE = 'ghcr.io/example/bangla@sha256:' + 'a' * 64
ARCHIVE = 'bangla-data-20330518T033000123456Z-0123456789ab.tar.gz'


def completed(stdout='', returncode=0):
    return subprocess.CompletedProcess([], returncode, stdout, '')


class StopHandlers:
    """Installs the entry point's real stop handlers for one test, then puts the previous ones back."""

    def __enter__(self):
        self.previous = {number: signal.getsignal(number) for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)}
        for number in (signal.SIGTERM, signal.SIGHUP):
            signal.signal(number, ops.interrupted)
        return self

    def stop_after(self, seconds):
        timer = threading.Timer(seconds, os.kill, (os.getpid(), signal.SIGTERM))
        timer.start()
        return timer

    def __exit__(self, *_):
        for number, handler in self.previous.items():
            signal.signal(number, handler)


def facts(**changes):
    value = {'checkedAtEpoch': NOW, 'loopbackHealth': True, 'appRunning': True, 'appHealthy': True, 'appImageCurrent': True,
             'portsConfined': True, 'freeDiskBytes': 2 * 1024 ** 3, 'backup': {'present': True, 'createdEpoch': NOW - 60},
             'lastBackupRunPassed': True, 'backupLockPresent': False,
             'public': {'health': True, 'certificateExpiresEpoch': NOW + 60 * 86400},
             'offsite': {'lastSuccessEpoch': NOW - 3600}}
    value.update(changes)
    return value


class Fixture:
    """A deployment folder like the server's, owned by the test user, with no Docker behind it."""

    def __init__(self, folder):
        self.root = Path(folder)
        self.deployment = self.root / 'deploy'
        self.deployment.mkdir(mode=0o700)
        (self.deployment / 'compose.yaml').write_text('services: {}\n')
        (self.deployment / '.env').write_text(f'PUBLIC_ORIGIN=https://learn.example.org\nAPP_PORT=3001\nCOMPOSE_PROJECT_NAME=bangla-adventures\nAPP_IMAGE={IMAGE}\n')
        (self.deployment / '.env').chmod(0o600)
        (self.deployment / '.deploy.lock').write_text('')
        (self.deployment / 'ops').mkdir(mode=0o700)
        self.offsite = self.root / 'offsite'
        self.offsite.mkdir(mode=0o700)
        self.repository = self.root / 'repository'
        self.environ = {'PRODUCTION_OPS_DEPLOYMENT_DIR': str(self.deployment), 'PRODUCTION_OPS_DOCKER_HOST': 'unix:///nonexistent/docker.sock',
                        'PRODUCTION_OPS_UID': str(os.getuid()), 'PRODUCTION_OPS_REQUIRE_ROOTLESS': 'false',
                        'PRODUCTION_OPS_OFFSITE_DIR': str(self.offsite)}

    def production(self, **extra):
        return ops.Production(ops.Settings({**self.environ, **extra}))

    def hold_lock(self):
        fd = os.open(self.deployment / '.deploy.lock', os.O_RDWR)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd

    def report(self, action):
        path = self.deployment / 'ops' / f'last-{action}.json'
        return json.loads(path.read_text()) if path.exists() else None


class SettingsTests(unittest.TestCase):
    def test_defaults_are_the_production_values(self):
        s = ops.Settings({})
        self.assertEqual((s.deployment, s.docker_host, s.uid, s.rootless, s.test_repository, s.overridden),
                         (Path('/opt/bangla-adventures'), 'unix:///run/user/1002/docker.sock', 1002, True, None, False))
        self.assertEqual(s.ops, Path('/opt/bangla-adventures/ops'))
        self.assertEqual(s.tools, Path('/opt/bangla-adventures/ops/tools'))
        self.assertEqual(s.backups, Path('/opt/bangla-adventures/backups'))

    def test_overrides_are_validated(self):
        for name, value in [('PRODUCTION_OPS_DEPLOYMENT_DIR', 'relative'), ('PRODUCTION_OPS_DEPLOYMENT_DIR', '/opt/../etc'),
                            ('PRODUCTION_OPS_DEPLOYMENT_DIR', '/opt/a b'), ('PRODUCTION_OPS_DOCKER_HOST', 'tcp://docker.example.test:2375'),
                            ('PRODUCTION_OPS_UID', 'root'), ('PRODUCTION_OPS_REQUIRE_ROOTLESS', 'yes'),
                            ('PRODUCTION_OPS_TEST_REPOSITORY', '/tmp/$(id)')]:
            with self.assertRaisesRegex(ops.Refused, 'invalid-override'):
                ops.Settings({name: value})
        self.assertTrue(ops.Settings({'PRODUCTION_OPS_UID': '0'}).overridden)

    def test_restic_image_is_pinned_by_digest_and_documented(self):
        self.assertRegex(ops.RESTIC_IMAGE, r'^restic/restic:0\.19\.1@sha256:[0-9a-f]{64}$')
        self.assertTrue(ops.RESTIC_IMAGE.startswith(f'restic/restic:{ops.RESTIC_VERSION}@'))
        self.assertIn(ops.RESTIC_IMAGE.split('@')[1], (ROOT / 'docs/PRODUCTION_OPERATIONS.md').read_text())

    def test_server_side_files_never_set_overrides(self):
        for path in [*(ROOT / 'deploy/production-ops').iterdir(), ROOT / '.github/workflows/vps-production-ops.yml',
                     ROOT / '.github/workflows/vps-production-status.yml', ROOT / 'scripts/production-ops-controller.sh']:
            self.assertNotIn('PRODUCTION_OPS_', path.read_text(), path.name)


class MonitorTests(unittest.TestCase):
    def test_healthy_facts_pass(self):
        result = ops.evaluate_monitor(facts())
        self.assertEqual((result['status'], result['verified'], result['codes']), ('healthy', True, []))
        self.assertEqual(result['measures']['certificateDaysLeft'], 60.0)

    def test_each_failing_check_has_its_own_code(self):
        cases = [
            (dict(loopbackHealth=False), 'health-unavailable'), (dict(appRunning=False), 'app-not-running'),
            (dict(appHealthy=False), 'app-unhealthy'), (dict(appImageCurrent=False), 'app-image-mismatch'),
            (dict(portsConfined=False), 'port-exposed'), (dict(freeDiskBytes=ops.MIN_FREE_BYTES - 1), 'disk-low'),
            (dict(backup={'present': False, 'createdEpoch': None}), 'backup-missing'),
            (dict(backup={'present': True, 'createdEpoch': NOW - 36 * 3600 - 1}), 'backup-stale-or-future'),
            (dict(backup={'present': True, 'createdEpoch': NOW + 301}), 'backup-stale-or-future'),
            (dict(lastBackupRunPassed=False), 'backup-job-failed'),
            (dict(backupLockPresent=True), 'stale-backup-lock-found'),
            (dict(public={'health': False, 'certificateExpiresEpoch': NOW + 60 * 86400}), 'public-health-failed'),
            (dict(public={'health': True, 'certificateExpiresEpoch': NOW + 14 * 86400 - 1}), 'certificate-expiring-or-invalid'),
            (dict(public={'health': False, 'certificateExpiresEpoch': None}), 'certificate-expiring-or-invalid'),
            (dict(offsite={'lastSuccessEpoch': NOW - 48 * 3600 - 1}), 'offsite-stale'),
            (dict(offsite={'lastSuccessEpoch': None}), 'offsite-stale'),
        ]
        for change, code in cases:
            result = ops.evaluate_monitor(facts(**change))
            self.assertFalse(result['verified'], change)
            self.assertEqual(result['status'], 'failed')
            self.assertIn(code, result['codes'], change)

    def test_boundaries_pass(self):
        value = facts(freeDiskBytes=ops.MIN_FREE_BYTES, backup={'present': True, 'createdEpoch': NOW - 36 * 3600},
                      public={'health': True, 'certificateExpiresEpoch': NOW + 14 * 86400},
                      offsite={'lastSuccessEpoch': NOW - 48 * 3600})
        self.assertTrue(ops.evaluate_monitor(value)['verified'])
        self.assertTrue(ops.evaluate_monitor(facts(backup={'present': True, 'createdEpoch': NOW + 300}))['verified'])

    def test_public_and_offsite_checks_apply_only_when_configured(self):
        result = ops.evaluate_monitor(facts(public=None, offsite=None))
        self.assertTrue(result['verified'])
        self.assertEqual((result['checks']['publicHealth'], result['checks']['certificateValid'], result['checks']['offsiteFresh']), (None, None, None))
        self.assertEqual((result['publicOriginConfigured'], result['offsiteConfigured']), (False, False))

    def test_invalid_facts_are_rejected(self):
        for change in [dict(extra=True), dict(freeDiskBytes=True), dict(appRunning=1), dict(backupLockPresent=None), dict(checkedAtEpoch=float('nan')),
                       dict(backup={'present': True}), dict(public={'health': 'yes', 'certificateExpiresEpoch': None}),
                       dict(offsite={'lastSuccessEpoch': -5})]:
            with self.assertRaises(ValueError):
                ops.evaluate_monitor(facts(**change))


def container(service='app', oneoff='False', bindings=None, running=True, network='bangla-adventures_default', publish_all=False):
    bindings = {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3001'}]} if bindings is None else bindings
    return {'Config': {'Labels': {'com.docker.compose.service': service, 'com.docker.compose.oneoff': oneoff}, 'Image': IMAGE},
            'HostConfig': {'PortBindings': bindings, 'PublishAllPorts': publish_all, 'NetworkMode': network},
            'NetworkSettings': {'Ports': bindings if running else {}}, 'State': {'Running': running}}


class PortTests(unittest.TestCase):
    def test_only_the_app_on_loopback_application_port_is_published(self):
        self.assertTrue(ops.ports_confined([container()], 3001))
        self.assertTrue(ops.ports_confined([container(running=False), container(oneoff='True', bindings={})], 3001))
        self.assertTrue(ops.ports_confined([container(bindings={'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3001'}], '9229/tcp': None})], 3001))
        for found in [
            [container(bindings={'3000/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '3001'}]})],
            [container(bindings={'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3002'}]})],
            [container(bindings={'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3001'}], '9229/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '9229'}]})],
            [container(bindings={'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3001'}, {'HostIp': '::', 'HostPort': '3001'}]})],
            [container(), container(oneoff='True')], [container(network='host')], [container(publish_all=True)],
        ]:
            self.assertFalse(ops.ports_confined(found, 3001), found)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.fx = Fixture(self.folder.name)
        self.prod = self.fx.production()
        self.events = []
        self.running = True
        self.backup_rc = 0
        self.up_error = None
        self.healthy_again = True
        self.docker_healthy = True
        self.run_args = None
        self.helpers_left = 0
        self.stale_found = True
        self.stale_at_start = False
        self.writer = False
        self.patches = [
            patch.object(self.prod, 'platform', lambda: None),
            patch.object(self.prod, 'wait_until_serving', lambda cfg, timeout: self.events.append('serving') or container()),
            patch.object(self.prod, 'free_bytes', return_value=5 * 1024 ** 3),
            patch.object(self.prod, 'prepare_backups', lambda cfg: self.events.append('prepare')),
            patch.object(self.prod, 'containers', lambda cfg: [container(running=self.running)]),
            patch.object(self.prod, 'docker', lambda *args, **kwargs: completed()),
            patch.object(self.prod, 'compose', self.compose),
            patch.object(self.prod, 'remove_owned', lambda token: self.events.append('helpers-gone') or self.helpers_left),
            patch.object(self.prod, 'clear_stale_backup', self.clear_stale),
            patch.object(self.prod, 'backup_writer_running', lambda: self.writer),
            patch.object(self.prod, 'wait_for_health', lambda port, timeout: self.events.append('health') or self.healthy_again),
            patch.object(self.prod, 'wait_until_healthy', lambda cfg, timeout: self.events.append('docker-healthy') or self.docker_healthy),
            patch.object(self.prod, 'receipt', lambda cfg, verify: {'present': True, 'archive': ARCHIVE, 'sha256': 'b' * 64, 'bytes': 2048, 'createdEpoch': NOW}),
        ]
        for item in self.patches:
            item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])

    def clear_stale(self, cfg):
        # Before this run's stop: the check at the start; after it: the clean-up after a killed helper.
        stopped = 'stop' in self.events[len(self.events) - self.events[::-1].index('prepare'):]
        found = self.stale_found if stopped else self.stale_at_start
        self.events.append('clear-stale' if stopped else 'clear-start')
        if isinstance(found, BaseException):
            raise found
        return found

    def compose(self, cfg, *args, image=None, **kwargs):
        if args[0] == 'stop':
            self.events.append('stop')
            self.running = False
        elif args[0] == 'run':
            self.events.append('backup')
            self.run_args, self.run_image = args, image
            self.assertFalse(self.running)
            if callable(self.backup_rc):
                return self.backup_rc()
            if isinstance(self.backup_rc, BaseException):
                raise self.backup_rc
            output = json.dumps({'archive': '/backups/' + ARCHIVE, 'sha256': 'b' * 64, 'files': 3, 'verified': True})
            return completed(output if self.backup_rc == 0 else '', self.backup_rc)
        elif args[0] == 'up':
            self.events.append('up')
            self.assertIs(signal.getsignal(signal.SIGTERM), signal.SIG_IGN)
            self.assertIs(signal.getsignal(signal.SIGHUP), signal.SIG_IGN)
            if self.up_error:
                raise self.up_error
            self.running = True
        return completed()

    def test_busy_deploy_lock_defers_with_75_and_never_stops_the_app(self):
        fd = self.fx.hold_lock()
        self.addCleanup(os.close, fd)
        with self.assertRaisesRegex(ops.Refused, 'transaction-busy'):
            self.prod.backup()
        self.assertEqual(self.events, [])
        # The real entry point, as systemd runs it: deferral exits 75 and records nothing.
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/production-ops.py'), 'backup'], capture_output=True, text=True,
                                env={**os.environ, **self.fx.environ}, timeout=60)
        self.assertEqual(result.returncode, 75, result.stdout + result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual((value['status'], value['codes'], value['verified']), ('deferred', ['transaction-busy'], False))
        self.assertIsNone(self.fx.report('backup'))

    def test_routine_backup_runs_the_deploys_command_and_records_downtime(self):
        value = self.prod.backup()
        self.assertEqual(value['status'], 'passed')
        self.assertEqual(self.events, ['prepare', 'clear-start', 'serving', 'stop', 'backup', 'helpers-gone', 'up', 'health', 'docker-healthy'])
        self.assertEqual(value['codes'], [])
        backups = str(self.fx.deployment / 'backups')
        self.assertEqual(self.run_args[:3], ('run', '--rm', '--no-deps'))
        self.assertEqual(self.run_args[-8:], ('--volume', backups + ':/backups', 'app', 'bash', 'scripts/backup.sh', '/backups', '14', '--application-stopped'))
        self.assertEqual(self.run_image, IMAGE)
        self.assertEqual(value['backup']['archive'], ARCHIVE)
        self.assertIsInstance(value['measures']['downtimeSeconds'], float)
        self.assertEqual(self.fx.report('backup')['status'], 'passed')
        self.assertTrue(self.running)

    def test_failed_backup_always_starts_the_app_again(self):
        self.backup_rc = 1
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['backup-failed'])
        self.assertLess(self.events.index('helpers-gone'), self.events.index('up'))
        self.assertTrue(self.running)

    def test_interrupted_backup_starts_the_app_again(self):
        for error, code in [(ops.Stopped(), 'interrupted'), (KeyboardInterrupt(), 'interrupted'), (ops.Refused('command-unavailable-or-timeout'), 'backup-timeout')]:
            self.events.clear()
            self.running, self.backup_rc = True, error
            with self.assertRaises(ops.Refused) as caught:
                self.prod.backup()
            self.assertEqual(caught.exception.codes, [code])
            self.assertIn('up', self.events)
            self.assertTrue(self.running)

    def test_a_real_stop_request_interrupts_a_running_command(self):
        # Production.command waits in subprocess's selector loop, which swallows InterruptedError.
        with StopHandlers() as handlers:
            handlers.stop_after(0.5)
            began = time.monotonic()
            with self.assertRaises(ops.Stopped):
                ops.Production.command(self.prod, ['sleep', '20'], timeout=60)
            self.assertLess(time.monotonic() - began, 10)
            # Later stop requests wait for recovery instead of interrupting it.
            self.assertIs(signal.getsignal(signal.SIGTERM), signal.SIG_IGN)

    def test_a_real_stop_request_during_the_backup_starts_the_app_again(self):
        # The helper runs through the real Production.command, as `docker compose run` does.
        self.backup_rc = lambda: ops.Production.command(self.prod, ['sleep', '20'], timeout=60, okay=True)
        self.helpers_left = 1  # Killing the CLI leaves the helper container, which is then removed.
        with StopHandlers() as handlers:
            handlers.stop_after(0.5)
            began = time.monotonic()
            with self.assertRaises(ops.Refused) as caught:
                self.prod.backup()
            self.assertLess(time.monotonic() - began, 10)
        self.assertEqual(caught.exception.codes, ['interrupted', 'stale-backup-lock-cleared'])
        self.assertEqual(self.events[-6:], ['backup', 'helpers-gone', 'up', 'health', 'docker-healthy', 'clear-stale'])
        self.assertTrue(self.running)

    def test_a_killed_helper_never_leaves_the_backup_lock_behind(self):
        self.backup_rc = ops.Refused('command-unavailable-or-timeout')
        self.helpers_left = 1
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['backup-timeout', 'stale-backup-lock-cleared'])
        # The app is serving again before the clean-up, which still runs under the deploy lock.
        self.assertLess(self.events.index('docker-healthy'), self.events.index('clear-stale'))
        self.events.clear()
        self.stale_found = False
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['backup-timeout'])
        self.stale_found = ops.Refused('stale-backup-lock')
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['backup-timeout', 'stale-backup-lock'])
        self.assertTrue(self.running)

    def test_backup_lock_clean_up_needs_a_proven_killed_helper(self):
        self.backup_rc = 1
        with self.assertRaises(ops.Refused):
            self.prod.backup()
        self.assertNotIn('clear-stale', self.events)
        self.events.clear()
        self.helpers_left = 1
        with patch.object(self.prod, 'remove_owned', side_effect=ops.Refused('helper-cleanup-failed')):
            with self.assertRaises(ops.Refused) as caught:
                self.prod.backup()
        self.assertEqual(caught.exception.codes, ['backup-failed', 'helper-cleanup-failed'])
        self.assertNotIn('clear-stale', self.events)

    def test_stale_backup_clean_up_runs_as_the_app_user_on_backups_only(self):
        with patch.object(self.prod, 'isolated_run', return_value=completed('cleared\n')) as run:
            self.assertTrue(ops.Production.clear_stale_backup(self.prod, {'image': IMAGE}))
        args = run.call_args.args
        joined = ' '.join(args)
        for expected in ['--network none', '--user 1000:1000', '--read-only', '--cap-drop ALL', 'no-new-privileges:true',
                         f'type=bind,source={self.fx.deployment / "backups"},target=/backups', '--entrypoint sh ' + IMAGE]:
            self.assertIn(expected, joined)
        self.assertIn('/backups/.bangla-backup.lock /backups/.bangla-snapshot-*', args[-1])
        with patch.object(self.prod, 'isolated_run', return_value=completed('clean\n')):
            self.assertFalse(ops.Production.clear_stale_backup(self.prod, {'image': IMAGE}))
        for result in [completed('cleared\n', 1), completed('')]:
            with patch.object(self.prod, 'isolated_run', return_value=result):
                with self.assertRaisesRegex(ops.Refused, 'stale-backup-lock'):
                    ops.Production.clear_stale_backup(self.prod, {'image': IMAGE})

    def test_stale_backup_script_removes_only_the_backup_lock_and_staging_copies(self):
        with tempfile.TemporaryDirectory() as folder:
            backups = Path(folder)
            (backups / '.bangla-backup.lock').mkdir()
            (backups / '.bangla-snapshot-abc' / 'media').mkdir(parents=True)
            (backups / ARCHIVE).write_bytes(b'archive')
            (backups / '.latest-backup.json').write_text('{}')
            script = ops.CLEAR_STALE_SCRIPT.replace('/backups/', str(backups) + '/')
            self.assertEqual(subprocess.run(['sh', '-c', script], capture_output=True, text=True, check=True).stdout.split(), ['cleared'])
            self.assertEqual(sorted(path.name for path in backups.iterdir()), ['.latest-backup.json', ARCHIVE])
            self.assertEqual(subprocess.run(['sh', '-c', script], capture_output=True, text=True, check=True).stdout.split(), ['clean'])

    def test_a_stop_request_is_recorded_as_interrupted_by_the_entry_point(self):
        self.backup_rc = ops.Stopped()
        with patch.object(ops, 'Production', return_value=self.prod), patch.object(ops.sys, 'stdout'):
            self.assertEqual(ops.main(['production-ops.py', 'backup']), 1)
        self.assertEqual(self.fx.report('backup')['codes'], ['interrupted'])
        with patch.object(ops, 'Production', return_value=self.prod), patch.object(self.prod, 'backup', side_effect=ops.Stopped()), \
                patch.object(ops.sys, 'stdout'):
            self.assertEqual(ops.main(['production-ops.py', 'backup']), 1)
        self.assertEqual(self.fx.report('backup')['codes'], ['interrupted'])

    def test_partial_stop_still_attempts_recovery_without_a_backup(self):
        def stop(cfg, *args, **kwargs):
            if args[0] == 'stop':
                self.running = False
                self.events.append('partial-stop')
                raise ops.Refused('command-failed')
            return self.compose(cfg, *args, **kwargs)
        with patch.object(self.prod, 'compose', stop):
            with self.assertRaises(ops.Refused) as caught:
                self.prod.backup()
        self.assertEqual(caught.exception.codes, ['app-stop-failed'])
        self.assertNotIn('backup', self.events)
        self.assertTrue(self.running)

    def test_a_stop_request_while_the_app_drains_starts_it_only_after_it_exits(self):
        # The daemon has sent the app its stop signal; it drains while `compose stop` waits, and the stop
        # request kills that command. `up --no-recreate` before the exit would do nothing, and the app would
        # then exit as stopped by hand, which `restart: unless-stopped` never undoes.
        polls = []

        def compose(cfg, *args, **kwargs):
            if args[0] == 'stop':
                self.events.append('stop')
                return ops.Production.command(self.prod, ['sleep', '20'], timeout=60)
            if args[0] == 'up':
                self.assertFalse(self.running, 'the app is started only once it has exited')
            return self.compose(cfg, *args, **kwargs)

        def containers(cfg):
            if 'stop' in self.events and self.running:
                polls.append('running')
                if len(polls) == 3:
                    self.running = False
                    self.events.append('exited')
            return [container(running=self.running)]
        with patch.object(self.prod, 'compose', compose), patch.object(self.prod, 'containers', containers), \
                patch.object(ops.time, 'sleep', lambda seconds: self.events.append('wait')):
            with StopHandlers() as handlers:
                handlers.stop_after(0.5)
                began = time.monotonic()
                with self.assertRaises(ops.Refused) as caught:
                    self.prod.backup()
                self.assertLess(time.monotonic() - began, 10)
        self.assertEqual(caught.exception.codes, ['interrupted'])
        self.assertEqual(self.events[self.events.index('stop'):],
                         ['stop', 'helpers-gone', 'wait', 'wait', 'exited', 'up', 'health', 'docker-healthy'])
        self.assertEqual(self.events.count('stop'), 1, 'the stop is waited for, not repeated')
        self.assertTrue(self.running)

    def test_a_stop_that_never_reached_the_daemon_is_waited_for_only_within_the_grace_period(self):
        clock = [1000.0]

        def compose(cfg, *args, **kwargs):
            if args[0] == 'stop':
                self.events.append('stop')
                raise ops.Stopped()  # Before the command reached the daemon: the app keeps serving.
            return self.compose(cfg, *args, **kwargs)

        def sleep(seconds):
            clock[0] += seconds
        with patch.object(self.prod, 'compose', compose), patch.object(ops.time, 'monotonic', lambda: clock[0]), patch.object(ops.time, 'sleep', sleep):
            with self.assertRaises(ops.Refused) as caught:
                self.prod.backup()
        self.assertEqual(caught.exception.codes, ['interrupted'])
        # Docker would have killed an app it was asked to stop by then; this one is left running.
        self.assertGreaterEqual(clock[0] - 1000.0, ops.STOP_GRACE + ops.STOP_MARGIN)
        self.assertLess(clock[0] - 1000.0, ops.STOP_GRACE + ops.STOP_MARGIN + 5)
        self.assertEqual(self.events.count('stop'), 1)
        self.assertEqual(self.events[-3:], ['up', 'health', 'docker-healthy'])
        self.assertTrue(self.running)

    def test_waiting_for_the_stop_follows_the_grace_period_and_rides_out_docker_errors(self):
        self.assertIn(f'stop_grace_period: {ops.STOP_GRACE}s\n', (ROOT / 'compose.yaml').read_text())
        states = iter([ops.Refused('command-failed'), True, False])

        def containers(cfg):
            state = next(states)
            if isinstance(state, BaseException):
                raise state
            return [container(running=state)]
        with patch.object(self.prod, 'containers', containers), patch.object(ops.time, 'sleep'):
            self.assertTrue(ops.Production.wait_until_stopped(self.prod, {'project': 'p'}, 60))
        with patch.object(self.prod, 'containers', lambda cfg: [container()]), patch.object(ops.time, 'sleep'), \
                patch.object(ops.time, 'monotonic', side_effect=[0, 0, 61]):
            self.assertFalse(ops.Production.wait_until_stopped(self.prod, {'project': 'p'}, 60))

    def test_a_stop_request_before_the_stop_never_stops_the_app(self):
        def serving(cfg, timeout):
            raise ops.Stopped()
        with patch.object(self.prod, 'wait_until_serving', serving):
            with self.assertRaises(ops.Stopped):
                self.prod.backup()
        self.assertNotIn('stop', self.events)
        self.assertNotIn('up', self.events)
        self.assertTrue(self.running)

    def test_a_stale_backup_lock_is_cleared_at_the_start_while_the_app_still_serves(self):
        self.stale_at_start = True
        value = self.prod.backup()
        self.assertEqual((value['status'], value['verified'], value['codes']), ('passed', True, ['stale-backup-lock-cleared-at-start']))
        self.assertEqual(self.events[:4], ['prepare', 'clear-start', 'serving', 'stop'])
        self.assertEqual(self.fx.report('backup')['codes'], ['stale-backup-lock-cleared-at-start'])
        # A passing run with the notice keeps status healthy, and shows the code.
        status = StatusTests().status(reports=StatusTests().reports(backup={**self.fx.report('backup'), 'checkedAtEpoch': NOW - 60}))
        self.assertEqual((status['verified'], status['backup']['codes']), (True, ['stale-backup-lock-cleared-at-start']))

    def test_the_clean_up_at_the_start_is_reported_by_a_failing_run_too(self):
        self.stale_at_start = True
        self.backup_rc = 1
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['backup-failed', 'stale-backup-lock-cleared-at-start'])
        self.events.clear()

        def unhealthy(cfg, timeout):
            raise ops.Refused('app-unhealthy-before-backup')
        # A run that never recovered may have left the app stopped too: the lock is cleared all the same,
        # so the deploy that starts the app again is not refused by it.
        with patch.object(self.prod, 'wait_until_serving', unhealthy):
            with self.assertRaises(ops.Refused) as caught:
                self.prod.backup()
        self.assertEqual(caught.exception.codes, ['app-unhealthy-before-backup', 'stale-backup-lock-cleared-at-start'])
        self.assertEqual(self.events, ['prepare', 'clear-start'])

    def test_a_running_backup_writer_means_the_lock_is_not_stale(self):
        self.writer = True
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['backup-helper-running'])
        self.assertEqual(self.events, ['prepare'])
        self.writer, self.stale_at_start = False, ops.Refused('stale-backup-lock')
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['stale-backup-lock'])
        self.assertNotIn('stop', self.events)

    def test_backup_writers_are_running_containers_with_backups_mounted_writable(self):
        backups = str(self.fx.deployment / 'backups')
        ids = {'helper': 'a' * 64, 'deploy': 'b' * 64, 'reader': 'c' * 64}
        mounts = {ids['helper']: [{'Type': 'bind', 'Source': backups, 'Destination': '/backups', 'RW': True}],
                  ids['deploy']: [{'Type': 'bind', 'Source': backups, 'Destination': '/backups', 'RW': True},
                                  {'Type': 'volume', 'Name': 'bangla-adventures_bangla-data', 'Destination': '/app/.data', 'RW': True}],
                  ids['reader']: [{'Type': 'bind', 'Source': backups, 'Destination': '/backups', 'RW': False}]}
        for listed, expected in [({}, False), ({'label': ['reader']}, False), ({'label': ['reader', 'helper']}, True),
                                 ({'volume': ['deploy']}, True), ({'volume': ['reader']}, False)]:
            calls = []

            def docker(*args, **kwargs):
                calls.append(args)
                kind = args[-1].split('=', 1)[0]
                return completed('\n'.join(ids[name] for name in listed.get(kind, [])))
            with patch.object(self.prod, 'docker', docker), patch.object(self.prod, 'inspect', lambda kind, cid: {'Mounts': mounts[cid]}):
                self.assertIs(ops.Production.backup_writer_running(self.prod), expected, listed)
            # Running containers only, found by this tool's label and by the bind mount.
            self.assertEqual(calls, [('ps', '--quiet', '--no-trunc', '--filter', 'label=io.bangla.scope=' + ops.SCOPE),
                                     ('ps', '--quiet', '--no-trunc', '--filter', 'volume=' + backups)])

    def test_resume_failure_is_reported_even_after_a_good_backup(self):
        self.up_error = ops.Refused('command-failed')
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['resume-failed'])
        self.up_error, self.healthy_again = None, False
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['resume-failed'])
        self.backup_rc = 1
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['backup-failed', 'resume-failed'])

    def test_serving_but_never_healthy_in_docker_is_a_failed_resume(self):
        self.docker_healthy = False
        with self.assertRaises(ops.Refused) as caught:
            self.prod.backup()
        self.assertEqual(caught.exception.codes, ['resume-failed'])

    def test_waiting_for_docker_health_reads_the_app_container(self):
        states = iter([{'Running': True, 'Health': {'Status': 'starting'}}, {'Running': True, 'Health': {'Status': 'healthy'}}])
        with patch.object(self.prod, 'containers', lambda cfg: [{**container(), 'State': next(states)}]), patch.object(ops.time, 'sleep'):
            self.assertTrue(ops.Production.wait_until_healthy(self.prod, {'project': 'p'}, 60))
        with patch.object(self.prod, 'containers', lambda cfg: [{**container(), 'State': {'Running': True, 'Health': {'Status': 'unhealthy'}}}]), \
                patch.object(ops.time, 'sleep'), patch.object(ops.time, 'monotonic', side_effect=[0, 0, 61]):
            self.assertFalse(ops.Production.wait_until_healthy(self.prod, {'project': 'p'}, 60))

    def test_helper_cleanup_failure_still_resumes_and_is_reported(self):
        def cleanup(token):
            raise ops.Refused('helper-cleanup-failed')
        with patch.object(self.prod, 'remove_owned', cleanup):
            with self.assertRaises(ops.Refused) as caught:
                self.prod.backup()
        self.assertEqual(caught.exception.codes, ['helper-cleanup-failed'])
        self.assertTrue(self.running)

    def test_unhealthy_app_is_never_stopped(self):
        def unhealthy(cfg, timeout):
            raise ops.Refused('app-unhealthy-before-backup')
        with patch.object(self.prod, 'wait_until_serving', unhealthy):
            with self.assertRaisesRegex(ops.Refused, 'app-unhealthy-before-backup'):
                self.prod.backup()
        self.assertNotIn('stop', self.events)

    def test_low_disk_is_refused_before_stopping(self):
        with patch.object(self.prod, 'free_bytes', return_value=ops.MIN_FREE_BYTES - 1):
            with self.assertRaisesRegex(ops.Refused, 'disk-low'):
                self.prod.backup()
        self.assertNotIn('stop', self.events)

    def test_a_receipt_for_another_archive_is_not_a_verified_backup(self):
        with patch.object(self.prod, 'receipt', return_value={'present': True, 'archive': ARCHIVE.replace('0123', '9999'), 'sha256': 'b' * 64, 'bytes': 1, 'createdEpoch': NOW}):
            with self.assertRaisesRegex(ops.Refused, 'backup-unverified'):
                self.prod.backup()
        self.assertTrue(self.running)

    def test_failed_backup_is_recorded_by_the_entry_point(self):
        self.backup_rc = 1
        with patch.object(ops, 'Production', return_value=self.prod), patch.object(ops.sys, 'stdout'):
            self.assertEqual(ops.main(['production-ops.py', 'backup']), 1)
        report = self.fx.report('backup')
        self.assertEqual((report['status'], report['codes']), ('failed', ['backup-failed']))

    def test_backup_output_must_be_a_verified_archive(self):
        good = {'archive': '/backups/' + ARCHIVE, 'sha256': 'c' * 64, 'files': 2, 'verified': True}
        self.assertEqual(ops.backup_output('noise\n' + json.dumps(good) + '\n')['archive'], ARCHIVE)
        for change in [dict(archive='/elsewhere/' + ARCHIVE), dict(archive='/backups/other.tar.gz'), dict(verified=False), dict(sha256='x')]:
            with self.assertRaisesRegex(ops.Refused, 'backup-unverified'):
                ops.backup_output(json.dumps({**good, **change}))


class ReceiptScriptTests(unittest.TestCase):
    """The container's receipt reader, run against a real archive made by backup_restore.py."""

    def test_read_and_verify_modes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'media').mkdir()
            (root / 'media/clip.mp3').write_bytes(b'audio')
            with sqlite3.connect(root / 'app.db') as db:
                db.execute('create table t(x)')
            backups = root / 'backups'
            env = {**os.environ, 'DATABASE_PATH': str(root / 'app.db'), 'MEDIA_ROOT': str(root / 'media')}
            made = subprocess.run([sys.executable, 'scripts/backup_restore.py', 'backup', str(backups), '14', '--application-stopped'],
                                  cwd=ROOT, env=env, capture_output=True, text=True, check=True)
            archive = Path(json.loads(made.stdout)['archive']).name
            script = ops.RECEIPT_SCRIPT.replace("pathlib.Path('/backups')", f'pathlib.Path({str(backups)!r})')
            def run(mode):
                result = subprocess.run([sys.executable, '-', mode], input=script, cwd=ROOT, capture_output=True, text=True, check=True)
                return json.loads(result.stdout)
            read = run('read')
            self.assertEqual((read['present'], read['archive'], read['backupLock']), (True, archive, False))
            checked = run('verify')
            self.assertTrue(checked['sha256Matches'] and checked['verified'])
            prod = ops.Production(ops.Settings({'PRODUCTION_OPS_DEPLOYMENT_DIR': folder, 'PRODUCTION_OPS_UID': str(os.getuid())}))
            for verify, raw in [(False, read), (True, checked)]:
                with patch.object(prod, 'isolated_run', return_value=completed(json.dumps(raw))):
                    value = prod.receipt({'image': IMAGE}, verify=verify)
                self.assertTrue(value['present'])
                self.assertIs(value['backupLock'], False)
                self.assertLess(abs(value['createdEpoch'] - ops.time.time()), 600)
            # A lock that outlived its backup is seen in the same read, with or without a receipt.
            (backups / '.bangla-backup.lock').mkdir()
            self.assertIs(run('read')['backupLock'], True)
            with patch.object(prod, 'isolated_run', return_value=completed(json.dumps(run('read')))):
                self.assertIs(prod.receipt({'image': IMAGE}, verify=False)['backupLock'], True)
            (backups / archive).write_bytes(b'tampered')
            self.assertFalse(run('verify')['sha256Matches'])
            (backups / '.latest-backup.json').unlink()
            self.assertEqual(run('read'), {'present': False, 'backupLock': True})
            with patch.object(prod, 'isolated_run', return_value=completed(json.dumps(run('read')))):
                self.assertEqual(prod.receipt({'image': IMAGE}, verify=False), {'present': False, 'backupLock': True})
            (backups / '.bangla-backup.lock').rmdir()
            self.assertEqual(run('read'), {'present': False, 'backupLock': False})


class OffsiteTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.fx = Fixture(self.folder.name)
        self.prod = self.fx.production()
        self.calls = []
        self.forget_rc = 0
        self.patches = [patch.object(self.prod, 'safe_group', return_value=os.getgid()), patch.object(self.prod, 'platform', lambda: None),
                        patch.object(self.prod, 'receipt', lambda cfg, verify: self.latest())]
        for item in self.patches:
            item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])
        self.created = ops.time.time() - 600

    def latest(self):
        return {'present': True, 'archive': ARCHIVE, 'sha256': 'd' * 64, 'bytes': 4096, 'verified': True, 'createdEpoch': self.created}

    def configure(self, lines=('RESTIC_REPOSITORY=s3:s3.amazonaws.com/bucket/bangla', 'AWS_ACCESS_KEY_ID=fixture-id', 'AWS_SECRET_ACCESS_KEY=fixture-secret'),
                  env_mode=0o600, password_mode=0o640):
        env = self.fx.offsite / 'offsite.env'
        env.write_text('# client destination\n' + '\n'.join(lines) + '\n')
        env.chmod(env_mode)
        password = self.fx.offsite / 'restic-password'
        password.write_text('fixture-password\n')
        password.chmod(password_mode)

    def restic(self, conf, *args, timeout=600):
        self.calls.append(args)
        command = args[2]
        if command == 'backup':
            return completed(json.dumps({'message_type': 'summary', 'snapshot_id': 'e' * 64}) + '\n')
        if command == 'snapshots':
            return completed(json.dumps([{'id': 'e' * 64, 'paths': ['/backups/' + ARCHIVE], 'hostname': ops.RESTIC_HOST, 'tags': [ops.RESTIC_TAG]}]))
        if command == 'forget':
            return completed(returncode=self.forget_rc)
        self.fail(args)

    def test_inert_without_the_settings_file(self):
        with patch.object(self.prod, 'docker', side_effect=AssertionError('no Docker before configuration')):
            value = self.prod.offsite()
        self.assertEqual((value['status'], value['verified']), ('not-configured', True))
        self.assertIsNone(self.fx.report('offsite'))

    def test_insecure_or_missing_files_are_refused(self):
        cases = [dict(env_mode=0o640), dict(env_mode=0o604), dict(password_mode=0o600), dict(password_mode=0o644), dict(password_mode=0o660), dict(password_mode=0o740)]
        for case in cases:
            self.configure(**case)
            with self.assertRaisesRegex(ops.Refused, 'offsite-file-insecure'):
                self.prod.offsite_settings()
        self.configure()
        with patch.object(self.prod, 'safe_group', return_value=None):
            with self.assertRaisesRegex(ops.Refused, 'offsite-file-insecure'):
                self.prod.offsite_settings()
        with patch.object(self.prod, 'safe_group', return_value=os.getgid() + 1):
            with self.assertRaisesRegex(ops.Refused, 'offsite-file-insecure'):
                self.prod.offsite_settings()
        self.fx.offsite.chmod(0o777)
        with self.assertRaisesRegex(ops.Refused, 'offsite-file-insecure'):
            self.prod.offsite_settings()
        self.fx.offsite.chmod(0o700)
        (self.fx.offsite / 'restic-password').unlink()
        with self.assertRaisesRegex(ops.Refused, 'offsite-file-missing'):
            self.prod.offsite_settings()

    def test_only_environment_configured_backends_over_https(self):
        for repository in ['s3:s3.amazonaws.com/bucket', 's3:https://s3.example.org/bucket', 'b2:bucket:bangla', 'rest:https://backup.example.org:8000/bangla',
                           'azure:container:/bangla']:
            self.configure(lines=['RESTIC_REPOSITORY=' + repository])
            self.assertIsNone(self.prod.offsite_settings()['retention'])
        for repository in ['sftp:user@backup.example.org:/srv', 'local:/srv/restic', '/srv/restic', 'rclone:remote:bangla', 'rest:http://backup.example.org/',
                           's3:http://s3.example.org/bucket', 'swift:container:/']:
            self.configure(lines=['RESTIC_REPOSITORY=' + repository])
            with self.assertRaisesRegex(ops.Refused, 'offsite-backend-unsupported'):
                self.prod.offsite_settings()
        self.configure(lines=['RESTIC_REPOSITORY=gs:bucket:/bangla', 'GOOGLE_PROJECT_ID=fixture'])
        with self.assertRaisesRegex(ops.Refused, 'offsite-file-missing'):
            self.prod.offsite_settings()
        key = self.fx.offsite / 'gcs-key.json'
        key.write_text('{}')
        key.chmod(0o640)
        self.assertEqual(self.prod.offsite_settings()['gcsKey'], key)

    def test_password_commands_unknown_names_and_quoted_values_are_refused(self):
        base = 'RESTIC_REPOSITORY=b2:bucket:bangla'
        for line in ['RESTIC_PASSWORD=inline', 'RESTIC_PASSWORD_COMMAND=cat /etc/shadow', 'RESTIC_PASSWORD_FILE=/elsewhere', 'LD_PRELOAD=/tmp/x.so',
                     'B2_ACCOUNT_KEY="quoted"', 'B2_ACCOUNT_KEY= padded', 'B2_ACCOUNT_KEY', base]:
            self.configure(lines=[base, line])
            with self.assertRaisesRegex(ops.Refused, 'offsite-settings-invalid'):
                self.prod.offsite_settings()

    def test_retention_needs_all_three_positive_values(self):
        base = ['RESTIC_REPOSITORY=b2:bucket:bangla']
        for keep in [['RESTIC_KEEP_DAILY=14'], ['RESTIC_KEEP_DAILY=14', 'RESTIC_KEEP_WEEKLY=8'],
                     ['RESTIC_KEEP_DAILY=0', 'RESTIC_KEEP_WEEKLY=8', 'RESTIC_KEEP_MONTHLY=6'],
                     ['RESTIC_KEEP_DAILY=14', 'RESTIC_KEEP_WEEKLY=eight', 'RESTIC_KEEP_MONTHLY=6'],
                     ['RESTIC_KEEP_DAILY=14', 'RESTIC_KEEP_WEEKLY=8', 'RESTIC_KEEP_MONTHLY=-6']]:
            self.configure(lines=base + keep)
            with self.assertRaisesRegex(ops.Refused, 'offsite-retention-invalid'):
                self.prod.offsite_settings()
        self.configure(lines=base + ['RESTIC_KEEP_DAILY=14', 'RESTIC_KEEP_WEEKLY=8', 'RESTIC_KEEP_MONTHLY=6'])
        self.assertEqual(self.prod.offsite_settings()['retention'], (14, 8, 6))

    def test_sends_only_the_receipts_archive_then_applies_opted_in_retention(self):
        self.configure(lines=['RESTIC_REPOSITORY=b2:bucket:bangla', 'B2_ACCOUNT_ID=id', 'B2_ACCOUNT_KEY=key',
                              'RESTIC_KEEP_DAILY=14', 'RESTIC_KEEP_WEEKLY=8', 'RESTIC_KEEP_MONTHLY=6'])
        with patch.object(self.prod, 'restic', self.restic), patch.object(self.prod, 'env_settings', return_value={'image': IMAGE}):
            value = self.prod.offsite()
        self.assertEqual((value['status'], value['copy']['snapshotId'], value['retention']['applied']), ('passed', 'e' * 64, True))
        backup, = [call for call in self.calls if call[2] == 'backup']
        self.assertEqual(backup[-2:], ('--', '/backups/' + ARCHIVE))
        self.assertEqual(backup[backup.index('--host') + 1], ops.RESTIC_HOST)
        self.assertEqual(backup[backup.index('--tag') + 1], 'bangla-adventures')
        forget, = [call for call in self.calls if call[2] == 'forget']
        self.assertEqual(forget[3:], ('--tag', 'bangla-adventures', '--host', ops.RESTIC_HOST, '--group-by', 'host,tags',
                                      '--keep-daily', '14', '--keep-weekly', '8', '--keep-monthly', '6', '--prune'))
        report = self.fx.report('offsite')
        self.assertEqual(report['lastSuccessEpoch'], value['lastSuccessEpoch'])
        self.assertNotIn('bucket', json.dumps(report))

    def test_without_retention_nothing_is_forgotten_and_failures_keep_the_last_success(self):
        self.configure(lines=['RESTIC_REPOSITORY=b2:bucket:bangla'])
        with patch.object(self.prod, 'restic', self.restic), patch.object(self.prod, 'env_settings', return_value={'image': IMAGE}):
            value = self.prod.offsite()
        self.assertEqual([call[2] for call in self.calls], ['backup', 'snapshots'])
        self.assertFalse(value['retention']['configured'])
        failure = ops.failure_value(self.prod, 'offsite', ['offsite-copy-failed'])
        self.assertEqual(failure['lastSuccessEpoch'], value['lastSuccessEpoch'])

    def test_failed_retention_is_a_failure_after_a_good_copy(self):
        self.configure(lines=['RESTIC_REPOSITORY=b2:bucket:bangla', 'RESTIC_KEEP_DAILY=14', 'RESTIC_KEEP_WEEKLY=8', 'RESTIC_KEEP_MONTHLY=6'])
        self.forget_rc = 11
        with patch.object(self.prod, 'restic', self.restic), patch.object(self.prod, 'env_settings', return_value={'image': IMAGE}):
            value = self.prod.offsite()
        self.assertEqual((value['status'], value['codes']), ('failed', ['offsite-repository-locked']))
        self.assertIsNotNone(value['lastSuccessEpoch'])

    def test_retention_that_times_out_keeps_the_copys_success(self):
        self.configure(lines=['RESTIC_REPOSITORY=b2:bucket:bangla', 'RESTIC_KEEP_DAILY=14', 'RESTIC_KEEP_WEEKLY=8', 'RESTIC_KEEP_MONTHLY=6'])
        seen = []

        def restic(conf, *args, timeout=600):
            if args[2] == 'forget':
                # The copy is already recorded as a success before retention starts.
                seen.append(self.fx.report('offsite'))
                raise ops.Refused('command-unavailable-or-timeout')
            return self.restic(conf, *args, timeout=timeout)
        with patch.object(self.prod, 'restic', restic), patch.object(self.prod, 'env_settings', return_value={'image': IMAGE}):
            value = self.prod.offsite()
        self.assertEqual((value['status'], value['codes'], value['copy']['snapshotId']), ('failed', ['offsite-retention-timeout'], 'e' * 64))
        self.assertEqual(seen[0]['status'], 'passed')
        self.assertEqual(seen[0]['lastSuccessEpoch'], value['lastSuccessEpoch'])
        self.assertEqual(self.fx.report('offsite')['lastSuccessEpoch'], value['lastSuccessEpoch'])
        # A stop request during retention keeps the recorded copy too.
        with patch.object(self.prod, 'restic', lambda conf, *args, timeout=600: (_ for _ in ()).throw(ops.Stopped()) if args[2] == 'forget' else self.restic(conf, *args)), \
                patch.object(self.prod, 'env_settings', return_value={'image': IMAGE}), patch.object(ops, 'Production', return_value=self.prod), \
                patch.object(ops.sys, 'stdout'):
            self.assertEqual(ops.main(['production-ops.py', 'offsite']), 1)
        report = self.fx.report('offsite')
        self.assertEqual(report['codes'], ['interrupted'])
        self.assertGreaterEqual(report['lastSuccessEpoch'], value['lastSuccessEpoch'])

    def test_the_run_stays_inside_the_units_time_budget(self):
        self.configure(lines=['RESTIC_REPOSITORY=b2:bucket:bangla', 'RESTIC_KEEP_DAILY=14', 'RESTIC_KEEP_WEEKLY=8', 'RESTIC_KEEP_MONTHLY=6'])
        clock = [1000.0]
        timeouts = {}

        def restic(conf, *args, timeout=600):
            timeouts[args[2]] = timeout
            clock[0] += {'backup': copying, 'snapshots': 100}.get(args[2], 0)
            return self.restic(conf, *args, timeout=timeout)
        # A copy that takes three hours leaves retention only what is left of the budget.
        copying = 3 * 3600 - 100
        with patch.object(ops.time, 'monotonic', lambda: clock[0]), patch.object(self.prod, 'restic', restic), \
                patch.object(self.prod, 'env_settings', return_value={'image': IMAGE}):
            value = self.prod.offsite()
        self.assertEqual(timeouts, {'backup': ops.OFFSITE_TIMEOUT, 'snapshots': 600, 'forget': ops.OFFSITE_BUDGET - 3 * 3600})
        self.assertTrue(value['retention']['applied'])
        # The budget, which includes the receipt check, leaves ten minutes of TimeoutStartSec=4h for clean-up.
        self.assertLessEqual(ops.OFFSITE_BUDGET + 10 * 60, 4 * 3600)
        self.assertIn('TimeoutStartSec=4h\n', (ROOT / 'deploy/production-ops/ba-production-offsite.service').read_text())
        # With under a minute left, retention is not started at all.
        clock[0], copying = 1000.0, ops.OFFSITE_BUDGET - 130
        timeouts.clear()
        with patch.object(ops.time, 'monotonic', lambda: clock[0]), patch.object(self.prod, 'restic', restic), \
                patch.object(self.prod, 'env_settings', return_value={'image': IMAGE}):
            value = self.prod.offsite()
        self.assertNotIn('forget', timeouts)
        self.assertEqual(value['codes'], ['offsite-retention-timeout'])
        self.assertIsNotNone(value['lastSuccessEpoch'])

    def test_stale_or_unverified_backups_are_never_sent(self):
        self.configure()
        for created, verified, code in [(ops.time.time() - 37 * 3600, True, 'backup-stale-or-future'),
                                        (ops.time.time() + 3600, True, 'backup-stale-or-future'), (ops.time.time(), False, 'backup-unverified')]:
            self.created = created
            with patch.object(self.prod, 'receipt', lambda cfg, verify: {**self.latest(), 'verified': verified}), \
                    patch.object(self.prod, 'restic', side_effect=AssertionError('nothing may be sent')), patch.object(self.prod, 'env_settings', return_value={'image': IMAGE}):
                with self.assertRaisesRegex(ops.Refused, code):
                    self.prod.offsite()

    def test_restic_exit_codes(self):
        self.assertEqual([ops.restic_code(code, 'offsite-copy-failed') for code in (1, 3, 10, 11, 12)],
                         ['offsite-copy-failed', 'offsite-copy-failed', 'offsite-repository-missing', 'offsite-repository-locked', 'offsite-password-wrong'])

    def test_restic_runs_isolated_with_credentials_only_from_files(self):
        self.configure(lines=['RESTIC_REPOSITORY=b2:bucket:secret-location'])
        conf = self.prod.offsite_settings()
        with patch.object(self.prod, 'isolated_run', return_value=completed()) as run:
            self.prod.restic(conf, 'snapshots', '--json')
        args = run.call_args.args
        joined = ' '.join(args)
        for expected in ['--user 1000:1000', '--read-only', '--cap-drop ALL', 'no-new-privileges:true', '--env-file ' + str(conf['env']),
                         f'type=bind,source={conf["password"]},target=/run/secrets/restic-password,readonly',
                         f'type=bind,source={self.fx.deployment / "backups"},target=/backups,readonly', '--tmpfs /cache:',
                         '--entrypoint /usr/bin/restic ' + ops.RESTIC_IMAGE]:
            self.assertIn(expected, joined)
        self.assertNotIn('secret-location', joined)
        self.assertEqual(args[args.index('--group-add') + 1], str(os.stat(conf['password']).st_gid))


class DeployLockTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.fx = Fixture(self.folder.name)
        self.prod = self.fx.production()

    def test_a_held_deploy_lock_is_seen_without_taking_it(self):
        self.assertFalse(self.prod.deploy_busy())
        fd = self.fx.hold_lock()
        try:
            with patch.object(ops.fcntl, 'flock', side_effect=AssertionError('the monitor never takes the deploy lock')):
                self.assertTrue(self.prod.deploy_busy())
        finally:
            os.close(fd)
        self.assertFalse(self.prod.deploy_busy())
        # The deploy's own shell acquisition, as in deploy-remote.sh.
        holder = subprocess.Popen(['bash', '-c', 'exec 9> .deploy.lock; flock -n 9; echo held; sleep 30'], cwd=self.fx.deployment,
                                  stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'held')
            self.assertTrue(self.prod.deploy_busy())
        finally:
            holder.kill()
            holder.wait()

    def test_watching_the_lock_never_makes_a_deploy_fail(self):
        stop = threading.Event()

        def watch():
            while not stop.is_set():
                self.prod.deploy_busy()
        watcher = threading.Thread(target=watch)
        watcher.start()
        refused = 0
        try:
            for _ in range(2000):
                fd = os.open(self.fx.deployment / '.deploy.lock', os.O_RDWR)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    refused += 1
                finally:
                    os.close(fd)
        finally:
            stop.set()
            watcher.join()
        self.assertEqual(refused, 0)

    def test_lock_table_parsing(self):
        info = (self.fx.deployment / '.deploy.lock').stat()
        key = f'{os.major(info.st_dev):02x}:{os.minor(info.st_dev):02x}:{info.st_ino}'
        other = f'{os.major(info.st_dev):02x}:{os.minor(info.st_dev):02x}:{info.st_ino + 1}'
        # btrfs subvolumes and some overlay set-ups: the kernel names another device than stat does.
        device = f'{(os.major(info.st_dev) + 1) % 256:02x}:{(os.minor(info.st_dev) + 7) % 256:02x}:{info.st_ino}'
        for table, busy in [(f'1: FLOCK  ADVISORY  WRITE 4242 {key} 0 EOF\n', True), (f'1: POSIX  ADVISORY  WRITE 4242 {key} 0 EOF\n', False),
                            (f'1: FLOCK  ADVISORY  WRITE 4242 {other} 0 EOF\n', False), (f'1: -> FLOCK  ADVISORY  WRITE 4243 {key} 0 EOF\n', False),
                            (f'1: FLOCK  ADVISORY  WRITE 4242 {device} 0 EOF\n', True),
                            (f'1: FLOCK  ADVISORY  WRITE 4242 00:2e:1{info.st_ino} 0 EOF\n', False),
                            (f'7: POSIX  ADVISORY  WRITE 99 {key} 0 EOF\n8: FLOCK  ADVISORY  WRITE 4242 {device} 0 EOF\n', True), ('', False)]:
            with patch.object(ops.Path, 'read_text', return_value=table):
                self.assertIs(self.prod.deploy_busy(), busy, table)
        with patch.object(ops.Path, 'read_text', side_effect=PermissionError()):
            with self.assertRaisesRegex(ops.Refused, 'lock-state-unreadable'):
                self.prod.deploy_busy()


class MonitorRunTests(unittest.TestCase):
    """The monitor job around its pure checks, with Docker's answers stubbed."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.fx = Fixture(self.folder.name)
        self.prod = self.fx.production()
        now = ops.time.time()
        self.prod.write_status('backup', {'scope': ops.SCOPE, 'action': 'backup', 'status': 'passed', 'verified': True, 'checkedAtEpoch': now, 'codes': []})
        self.busy = [False, False]
        self.latest = {'present': True, 'archive': ARCHIVE, 'sha256': 'b' * 64, 'bytes': 1, 'createdEpoch': now - 60, 'backupLock': False}

        def receipt(cfg, verify):
            if isinstance(self.latest, BaseException):
                raise self.latest
            return self.latest
        self.patches = [patch.object(self.prod, 'platform', lambda: None), patch.object(self.prod, 'deploy_busy', lambda: self.busy.pop(0)),
                        patch.object(self.prod, 'containers', return_value=[container()]), patch.object(self.prod, 'receipt', receipt),
                        patch.object(self.prod, 'loopback_health', return_value=True), patch.object(self.prod, 'free_bytes', return_value=5 * 1024 ** 3),
                        patch.object(self.prod, 'public_facts', return_value={'health': True, 'certificateExpiresEpoch': now + 60 * 86400})]
        for item in self.patches:
            item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])

    def test_a_healthy_deployment_passes(self):
        value = self.prod.monitor()
        self.assertEqual((value['status'], value['codes'], value['checks']['backupLockClear']), ('healthy', [], True))

    def test_a_backup_lock_while_the_deploy_lock_is_free_is_reported(self):
        self.latest = {**self.latest, 'backupLock': True}
        value = self.prod.monitor()
        self.assertEqual((value['status'], value['codes']), ('failed', ['stale-backup-lock-found']))
        self.assertEqual(self.fx.report('monitor')['codes'], ['stale-backup-lock-found'])
        self.assertEqual(self.busy, [], 'the deploy lock is read again before the failure is recorded')

    def test_a_backup_lock_held_by_a_deploy_that_just_started_defers(self):
        self.latest, self.busy = {**self.latest, 'backupLock': True}, [False, True]
        with self.assertRaisesRegex(ops.Refused, 'transaction-busy'):
            self.prod.monitor()
        self.assertIsNone(self.fx.report('monitor'))

    def test_an_unreadable_receipt_is_a_missing_backup_not_a_lock(self):
        self.latest = ops.Refused('backup-receipt-unreadable')
        value = self.prod.monitor()
        self.assertEqual(value['codes'], ['backup-missing', 'backup-stale-or-future'])


class StatusTests(unittest.TestCase):
    def reports(self, **changes):
        value = {'backup': {'scope': ops.SCOPE, 'action': 'backup', 'status': 'passed', 'verified': True, 'checkedAtEpoch': NOW - 3600, 'codes': []},
                 'monitor': {'scope': ops.SCOPE, 'action': 'monitor', 'status': 'healthy', 'verified': True, 'checkedAtEpoch': NOW - 120, 'codes': []},
                 'offsite': {'scope': ops.SCOPE, 'action': 'offsite', 'status': 'passed', 'verified': True, 'checkedAtEpoch': NOW - 1800, 'codes': [], 'lastSuccessEpoch': NOW - 1800}}
        value.update(changes)
        return value

    def status(self, **changes):
        value = {'checkedAtEpoch': NOW, 'installed': True, 'offsiteConfigured': True, 'reports': self.reports(),
                 'timers': {'backup': True, 'monitor': True, 'offsite': True},
                 'services': {'backup': False, 'monitor': False, 'offsite': False}, 'lingering': True}
        value.update(changes)
        return ops.evaluate_status(value)

    def test_all_fresh_and_passing_is_healthy(self):
        value = self.status()
        self.assertEqual((value['status'], value['verified'], value['codes']), ('healthy', True, []))
        self.assertEqual(set(value), {'scope', 'action', 'verified', 'status', 'checkedAtEpoch', 'codes', 'installed', 'backup', 'monitor', 'offsite',
                                      'timers', 'servicesFailed', 'lingering'})
        self.assertEqual(value['offsite']['lastSuccessEpoch'], NOW - 1800)

    def test_unconfigured_offsite_is_not_a_failure(self):
        value = self.status(offsiteConfigured=False, reports=self.reports(offsite=None))
        self.assertTrue(value['verified'])
        self.assertEqual(value['offsite']['status'], 'not-configured')

    def test_failing_missing_and_stale_parts_fail_the_aggregate(self):
        failed_monitor = {**self.reports()['monitor'], 'status': 'failed', 'verified': False, 'codes': ['disk-low', 'Not A Code']}
        cases = [
            (dict(reports=self.reports(monitor=None)), 'monitor-report-missing'),
            (dict(reports=self.reports(monitor={**self.reports()['monitor'], 'checkedAtEpoch': NOW - 21 * 60})), 'monitor-report-stale'),
            (dict(reports=self.reports(monitor=failed_monitor)), 'monitor-report-failed'),
            (dict(reports=self.reports(backup={**self.reports()['backup'], 'checkedAtEpoch': NOW - 49 * 3600})), 'backup-report-stale'),
            (dict(reports=self.reports(backup={**self.reports()['backup'], 'status': 'failed', 'verified': False})), 'backup-report-failed'),
            (dict(reports=self.reports(offsite=None)), 'offsite-report-missing'),
            (dict(reports=self.reports(offsite={**self.reports()['offsite'], 'checkedAtEpoch': NOW - 49 * 3600})), 'offsite-report-stale'),
            (dict(timers={'backup': True, 'monitor': True, 'offsite': False}), 'timer-inactive-offsite'),
            (dict(lingering=False), 'user-linger-disabled'), (dict(installed=False), 'installation-invalid'),
            # A run systemd killed writes nothing; its unit stays failed while the old result still looks good.
            (dict(services={'backup': True, 'monitor': False, 'offsite': False}), 'service-failed-backup'),
            (dict(services={'backup': False, 'monitor': False, 'offsite': True}), 'service-failed-offsite'),
        ]
        for change, code in cases:
            value = self.status(**change)
            self.assertFalse(value['verified'], change)
            self.assertIn(code, value['codes'])
        value = self.status(reports=self.reports(monitor=failed_monitor))
        self.assertEqual(value['monitor']['codes'], ['disk-low', 'invalid-report'])

    def test_status_reads_the_reports_written_by_the_jobs(self):
        with tempfile.TemporaryDirectory() as folder:
            fx = Fixture(folder)
            prod = fx.production()
            for name, report in self.reports().items():
                prod.write_status(name, {**report, 'checkedAtEpoch': ops.time.time()})
            (fx.offsite / 'offsite.env').write_text('RESTIC_REPOSITORY=b2:x:y\n')
            with patch.object(prod, 'validate_installation'), patch.object(prod, 'timer_active', return_value=True), patch.object(prod, 'lingering', return_value=True), \
                    patch.object(prod, 'service_failed', return_value=False):
                value = prod.status()
            self.assertEqual(value['status'], 'healthy', value)
            calls = []
            with patch.object(prod, 'validate_installation'), patch.object(prod, 'timer_active', return_value=True), patch.object(prod, 'lingering', return_value=True), \
                    patch.object(prod, 'userctl', lambda *args: calls.append(args) or completed(returncode=0 if args[2] == 'ba-production-backup.service' else 1)):
                value = prod.status()
            self.assertEqual(value['codes'], ['service-failed-backup'])
            self.assertIn(('is-failed', '--quiet', 'ba-production-offsite.service'), calls)
            for name in ('backup', 'monitor', 'offsite'):
                self.assertEqual(oct((fx.deployment / 'ops' / f'last-{name}.json').stat().st_mode & 0o777), '0o600')


class InstallerTests(unittest.TestCase):
    def install_fixture(self, folder):
        root = Path(folder)
        source = root / 'payload'
        source.mkdir()
        fx = Fixture(folder)
        (fx.deployment / 'ops' / 'tools').mkdir(mode=0o700)
        config = root / 'units'
        config.mkdir()
        for name in (*installer.ops.TOOLS, *installer.ops.UNITS):
            (source / name).write_bytes(installer.MARKER + b'fixture\n')

        class Payload:
            def __str__(self):
                return '/opt/bangla-adventures/ops/.incoming.abcdefghijkl'

            def __truediv__(self, name):
                return source / name
        settings = installer.ops.Settings({key: value for key, value in fx.environ.items() if key != 'PRODUCTION_OPS_OFFSITE_DIR'})
        settings.overridden = False
        return fx, settings, config, Payload()

    def patches(self, fx, settings, config, payload, **extra):
        prod = installer.ops.Production(settings)
        base = {
            'Settings': patch.object(installer.ops, 'Settings', return_value=settings),
            'Production': patch.object(installer.ops, 'Production', return_value=prod),
            'Path': patch.object(installer, 'Path', return_value=payload),
            'private_dir': patch.object(installer.ops, 'private_dir'), 'regular': patch.object(installer.ops, 'regular'),
            'check_user': patch.object(prod, 'check_user'), 'check_docker': patch.object(prod, 'check_docker'),
            'env_settings': patch.object(prod, 'env_settings', return_value={'project': 'bangla-adventures', 'port': 3001, 'image': IMAGE, 'origin': None}),
            'containers': patch.object(prod, 'containers', return_value=[container()]), 'loopback': patch.object(prod, 'loopback_health', return_value=True),
            'lingering': patch.object(prod, 'lingering', return_value=True), 'systemd_dir': patch.object(prod, 'systemd_dir', return_value=config),
            'owned_config': patch.object(installer, 'owned_config'), 'offsite': patch.object(prod, 'offsite_configured', return_value=False),
        }
        base.update(extra)
        return prod, base

    def test_overrides_are_refused_on_the_server(self):
        with patch.dict(os.environ, {'PRODUCTION_OPS_UID': '0'}):
            with self.assertRaisesRegex(installer.ops.Refused, 'overrides-not-allowed'):
                installer.main(['install', '/opt/bangla-adventures/ops/.incoming.abcdefghijkl'])

    def test_payload_path_is_fixed(self):
        with patch.dict(os.environ, {}, clear=False):
            for name in installer.ops.OVERRIDES:
                os.environ.pop(name, None)
            for path in ['/tmp/payload', '/opt/bangla-adventures/backups/.incoming.abcdefghijkl', '/opt/bangla-adventures/ops/.incoming.abc']:
                with self.assertRaisesRegex(installer.ops.Refused, 'payload-path'):
                    installer.main(['install', path])

    def test_busy_installation_lock_does_not_stop_timers_or_replace_files(self):
        with tempfile.TemporaryDirectory() as folder:
            fx, settings, config, payload = self.install_fixture(folder)
            prod, items = self.patches(fx, settings, config, payload)
            items['lock'] = patch.object(prod, 'deploy_lock', side_effect=installer.ops.Refused('transaction-busy'))
            with patch.object(installer, 'userctl') as ctl, patch.object(installer, 'atomic') as replace:
                for item in items.values():
                    item.start()
                try:
                    with self.assertRaisesRegex(installer.ops.Refused, 'transaction-busy'):
                        installer.main(['install', str(payload)])
                finally:
                    for item in reversed(list(items.values())):
                        item.stop()
                ctl.assert_not_called()
                replace.assert_not_called()

    def test_installation_rollback_holds_the_lock_until_restoration_finishes(self):
        with tempfile.TemporaryDirectory() as folder:
            fx, settings, config, payload = self.install_fixture(folder)
            prod, items = self.patches(fx, settings, config, payload)
            events = []
            reloads = 0
            fd = os.open(Path(folder) / 'lock', os.O_RDWR | os.O_CREAT, 0o600)
            real_close = os.close

            def close(value):
                events.append('unlock')
                real_close(value)

            def ctl(prod, *args, **kwargs):
                nonlocal reloads
                if args[0] in ('is-enabled', 'is-active'):
                    return completed(returncode=1)
                if args[0] == 'daemon-reload':
                    reloads += 1
                    events.append('reload-' + str(reloads))
                    if reloads == 1:
                        raise installer.ops.Refused('forced-reload-failure')
                return completed()
            items['lock'] = patch.object(prod, 'deploy_lock', return_value=fd)
            items['userctl'] = patch.object(installer, 'userctl', ctl)
            items['close'] = patch.object(installer.os, 'close', close)
            for item in items.values():
                item.start()
            try:
                with self.assertRaisesRegex(installer.ops.Refused, 'forced-reload-failure'):
                    installer.main(['install', str(payload)])
            finally:
                for item in reversed(list(items.values())):
                    item.stop()
            self.assertLess(events.index('reload-2'), events.index('unlock'))
            self.assertEqual(list((fx.deployment / 'ops' / 'tools').iterdir()), [])
            self.assertEqual(list(config.iterdir()), [])
            self.assertFalse((fx.deployment / 'ops' / 'installation.json').exists())

    def initial_run_failure(self, folder, lock_results):
        """An update whose initial backup defers because a deploy took the lock after the commit."""
        fx, settings, config, payload = self.install_fixture(folder)
        prod, items = self.patches(fx, settings, config, payload)
        old = {name: b'# old\n' for name in (*installer.ops.TOOLS, *installer.ops.UNITS)}
        for name in installer.ops.TOOLS:
            (fx.deployment / 'ops' / 'tools' / name).write_bytes(old[name])
        for name in installer.ops.UNITS:
            (config / name).write_bytes(old[name])
        (fx.deployment / 'ops' / 'installation.json').write_text('{"old": true}\n')
        calls = []
        results = iter(lock_results)

        def lock():
            result = next(results)
            if isinstance(result, BaseException):
                raise result
            return os.open(fx.deployment / '.deploy.lock', os.O_RDWR)

        def ctl(prod, *args, **kwargs):
            calls.append(args)
            if args[0] in ('is-enabled', 'is-active'):
                return completed(returncode=0)
            if args[0] == 'show' and args[2] == '--property=FragmentPath':
                return completed(str(config / args[1]))
            if args[0] == 'show':
                return completed('75')
            return completed()
        items.update(lock=patch.object(prod, 'deploy_lock', lock), userctl=patch.object(installer, 'userctl', ctl),
                     validate=patch.object(prod, 'validate_installation'), sleep=patch.object(installer.time, 'sleep'),
                     report=patch.object(prod, 'read_report', return_value=None))
        for item in items.values():
            item.start()
        try:
            with self.assertRaises(installer.InstallFailed) as caught:
                installer.main(['install', str(payload)])
        finally:
            for item in reversed(list(items.values())):
                item.stop()
        return fx, config, old, calls, caught.exception

    def test_rollback_waits_for_a_running_deploy_then_restores_everything(self):
        busy = installer.ops.Refused('transaction-busy')
        with tempfile.TemporaryDirectory() as folder:
            fx, config, old, calls, failure = self.initial_run_failure(folder, [None, busy, busy, None])
            self.assertEqual((failure.codes, failure.rollback), (['initial-backup-deferred'], 'complete'), repr(failure.__cause__))
            for name in installer.ops.TOOLS:
                self.assertEqual((fx.deployment / 'ops' / 'tools' / name).read_bytes(), old[name])
            for name in installer.ops.UNITS:
                self.assertEqual((config / name).read_bytes(), old[name])
            self.assertEqual((fx.deployment / 'ops' / 'installation.json').read_text(), '{"old": true}\n')
            started = [args[1] for args in calls if args[0] == 'start']
            self.assertEqual(started[-3:], list(installer.ops.TIMERS.values()), 'the earlier timers run again')

    def test_rollback_restarts_the_earlier_timers_when_a_deploy_keeps_the_lock(self):
        busy = installer.ops.Refused('transaction-busy')
        with tempfile.TemporaryDirectory() as folder, patch.object(installer, 'ROLLBACK_LOCK_WAIT', 0):
            fx, config, old, calls, failure = self.initial_run_failure(folder, [None, busy])
            self.assertEqual((failure.codes, failure.rollback), (['initial-backup-deferred', 'rollback-incomplete'], 'incomplete'))
            self.assertEqual((fx.deployment / 'ops' / 'tools' / 'production-ops.py').read_bytes(), installer.MARKER + b'fixture\n')
            started = [args[1] for args in calls if args[0] == 'start']
            self.assertEqual(started[-3:], list(installer.ops.TIMERS.values()))

    def test_the_failure_result_says_what_the_rollback_did(self):
        env = {key: value for key, value in os.environ.items() if key not in installer.ops.OVERRIDES}
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/production-ops-install.py'), '/tmp/elsewhere'], capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(result.returncode, 1)
        value = json.loads(result.stdout)
        self.assertEqual((value['codes'], value['rollback']), (['payload-path'], 'none'))

    def test_deferred_failed_or_old_results_cannot_satisfy_an_initial_run(self):
        with tempfile.TemporaryDirectory() as folder:
            fx = Fixture(folder)
            prod = fx.production()
            now = 2_000_000_000
            value = {'scope': installer.ops.SCOPE, 'action': 'backup', 'status': 'passed', 'verified': True, 'checkedAtEpoch': now - 1, 'invocationId': 'f' * 32, 'codes': []}
            prod.write_status('backup', value)
            with patch.object(installer, 'userctl', return_value=completed('0')):
                with self.assertRaisesRegex(installer.ops.Refused, 'initial-operations-check'):
                    installer.fresh_service_result(prod, 'backup', now)
            prod.write_status('backup', {**value, 'checkedAtEpoch': now + 1})
            with patch.object(installer, 'userctl', return_value=completed('75')):
                with self.assertRaisesRegex(installer.ops.Refused, 'initial-backup-deferred'):
                    installer.fresh_service_result(prod, 'backup', now)
            prod.write_status('backup', {**value, 'checkedAtEpoch': now + 1, 'status': 'failed', 'verified': False, 'codes': ['resume-failed']})
            with patch.object(installer, 'userctl', return_value=completed('1')):
                with self.assertRaises(installer.ops.Refused) as caught:
                    installer.fresh_service_result(prod, 'backup', now)
            self.assertEqual(caught.exception.codes, ['initial-backup-failed', 'resume-failed'])
            prod.write_status('backup', {**value, 'checkedAtEpoch': now + 1})
            with patch.object(installer, 'userctl', return_value=completed('0')):
                self.assertEqual(installer.fresh_service_result(prod, 'backup', now)['invocationId'], 'f' * 32)

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
            return installer.ops.grp.struct_group((name, 'x', 1002, members))
        cases = [(group('deployer', []), [user], 1002), (group('deployer', ['deployer']), [user], 1002),
                 (group('deployer', ['someone']), [user], None), (group('staff', []), [user], None),
                 (group('deployer', []), [user, other], None)]
        for entry, users, expected in cases:
            with patch.object(installer.ops.grp, 'getgrgid', return_value=entry), patch.object(installer.ops.pwd, 'getpwall', return_value=users):
                self.assertEqual(installer.ops.private_group(user), expected)

    def test_unsafe_unit_folders_are_named(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder) / 'home'
            home.mkdir(mode=0o700)
            user = installer.ops.pwd.struct_passwd(('deployer', 'x', os.getuid(), os.getgid(), '', str(home), '/bin/bash'))
            prod = installer.ops.Production(installer.ops.Settings({'PRODUCTION_OPS_UID': str(os.getuid())}))
            path = home / '.config/systemd/user'
            with patch.object(installer.ops.pwd, 'getpwuid', return_value=user), patch.object(installer.ops, 'private_group', return_value=None):
                installer.owned_config(prod, path, create=True)
                self.assertTrue(path.is_dir())
                (home / '.config').chmod(0o777)
                with self.assertRaisesRegex(installer.ops.Refused, 'unsafe-unit-directory-config-writable'):
                    installer.owned_config(prod, path)
                (home / '.config').chmod(0o700)
                with self.assertRaisesRegex(installer.ops.Refused, 'user-unit-path'):
                    installer.owned_config(prod, Path('/etc/systemd/system'))


class DocumentationTests(unittest.TestCase):
    def test_every_fixed_failure_code_is_documented(self):
        text = (ROOT / 'docs/PRODUCTION_OPERATIONS.md').read_text()
        documented = set(re.findall(r'`([a-z0-9][a-z0-9-]*)`', text))
        # A family is written as its first code, then the other endings: `timer-inactive-backup`, `-monitor`.
        for first, rest in re.findall(r'`([a-z0-9-]+)`((?:, `-[a-z0-9-]+`)+)', text):
            documented |= {first.rsplit('-', 1)[0] + suffix for suffix in re.findall(r'`(-[a-z0-9-]+)`', rest)}
        codes = set(ops.MONITOR_CODES.values())
        for path in ('scripts/production-ops.py', 'scripts/production-ops-install.py'):
            for node in ast.walk(ast.parse((ROOT / path).read_text())):
                if isinstance(node, ast.Call):
                    name = getattr(node.func, 'attr', getattr(node.func, 'id', ''))
                    values = node.args[1:2] if name == 'require' else node.args if name in ('Refused', 'InstallFailed') else []
                    codes |= {value.value for value in values if isinstance(value, ast.Constant) and isinstance(value.value, str)}
                if isinstance(node, ast.Constant) and isinstance(node.value, str) and re.fullmatch(r'(stale-backup-lock(-[a-z-]+)?|offsite-retention-\w+|rollback-\w+|interrupted|operation-failed|install-failed)', node.value):
                    codes.add(node.value)
        codes |= {f'{name}-report-{kind}' for name in ops.REPORTS for kind in ('missing', 'failed', 'stale')}
        codes |= {f'{prefix}-{name}' for prefix in ('timer-inactive', 'service-failed') for name in ops.REPORTS}
        codes |= {f'initial-{name}-{kind}' for name in ops.REPORTS for kind in ('deferred', 'failed')}
        self.assertEqual(sorted(code for code in codes if code not in documented), [])

    def test_the_manual_restic_commands_mount_the_gcs_key_only_for_gs(self):
        # Pasted for any destination: an unconditional key mount fails ("bind source path does not exist").
        text = (ROOT / 'docs/PRODUCTION_OPERATIONS.md').read_text()
        blocks = re.findall(r'```sh\n(.*?)```', text, re.S)
        configure, = [block for block in blocks if 'restic_options=(' in block]
        uses = [block for block in blocks if 'restic_options[@]' in block and block != configure]
        self.assertTrue(uses, 'the restore commands reuse the options')
        self.assertEqual(text.count('gcs-key.json,target='), 1, 'only the guarded line adds the key')
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder) / 'home'
            settings = home / '.config/bangla-adventures'
            settings.mkdir(parents=True)
            tools = Path(folder) / 'bin'
            tools.mkdir()
            log = Path(folder) / 'docker.log'
            (tools / 'docker').write_text('#!/bin/sh\nprintf "%s\\n" "$@" END >> "$DOCKER_LOG"\n')
            (tools / 'docker').chmod(0o755)
            env = {'HOME': str(home), 'PATH': f'{tools}:/usr/bin:/bin', 'DOCKER_LOG': str(log)}
            for repository, mounted in [('s3:s3.amazonaws.com/bucket', False), ('b2:bucket:bangla', False), ('rest:https://backup.example.org/', False),
                                        ('azure:container:/bangla', False), ('gs:bucket:/bangla', True)]:
                (settings / 'offsite.env').write_text(f'# client destination\nRESTIC_REPOSITORY={repository}\n')
                log.write_text('')
                subprocess.run(['bash', '-c', 'set -euo pipefail\n' + configure + '\n'.join(uses)], env=env, check=True, capture_output=True, text=True)
                runs = log.read_text().split('END\n')[:-1]
                self.assertEqual(len(runs), 1 + sum(block.count('"$restic_image"') for block in uses), repository)
                for run in runs:
                    self.assertIn('target=/run/secrets/restic-password,readonly', run)
                    self.assertEqual('target=/run/secrets/gcs-key.json,readonly' in run, mounted, repository)
                    self.assertEqual('GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcs-key.json' in run, mounted, repository)


class UnitTests(unittest.TestCase):
    folder = ROOT / 'deploy/production-ops'

    def text(self, name):
        return (self.folder / name).read_text()

    def test_exactly_the_managed_user_units_ship(self):
        self.assertEqual(sorted(path.name for path in self.folder.iterdir()), sorted(ops.UNITS))
        for name in ops.UNITS:
            text = self.text(name)
            self.assertTrue(text.encode().startswith(installer.MARKER))
            for forbidden in ('User=', 'Group=', '/etc/systemd/system', 'root', 'PRODUCTION_OPS_'):
                self.assertNotIn(forbidden, text, name)

    def test_services_are_private_journaled_and_treat_deferral_as_success(self):
        for action in ('backup', 'monitor', 'offsite'):
            text = self.text(f'ba-production-{action}.service')
            for line in ('Type=oneshot', 'UMask=0077', 'NoNewPrivileges=true', 'SuccessExitStatus=75', 'StandardOutput=journal',
                         'StandardError=journal', 'Environment=DOCKER_HOST=unix:///run/user/1002/docker.sock',
                         f'ExecStart=/bin/bash /opt/bangla-adventures/ops/tools/production-ops.sh {action}'):
                self.assertIn(line + '\n', text, (action, line))
        for action in ('backup', 'offsite'):
            self.assertIn('KillMode=mixed\n', self.text(f'ba-production-{action}.service'))
        self.assertIn('ConditionPathExists=%h/.config/bangla-adventures/offsite.env\n', self.text('ba-production-offsite.service'))

    def test_schedules_are_utc_and_persistent(self):
        backup, offsite, monitor = (self.text(f'ba-production-{name}.timer') for name in ('backup', 'offsite', 'monitor'))
        self.assertIn('OnCalendar=*-*-* 16:30:00 UTC\n', backup)
        self.assertIn('OnCalendar=*-*-* 17:15:00 UTC\n', offsite)
        for text in (backup, offsite):
            self.assertIn('Persistent=true\n', text)
            self.assertIn('WantedBy=timers.target\n', text)
        self.assertIn('OnUnitActiveSec=5min\n', monitor)
        self.assertNotIn('OnCalendar', monitor)


if __name__ == '__main__':
    unittest.main()
