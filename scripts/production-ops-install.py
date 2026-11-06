#!/usr/bin/env python3
"""Install or update the production operations user units and tools; no root or system units.

Also keeps the status key's single restricted line in the deployment user's ~/.ssh/authorized_keys.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import importlib.util
import json
import os
import pathlib
from pathlib import Path
import re
import secrets
import signal
import sys
import time

spec = importlib.util.spec_from_file_location("production_ops", Path(__file__).with_name("production-ops.py"))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

MARKER = b"# bangla-production-operations-v1\n"
PAYLOAD = re.compile(r"/opt/bangla-adventures/ops/\.incoming\.[A-Za-z0-9]{12}")
UNIT_PARTS = ("home", "config", "systemd", "user")
SERVICE_TIMEOUT = {"backup": 45 * 60, "offsite": 4 * 3600, "monitor": 10 * 60}
# A rollback waits this long for a running deploy (its health wait is minutes) before giving up on the lock.
ROLLBACK_LOCK_WAIT = 20 * 60
# The controller's key request: public halves only, never a private key.
KEY_REQUEST = "status-key.json"
# The status key's managed line: this exact start and comment, whatever the key's own comment was.
STATUS_PREFIX = b'restrict,command="bash /opt/bangla-adventures/ops/tools/production-ops.sh status" ssh-ed25519 '
STATUS_COMMENT = b" bangla-adventures-status"
ED25519 = re.compile(r"ssh-ed25519 ([A-Za-z0-9+/]{68})")
PUBLIC_KEY = re.compile(r"([a-z0-9][a-z0-9@.-]{0,63}) ([A-Za-z0-9+/]{16,16384}={0,2})")
KEY_TYPE = re.compile(rb"[a-z0-9][a-z0-9@.-]{0,63}")
MAX_AUTHORIZED_KEYS = 1024 * 1024


class InstallFailed(ops.Refused):
    """A failure after files changed, with what the rollback achieved: complete, incomplete or failed."""

    def __init__(self, codes: list[str], rollback: str):
        super().__init__(*codes, *({"incomplete": ["rollback-incomplete"], "failed": ["rollback-failed"]}.get(rollback, [])))
        self.rollback = rollback


def failure_codes(exc: BaseException) -> list[str]:
    if isinstance(exc, ops.Refused):
        return exc.codes
    return ["interrupted" if isinstance(exc, (ops.Stopped, KeyboardInterrupt)) else "install-failed"]


def wait_for_deploy_lock(prod, timeout: float) -> int | None:
    """The deploy lock, waiting for a running deploy to finish; None if it is still busy."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            return prod.deploy_lock()
        except ops.Refused as exc:
            if exc.code != "transaction-busy":
                raise
        if time.monotonic() >= deadline:
            return None
        time.sleep(5)


def unit_directory_problem(info: os.stat_result, resolved: bool, safe_group: int | None) -> str | None:
    """The private staging installer's rule: units run as the deployment user, so only it may change the path."""
    return ops.directory_problem(info, resolved, (ops.OWNER,), safe_group)


def owned_config(prod, path: Path, *, create: bool = False) -> None:
    user = ops.pwd.getpwuid(prod.s.uid)
    home = Path(user.pw_dir)
    ops.require(path == home / ".config/systemd/user", "user-unit-path")
    safe_group = ops.private_group(user)
    for part, current in zip(UNIT_PARTS, (home, home / ".config", home / ".config/systemd", path)):
        if create and not os.path.lexists(current):
            current.mkdir(mode=0o700)
        problem = ops.directory_problem(current.lstat(), current.resolve() == current, (prod.s.uid,), safe_group)
        ops.require(problem is None, f"unsafe-unit-directory-{part}-{problem}")


def atomic(path: Path, content: bytes, owner: int) -> None:
    if os.path.lexists(path):
        ops.regular(path, owner)
    temporary = path.with_name(".ba-production-ops-" + secrets.token_hex(12))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def userctl(prod, *args: str, okay: bool = False, timeout: int = 60):
    runtime = Path("/run/user") / str(prod.s.uid)
    ops.require(runtime.is_dir() and runtime.stat().st_uid == prod.s.uid, "user-runtime")
    bus = runtime / "bus"
    ops.require(os.path.lexists(bus) and ops.stat.S_ISSOCK(bus.lstat().st_mode) and bus.lstat().st_uid == prod.s.uid, "user-bus")
    return prod.command(["systemctl", "--user", "--no-pager", *args], okay=okay, timeout=timeout,
                        extra_env={"XDG_RUNTIME_DIR": str(runtime), "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(bus)})


def fresh_service_result(prod, action: str, started: float) -> dict:
    """Only this run's systemd execution counts, never an older or deferred report."""
    unit = "ba-production-" + action + ".service"
    status = userctl(prod, "show", unit, "--property=ExecMainStatus", "--value").stdout.strip()
    report = prod.read_report(action)
    fresh = (report is not None and ops.numeric(report.get("checkedAtEpoch")) and report["checkedAtEpoch"] >= started
             and re.fullmatch(r"[a-f0-9]{32}", report.get("invocationId") or "") is not None)
    if status != "0":
        codes = ["initial-" + action + ("-deferred" if status == "75" else "-failed")]
        raise ops.Refused(*codes, *(ops.clean_codes(report.get("codes")) if fresh else []))
    ops.require(fresh and report.get("verified") is True, "initial-operations-check")
    return report


# The status key's line in ~/.ssh/authorized_keys -------------------------------------------

def decoded(text: str | bytes) -> bytes | None:
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        return None


def blob_type(blob: bytes) -> bytes | None:
    """The key type named by a public key blob's first field."""
    size = int.from_bytes(blob[:4], "big") if len(blob) >= 4 else 0
    return blob[4:4 + size] if 0 < size <= 64 and len(blob) >= 4 + size else None


def public_key(text, *, ed25519: bool = False) -> tuple[bytes, bytes]:
    """A request's 'TYPE BASE64' as (type, blob); the status key must be a plain ed25519 key."""
    match = (ED25519 if ed25519 else PUBLIC_KEY).fullmatch(text) if isinstance(text, str) else None
    ops.require(match is not None, "status-key-request-invalid")
    kind, encoded = ("ssh-ed25519", match.group(1)) if ed25519 else match.groups()
    blob = decoded(encoded)
    ops.require(blob is not None and blob_type(blob) == kind.encode(), "status-key-request-invalid")
    # ed25519: the type field, then one 32-byte key and nothing else.
    ops.require(not ed25519 or (len(blob) == 51 and blob[15:19] == (32).to_bytes(4, "big")), "status-key-request-invalid")
    return kind.encode(), blob


def key_request(path: Path) -> dict:
    """What this install does with the status key: unchanged, install or remove."""
    try:
        ops.require(path.stat().st_size <= 65536, "status-key-request-invalid")
        value = json.loads(path.read_bytes())
    except (OSError, ValueError) as exc:
        raise ops.Refused("status-key-request-invalid") from exc
    ops.require(isinstance(value, dict) and set(value) == {"deployKey", "statusKey"}, "status-key-request-invalid")
    deploy = public_key(value["deployKey"])
    if value["statusKey"] is None:
        return {"action": "unchanged", "deploy": deploy}
    if value["statusKey"] == "remove":
        return {"action": "remove", "deploy": deploy}
    _, blob = public_key(value["statusKey"], ed25519=True)
    ops.require(blob != deploy[1], "status-key-is-deploy-key")
    return {"action": "install", "deploy": deploy, "status": blob, "line": STATUS_PREFIX + base64.b64encode(blob) + STATUS_COMMENT}


def lines_of(data: bytes) -> list[bytes]:
    """Each line with its own ending; the last one may have none."""
    parts = data.split(b"\n")
    return [part + b"\n" for part in parts[:-1]] + ([parts[-1]] if parts[-1] else [])


def text_of(line: bytes) -> bytes:
    line = line[:-1] if line.endswith(b"\n") else line
    return line[:-1] if line.endswith(b"\r") else line


def managed(line: bytes) -> bool:
    text = text_of(line)
    return text.startswith(STATUS_PREFIX) and text.endswith(STATUS_COMMENT)


def key_at(text: bytes) -> tuple[bytes, bytes] | None:
    fields = text.split(None, 2)
    if len(fields) < 2 or KEY_TYPE.fullmatch(fields[0]) is None:
        return None
    blob = decoded(fields[1])
    return (fields[0], blob) if blob is not None and blob_type(blob) == fields[0] else None


def line_key(line: bytes) -> tuple[bytes, bytes] | None:
    """The key on an authorized_keys line, read as sshd does: a key, or options and then a key."""
    text = text_of(line).lstrip(b" \t")
    if not text or text.startswith(b"#"):
        return None
    found = key_at(text)
    if found is not None:
        return found
    # Options end at the first blank outside double quotes; \" does not end a quoted value.
    quoted, index = False, 0
    while index < len(text) and (quoted or text[index] not in b" \t"):
        if text[index:index + 2] == b'\\"':
            index += 1
        elif text[index] == ord('"'):
            quoted = not quoted
        index += 1
    return None if quoted else key_at(text[index:].lstrip(b" \t"))


def plan_status_key(current: bytes, request: dict) -> tuple[str, bytes | None]:
    """The outcome and the new file, or None when the file already holds what was asked."""
    lines = lines_of(current)
    unmanaged = [line for line in lines if not managed(line)]
    found = [line for line in lines if managed(line)]
    # The deploy key on a line of its own proves sshd reads this file, and deploy access stays as it is.
    ops.require(any(line_key(line) == request["deploy"] for line in unmanaged), "authorized-keys-not-in-use")
    if request["action"] == "remove":
        return ("removed", b"".join(unmanaged)) if found else ("already-absent", None)
    # Never restrict or duplicate a key someone else authorized.
    encoded = base64.b64encode(request["status"])
    ops.require(not any(encoded in line or (line_key(line) or (b"", b""))[1] == request["status"] for line in unmanaged),
                "status-key-already-authorized")
    if [text_of(line) for line in found] == [request["line"]]:
        return "already-present", None
    terminated = [line for line in unmanaged if line.endswith(b"\n")]
    ending = b"\r\n" if terminated and terminated[-1].endswith(b"\r\n") else b"\n"
    body = b"".join(unmanaged)
    if body and not body.endswith(b"\n"):
        body += b"\n" if body.endswith(b"\r") else ending
    return ("replaced" if found else "installed"), body + request["line"] + ending


def check_written(data: bytes, previous: bytes, expected: bytes, request: dict) -> None:
    """The file read back holds what was planned: every other line unchanged, the deploy key still there."""
    ops.require(data == expected, "authorized-keys-verify-failed")
    before, after = lines_of(previous), lines_of(data)
    ops.require([text_of(line) for line in after if not managed(line)] == [text_of(line) for line in before if not managed(line)],
                "authorized-keys-verify-failed")
    wanted = [request["line"]] if request["action"] == "install" else []
    ops.require([text_of(line) for line in after if managed(line)] == wanted, "authorized-keys-verify-failed")
    ops.require(any(line_key(line) == request["deploy"] for line in after if not managed(line)), "authorized-keys-verify-failed")


def ssh_folder(prod) -> pathlib.Path:
    return pathlib.Path(ops.pwd.getpwuid(prod.s.uid).pw_dir) / ".ssh"


def read_authorized_keys(folder: pathlib.Path, uid: int) -> bytes:
    """authorized_keys, only from a folder and file that sshd's StrictModes accepts; never a link."""
    try:
        info = folder.lstat()
    except FileNotFoundError as exc:
        raise ops.Refused("authorized-keys-not-in-use") from exc
    ops.require(ops.stat.S_ISDIR(info.st_mode) and info.st_uid == uid and not info.st_mode & 0o022 and folder.resolve() == folder,
                "unsafe-ssh-directory")
    path = folder / "authorized_keys"
    try:
        info = path.lstat()
    except FileNotFoundError as exc:
        raise ops.Refused("authorized-keys-not-in-use") from exc
    ops.require(ops.stat.S_ISREG(info.st_mode) and info.st_uid == uid and not info.st_mode & 0o022 and info.st_size <= MAX_AUTHORIZED_KEYS,
                "unsafe-authorized-keys")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as handle:
        opened = os.fstat(handle.fileno())
        ops.require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino), "unsafe-authorized-keys")
        data = handle.read(MAX_AUTHORIZED_KEYS + 1)
    ops.require(len(data) <= MAX_AUTHORIZED_KEYS, "unsafe-authorized-keys")
    return data


def write_authorized_keys(folder: pathlib.Path, data: bytes) -> None:
    """Atomic replacement: a private temporary file in ~/.ssh, fsync, rename, then fsync of the folder."""
    temporary = folder / (".authorized_keys.ba-" + secrets.token_hex(12))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, folder / "authorized_keys")
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    directory = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


class StatusKey:
    """The status key's managed line: planned before anything changes, written once, restorable."""

    def __init__(self, prod, request: dict):
        self.uid = prod.s.uid
        self.folder = ssh_folder(prod)
        self.request = request
        self.previous = read_authorized_keys(self.folder, self.uid)
        self.outcome, self.planned = plan_status_key(self.previous, request)
        self.written = None

    def apply(self) -> str:
        if self.planned is None:
            return self.outcome
        ops.require(read_authorized_keys(self.folder, self.uid) == self.previous, "authorized-keys-changed")
        self.written = self.planned
        write_authorized_keys(self.folder, self.planned)
        try:
            check_written(read_authorized_keys(self.folder, self.uid), self.previous, self.planned, self.request)
        except (ops.Refused, OSError) as exc:
            write_authorized_keys(self.folder, self.previous)
            self.written = None
            raise ops.Refused("authorized-keys-verify-failed") from exc
        return self.outcome

    def restore(self) -> None:
        """The previous bytes again, unless someone else has changed the file since this install wrote it."""
        if self.written is None:
            return
        current = read_authorized_keys(self.folder, self.uid)
        if current != self.previous:
            ops.require(current == self.written, "authorized-keys-changed")
            write_authorized_keys(self.folder, self.previous)
            ops.require(read_authorized_keys(self.folder, self.uid) == self.previous, "authorized-keys-verify-failed")
        self.written = None


def main(argv: list[str]) -> int:
    ops.require(len(argv) == 2, "invalid-install-arguments")
    settings = ops.Settings()
    # The server always runs the production values.
    ops.require(not settings.overridden, "overrides-not-allowed")
    prod = ops.Production(settings)
    payload = Path(argv[1])
    ops.require(PAYLOAD.fullmatch(str(payload)) is not None, "payload-path")
    prod.check_user()
    ops.private_dir(settings.ops, settings.uid)
    ops.private_dir(payload, settings.uid)
    for name in (*ops.TOOLS, *ops.UNITS, KEY_REQUEST):
        ops.regular(payload / name, settings.uid)
    for name in ops.UNITS:
        ops.require((payload / name).read_bytes().startswith(MARKER), "unit-marker")
    request = key_request(payload / KEY_REQUEST)
    prod.check_docker()
    cfg = prod.env_settings()
    running, healthy = prod.serving_state(prod.app(prod.containers(cfg)))
    ops.require(healthy and prod.loopback_health(cfg["port"]), "app-unhealthy-before-install")
    # Without lingering the user manager, and so every timer, stops when the last session ends.
    ops.require(prod.lingering(), "user-linger-disabled")
    config = prod.systemd_dir()
    owned_config(prod, config, create=True)
    if not os.path.lexists(settings.tools):
        settings.tools.mkdir(mode=0o700)
    ops.private_dir(settings.tools, settings.uid)
    receipt_path = settings.ops / "installation.json"
    destinations = {settings.tools / name: (payload / name).read_bytes() for name in ops.TOOLS}
    destinations.update({config / name: (payload / name).read_bytes() for name in ops.UNITS})
    previous = {}
    previous_receipt = None
    timer_states = {}
    status_key = None
    status_outcome = "unchanged"

    def stop_new_timers():
        for name in ops.TIMERS.values():
            userctl(prod, "stop", name, okay=True)
            if not timer_states.get(name, {}).get("enabled"):
                userctl(prod, "disable", name, okay=True)

    def start_previous_timers():
        for name, state in timer_states.items():
            if state["enabled"]:
                userctl(prod, "enable", name, okay=True)
            if state["active"]:
                userctl(prod, "start", name, okay=True)

    def restore_previous():
        # The caller holds .deploy.lock until all file and timer rollback work is complete.
        stop_new_timers()
        for path, content in previous.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                atomic(path, content, settings.uid)
        if previous_receipt is None:
            receipt_path.unlink(missing_ok=True)
        else:
            atomic(receipt_path, previous_receipt, settings.uid)
        userctl(prod, "daemon-reload", okay=True)
        start_previous_timers()
        if status_key is not None:
            status_key.restore()

    def rollback(held: int | None) -> str:
        """Put the previous files and timer states back; once started, stop requests wait for it."""
        previous_signals = ops.quiet_signals()
        try:
            lock_fd = held if held is not None else wait_for_deploy_lock(prod, ROLLBACK_LOCK_WAIT)
            if lock_fd is None:
                # A deploy still holds the lock: leave the files, but bring back the earlier timer states
                # so scheduled jobs carry on (each defers while the deploy runs).
                stop_new_timers()
                start_previous_timers()
                return "incomplete"
            try:
                restore_previous()
            finally:
                if held is None:
                    os.close(lock_fd)
            return "complete"
        except BaseException:
            return "failed"
        finally:
            ops.restore_signals(previous_signals)

    lock = prod.deploy_lock()
    touched = False
    try:
        previous_receipt = receipt_path.read_bytes() if os.path.lexists(receipt_path) else None
        if previous_receipt is not None:
            prod.validate_installation()
        else:
            for path in destinations:
                ops.require(not os.path.lexists(path), "unmanaged-file")
        previous = {path: path.read_bytes() if os.path.lexists(path) else None for path in destinations}
        # Unset STATUS_SSH_PUBLIC_KEY never reads authorized_keys; a refusal here changes nothing.
        if request["action"] != "unchanged":
            status_key = StatusKey(prod, request)
        for name in ops.TIMERS.values():
            timer_states[name] = {
                "enabled": userctl(prod, "is-enabled", "--quiet", name, okay=True).returncode == 0,
                "active": userctl(prod, "is-active", "--quiet", name, okay=True).returncode == 0,
            }
        # A busy lock returns before stopping any prior timer or changing managed files.
        touched = True
        for name in ops.TIMERS.values():
            if timer_states[name]["active"]:
                userctl(prod, "stop", name)
        for path, content in destinations.items():
            atomic(path, content, settings.uid)
        receipt = {"scope": ops.SCOPE, "installedAtEpoch": time.time(),
                   "tools": {name: hashlib.sha256((payload / name).read_bytes()).hexdigest() for name in ops.TOOLS},
                   "units": {name: hashlib.sha256((payload / name).read_bytes()).hexdigest() for name in ops.UNITS}}
        atomic(receipt_path, (json.dumps(receipt, sort_keys=True) + "\n").encode(), settings.uid)
        if status_key is not None:
            status_outcome = status_key.apply()
        userctl(prod, "daemon-reload")
        for name in ops.UNITS:
            loaded = userctl(prod, "show", name, "--property=FragmentPath", "--value").stdout.strip()
            ops.require(loaded == str(config / name), "loaded-unit-path")
    except BaseException as exc:
        if not touched:
            raise
        raise InstallFailed(failure_codes(exc), rollback(lock)) from exc
    finally:
        os.close(lock)
    try:
        offsite = prod.offsite_configured()
        # Fresh systemd runs, not an older JSON report, prove the installed jobs work.
        services = [f"ba-production-{name}.service" for name in ops.REPORTS]
        userctl(prod, "reset-failed", *services, okay=True)
        initial = {}
        for action in ("backup", "offsite", "monitor"):
            if action == "offsite" and not offsite:
                continue
            started = time.time()
            userctl(prod, "start", f"ba-production-{action}.service", okay=True, timeout=SERVICE_TIMEOUT[action])
            value = fresh_service_result(prod, action, started)
            initial[action] = {"invocationId": value["invocationId"], "checkedAtEpoch": value["checkedAtEpoch"]}
            if action == "backup":
                initial[action].update(archiveSha256=value["backup"]["sha256"], downtimeSeconds=value["measures"]["downtimeSeconds"])
            elif action == "offsite":
                initial[action]["snapshotId"] = value["copy"]["snapshotId"]
            else:
                initial[action]["backupAgeSeconds"] = value["measures"]["backupAgeSeconds"]
        for name in ops.TIMERS.values():
            userctl(prod, "enable", "--now", name)
            ops.require(userctl(prod, "is-enabled", "--quiet", name, okay=True).returncode == 0
                        and userctl(prod, "is-active", "--quiet", name, okay=True).returncode == 0, "timer-not-enabled")
    except BaseException as exc:
        # The deploy lock was released for the runs; a deploy may hold it now (a deferred run).
        raise InstallFailed(failure_codes(exc), rollback(None)) from exc
    result = {"scope": ops.SCOPE, "action": "install", "verified": True, "status": "passed", "codes": [],
              "timers": {name: True for name in ops.TIMERS}, "offsiteConfigured": offsite, "initialRuns": initial,
              "retentionCount": ops.KEEP, "backupSchedule": "16:30 UTC daily", "offsiteSchedule": "17:15 UTC daily",
              "monitorIntervalSeconds": 300, "resticImage": ops.RESTIC_IMAGE, "statusKey": status_outcome}
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, ops.interrupted)
    try:
        raise SystemExit(main(sys.argv))
    except (Exception, KeyboardInterrupt, ops.Stopped) as exc:
        # "none": nothing had changed yet; otherwise what the rollback achieved.
        print(json.dumps({"scope": ops.SCOPE, "action": "install", "verified": False, "status": "failed", "codes": failure_codes(exc),
                          "rollback": getattr(exc, "rollback", "none")}, separators=(",", ":")))
        raise SystemExit(1)
