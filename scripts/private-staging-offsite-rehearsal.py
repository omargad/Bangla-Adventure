#!/usr/bin/env python3
"""Off-site copy rehearsal on the VPS, with no client credentials (docs/PRODUCTION_OPERATIONS.md).

Run as the deployment user (UID 1002) from the private payload folder that
scripts/private-staging-offsite-rehearsal.sh uploads:

    python3 -I PAYLOAD/private-staging-offsite-rehearsal.py PAYLOAD

Under the private staging deploy lock it takes the newest verified staging archive, backs it up
into a throwaway restic repository in a new private folder with a random password made here,
runs restic check --read-data, previews the proposed retention with forget --dry-run, restores
the copy and proves it equals the original and passes the archive verification. The folder, its
password and the restored files are removed on every path and shown to be gone. Last, it reads
the staging backup and monitor timers without changing them. It prints one JSON result with fixed
fields and codes: never a password, a path with the account name or the server address.

The restic container is the one the production off-site job runs: the same pinned image, user,
read-only mounts and password-file handling, with no network. Staging's own data, timers and
archives are only read; production, Nginx and the firewall are never touched.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import sys
import time

HERE = Path(__file__).resolve().parent


def load(name: str, file: str):
    """The reviewed staging and production tools, uploaded beside this one, used as libraries."""
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stage = load("private_staging_ops", "private-staging-ops.py")
prod = load("production_ops", "production-ops.py")
Refused = stage.Refused
require = stage.require

SCOPE = "private-staging-offsite-rehearsal"
PAYLOAD = re.compile(r"/opt/bangla-adventures/\.offsite-rehearsal-payload\.[A-Za-z0-9]{12}")
WORKSPACE = re.compile(r"\.offsite-rehearsal-[0-9a-f]{24}")
ARCHIVE = re.compile(r"bangla-data-\d{8}T\d{12}Z-[0-9a-f]{12}\.tar\.gz")
CODE = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
# The retention proposed to the client: previewed only, nothing is ever forgotten here.
KEEP = {"keepDaily": 14, "keepWeekly": 8, "keepMonthly": 6}
STEPS = ("archive", "image", "init", "backup", "check", "retention", "restore", "verify", "cleanup")
LOCK_WAIT = 600  # A staging backup or deploy holding the lock is waited for, then the run defers.
STOPS = {signal.SIGTERM, signal.SIGHUP, signal.SIGINT}
MIN_FREE_BYTES = 1024 ** 3
# Under rootless Docker the deployment user's own group is group 0 inside a container, which is
# how the restic user (1000) reads the 0640 password file, exactly as the production job does.
SECRET_GID = 0
TIMEOUTS = {"inspect": 900, "pull": 900, "init": 300, "backup": 1800, "snapshots": 300, "check": 1800,
            "forget": 300, "restore": 1800, "cleanup": 300}

# Runs in the staging app image as uid 1000 with no network. "source" reads the receipt of the
# newest archive, checks its SHA-256 and runs the project's own verification (SQLite integrity
# included); "restored" checks the restored copy the same way. Unpacking uses /scratch, never /tmp.
INSPECT = r'''
import hashlib,json,pathlib,re,subprocess,sys,datetime as dt
mode=sys.argv[1];pattern=re.compile(r'bangla-data-\d{8}T\d{12}Z-[0-9a-f]{12}\.tar\.gz')
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as source:
  for block in iter(lambda:source.read(1048576),b''):h.update(block)
 return h.hexdigest()
def verify(p):
 result=subprocess.run(['python3','scripts/backup_restore.py','verify',str(p)],capture_output=True,text=True)
 if result.returncode:return None
 value=json.loads(result.stdout)
 return value if value.get('verified') is True else None
if mode=='source':
 root=pathlib.Path('/backups');marker=root/'.latest-backup.json'
 assert root.is_dir() and not root.is_symlink()
 assert marker.is_file() and not marker.is_symlink() and marker.stat().st_size<=4096
 receipt=json.loads(marker.read_text());name=receipt['archive'];expected=receipt['sha256']
 assert isinstance(name,str) and pattern.fullmatch(name) and isinstance(expected,str) and re.fullmatch('[0-9a-f]{64}',expected)
 archive=root/name
else:
 name=sys.argv[2];expected=sys.argv[3]
 assert pattern.fullmatch(name) and re.fullmatch('[0-9a-f]{64}',expected)
 archive=pathlib.Path('/restore/backups')/name
assert archive.is_file() and not archive.is_symlink()
actual=digest(archive);checked=verify(archive) if actual==expected else None
created=None
if checked and checked.get('created_at'):
 stamp=dt.datetime.fromisoformat(checked['created_at']);created=stamp.timestamp() if stamp.tzinfo else None
print(json.dumps({'archive':name,'sha256':actual,'sha256Matches':actual==expected,'verified':checked is not None,
 'files':checked['files'] if checked else None,'createdEpoch':created,'bytes':archive.stat().st_size}))
'''

# Removes the throwaway folders' contents, which belong to the container user, as the container's
# root (the deployment user itself under rootless Docker), with no network and no other mount.
CLEAN = "rm -rf -- /work/repository /work/restore /work/scratch"


def numeric(value) -> bool:
    return prod.numeric(value)


class Rehearsal:
    def __init__(self):
        self.token = secrets.token_hex(12)
        self.workspace: Path | None = None
        # Set once this run holds the staging lock: only then may it remove helpers or folders.
        self.locked = False
        self.result = {
            "scope": SCOPE, "verified": False, "status": "failed", "checkedAtEpoch": None, "durationSeconds": None, "codes": [],
            "steps": {name: "not-run" for name in STEPS},
            "archive": {"createdEpoch": None, "bytes": None, "sha256": None, "files": None},
            "restic": {"version": prod.RESTIC_VERSION, "network": "none", "imagePulled": False, "snapshotId": None},
            "retention": {**KEEP, "dryRun": True, "kept": None, "wouldRemove": None},
            "restore": {"sha256Matches": False, "archiveVerified": False},
            "cleanup": {"repositoryRemoved": False, "passwordRemoved": False, "restoredFilesRemoved": False,
                        "workspaceRemoved": False, "helpersRemoved": False, "earlierWorkspacesRemoved": 0},
            "staging": None,
        }

    # Containers --------------------------------------------------------------------------------

    def remove_owned(self) -> None:
        """Remove every container of this tool's scope by label and prove none is left."""
        label = "label=io.bangla.scope=" + SCOPE
        for cid in stage.docker("ps", "--all", "--quiet", "--no-trunc", "--filter", label).stdout.split():
            require(re.fullmatch(r"[a-f0-9]{64}", cid) is not None, "helper-id")
            labels = (stage.inspect("container", cid).get("Config") or {}).get("Labels") or {}
            require(labels.get("io.bangla.scope") == SCOPE, "helper-identity")
            stage.docker("container", "rm", "--force", cid)
        require(not stage.docker("ps", "--all", "--quiet", "--filter", label).stdout.strip(), "helper-cleanup-failed")

    def isolated_run(self, *args: str, data: str | None = None, timeout: int = 240):
        """A labelled helper that is removed, and proven gone, after a timeout or a stop request too."""
        token = secrets.token_hex(12)
        name = "ba-offsite-rehearsal-" + token
        options = ["container", "create", "--name", name, "--label", "io.bangla.scope=" + SCOPE, "--label", "io.bangla.ops.id=" + token,
                   "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--read-only"]
        if data is not None:
            options.append("--interactive")
        try:
            lines = stage.docker(*options, *args).stdout.split()
            require(bool(lines) and re.fullmatch(r"[a-f0-9]{64}", lines[-1]) is not None, "helper-id")
            return stage.docker("container", "start", "--attach", "--interactive", lines[-1], data=data, timeout=timeout, okay=True)
        finally:
            # A stop request waits until the helper is gone, then ends the run; it is never lost.
            blocked = signal.pthread_sigmask(signal.SIG_BLOCK, STOPS)
            try:
                self.remove_owned()
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, blocked)

    def restic(self, step: str, *args: str, backups: bool = False, restore: bool = False):
        """The production job's restic container, against the local throwaway repository only."""
        work = self.workspace
        options = ["--user", "1000:1000", "--group-add", str(SECRET_GID),
                   "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=512m", "--tmpfs", "/cache:rw,noexec,nosuid,nodev,size=1g",
                   "--env", "RESTIC_REPOSITORY=local:/repository", "--env", "RESTIC_PASSWORD_FILE=/run/secrets/restic-password",
                   "--env", "RESTIC_CACHE_DIR=/cache", "--env", "HOME=/tmp", "--env", "TMPDIR=/tmp",
                   "--mount", f"type=bind,source={work / 'password'},target=/run/secrets/restic-password,readonly",
                   "--mount", f"type=bind,source={work / 'repository'},target=/repository"]
        if backups:
            options += ["--mount", f"type=volume,source={stage.BACKUPS},target=/backups,readonly"]
        if restore:
            options += ["--mount", f"type=bind,source={work / 'restore'},target=/restore"]
        return self.isolated_run(*options, "--entrypoint", "/usr/bin/restic", prod.RESTIC_IMAGE, *args, timeout=TIMEOUTS[step])

    def inspect_archive(self, *args: str, restored: bool = False) -> dict:
        work = self.workspace
        options = ["--user", "1000:1000", "--group-add", str(SECRET_GID), "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
                   "--env", "TMPDIR=/scratch", "--mount", f"type=bind,source={work / 'scratch'},target=/scratch"]
        if restored:
            options += ["--mount", f"type=bind,source={work / 'restore'},target=/restore,readonly"]
        else:
            options += ["--mount", f"type=volume,source={stage.BACKUPS},target=/backups,readonly"]
        result = self.isolated_run(*options, "--entrypoint", "python3", stage.IMAGE, "-", "restored" if restored else "source", *args,
                                   data=INSPECT, timeout=TIMEOUTS["inspect"])
        require(result.returncode == 0, "restored-archive-unreadable" if restored else "archive-unreadable")
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        value = json.loads(lines[-1]) if lines else None
        require(isinstance(value, dict) and isinstance(value.get("archive"), str) and ARCHIVE.fullmatch(value["archive"]) is not None
                and isinstance(value.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is not None
                and type(value.get("bytes")) is int and value["bytes"] > 0, "restored-archive-unreadable" if restored else "archive-unreadable")
        return value

    # Throwaway folder --------------------------------------------------------------------------

    def create_workspace(self) -> None:
        stage.private_dir(stage.STAGE)
        path = stage.STAGE / (".offsite-rehearsal-" + self.token)
        require(not os.path.lexists(path), "workspace-exists")
        os.mkdir(path, 0o700)
        self.workspace = path
        stage.private_dir(path)
        # Writable by the container user through the deployment user's group (group 0 inside it),
        # never by anyone else: the folder around them is 0700.
        for name in ("repository", "restore", "scratch"):
            os.mkdir(path / name, 0o700)
            os.chmod(path / name, 0o770)
        # Made here and never printed, logged or put on a command line; the container reads the file.
        fd = os.open(path / "password", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as output:
            output.write(secrets.token_urlsafe(48) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(path / "password", 0o640)

    def remove_workspace(self, path: Path) -> dict:
        """Remove one throwaway folder and say what is gone; every step runs even if one fails."""
        try:
            info = path.lstat()
            safe = (stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and path.parent == stage.STAGE
                    and WORKSPACE.fullmatch(path.name) is not None)
        except OSError:
            safe = False
        if safe:
            # Each part is attempted on its own, so the password goes even when other files stay.
            try:
                if any(os.path.lexists(path / name) for name in ("repository", "restore", "scratch")):
                    self.isolated_run("--user", "0:0", "--cap-add", "DAC_OVERRIDE", "--mount", f"type=bind,source={path},target=/work",
                                      "--entrypoint", "sh", stage.IMAGE, "-c", CLEAN, timeout=TIMEOUTS["cleanup"])
            except (Refused, OSError, ValueError):
                pass
            for remove, entry in ((os.unlink, path / "password"), (os.rmdir, path)):
                try:
                    if os.path.lexists(entry):
                        remove(entry)
                except OSError:
                    pass
        return {"repository": not os.path.lexists(path / "repository"), "restore": not os.path.lexists(path / "restore"),
                "password": not os.path.lexists(path / "password"), "workspace": not os.path.lexists(path)}

    def earlier_workspaces(self) -> int:
        """Folders left by a run that was killed outright (SIGKILL or power loss); removed first."""
        found = [entry for entry in stage.STAGE.iterdir() if WORKSPACE.fullmatch(entry.name)]
        for entry in found:
            require(self.remove_workspace(entry)["workspace"], "earlier-workspace-cleanup-failed")
        return len(found)

    # The rehearsal -----------------------------------------------------------------------------

    def step(self, name: str, code: str, action):
        self.result["steps"][name] = "failed"
        try:
            value = action()
        except Refused as exc:
            # A failed command, or the production tool's own code, is named after this step.
            if exc.code in ("command-failed", "offsite-unverified"):
                raise Refused(code) from exc
            if exc.code.startswith("offsite-"):
                raise Refused("rehearsal-" + exc.code[len("offsite-"):]) from exc
            raise
        self.result["steps"][name] = "passed"
        return value

    def free_bytes(self) -> int:
        disk = os.statvfs(stage.STAGE)
        return disk.f_bavail * disk.f_frsize

    def restic_image(self) -> None:
        present = stage.docker("image", "inspect", prod.RESTIC_IMAGE, okay=True).returncode == 0
        if not present:
            # The only network use: the daemon pulls the pinned image. The containers have none.
            pulled = stage.docker("pull", "--quiet", prod.RESTIC_IMAGE, okay=True, timeout=TIMEOUTS["pull"])
            require(pulled.returncode == 0, "restic-image-unavailable")
            self.result["restic"]["imagePulled"] = True
        image = stage.inspect("image", prod.RESTIC_IMAGE)
        digest = prod.RESTIC_IMAGE.rpartition("@")[2]
        require(any(entry.endswith("@" + digest) for entry in image.get("RepoDigests") or []), "restic-image-unavailable")

    def rehearse(self) -> None:
        def newest() -> dict:
            value = self.inspect_archive()
            require(value["sha256Matches"] is True and value["verified"] is True and numeric(value.get("createdEpoch"))
                    and type(value.get("files")) is int, "archive-unverified")
            return value
        source = self.step("archive", "archive-unverified", newest)
        self.result["archive"] = {key: source[key] for key in ("createdEpoch", "bytes", "sha256", "files")}
        # The repository, the restored copy and its unpacked check each take about one archive.
        require(self.free_bytes() >= 3 * source["bytes"] + MIN_FREE_BYTES, "disk-low")
        self.step("image", "restic-image-unavailable", self.restic_image)

        def init():
            require(self.restic("init", "init").returncode == 0, "rehearsal-init-failed")
        self.step("init", "rehearsal-init-failed", init)

        target = "/backups/" + source["archive"]

        def backup() -> str:
            copy = self.restic("backup", "backup", "--json", "--quiet", "--host", prod.RESTIC_HOST, "--tag", prod.RESTIC_TAG, "--", target, backups=True)
            require(copy.returncode == 0, prod.restic_code(copy.returncode, "offsite-backup-failed"))
            snapshot = prod.backup_snapshot(copy.stdout)
            listed = self.restic("snapshots", "snapshots", "--json", snapshot)
            require(listed.returncode == 0 and prod.snapshot_matches(listed.stdout, snapshot, target), "rehearsal-snapshot-unverified")
            return snapshot
        snapshot = self.step("backup", "rehearsal-backup-failed", backup)
        self.result["restic"]["snapshotId"] = snapshot

        def check():
            require(self.restic("check", "check", "--read-data").returncode == 0, "rehearsal-check-failed")
        self.step("check", "rehearsal-check-failed", check)

        def retention():
            # The production job's grouping and the proposed policy, with --dry-run: nothing is removed.
            preview = self.restic("forget", "forget", "--json", "--dry-run", "--tag", prod.RESTIC_TAG, "--host", prod.RESTIC_HOST,
                                  "--group-by", "host,tags", "--keep-daily", str(KEEP["keepDaily"]),
                                  "--keep-weekly", str(KEEP["keepWeekly"]), "--keep-monthly", str(KEEP["keepMonthly"]))
            require(preview.returncode == 0, "rehearsal-retention-preview-failed")
            kept, removed = forget_counts(preview.stdout, snapshot)
            self.result["retention"].update(kept=kept, wouldRemove=removed)
        self.step("retention", "rehearsal-retention-preview-failed", retention)

        def restore():
            done = self.restic("restore", "restore", snapshot, "--target", "/restore", "--verify", "--quiet", restore=True)
            require(done.returncode == 0, "rehearsal-restore-failed")
        self.step("restore", "rehearsal-restore-failed", restore)

        def verify():
            copy = self.inspect_archive(source["archive"], source["sha256"], restored=True)
            matches = copy["sha256Matches"] is True and copy["sha256"] == source["sha256"] and copy["bytes"] == source["bytes"]
            self.result["restore"] = {"sha256Matches": matches, "archiveVerified": copy["verified"] is True}
            require(matches, "rehearsal-restore-mismatch")
            require(copy["verified"] is True, "rehearsal-restore-unverified")
        self.step("verify", "rehearsal-restore-unverified", verify)

    def cleanup(self) -> list[str]:
        """Runs on every path, with stop requests ignored until it ends."""
        codes = []
        cleanup = self.result["cleanup"]
        if not self.locked:
            # Stopped before the lock: nothing was made, and another run's files are not this one's.
            cleanup.update(repositoryRemoved=True, passwordRemoved=True, restoredFilesRemoved=True, workspaceRemoved=True, helpersRemoved=True)
            self.result["steps"]["cleanup"] = "passed"
            return codes
        try:
            self.remove_owned()
            cleanup["helpersRemoved"] = True
        except (Refused, OSError, ValueError):
            codes.append("helper-cleanup-failed")
        if self.workspace is not None:
            gone = self.remove_workspace(self.workspace)
            cleanup.update(repositoryRemoved=gone["repository"], passwordRemoved=gone["password"],
                           restoredFilesRemoved=gone["restore"], workspaceRemoved=gone["workspace"])
            if not all(gone.values()):
                codes.append("cleanup-failed")
        else:
            cleanup.update(repositoryRemoved=True, passwordRemoved=True, restoredFilesRemoved=True, workspaceRemoved=True)
        if not codes:
            # No throwaway folder of this or an earlier run is left in the staging folder.
            try:
                left = [entry for entry in stage.STAGE.iterdir() if WORKSPACE.fullmatch(entry.name)]
            except OSError:
                left = [None]
            if left:
                codes.append("cleanup-failed")
                cleanup["workspaceRemoved"] = False
        self.result["steps"]["cleanup"] = "failed" if codes else "passed"
        return codes

    # Read-only staging status -------------------------------------------------------------------

    def userctl(self, *args: str):
        runtime = Path("/run/user") / str(os.getuid())
        return stage.command(["systemctl", "--user", "--no-pager", *args], okay=True, timeout=60,
                             extra_env={"XDG_RUNTIME_DIR": str(runtime), "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(runtime / "bus")})

    def timer(self, name: str) -> dict:
        unit = f"ba-private-stage-{name}"
        value = {"timerEnabled": False, "timerActive": False, "lastTriggerEpoch": None, "serviceFailed": False}
        try:
            value["timerEnabled"] = self.userctl("is-enabled", "--quiet", unit + ".timer").returncode == 0
            value["timerActive"] = self.userctl("is-active", "--quiet", unit + ".timer").returncode == 0
            value["serviceFailed"] = self.userctl("is-failed", "--quiet", unit + ".service").returncode == 0
            shown = self.userctl("show", unit + ".timer", "--property=LastTriggerUSec", "--timestamp=unix").stdout.strip()
            match = re.fullmatch(r"LastTriggerUSec=@([0-9]{1,12})", shown)
            value["lastTriggerEpoch"] = int(match.group(1)) if match and int(match.group(1)) > 0 else None
        except Refused:
            pass
        return value

    def report(self, name: str) -> dict:
        value = {"status": "missing", "checkedAtEpoch": None, "lastSuccessEpoch": None, "codes": []}
        try:
            path = stage.OPS / ("last-" + name + ".json")
            stage.regular(path)
            require(path.stat().st_size <= 65536, "unsafe-file")
            report = json.loads(path.read_text())
        except (Refused, OSError, ValueError):
            return value
        if not isinstance(report, dict) or report.get("scope") != stage.SCOPE or report.get("action") != name:
            return {**value, "status": "invalid"}
        checked = report.get("checkedAtEpoch")
        status = report.get("status") if report.get("status") in ("passed", "healthy", "failed", "deferred") else "invalid"
        good = report.get("verified") is True and status == ("passed" if name == "backup" else "healthy")
        return {"status": status, "checkedAtEpoch": checked if numeric(checked) else None,
                "lastSuccessEpoch": checked if good and numeric(checked) else None, "codes": prod.clean_codes(report.get("codes"))}

    def staging_status(self) -> dict:
        try:
            stage.validate_installation()
            installed = True
        except (Refused, OSError, ValueError, KeyError, TypeError, AttributeError):
            installed = False
        return {"installationValid": installed, **{name: {**self.report(name), **self.timer(name)} for name in ("backup", "monitor")}}


def forget_counts(stdout: str, snapshot: str) -> tuple[int, int]:
    try:
        groups = json.loads(stdout)
    except ValueError as exc:
        raise Refused("rehearsal-retention-preview-failed") from exc
    require(isinstance(groups, list) and all(isinstance(group, dict) for group in groups), "rehearsal-retention-preview-failed")
    kept = [item.get("id") for group in groups for item in group.get("keep") or [] if isinstance(item, dict)]
    removed = [item for group in groups for item in group.get("remove") or []]
    require(snapshot in kept, "rehearsal-retention-preview-failed")
    return len(kept), len(removed)


def lock_staging(deadline: float) -> int:
    """The staging deploy lock, which its backups, monitor, deploys and QA also take."""
    while True:
        try:
            return stage.acquire_lock()
        except Refused as exc:
            if exc.code != "transaction-busy" or time.monotonic() >= deadline:
                raise
        time.sleep(2)


def main(argv: list[str]) -> tuple[dict, int]:
    started = time.monotonic()
    run = Rehearsal()
    codes: list[str] = []
    fd = None
    previous = None
    try:
        require(len(argv) == 2 and PAYLOAD.fullmatch(argv[1]) is not None and Path(argv[1]) == HERE, "payload-path")
        stage.platform(operations=False)
        fd = lock_staging(time.monotonic() + LOCK_WAIT)
        run.locked = True
        stage.platform(operations=False)  # Again while holding the lock, as the staging jobs do.
        stage.volume(stage.BACKUPS)
        run.remove_owned()
        run.result["cleanup"]["earlierWorkspacesRemoved"] = run.earlier_workspaces()
        require(run.free_bytes() >= MIN_FREE_BYTES, "disk-low")
        run.create_workspace()
        run.rehearse()
    except (Exception, KeyboardInterrupt, stage.Stopped) as exc:  # Any failure is a fixed code, never a trace.
        codes.append(exc.code if isinstance(exc, Refused) else "interrupted" if isinstance(exc, (stage.Stopped, KeyboardInterrupt)) else "operation-failed")
    finally:
        previous = stage.quiet_signals()
        try:
            codes += run.cleanup()
        finally:
            if fd is not None:
                os.close(fd)
            stage.restore_signals(previous)
    try:
        run.result["staging"] = run.staging_status()
    except Exception:  # Read-only and informative: it never changes the rehearsal's result.
        run.result["staging"] = None
    deferred = codes == ["transaction-busy"]
    run.result.update(verified=not codes, status="passed" if not codes else "deferred" if deferred else "failed",
                      codes=[code if CODE.fullmatch(code) else "operation-failed" for code in codes][:16],
                      checkedAtEpoch=time.time(), durationSeconds=round(time.monotonic() - started, 3))
    return run.result, 0 if not codes else 75 if deferred else 1


if __name__ == "__main__":
    os.umask(0o077)
    # Stop requests and hang-ups (a dropped SSH connection) become exceptions, so clean-up runs.
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, stage.interrupted)
    value, status = main(sys.argv)
    try:
        print(json.dumps(value, separators=(",", ":")), flush=True)
    except OSError:
        pass
    raise SystemExit(status)
