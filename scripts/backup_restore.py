#!/usr/bin/env python3
"""Private SQLite/media snapshots and verified, non-overwriting restore drills.

Python 3.10+ standard library only. Checksums detect corruption, not an attacker
who can replace both an archive and its manifest; protect/encrypt backup storage.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import sqlite3
import stat
import sys
import tarfile
import tempfile
import time

FORMAT = "bangla-adventures-backup"
ARCHIVE_RE = re.compile(r"bangla-data-\d{8}T\d{12}Z-[0-9a-f]{12}\.tar\.gz\Z")
MAX_FILES = 100_000
MAX_BYTES = 20 * 1024**3
MANIFEST_LIMIT = 16 * 1024**2


class BackupError(Exception):
    pass


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def regular_file(path: Path) -> None:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError as exc:
        raise BackupError(f"Required file does not exist: {path}") from exc
    if not stat.S_ISREG(mode):
        raise BackupError(f"Expected a regular file, not a link/device: {path}")


def check_database(path: Path) -> None:
    regular_file(path)
    with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("PRAGMA query_only = ON")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise BackupError("SQLite integrity check failed")


def snapshot_database(source: Path, target: Path, timeout: float) -> None:
    regular_file(source)
    started = time.monotonic()

    def progress(_status: int, _remaining: int, _total: int) -> None:
        if time.monotonic() - started > timeout:
            raise BackupError("SQLite snapshot timed out; stop writers and retry")

    with contextlib.closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as src:
        with contextlib.closing(sqlite3.connect(target)) as dst:
            src.backup(dst, pages=1024, progress=progress, sleep=0.05)
            # The snapshot never depends on source WAL/SHM sidecars.
            dst.execute("PRAGMA journal_mode = DELETE")
    target.chmod(0o600)
    check_database(target)


def media_inventory(root: Path) -> dict[str, tuple[int, int, int, int]]:
    result = {}
    def fail_walk(error: OSError) -> None:
        raise BackupError(f"Cannot read all media: {error}") from error
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=fail_walk):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            info = path.lstat()
            if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise BackupError(f"Media contains a link or special file: {path}")
            if stat.S_ISREG(info.st_mode):
                result[path.relative_to(root).as_posix()] = (
                    info.st_size, info.st_mtime_ns, info.st_ino, info.st_dev
                )
    return result


def private_directory(path: Path) -> None:
    if path.is_symlink():
        raise BackupError(f"Directory must not be a symbolic link: {path}")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir():
        raise BackupError(f"Not a directory: {path}")
    # Do not silently change permissions on an existing shared directory.
    if path.stat().st_mode & 0o077:
        raise BackupError(f"Backup directory must be private (chmod 700): {path}")


def add_member(archive: tarfile.TarFile, source: Path, name: str) -> None:
    info = archive.gettarinfo(str(source), arcname=name)
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    info.mode = 0o700 if info.isdir() else 0o600
    with source.open("rb") if info.isfile() else contextlib.nullcontext() as f:
        archive.addfile(info, f)


def backup(args: argparse.Namespace) -> dict:
    if not args.application_stopped:
        raise BackupError("Stop all application/media writers, then pass --application-stopped")
    db = Path(os.environ.get("DATABASE_PATH", ".data/bangla-adventures.db")).expanduser().absolute()
    media = Path(os.environ.get("MEDIA_ROOT", ".data/media")).expanduser().absolute()
    output = Path(args.directory).expanduser().absolute()
    regular_file(db)
    if media.is_symlink() or (media.exists() and not media.is_dir()):
        raise BackupError("MEDIA_ROOT must be a directory, not a link or file")
    if not media.exists() and not args.media_empty:
        raise BackupError("MEDIA_ROOT does not exist; use --media-empty only if no uploads exist")
    if media.exists() and (output.resolve() == media.resolve() or media.resolve() in output.resolve().parents):
        raise BackupError("Backup destination must not be inside MEDIA_ROOT")
    if media.exists() and media.resolve() in db.resolve().parents:
        raise BackupError("DATABASE_PATH must not be inside MEDIA_ROOT")
    if args.keep < 1:
        raise BackupError("Retention count must be at least 1")
    private_directory(output)
    lock = output / ".bangla-backup.lock"
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError as exc:
        raise BackupError("Backup lock exists; check for a running/interrupted backup before removing it") from exc
    try:
        with tempfile.TemporaryDirectory(prefix=".bangla-snapshot-", dir=output) as temporary:
            stage = Path(temporary)
            before = media_inventory(media) if media.exists() else {}
            snapshot_database(db, stage / "database.sqlite3", args.timeout)
            (stage / "media").mkdir(mode=0o700)
            for name in before:
                source, target = media / name, stage / "media" / name
                regular_file(source)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                shutil.copyfile(source, target)
                target.chmod(0o600)
            after = media_inventory(media) if media.exists() else {}
            if before != after:
                raise BackupError("Media changed during backup; stop writers and retry")
            records = {}
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    records[path.relative_to(stage).as_posix()] = {"sha256": digest(path), "size": path.stat().st_size}
            manifest = {
                "format": FORMAT, "version": 1,
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "database": "database.sqlite3", "media": "media",
                "consistency": "sqlite-online-backup; operator-confirmed-stopped-application",
                "files": records,
            }
            (stage / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            archive_path = output / f"bangla-data-{stamp}-{secrets.token_hex(6)}.tar.gz"
            partial = stage / "archive.partial"
            with tarfile.open(partial, "w:gz", format=tarfile.PAX_FORMAT) as archive:
                for path in sorted(stage.rglob("*")):
                    if path != partial:
                        add_member(archive, path, path.relative_to(stage).as_posix())
            partial.chmod(0o600)
            verify_archive(partial, MAX_BYTES)
            # Publish without overwriting an existing archive. Keep the valid new
            # backup even if later retention or reporting fails.
            os.link(partial, archive_path)
            with archive_path.open("rb") as f:
                os.fsync(f.fileno())
            others = sorted(
                (p for p in output.iterdir() if p != archive_path and ARCHIVE_RE.fullmatch(p.name)
                 and p.is_file() and not p.is_symlink()),
                key=lambda p: p.name, reverse=True,
            )
            # Always retain this successful snapshot even when the system clock
            # moves backwards or existing files have future timestamps.
            for old in others[args.keep - 1:]:
                old.unlink()
            archive_hash = digest(archive_path)
            marker = stage / "latest.json"
            marker.write_text(json.dumps({"archive": archive_path.name, "sha256": archive_hash}) + "\n", encoding="utf-8")
            marker.chmod(0o600)
            os.replace(marker, output / ".latest-backup.json")
            return {"archive": str(archive_path), "sha256": archive_hash, "files": len(records), "verified": True}
    finally:
        lock.rmdir()


def checked_name(name: str) -> str:
    path = PurePosixPath(name)
    if (not name or "\\" in name or "\x00" in name or path.is_absolute()
            or any(p in ("", ".", "..") for p in name.rstrip("/").split("/"))):
        raise BackupError(f"Unsafe archive path: {name!r}")
    clean = str(path)
    if clean not in ("manifest.json", "database.sqlite3", "media") and not clean.startswith("media/"):
        raise BackupError(f"Unexpected archive path: {name!r}")
    return clean


def unpack_checked(archive_path: Path, stage: Path, max_bytes: int) -> dict:
    regular_file(archive_path)
    seen, files, total = set(), {}, 0
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive:
            name = checked_name(member.name)
            if name in seen or len(seen) >= MAX_FILES:
                raise BackupError("Archive has duplicate paths or too many members")
            seen.add(name)
            if not (member.isfile() or member.isdir()) or member.issparse():
                raise BackupError("Archive links, devices, sparse files and special entries are forbidden")
            if member.isdir() and not (name == "media" or name.startswith("media/")):
                raise BackupError("Only media directories are permitted")
            if member.isfile() and name == "media":
                raise BackupError("Media root must be a directory")
            if member.size < 0:
                raise BackupError("Invalid archive member size")
            total += member.size
            if total > max_bytes or (name == "manifest.json" and member.size > MANIFEST_LIMIT):
                raise BackupError("Archive exceeds the configured extraction limit")
            target = stage / name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
                continue
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with contextlib.closing(archive.extractfile(member)) as src, target.open("xb") as dst:
                shutil.copyfileobj(src, dst)
            target.chmod(0o600)
            if target.stat().st_size != member.size:
                raise BackupError("Truncated archive member")
            files[name] = {"sha256": digest(target), "size": member.size}
    if "manifest.json" not in files or "database.sqlite3" not in files or not (stage / "media").is_dir():
        raise BackupError("Archive must contain a manifest, database and media directory")
    try:
        manifest = json.loads((stage / "manifest.json").read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise BackupError("Invalid backup manifest") from exc
    if (not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("version") != 1
            or manifest.get("database") != "database.sqlite3" or manifest.get("media") != "media"):
        raise BackupError("Unsupported backup manifest")
    files.pop("manifest.json")
    if manifest.get("files") != files:
        raise BackupError("Backup files do not match manifest checksums/sizes")
    check_database(stage / "database.sqlite3")
    return manifest


def verify_archive(archive: Path, max_bytes: int) -> dict:
    with tempfile.TemporaryDirectory(prefix="bangla-verify-") as temporary:
        manifest = unpack_checked(archive, Path(temporary), max_bytes)
    return {"verified": True, "files": len(manifest["files"]), "created_at": manifest.get("created_at")}


def restore(args: argparse.Namespace) -> dict:
    archive = Path(args.archive).expanduser().absolute()
    destination = Path(args.destination).expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        raise BackupError("Restore destination must not exist; use a new directory for the drill")
    if not destination.parent.is_dir():
        raise BackupError("Restore destination parent must already exist")
    destination.mkdir(mode=0o700)
    try:
        manifest = unpack_checked(archive, destination, args.max_bytes)
        (destination / "database.sqlite3").rename(destination / "bangla-adventures.db")
        (destination / "manifest.json").unlink()
        receipt = {"format": FORMAT, "restored_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                   "archive_sha256": digest(archive), "backup_created_at": manifest.get("created_at")}
        receipt_path = destination / "restore-receipt.json"
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        receipt_path.chmod(0o600)
        return {"destination": str(destination), "database": str(destination / "bangla-adventures.db"),
                "media": str(destination / "media"), "verified": True}
    except Exception:
        shutil.rmtree(destination)
        raise


def positive_number(value: str) -> float:
    number = float(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("backup", help="Snapshot configured database/media; requires stopped application")
    create.add_argument("directory", nargs="?", default="./backups")
    create.add_argument("keep", nargs="?", type=int, default=14)
    create.add_argument("--application-stopped", action="store_true")
    create.add_argument("--media-empty", action="store_true", help="Allow absent MEDIA_ROOT only when no uploads exist")
    create.add_argument("--timeout", type=positive_number, default=120.0)
    for name in ("verify", "restore"):
        command = commands.add_parser(name)
        command.add_argument("archive")
        command.add_argument("--max-bytes", type=int, default=MAX_BYTES, help="Maximum uncompressed data size (default 20 GiB)")
        if name == "restore":
            command.add_argument("destination")
    args = parser.parse_args()
    try:
        if hasattr(args, "max_bytes") and args.max_bytes <= 0:
            raise BackupError("Extraction limit must be positive")
        if args.command == "backup":
            result = backup(args)
        elif args.command == "verify":
            result = verify_archive(Path(args.archive).expanduser().absolute(), args.max_bytes)
        else:
            result = restore(args)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (BackupError, OSError, sqlite3.Error, tarfile.TarError, EOFError, ValueError) as exc:
        print(f"Backup/restore failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
