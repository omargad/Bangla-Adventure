"""Isolated backup/restore integration tests; never read deployment data."""
import contextlib
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "backup_restore.py"
spec = importlib.util.spec_from_file_location("backup_restore", SCRIPT)
backup_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_module)


class BackupRestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bangla-backup-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / "external-database" / "production.db"
        self.database.parent.mkdir()
        self.media = self.root / "external-media"
        self.media.mkdir()
        (self.media / "বাংলা.wav").write_bytes(b"recording bytes\0\xff")
        self.conn = sqlite3.connect(self.database)
        self.addCleanup(self.conn.close)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA wal_autocheckpoint=0")
        self.conn.execute("CREATE TABLE samples (id INTEGER PRIMARY KEY, text TEXT)")
        self.conn.execute("INSERT INTO samples(text) VALUES (?)", ("committed in WAL",))
        self.conn.commit()
        self.env = {**os.environ, "DATABASE_PATH": str(self.database), "MEDIA_ROOT": str(self.media)}
        self.output = self.root / "backups"

    def run_cli(self, *args, success=True, env=None):
        result = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                                cwd=self.root, env=env or self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)
        return json.loads(result.stdout) if success else result.stderr

    def make_backup(self, keep=14, **kwargs):
        return Path(self.run_cli("backup", self.output, keep, "--application-stopped", **kwargs)["archive"])

    def rewrite_archive(self, source, name, change):
        target = self.root / name
        with tarfile.open(source, "r:gz") as old, tarfile.open(target, "w:gz") as new:
            for member in old:
                contents = old.extractfile(member).read() if member.isfile() else None
                member, contents = change(member, contents)
                if member is not None:
                    if contents is not None:
                        member.size = len(contents)
                    new.addfile(member, io.BytesIO(contents) if contents is not None else None)
        return target

    def test_external_paths_wal_snapshot_and_restore_roundtrip(self):
        # Keep source connection open so committed data remains in the WAL file.
        self.assertTrue(Path(str(self.database) + "-wal").is_file())
        archive = self.make_backup()
        self.assertEqual(stat.S_IMODE(archive.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        result = self.run_cli("verify", archive)
        self.assertTrue(result["verified"])
        restored = self.root / "restore-drill"
        self.run_cli("restore", archive, restored)
        with contextlib.closing(sqlite3.connect(restored / "bangla-adventures.db")) as db:
            self.assertEqual(db.execute("SELECT text FROM samples").fetchall(), [("committed in WAL",)])
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertEqual((restored / "media/বাংলা.wav").read_bytes(), (self.media / "বাংলা.wav").read_bytes())
        self.assertFalse((restored / "database.sqlite3-wal").exists())
        for path in restored.rglob("*"):
            if path.is_file():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_requires_stopped_writers_and_does_not_create_missing_database(self):
        self.assertIn("Stop all", self.run_cli("backup", self.output, success=False))
        missing = self.root / "does-not-exist.db"
        error = self.run_cli("backup", self.output, "--application-stopped", success=False,
                             env={**self.env, "DATABASE_PATH": str(missing)})
        self.assertIn("does not exist", error)
        self.assertFalse(missing.exists())
        self.assertFalse(self.output.exists())

    def test_missing_media_requires_explicit_empty_override(self):
        env = {**self.env, "MEDIA_ROOT": str(self.root / "missing-media")}
        self.run_cli("backup", self.output, "--application-stopped", success=False, env=env)
        result = self.run_cli("backup", self.output, "--application-stopped", "--media-empty", env=env)
        restored = self.root / "empty-media-restore"
        self.run_cli("restore", result["archive"], restored)
        self.assertEqual(list((restored / "media").iterdir()), [])

    def test_rejects_source_symlinks_and_backup_inside_media(self):
        link = self.media / "external-link"
        link.symlink_to(self.database)
        self.assertIn("link", self.run_cli("backup", self.output, "--application-stopped", success=False))
        link.unlink()
        self.run_cli("backup", self.media / "backups", "--application-stopped", success=False)
        self.assertFalse((self.media / "backups").exists())

    def test_media_walk_permission_failures_are_not_silently_omitted(self):
        # A subprocess running as root would bypass fixture directory permissions;
        # simulate the scandir failure that os.walk normally suppresses instead.
        with mock.patch.object(backup_module.os, "scandir", side_effect=PermissionError("unreadable media")):
            with self.assertRaises(backup_module.BackupError):
                backup_module.media_inventory(self.media)

    def test_retention_only_removes_this_tools_archives(self):
        first = self.make_backup(keep=1)
        unrelated = self.output / "important.tar.gz"
        unrelated.write_bytes(b"keep")
        old_format = self.output / "bangla-data-old.tar.gz"
        old_format.write_bytes(b"keep old format")
        link = self.output / "bangla-data-20000101T000000000000Z-aaaaaaaaaaaa.tar.gz"
        link.symlink_to(unrelated)
        second = self.make_backup(keep=1)
        self.assertFalse(first.exists())
        self.assertTrue(second.exists())
        self.assertEqual(unrelated.read_bytes(), b"keep")
        self.assertTrue(old_format.exists())
        self.assertTrue(link.is_symlink())

    def test_retention_preserves_new_snapshot_when_clock_moves_backwards(self):
        self.output.mkdir(mode=0o700)
        future = self.output / "bangla-data-99991231T235959999999Z-aaaaaaaaaaaa.tar.gz"
        future.write_bytes(b"old snapshot created while clock was wrong")
        current = self.make_backup(keep=1)
        self.assertTrue(current.is_file())
        self.assertFalse(future.exists())
        receipt = json.loads((self.output / ".latest-backup.json").read_text())
        self.assertEqual(receipt["archive"], current.name)
        self.assertEqual(receipt["sha256"], hashlib.sha256(current.read_bytes()).hexdigest())

    def test_refuses_overwriting_existing_destination(self):
        archive = self.make_backup()
        existing = self.root / "existing"
        existing.mkdir()
        sentinel = existing / "sentinel"
        sentinel.write_text("keep")
        self.run_cli("restore", archive, existing, success=False)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_tampered_archive_fails_and_removes_incomplete_restore(self):
        archive = self.make_backup()
        tampered = self.rewrite_archive(archive, "tampered.tar.gz", lambda m, b: (m, b"changed") if m.name.endswith(".wav") else (m, b))
        target = self.root / "bad-restore"
        self.assertIn("checksums", self.run_cli("restore", tampered, target, success=False))
        self.assertFalse(target.exists())

    def test_rejects_traversal_links_duplicates_and_oversized_archives(self):
        archive = self.make_backup()
        for name, kind in [("../outside", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE),
                           ("media/link", tarfile.SYMTYPE), ("media/hardlink", tarfile.LNKTYPE)]:
            with self.subTest(name=name):
                bad = self.root / "malicious.tar.gz"
                with tarfile.open(bad, "w:gz") as tar:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "../../outside"
                    tar.addfile(member, io.BytesIO(b"") if kind == tarfile.REGTYPE else None)
                self.run_cli("restore", bad, self.root / "malicious-out", success=False)
                self.assertFalse((self.root / "malicious-out").exists())
        duplicate = self.root / "duplicates.tar.gz"
        with tarfile.open(duplicate, "w:gz") as tar:
            for _ in range(2):
                member = tarfile.TarInfo("media")
                member.type = tarfile.DIRTYPE
                tar.addfile(member)
        self.assertIn("duplicate", self.run_cli("verify", duplicate, success=False))
        self.assertIn("limit", self.run_cli("verify", archive, "--max-bytes", 10, success=False))
        self.assertFalse((self.root / "outside").exists())

    def test_rejects_corrupt_sqlite_even_when_manifest_hash_is_updated(self):
        archive = self.make_backup()
        invalid = b"not a sqlite database"
        def modify(member, data):
            if member.name == "database.sqlite3":
                data = invalid
            elif member.name == "manifest.json":
                manifest = json.loads(data)
                manifest["files"]["database.sqlite3"] = {"size": len(invalid), "sha256": hashlib.sha256(invalid).hexdigest()}
                data = json.dumps(manifest).encode()
            return member, data
        bad = self.rewrite_archive(archive, "bad-db.tar.gz", modify)
        self.run_cli("verify", bad, success=False)

    def test_refuses_public_output_directory_and_existing_lock(self):
        self.output.mkdir(mode=0o755)
        self.output.chmod(0o755)
        self.assertIn("private", self.run_cli("backup", self.output, "--application-stopped", success=False))
        self.output.chmod(0o700)
        (self.output / ".bangla-backup.lock").mkdir()
        self.assertIn("lock", self.run_cli("backup", self.output, "--application-stopped", success=False))

    def test_offsite_transfers_only_verified_latest_archive_without_real_network(self):
        archive = self.make_backup()
        # A lexicographically later archive must not replace the successful receipt.
        (self.output / "bangla-data-99991231T235959999999Z-aaaaaaaaaaaa.tar.gz").write_bytes(b"older wrong-clock artifact")
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        call_log = self.root / "restic-call.json"
        fake_restic = fake_bin / "restic"
        fake_restic.write_text(f"#!{sys.executable}\nimport json,os,sys\nfrom pathlib import Path\nPath(os.environ['RESTIC_TEST_CALL_LOG']).write_text(json.dumps(sys.argv[1:]))\n")
        fake_restic.chmod(0o755)
        password = self.root / "restic-password"
        password.write_text("fixture-only")
        password.chmod(0o600)
        env = {**self.env, "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
               "RESTIC_REPOSITORY": "fixture-repository-never-contacted", "RESTIC_PASSWORD_FILE": str(password),
               "BACKUP_DIR": str(self.output), "RESTIC_TEST_CALL_LOG": str(call_log)}
        offsite = ROOT / "scripts/backup-offsite.sh"
        result = subprocess.run(["bash", str(offsite)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(call_log.read_text()), ["backup", "--tag", "bangla-adventures", "--", str(archive)])
        call_log.unlink()
        future = time.time() + 3600
        os.utime(archive, (future, future))
        result = subprocess.run(["bash", str(offsite)], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("future", result.stderr)
        self.assertFalse(call_log.exists())
        os.utime(archive, (1, 1))
        result = subprocess.run(["bash", str(offsite)], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale", result.stderr)
        self.assertFalse(call_log.exists())


if __name__ == "__main__":
    unittest.main()
