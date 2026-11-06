#!/usr/bin/env python3
"""Install managed private-staging user units; no root/system units or offsite jobs."""
from __future__ import annotations

import grp
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import hashlib
import time
import signal

spec = importlib.util.spec_from_file_location("private_staging_ops", Path(__file__).with_name("private-staging-ops.py"))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

TOOLS = ("private-staging-ops.sh", "private-staging-ops.py", "private-staging-ops-check.py")
UNITS = ("ba-private-stage-backup.service", "ba-private-stage-backup.timer", "ba-private-stage-monitor.service", "ba-private-stage-monitor.timer")
TIMERS = ("ba-private-stage-backup.timer", "ba-private-stage-monitor.timer")
MARKER = b"# bangla-private-staging-operations-v1\n"


def userctl(*args: str, okay: bool = False):
    runtime = Path("/run/user/1002")
    ops.require(runtime.is_dir() and runtime.stat().st_uid == 1002, "user-runtime")
    bus = runtime / "bus"
    ops.require(stat.S_ISSOCK(bus.lstat().st_mode) and bus.stat().st_uid == 1002, "user-bus")
    return ops.command(["systemctl", "--user", "--no-pager", *args], okay=okay, extra_env={"XDG_RUNTIME_DIR": str(runtime), "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(bus)})


UNIT_PARTS = ("home", "config", "systemd", "user")


def private_group(user: ops.pwd.struct_passwd) -> int | None:
    """The user's own group when nobody else can be in it (Ubuntu's user private group)."""
    try:
        group = grp.getgrgid(user.pw_gid)
    except KeyError:
        return None
    others = [entry for entry in ops.pwd.getpwall() if entry.pw_gid == user.pw_gid and entry.pw_uid != user.pw_uid]
    return user.pw_gid if group.gr_name == user.pw_name and set(group.gr_mem) <= {user.pw_name} and not others else None


def unit_directory_problem(info: os.stat_result, resolved: bool, safe_group: int | None) -> str | None:
    """Units here run as the deployment user, so only that user may be able to change the path."""
    if not stat.S_ISDIR(info.st_mode) or not resolved:
        return "type"
    if info.st_uid != 1002:
        return "owner"
    # Ubuntu gives users with their own group a 002 umask, so their folders are group-writable.
    # That is only safe while the group is the user's private group.
    if info.st_mode & 0o002 or (info.st_mode & 0o020 and info.st_gid != safe_group):
        return "writable"
    return None


def owned_config(path: Path, *, create: bool = False) -> None:
    user = ops.pwd.getpwuid(1002)
    home = Path(user.pw_dir)
    ops.require(path == home / ".config/systemd/user", "user-unit-path")
    safe_group = private_group(user)
    for part, current in zip(UNIT_PARTS, (home, home / ".config", home / ".config/systemd", path)):
        if create and not current.exists():
            current.mkdir(mode=0o700)
        problem = unit_directory_problem(current.lstat(), current.resolve() == current, safe_group)
        ops.require(problem is None, f"unsafe-unit-directory-{part}-{problem}")


def atomic(path: Path, content: bytes) -> None:
    if path.exists() or path.is_symlink():
        ops.regular(path)
    temporary = path.with_name(".ba-private-ops-" + secrets.token_hex(12))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def fresh_service_result(action: str, started: float) -> dict:
    unit = "ba-private-stage-" + action + ".service"
    ops.require(userctl("show", unit, "--property=ExecMainStatus", "--value").stdout.strip() == "0", "initial-service-deferred-or-failed")
    path = ops.OPS / ("last-" + action + ".json")
    ops.regular(path)
    value = json.loads(path.read_text())
    ops.require(value.get("scope") == ops.SCOPE and value.get("action") == action and value.get("verified") is True and type(value.get("checkedAtEpoch")) in (int, float) and value["checkedAtEpoch"] >= started and re.fullmatch(r"[a-f0-9]{32}", value.get("invocationId") or ""), "initial-operations-check")
    return value


def main() -> int:
    ops.require(len(sys.argv) == 2, "invalid-install-arguments")
    payload = Path(sys.argv[1])
    ops.require(re.fullmatch(r"/opt/bangla-adventures/\.private-acceptance-payload\.[A-Za-z0-9]{12}", str(payload)), "payload-path")
    ops.private_dir(payload)
    for name in (*TOOLS, *UNITS):
        ops.regular(payload / name)
    for name in UNITS:
        ops.require((payload / name).read_bytes().startswith(MARKER), "unit-marker")
    ops.platform(operations=False)
    ops.require(ops.healthy(ops.containers()) and ops.http_health(), "stage-unhealthy-before-install")
    config = ops.systemd_dir()
    owned_config(config, create=True)
    if not ops.OPS.exists():
        ops.OPS.mkdir(mode=0o700)
    ops.private_dir(ops.OPS)
    receipt_path = ops.OPS / "installation.json"
    destinations = {ops.STAGE / "tools" / name: (payload / name).read_bytes() for name in TOOLS}
    destinations.update({config / name: (payload / name).read_bytes() for name in UNITS})
    previous = {}
    previous_receipt = None
    timer_states = {}

    def restore_previous():
        # Caller holds .deploy.lock until all file/timer rollback work is complete; stop requests wait for it.
        previous_signals = ops.quiet_signals()
        try:
            for name in TIMERS:
                userctl("stop", name, okay=True)
                if not timer_states.get(name, {}).get("enabled"):
                    userctl("disable", name, okay=True)
            for path, content in previous.items():
                if content is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic(path, content)
            if previous_receipt is None:
                receipt_path.unlink(missing_ok=True)
            else:
                atomic(receipt_path, previous_receipt)
            userctl("daemon-reload", okay=True)
            for name, state in timer_states.items():
                if state["enabled"]:
                    userctl("enable", name, okay=True)
                if state["active"]:
                    userctl("start", name, okay=True)
        finally:
            ops.restore_signals(previous_signals)

    lock = ops.acquire_lock()
    committed = False
    touched = False
    try:
        ops.platform(operations=False)
        previous_receipt = receipt_path.read_bytes() if receipt_path.exists() else None
        if previous_receipt is not None:
            ops.validate_installation()
        else:
            for name in TOOLS:
                ops.require(not (ops.STAGE / "tools" / name).exists() and not (ops.STAGE / "tools" / name).is_symlink(), "unmanaged-ops-tool")
            for name in UNITS:
                ops.require(not (config / name).exists() and not (config / name).is_symlink(), "unmanaged-user-unit")
        previous = {path: path.read_bytes() if path.exists() else None for path in destinations}
        for name in TIMERS:
            timer_states[name] = {
                "enabled": userctl("is-enabled", "--quiet", name, okay=True).returncode == 0,
                "active": userctl("is-active", "--quiet", name, okay=True).returncode == 0,
            }
        # A busy lock returns before stopping any prior timer or changing managed files.
        touched = True
        for name in TIMERS:
            if timer_states[name]["active"]:
                userctl("stop", name)
        for path, content in destinations.items():
            atomic(path, content)
        receipt = {"scope": ops.SCOPE, "localOnly": True, "installedAtEpoch": time.time(),
            "tools": {name: hashlib.sha256((payload / name).read_bytes()).hexdigest() for name in TOOLS},
            "units": {name: hashlib.sha256((payload / name).read_bytes()).hexdigest() for name in UNITS}}
        atomic(receipt_path, (json.dumps(receipt, sort_keys=True) + "\n").encode())
        userctl("daemon-reload")
        for name in UNITS:
            loaded = userctl("show", name, "--property=FragmentPath", "--value").stdout.strip()
            ops.require(loaded == str(config / name), "loaded-unit-path")
        committed = True
    finally:
        try:
            if touched and not committed:
                restore_previous()
        finally:
            os.close(lock)
    try:
        # Fresh systemd execution, not an older JSON report, proves integration.
        userctl("reset-failed", "ba-private-stage-backup.service", "ba-private-stage-monitor.service", okay=True)
        initial_runs = {}
        for action in ("backup", "monitor"):
            started = time.time()
            unit = "ba-private-stage-" + action + ".service"
            userctl("start", unit)
            value = fresh_service_result(action, started)
            initial_runs[action] = {"invocationId": value["invocationId"], "checkedAtEpoch": value["checkedAtEpoch"]}
            if action == "backup":
                initial_runs[action]["archiveSha256"] = value["backup"]["sha256"]
            else:
                initial_runs[action]["backupAgeSeconds"] = value["measures"]["backupAgeSeconds"]
        for name in TIMERS:
            userctl("enable", "--now", name)
            ops.require(userctl("is-enabled", "--quiet", name).returncode == 0 and userctl("is-active", "--quiet", name).returncode == 0, "timer-not-enabled")
    except BaseException:
        rollback_lock = ops.acquire_lock()
        try:
            restore_previous()
        finally:
            os.close(rollback_lock)
        raise
    result = {"scope": ops.SCOPE, "action": "install", "verified": True, "status": "passed",
        "timers": {"backup": True, "monitor": True}, "initialBackupVerified": True, "initialMonitorVerified": True,
        "localOnly": True, "retentionCount": 14, "backupSchedule": "03:30 UTC daily", "monitorIntervalSeconds": 300, "initialRuns": initial_runs}
    print(json.dumps(result, separators=(",", ":")))
    return 0


def failure_code(exc: BaseException) -> str:
    if isinstance(exc, ops.Refused):
        return exc.code
    return "interrupted" if isinstance(exc, (ops.Stopped, KeyboardInterrupt)) else "install-failed"


if __name__ == "__main__":
    os.umask(0o077)
    # Stop requests and hang-ups become exceptions, so a partial installation is rolled back.
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, ops.interrupted)
    try:
        raise SystemExit(main())
    except (ops.Refused, OSError, ValueError, KeyError, TypeError, KeyboardInterrupt, ops.Stopped) as exc:
        print(json.dumps({"scope": ops.SCOPE, "action": "install", "verified": False, "status": "failed", "codes": [failure_code(exc)]}, separators=(",", ":")))
        raise SystemExit(1)
