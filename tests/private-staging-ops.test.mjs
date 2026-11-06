import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('private staging operations prove failure recovery, owned-helper cleanup, monitoring boundaries and fresh systemd receipts', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'private_staging_ops_test.py', '-v'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
