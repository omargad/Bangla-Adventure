#!/usr/bin/env python3
"""Rootless private-staging maintenance, with fixed scope and finally-based recovery."""
from __future__ import annotations

import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
import pwd
from pathlib import Path
import re
import secrets
import signal
import socket
import stat
import subprocess
import sys
import time
import http.client

STAGE = Path("/opt/bangla-adventures/private-staging")
OPS = STAGE / "ops"
PROJECT = "bangla-adventures-staging"
DATA = "bangla-adventures-staging_bangla-data"
BACKUPS = "bangla-adventures-staging-backups"
SOCKET = Path("/run/user/1002/docker.sock")
IMAGE = "ghcr.io/omargad/bangla-adventure@sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2"
REVISION = "95b6308ac7ad3d5b6bb2d951df9d65a23ff77107"
MARKER = "bangla-adventures-private-staging-v1\n"
SCOPE = "private-staging-operations"
OWNED_HELPERS = {}


class Refused(Exception):
    def __init__(self, code: str):
        self.code = code


def require(condition: bool, code: str) -> None:
    if not condition:
        raise Refused(code)


def private_dir(path: Path) -> None:
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 1002 and stat.S_IMODE(info.st_mode) == 0o700 and path.resolve() == path, "unsafe-directory")


def regular(path: Path, owner: int = 1002) -> None:
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == owner, "unsafe-file")


def command(args: list[str], *, data: str | None = None, timeout: int = 240, extra_env: dict | None = None, okay: bool = False) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "COMPOSE_PROJECT_NAME", "COMPOSE_FILE", "APP_IMAGE", "PUBLIC_ORIGIN"):
        env.pop(key, None)
    env.update(extra_env or {})
    try:
        result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=timeout, env=env, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Refused("command-unavailable-or-timeout") from exc
    require(okay or result.returncode == 0, "command-failed")
    require(len(result.stdout) <= 2 * 1024 * 1024, "oversize-command-result")
    return result


def docker(*args: str, **kwargs) -> subprocess.CompletedProcess:
    return command(["docker", "--host", "unix://" + str(SOCKET), *args], **kwargs)


def inspect(kind: str, name: str):
    result = json.loads(docker(kind, "inspect", name).stdout)
    require(isinstance(result, list) and len(result) == 1, "ambiguous-resource")
    return result[0]


def cleanup_helpers() -> None:
    for cid, (name, token) in list(OWNED_HELPERS.items()):
        probe = docker("container", "inspect", cid, okay=True)
        if probe.returncode:
            OWNED_HELPERS.pop(cid, None)
            continue
        value, = json.loads(probe.stdout)
        labels = value.get("Config", {}).get("Labels") or {}
        require(value.get("Id") == cid and value.get("Name") == "/" + name and labels.get("io.bangla.scope") == SCOPE and labels.get("io.bangla.ops.id") == token, "helper-identity")
        docker("container", "rm", "--force", cid)
        require(docker("container", "inspect", cid, okay=True).returncode != 0, "helper-cleanup-failed")
        OWNED_HELPERS.pop(cid, None)


def isolated_run(*args: str, data: str | None = None, timeout: int = 240) -> subprocess.CompletedProcess:
    """Own a concrete helper ID, and prove it is gone even after CLI timeout/SIGTERM."""
    token = secrets.token_hex(12)
    name = "ba-private-stage-ops-" + token
    require(docker("container", "inspect", name, okay=True).returncode != 0, "helper-name-exists")
    options = ["container", "create", "--name", name, "--label", "io.bangla.scope=" + SCOPE, "--label", "io.bangla.ops.id=" + token]
    if data is not None:
        options.append("--interactive")
    cid = docker(*options, *args).stdout.strip()
    require(re.fullmatch(r"[a-f0-9]{64}", cid) is not None, "helper-id")
    OWNED_HELPERS[cid] = (name, token)
    try:
        return docker("container", "start", "--attach", "--interactive", cid, data=data, timeout=timeout, okay=True)
    finally:
        cleanup_helpers()


def volume(name: str, *, drill_id: str | None = None) -> None:
    v = inspect("volume", name)
    labels = v.get("Labels") or {}
    require(v.get("Name") == name and v.get("Driver") == "local" and not v.get("Options"), "volume-scope")
    if drill_id:
        require(name == "bangla-private-ops-drill-" + drill_id and labels.get("io.bangla.scope") == "private-ops-drill" and labels.get("io.bangla.ops.id") == drill_id, "volume-scope")
    else:
        require(name in (DATA, BACKUPS) and labels.get("com.docker.compose.project") == PROJECT and labels.get("io.bangla.scope") == "private-staging", "volume-scope")


def systemd_dir() -> Path:
    return Path(pwd.getpwuid(1002).pw_dir) / ".config/systemd/user"


def validate_installation() -> None:
    receipt = OPS / "installation.json"
    regular(receipt)
    value = json.loads(receipt.read_text())
    require(value.get("scope") == SCOPE and value.get("localOnly") is True, "installation-scope")
    expected = {"private-staging-ops.sh", "private-staging-ops.py", "private-staging-ops-check.py"}
    require(set(value["tools"]) == expected, "installation-tools")
    for name, digest in value["tools"].items():
        path = STAGE / "tools" / name
        regular(path)
        require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, "installation-hash")
    expected_units = {"ba-private-stage-backup.service", "ba-private-stage-backup.timer", "ba-private-stage-monitor.service", "ba-private-stage-monitor.timer"}
    require(set(value["units"]) == expected_units, "installation-units")
    for name, digest in value["units"].items():
        path = systemd_dir() / name
        regular(path)
        require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, "installation-unit-hash")


def platform(*, operations: bool = True) -> None:
    require(os.getuid() == 1002 and command(["id", "-un"]).stdout.strip() == "deployer", "wrong-user")
    private_dir(STAGE)
    if operations:
        private_dir(OPS)
        validate_installation()
    regular(STAGE / ".private-staging-marker")
    require((STAGE / ".private-staging-marker").read_text() == MARKER, "stage-marker")
    sock = SOCKET.lstat()
    require(stat.S_ISSOCK(sock.st_mode) and sock.st_uid == 1002 and SOCKET.resolve() == SOCKET, "rootless-socket")
    security = json.loads(docker("info", "--format", "{{json .SecurityOptions}}").stdout)
    require("name=rootless" in security, "non-rootless-daemon")
    regular(STAGE / "release.json")
    release = json.loads((STAGE / "release.json").read_text())
    require(release.get("scope") == "private-staging" and release.get("phase") == "healthy" and release.get("image") == IMAGE and release.get("revision") == REVISION and release.get("project") == PROJECT and release.get("volume") == DATA and release.get("origin") == "http://127.0.0.1:3001", "release-scope")
    expected = {"compose.yaml", "tools/private-staging-proxy.mjs", "tools/private-staging-remote.sh", "tools/private-staging-verify.mjs", "tools/private-staging-drill.sh", "tools/private-staging-qa.sh"}
    require(set(release["files"]) == expected, "release-files")
    for name, digest in release["files"].items():
        path = STAGE / name
        regular(path)
        require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, "release-hash")
    image = inspect("image", IMAGE)
    require(image.get("Os") == "linux" and image.get("Architecture") == "amd64" and IMAGE in image.get("RepoDigests", []) and image["Config"]["Labels"]["org.opencontainers.image.revision"] == REVISION, "image-pin")
    volume(DATA)


def containers() -> dict:
    ids = docker("ps", "--all", "--quiet", "--no-trunc", "--filter", "label=com.docker.compose.project=" + PROJECT).stdout.split()
    require(len(ids) == 2 and all(re.fullmatch(r"[a-f0-9]{64}", value) for value in ids), "container-count")
    found = {}
    for cid in ids:
        c = inspect("container", cid)
        cfg, host = c["Config"], c["HostConfig"]
        labels = cfg.get("Labels") or {}
        role = labels.get("com.docker.compose.service")
        require(role in ("app", "proxy") and role not in found and labels.get("com.docker.compose.project") == PROJECT and c["Id"] == cid and cfg.get("Image") == IMAGE and cfg.get("User") == "node", "container-scope")
        require(not host.get("PortBindings") and not host.get("PublishAllPorts") and not host.get("Privileged") and host.get("NetworkMode") == PROJECT + "_default", "container-exposure")
        ports = c.get("NetworkSettings", {}).get("Ports") or {}
        require(isinstance(ports, dict) and all(not entry for entry in ports.values()), "container-exposure")
        require("ALL" in (host.get("CapDrop") or []) and any(value.startswith("no-new-privileges") for value in (host.get("SecurityOpt") or [])), "container-hardening")
        mounts = c.get("Mounts") or []
        expected = {
            "app": {"/app/.data": ("volume", DATA, True), "/app/staging-tools/private-staging-verify.mjs": ("bind", str(STAGE / "tools/private-staging-verify.mjs"), False)},
            "proxy": {"/runtime": ("bind", str(STAGE / "runtime"), True), "/app/staging-tools/private-staging-proxy.mjs": ("bind", str(STAGE / "tools/private-staging-proxy.mjs"), False)},
        }[role]
        require(len(mounts) == len(expected), "container-mounts")
        for mount in mounts:
            target = mount.get("Destination")
            actual = (mount.get("Type"), mount.get("Name") if mount.get("Type") == "volume" else mount.get("Source"), mount.get("RW"))
            require(target in expected and actual == expected[target], "container-mounts")
        if role == "proxy":
            require(host.get("ReadonlyRootfs") is True, "container-hardening")
        found[role] = c
    network = inspect("network", PROJECT + "_default")
    require(network.get("Internal") is True and network.get("Labels", {}).get("com.docker.compose.project") == PROJECT, "network-scope")
    return found


def healthy(found: dict) -> bool:
    return all(c["State"].get("Running") is True and c["State"].get("Health", {}).get("Status") == "healthy" for c in found.values())


def http_health() -> bool:
    path = STAGE / "runtime/http.sock"
    try:
        require(stat.S_ISSOCK(path.lstat().st_mode), "transport-scope")
        connection = http.client.HTTPConnection("localhost", timeout=5)
        stream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        stream.settimeout(5)
        stream.connect(str(path))
        connection.sock = stream
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        response.read(65536)
        okay = response.status == 200
        connection.close()
        return okay
    except (OSError, Refused, http.client.HTTPException):
        return False


def compose(*args: str) -> None:
    docker("compose", "--env-file", "/dev/null", "--project-name", PROJECT, "--project-directory", str(STAGE), "--file", str(STAGE / "compose.yaml"), *args, extra_env={"STAGING_IMAGE": IMAGE})


def write_status(action: str, value: dict) -> None:
    private_dir(OPS)
    destination = OPS / ("last-" + action + ".json")
    if destination.exists() or destination.is_symlink():
        regular(destination)
    temporary = OPS / (".status-" + secrets.token_hex(12))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump(value, output, separators=(",", ":"))
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, destination)


def invocation_id() -> str | None:
    value = os.environ.get("INVOCATION_ID", "")
    return value if re.fullmatch(r"[a-f0-9]{32}", value) else None


BACKUP_METADATA = r'''
import datetime as dt,hashlib,json,pathlib,re,subprocess,sys
root=pathlib.Path('/backups');marker=root/'.latest-backup.json'
assert root.is_dir() and not root.is_symlink() and not(root.stat().st_mode&0o077)
assert marker.is_file() and not marker.is_symlink() and marker.stat().st_size<=4096
receipt=json.loads(marker.read_text());name=receipt['archive']
assert re.fullmatch(r'bangla-data-\d{8}T\d{12}Z-[0-9a-f]{12}\.tar\.gz',name)
archive=root/name;assert archive.is_file() and not archive.is_symlink()
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as source:
  for block in iter(lambda:source.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
actual=digest(archive);assert actual==receipt['sha256']
verify=subprocess.run(['python3','scripts/backup_restore.py','verify',str(archive)],capture_output=True,text=True,check=True)
value=json.loads(verify.stdout);assert value['verified'] is True
created=dt.datetime.fromisoformat(value['created_at']);assert created.tzinfo is not None
inventory={name:actual,'.latest-backup.json':digest(marker)}
if sys.argv[1]=='inventory':
 for p in sorted(root.iterdir()):
  assert p.is_file() and not p.is_symlink()
  inventory[p.name]=digest(p)
print(json.dumps({'verified':True,'createdEpoch':created.timestamp(),'archiveBytes':archive.stat().st_size,'sha256':actual,'inventoryDigest':hashlib.sha256(json.dumps(inventory,sort_keys=True).encode()).hexdigest()}))
'''


def backup_metadata(*, full_inventory: bool = False) -> dict:
    volume(BACKUPS)
    result = isolated_run("--network", "none", "--user", "node", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m", "--mount", "type=volume,source=" + BACKUPS + ",target=/backups,readonly", "--entrypoint", "python3", IMAGE, "-", "inventory" if full_inventory else "latest", data=BACKUP_METADATA, timeout=180)
    require(result.returncode == 0, "backup-metadata-failed")
    value = json.loads(result.stdout)
    require(set(value) == {"verified", "createdEpoch", "archiveBytes", "sha256", "inventoryDigest"} and value["verified"] is True and re.fullmatch(r"[a-f0-9]{64}", value["sha256"]) and re.fullmatch(r"[a-f0-9]{64}", value["inventoryDigest"]), "backup-metadata")
    return value


def last_backup_passed() -> bool:
    try:
        path = OPS / "last-backup.json"
        regular(path)
        value = json.loads(path.read_text())
        return value.get("scope") == SCOPE and value.get("action") == "backup" and value.get("verified") is True
    except (OSError, ValueError, Refused):
        return False


def monitor() -> dict:
    found = containers()
    try:
        metadata = backup_metadata()
        backup = {"verified": True, "createdEpoch": metadata["createdEpoch"]}
    except (Refused, ValueError, KeyError):
        backup = {"verified": False, "createdEpoch": None}
    spec = importlib.util.spec_from_file_location("private_staging_ops_check", Path(__file__).with_name("private-staging-ops-check.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    free = os.statvfs(STAGE)
    value = module.evaluate({"checkedAtEpoch": time.time(), "health": http_health(), "containersHealthy": healthy(found), "publishedPorts": 0, "freeDiskBytes": free.f_bavail * free.f_frsize, "backup": backup, "lastBackupRunPassed": last_backup_passed()})
    value["invocationId"] = invocation_id()
    write_status("monitor", value)
    return value


def ensure_backups() -> None:
    existing = docker("volume", "inspect", BACKUPS, okay=True)
    if existing.returncode:
        docker("volume", "create", "--label", "com.docker.compose.project=" + PROJECT, "--label", "io.bangla.scope=private-staging", BACKUPS)
    volume(BACKUPS)
    result = isolated_run("--network", "none", "--user", "root", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE", "--security-opt", "no-new-privileges:true", "--mount", "type=volume,source=" + BACKUPS + ",target=/backups", "--entrypoint", "sh", IMAGE, "-c", "chown 0:0 /backups && chmod 0700 /backups && chown 1000:1000 /backups")
    require(result.returncode == 0, "backup-directory-initialization")


def clean_digest(found: dict) -> str:
    value = json.loads(docker("exec", found["app"]["Id"], "node", "/app/staging-tools/private-staging-verify.mjs").stdout)
    require(value.get("verified") is True and re.fullmatch(r"[a-f0-9]{64}", value["stateDigest"]), "clean-stage-required")
    return value["stateDigest"]


def backup_command(destination: str, *, readonly: bool = False) -> subprocess.CompletedProcess:
    code = r'''
import sqlite3,subprocess,sys
try:
 with sqlite3.connect('file:/app/.data/bangla-adventures.db?mode=ro',uri=True) as db:
  assert db.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
  assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
 result=subprocess.run(['bash','scripts/backup.sh','/backups','14','--application-stopped'],capture_output=True,text=True)
 if result.returncode:sys.exit(1)
 print(result.stdout,end='')
except Exception:sys.exit(1)
'''
    return isolated_run("--network", "none", "--user", "node", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m", "--mount", "type=volume,source=" + DATA + ",target=/app/.data,readonly", "--mount", "type=volume,source=" + destination + ",target=/backups" + (",readonly" if readonly else ""), "--env", "DATABASE_PATH=/app/.data/bangla-adventures.db", "--env", "MEDIA_ROOT=/app/.data/media", "--entrypoint", "python3", IMAGE, "-", data=code, timeout=300)


def run_maintenance(*, exercise: bool) -> dict:
    action = "exercise" if exercise else "backup"
    found = containers()
    require(healthy(found) and http_health(), "stage-unhealthy-before-maintenance")
    disk = os.statvfs(STAGE)
    require(disk.f_bavail * disk.f_frsize >= 1024 ** 3, "disk-low")
    ensure_backups()
    before = clean_digest(found) if exercise else None
    original_backups = backup_metadata(full_inventory=True) if exercise else None
    drill_id = secrets.token_hex(12) if exercise else None
    destination = "bangla-private-ops-drill-" + drill_id if exercise else BACKUPS
    stopped = False
    expected_failure = False
    resumed = False
    cleanup_verified = not exercise
    failure = None
    try:
        if exercise:
            require(docker("volume", "inspect", destination, okay=True).returncode != 0, "drill-resource-exists")
            docker("volume", "create", "--label", "io.bangla.scope=private-ops-drill", "--label", "io.bangla.ops.id=" + drill_id, destination)
            volume(destination, drill_id=drill_id)
            initialised = isolated_run("--network", "none", "--user", "root", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE", "--security-opt", "no-new-privileges:true", "--mount", "type=volume,source=" + destination + ",target=/backups", "--entrypoint", "sh", IMAGE, "-c", "chown 0:0 /backups && chmod 0700 /backups && chown 1000:1000 /backups")
            require(initialised.returncode == 0, "drill-directory-initialization")
        stopped = True  # Recovery also runs after a partially successful stop.
        compose("stop", "proxy", "app")
        state = containers()
        require(all(not c["State"].get("Running") for c in state.values()), "writers-not-stopped")
        require(not docker("ps", "--quiet", "--filter", "volume=" + DATA).stdout.strip(), "source-still-in-use")
        result = backup_command(destination, readonly=exercise)
        if exercise:
            expected_failure = result.returncode != 0
            require(expected_failure, "fault-not-observed")
        else:
            require(result.returncode == 0, "snapshot-failed")
            receipt = json.loads(result.stdout)
            require(receipt.get("verified") is True, "snapshot-unverified")
    except BaseException as exc:
        failure = exc
    finally:
        if stopped:
            try:
                cleanup_helpers()  # Never resume writers while a timed-out backup helper remains.
                compose("up", "--detach", "--no-build", "--wait", "--wait-timeout", "180", "app", "proxy")
                resumed = healthy(containers()) and http_health()
            except BaseException:
                resumed = False
        if exercise and drill_id:
            try:
                volume(destination, drill_id=drill_id)
                require(not docker("ps", "--all", "--quiet", "--filter", "volume=" + destination).stdout.strip(), "drill-volume-in-use")
                docker("volume", "rm", destination)
                cleanup_verified = docker("volume", "inspect", destination, okay=True).returncode != 0
            except BaseException:
                cleanup_verified = False
    require(resumed, "resume-failed")
    if failure:
        raise failure
    result = {"scope": SCOPE, "action": action, "verified": True, "status": "passed", "checkedAtEpoch": time.time(), "invocationId": invocation_id(), "checks": {"writersQuiesced": True, "applicationResumedHealthy": resumed}, "codes": []}
    metadata = backup_metadata(full_inventory=exercise)
    if exercise:
        unchanged = before == clean_digest(containers())
        archives_unchanged = original_backups["inventoryDigest"] == metadata["inventoryDigest"]
        require(unchanged and archives_unchanged and cleanup_verified, "exercise-state-or-cleanup")
        result["checks"].update({"expectedBackupFailureObserved": expected_failure, "logicalDataUnchanged": unchanged, "realBackupArchivesUnchanged": archives_unchanged, "disposableVolumeRemoved": cleanup_verified})
    else:
        result["checks"].update({"snapshotVerified": metadata["verified"]})
        result["backup"] = {key: metadata[key] for key in ("createdEpoch", "archiveBytes", "sha256")}
    write_status(action, result)
    return result


def acquire_lock():
    path = STAGE / ".deploy.lock"
    regular(path)
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    require(os.fstat(fd).st_uid == 1002, "lock-owner")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        os.close(fd)
        raise Refused("transaction-busy") from exc
    return fd


def main() -> int:
    require(len(sys.argv) == 2 and sys.argv[1] in ("monitor", "backup", "exercise", "status"), "invalid-action")
    action = sys.argv[1]
    platform()
    fd = acquire_lock()
    try:
        platform()  # Recheck the manifest/image/scope while holding the shared deployment lock.
        if action == "monitor":
            value = monitor()
        elif action in ("backup", "exercise"):
            value = run_maintenance(exercise=action == "exercise")
        else:
            reports = {}
            for name in ("backup", "monitor", "exercise"):
                path = OPS / ("last-" + name + ".json")
                if path.exists():
                    regular(path)
                    reports[name] = json.loads(path.read_text())
            value = {"scope": SCOPE, "action": "status", "verified": True, "status": "passed", "reports": reports}
        print(json.dumps(value, separators=(",", ":")))
        return 0 if value["verified"] else 1
    finally:
        os.close(fd)


if __name__ == "__main__":
    os.umask(0o077)
    # SIGTERM is handled as an exception so stopped staging services are resumed.
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(InterruptedError()))
    try:
        raise SystemExit(main())
    except (Refused, OSError, ValueError, KeyError, TypeError, InterruptedError, KeyboardInterrupt) as exc:
        code = exc.code if isinstance(exc, Refused) else "operation-failed"
        action = sys.argv[1] if len(sys.argv) == 2 and sys.argv[1] in ("monitor", "backup", "exercise", "status") else "invalid"
        value = {"scope": SCOPE, "action": action, "verified": False, "status": "deferred" if code == "transaction-busy" else "failed", "checkedAtEpoch": time.time(), "codes": [code]}
        try:
            if action != "invalid" and code != "transaction-busy":
                write_status(action, value)
        except (OSError, Refused):
            pass
        print(json.dumps(value, separators=(",", ":")))
        raise SystemExit(75 if code == "transaction-busy" else 1)
