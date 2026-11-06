#!/usr/bin/env python3
"""Install or update the production operations user units and tools; no root or system units."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
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
    for name in (*ops.TOOLS, *ops.UNITS):
        ops.regular(payload / name, settings.uid)
    for name in ops.UNITS:
        ops.require((payload / name).read_bytes().startswith(MARKER), "unit-marker")
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

    def restore_previous():
        # The caller holds .deploy.lock until all file and timer rollback work is complete.
        for name in ops.TIMERS.values():
            userctl(prod, "stop", name, okay=True)
            if not timer_states.get(name, {}).get("enabled"):
                userctl(prod, "disable", name, okay=True)
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
        for name, state in timer_states.items():
            if state["enabled"]:
                userctl(prod, "enable", name, okay=True)
            if state["active"]:
                userctl(prod, "start", name, okay=True)

    lock = prod.deploy_lock()
    committed = False
    touched = False
    try:
        previous_receipt = receipt_path.read_bytes() if os.path.lexists(receipt_path) else None
        if previous_receipt is not None:
            prod.validate_installation()
        else:
            for path in destinations:
                ops.require(not os.path.lexists(path), "unmanaged-file")
        previous = {path: path.read_bytes() if os.path.lexists(path) else None for path in destinations}
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
        userctl(prod, "daemon-reload")
        for name in ops.UNITS:
            loaded = userctl(prod, "show", name, "--property=FragmentPath", "--value").stdout.strip()
            ops.require(loaded == str(config / name), "loaded-unit-path")
        committed = True
    finally:
        try:
            if touched and not committed:
                restore_previous()
        finally:
            os.close(lock)
    offsite = prod.offsite_configured()
    try:
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
    except BaseException:
        rollback = prod.deploy_lock()
        try:
            restore_previous()
        finally:
            os.close(rollback)
        raise
    result = {"scope": ops.SCOPE, "action": "install", "verified": True, "status": "passed", "codes": [],
              "timers": {name: True for name in ops.TIMERS}, "offsiteConfigured": offsite, "initialRuns": initial,
              "retentionCount": ops.KEEP, "backupSchedule": "16:30 UTC daily", "offsiteSchedule": "17:15 UTC daily",
              "monitorIntervalSeconds": 300, "resticImage": ops.RESTIC_IMAGE}
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, ops.interrupted)
    try:
        raise SystemExit(main(sys.argv))
    except (Exception, KeyboardInterrupt) as exc:
        codes = exc.codes if isinstance(exc, ops.Refused) else ["install-failed"]
        print(json.dumps({"scope": ops.SCOPE, "action": "install", "verified": False, "status": "failed", "codes": codes}, separators=(",", ":")))
        raise SystemExit(1)
