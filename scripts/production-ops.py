#!/usr/bin/env python3
"""Production operations on the rootless VPS: scheduled backup, monitoring, off-site copy, status.

Fixed scope and failure codes, finally-based recovery of the app, and no output of credentials,
the off-site repository location or the server address. See docs/PRODUCTION_OPERATIONS.md.
"""
from __future__ import annotations

import datetime as dt
import fcntl
import grp
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import pwd
import re
import secrets
import signal
import ssl
import stat
import subprocess
import sys
import time
import urllib.parse

SCOPE = "production-operations"
DEPLOYMENT = Path("/opt/bangla-adventures")
OWNER = 1002
DOCKER_HOST = "unix:///run/user/1002/docker.sock"
# Official restic image, pinned by its multi-platform index digest (restic 0.19.1, built 2026-07-05).
RESTIC_VERSION = "0.19.1"
RESTIC_IMAGE = "restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510"
RESTIC_TAG = "bangla-adventures"
# A fixed snapshot host: each helper container has a new hostname, which would defeat retention.
RESTIC_HOST = "bangla-adventures-production"
KEEP = 14
MIN_FREE_BYTES = 1024 ** 3  # The private staging threshold, on the same filesystem.
MAX_BACKUP_AGE = 36 * 3600
FUTURE_SKEW = 300
MAX_OFFSITE_AGE = 48 * 3600
MIN_CERTIFICATE_SECONDS = 14 * 86400
MAX_MONITOR_REPORT_AGE = 20 * 60
MAX_BACKUP_REPORT_AGE = 48 * 3600
PRECHECK_TIMEOUT = 120
HEALTH_TIMEOUT = 180
# compose.yaml's stop_grace_period: Docker kills the app this long after a stop request.
STOP_GRACE = 30
STOP_MARGIN = 30
BACKUP_TIMEOUT = 30 * 60
OFFSITE_TIMEOUT = 3 * 3600
# The whole off-site run stays inside the unit's TimeoutStartSec=4h.
OFFSITE_BUDGET = 3 * 3600 + 45 * 60
ACTIONS = ("backup", "monitor", "offsite", "status")
REPORTS = ("backup", "monitor", "offsite")
TOOLS = ("production-ops.sh", "production-ops.py")
UNITS = tuple(f"ba-production-{name}.{kind}" for name in REPORTS for kind in ("service", "timer"))
TIMERS = {name: f"ba-production-{name}.timer" for name in REPORTS}
ARCHIVE = re.compile(r"bangla-data-(\d{8}T\d{12})Z-[0-9a-f]{12}\.tar\.gz")
CODE = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
OVERRIDES = ("PRODUCTION_OPS_DEPLOYMENT_DIR", "PRODUCTION_OPS_DOCKER_HOST", "PRODUCTION_OPS_UID",
             "PRODUCTION_OPS_REQUIRE_ROOTLESS", "PRODUCTION_OPS_OFFSITE_DIR", "PRODUCTION_OPS_TEST_REPOSITORY")
# Only these names may appear in offsite.env: backends configured purely by environment.
OFFSITE_NAMES = {
    "RESTIC_REPOSITORY", "RESTIC_KEEP_DAILY", "RESTIC_KEEP_WEEKLY", "RESTIC_KEEP_MONTHLY",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION",
    "RESTIC_REST_USERNAME", "RESTIC_REST_PASSWORD", "B2_ACCOUNT_ID", "B2_ACCOUNT_KEY",
    "AZURE_ACCOUNT_NAME", "AZURE_ACCOUNT_KEY", "AZURE_ACCOUNT_SAS", "AZURE_ENDPOINT_SUFFIX", "GOOGLE_PROJECT_ID",
}
KEEP_NAMES = ("RESTIC_KEEP_DAILY", "RESTIC_KEEP_WEEKLY", "RESTIC_KEEP_MONTHLY")
PASS_ENV = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS")


class Stopped(BaseException):
    """A stop request (SIGTERM or SIGHUP). Not an OSError, so subprocess and selectors pass it on."""


class Refused(Exception):
    def __init__(self, *codes: str):
        super().__init__(codes[0])
        self.codes = list(codes)

    @property
    def code(self) -> str:
        return self.codes[0]


def require(condition: bool, code: str) -> None:
    if not condition:
        raise Refused(code)


def regular(path: Path, owner: int) -> os.stat_result:
    try:
        info = path.lstat()
    except FileNotFoundError as exc:
        raise Refused("missing-file") from exc
    require(stat.S_ISREG(info.st_mode) and info.st_uid == owner, "unsafe-file")
    return info


def private_dir(path: Path, owner: int) -> None:
    try:
        info = path.lstat()
    except FileNotFoundError as exc:
        raise Refused("missing-directory") from exc
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == owner and stat.S_IMODE(info.st_mode) == 0o700 and path.resolve() == path, "unsafe-directory")


def private_group(user: pwd.struct_passwd) -> int | None:
    """The user's own group when nobody else can be in it (Ubuntu's user private group)."""
    try:
        group = grp.getgrgid(user.pw_gid)
    except KeyError:
        return None
    others = [entry for entry in pwd.getpwall() if entry.pw_gid == user.pw_gid and entry.pw_uid != user.pw_uid]
    return user.pw_gid if group.gr_name == user.pw_name and set(group.gr_mem) <= {user.pw_name} and not others else None


def directory_problem(info: os.stat_result, resolved: bool, owners: tuple[int, ...], safe_group: int | None) -> str | None:
    """Only the deployment user may be able to change what runs from here."""
    if not stat.S_ISDIR(info.st_mode) or not resolved:
        return "type"
    if info.st_uid not in owners:
        return "owner"
    # Ubuntu's 002 umask makes a user's folders group-writable; safe only for its private group.
    if info.st_mode & 0o002 or (info.st_mode & 0o020 and info.st_gid != safe_group):
        return "writable"
    return None


def numeric(value) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def invocation_id() -> str | None:
    value = os.environ.get("INVOCATION_ID", "")
    return value if re.fullmatch(r"[a-f0-9]{32}", value) else None


def archive_epoch(name: str) -> float:
    match = ARCHIVE.fullmatch(name)
    require(match is not None, "backup-missing")
    return dt.datetime.strptime(match.group(1), "%Y%m%dT%H%M%S%f").replace(tzinfo=dt.timezone.utc).timestamp()


def clean_codes(value) -> list[str]:
    if not isinstance(value, list) or len(value) > 16:
        return ["invalid-report"]
    return [code if isinstance(code, str) and CODE.fullmatch(code) else "invalid-report" for code in value]


class Settings:
    """Production values. Local tests may change them only through validated PRODUCTION_OPS_* variables."""

    def __init__(self, environ=None):
        environ = os.environ if environ is None else environ
        given = {name: environ[name] for name in OVERRIDES if name in environ}
        self.overridden = bool(given)

        def path(name: str, default: Path | None) -> Path | None:
            if name not in given:
                return default
            value = given[name]
            require(re.fullmatch(r"/[A-Za-z0-9_./-]+", value) is not None and os.path.normpath(value) == value, "invalid-override")
            return Path(value)

        self.deployment = path("PRODUCTION_OPS_DEPLOYMENT_DIR", DEPLOYMENT)
        self.docker_host = given.get("PRODUCTION_OPS_DOCKER_HOST", DOCKER_HOST)
        require(re.fullmatch(r"unix:///[A-Za-z0-9_./-]+", self.docker_host) is not None, "invalid-override")
        uid = given.get("PRODUCTION_OPS_UID", str(OWNER))
        require(re.fullmatch(r"[0-9]{1,7}", uid) is not None, "invalid-override")
        self.uid = int(uid)
        rootless = given.get("PRODUCTION_OPS_REQUIRE_ROOTLESS", "true")
        require(rootless in ("true", "false"), "invalid-override")
        self.rootless = rootless == "true"
        self._offsite = path("PRODUCTION_OPS_OFFSITE_DIR", None)
        # A local restic repository for the local end-to-end check only; never set on the server.
        self.test_repository = path("PRODUCTION_OPS_TEST_REPOSITORY", None)
        self.ops = self.deployment / "ops"
        self.tools = self.ops / "tools"
        self.backups = self.deployment / "backups"

    @property
    def offsite(self) -> Path:
        return self._offsite or Path(pwd.getpwuid(self.uid).pw_dir) / ".config/bangla-adventures"


class Production:
    def __init__(self, settings: Settings):
        self.s = settings

    # Commands -------------------------------------------------------------------------------

    def command(self, args: list[str], *, data: str | None = None, timeout: int = 240, okay: bool = False,
                cwd: Path | None = None, extra_env: dict | None = None) -> subprocess.CompletedProcess:
        # A minimal environment: nothing from the caller's shell may change Compose's settings.
        env = {key: os.environ[key] for key in PASS_ENV if key in os.environ}
        env["DOCKER_HOST"] = self.s.docker_host
        env.update(extra_env or {})
        stream = {"input": data} if data is not None else {"stdin": subprocess.DEVNULL}
        try:
            result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, env=env, cwd=cwd, check=False, **stream)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise Refused("command-unavailable-or-timeout") from exc
        require(okay or result.returncode == 0, "command-failed")
        require(len(result.stdout) <= 2 * 1024 * 1024, "oversize-command-result")
        return result

    def docker(self, *args: str, **kwargs) -> subprocess.CompletedProcess:
        return self.command(["docker", "--host", self.s.docker_host, *args], **kwargs)

    def compose(self, cfg: dict, *args: str, image: str | None = None, **kwargs) -> subprocess.CompletedProcess:
        root = self.s.deployment
        return self.command(["docker", "--host", self.s.docker_host, "compose", "--project-name", cfg["project"],
                             "--project-directory", str(root), "--env-file", str(root / ".env"),
                             "--file", str(root / "compose.yaml"), *args],
                            cwd=root, extra_env={"APP_IMAGE": image} if image else None, **kwargs)

    def inspect(self, kind: str, name: str) -> dict:
        value = json.loads(self.docker(kind, "inspect", name).stdout)
        require(isinstance(value, list) and len(value) == 1, "ambiguous-resource")
        return value[0]

    def remove_owned(self, token: str) -> int:
        """Remove this run's helpers by label, prove they are gone, and say how many there were."""
        ids = self.docker("ps", "--all", "--quiet", "--no-trunc", "--filter", "label=io.bangla.ops.id=" + token).stdout.split()
        for cid in ids:
            require(re.fullmatch(r"[a-f0-9]{64}", cid) is not None, "helper-id")
            labels = (self.inspect("container", cid).get("Config") or {}).get("Labels") or {}
            require(labels.get("io.bangla.scope") == SCOPE and labels.get("io.bangla.ops.id") == token, "helper-identity")
            self.docker("container", "rm", "--force", "--volumes", cid)
        require(not self.docker("ps", "--all", "--quiet", "--filter", "label=io.bangla.ops.id=" + token).stdout.strip(), "helper-cleanup-failed")
        return len(ids)

    def isolated_run(self, *args: str, data: str | None = None, timeout: int = 240) -> subprocess.CompletedProcess:
        """Own a concrete helper ID, and prove it is gone even after a CLI timeout or SIGTERM."""
        token = secrets.token_hex(12)
        name = "ba-production-ops-" + token
        require(self.docker("container", "inspect", name, okay=True).returncode != 0, "helper-name-exists")
        options = ["container", "create", "--name", name, "--label", "io.bangla.scope=" + SCOPE, "--label", "io.bangla.ops.id=" + token]
        if data is not None:
            options.append("--interactive")
        try:
            lines = self.docker(*options, *args).stdout.split()
            require(bool(lines) and re.fullmatch(r"[a-f0-9]{64}", lines[-1]) is not None, "helper-id")
            return self.docker("container", "start", "--attach", "--interactive", lines[-1], data=data, timeout=timeout, okay=True)
        finally:
            self.remove_owned(token)

    # Platform ---------------------------------------------------------------------------------

    def check_user(self) -> None:
        require(os.getuid() == self.s.uid, "wrong-user")
        root = self.s.deployment
        try:
            info = root.lstat()
        except FileNotFoundError as exc:
            raise Refused("deployment-missing") from exc
        problem = directory_problem(info, root.resolve() == root, (self.s.uid, 0), self.safe_group())
        require(problem is None, "unsafe-deployment-directory")

    def safe_group(self) -> int | None:
        try:
            return private_group(pwd.getpwuid(self.s.uid))
        except KeyError:
            return None

    def check_docker(self) -> None:
        if self.s.rootless:
            socket = Path(self.s.docker_host[len("unix://"):])
            try:
                info = socket.lstat()
            except FileNotFoundError as exc:
                raise Refused("rootless-socket") from exc
            require(stat.S_ISSOCK(info.st_mode) and info.st_uid == self.s.uid and socket.resolve() == socket, "rootless-socket")
        security = json.loads(self.docker("info", "--format", "{{json .SecurityOptions}}").stdout) or []
        require(not self.s.rootless or "name=rootless" in security, "non-rootless-daemon")

    def installed(self) -> bool:
        return Path(__file__).resolve().parent == self.s.tools

    def systemd_dir(self) -> Path:
        return Path(pwd.getpwuid(self.s.uid).pw_dir) / ".config/systemd/user"

    def validate_installation(self) -> None:
        try:
            receipt = self.s.ops / "installation.json"
            regular(receipt, self.s.uid)
            value = json.loads(receipt.read_text())
            require(value.get("scope") == SCOPE and set(value.get("tools", {})) == set(TOOLS) and set(value.get("units", {})) == set(UNITS), "installation-invalid")
            for folder, names in ((self.s.tools, value["tools"]), (self.systemd_dir(), value["units"])):
                for name, digest in names.items():
                    path = folder / name
                    regular(path, self.s.uid)
                    require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, "installation-invalid")
        except (Refused, OSError, ValueError, AttributeError, KeyError) as exc:
            raise Refused("installation-invalid") from exc

    def platform(self) -> None:
        self.check_user()
        private_dir(self.s.ops, self.s.uid)
        if self.installed():
            self.validate_installation()
        self.check_docker()

    def env_settings(self) -> dict:
        """The values deploy-remote.sh and Compose read from the server .env."""
        path = self.s.deployment / ".env"
        info = regular(path, self.s.uid)
        require(not info.st_mode & 0o022 and info.st_size <= 65536, "unsafe-file")
        values = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            match = re.fullmatch(r"(COMPOSE_PROJECT_NAME|APP_PORT|APP_IMAGE|PUBLIC_ORIGIN)=(.*)", line)
            if match:
                value = match.group(2)
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                values[match.group(1)] = value
        project = values.get("COMPOSE_PROJECT_NAME", "")
        port = values.get("APP_PORT") or "3000"
        image = values.get("APP_IMAGE", "")
        origin = values.get("PUBLIC_ORIGIN", "")
        require(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", project) is not None, "settings-invalid")
        require(re.fullmatch(r"[1-9][0-9]{0,4}", port) is not None and int(port) <= 65535, "settings-invalid")
        require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._/@:-]*", image) is not None, "app-image-missing")
        require(not origin or re.fullmatch(r"https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?", origin) is not None, "public-origin-invalid")
        require((self.s.deployment / "compose.yaml").is_file(), "deployment-missing")
        return {"project": project, "port": int(port), "image": image, "origin": origin.rstrip("/") or None}

    # Locks and reports ------------------------------------------------------------------------

    def lock(self, path: Path, *, create: bool = False) -> int:
        if create and not os.path.lexists(path):
            os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600))
        if not os.path.lexists(path):
            raise Refused("deployment-missing")
        regular(path, self.s.uid)
        fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
        try:
            require(os.fstat(fd).st_uid == self.s.uid, "lock-owner")
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            os.close(fd)
            raise Refused("transaction-busy") from exc
        except BaseException:
            os.close(fd)
            raise
        return fd

    def deploy_lock(self) -> int:
        return self.lock(self.s.deployment / ".deploy.lock")

    def deploy_busy(self) -> bool:
        """Whether a deploy or backup holds the deploy lock, read from /proc/locks without taking it."""
        path = self.s.deployment / ".deploy.lock"
        if not os.path.lexists(path):
            raise Refused("deployment-missing")
        info = regular(path, self.s.uid)
        # The kernel's form: "ID: FLOCK ADVISORY WRITE PID MAJ:MIN:INODE START END". Only the inode is
        # compared: on btrfs subvolumes and some overlay set-ups stat's device is not the kernel's, which
        # would hide every deploy. A lock on another device's file with the same inode number can only
        # make a run defer (exit 75), the safe direction; one that lasted would show as monitor-report-stale.
        inode = str(info.st_ino)
        try:
            table = Path("/proc/locks").read_text(encoding="ascii")
        except (OSError, ValueError) as exc:
            raise Refused("lock-state-unreadable") from exc
        # A "->" line is a waiter, not a holder; flock(1) and Python's flock both appear as FLOCK.
        return any(len(fields) >= 6 and fields[1] == "FLOCK" and fields[5].rpartition(":")[2] == inode
                   for fields in map(str.split, table.splitlines()))

    def write_status(self, action: str, value: dict) -> None:
        private_dir(self.s.ops, self.s.uid)
        destination = self.s.ops / ("last-" + action + ".json")
        if os.path.lexists(destination):
            regular(destination, self.s.uid)
        temporary = self.s.ops / (".status-" + secrets.token_hex(12))
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(value, output, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)

    def read_report(self, action: str) -> dict | None:
        path = self.s.ops / ("last-" + action + ".json")
        try:
            info = regular(path, self.s.uid)
            require(info.st_size <= 65536, "unsafe-file")
            value = json.loads(path.read_text())
        except (Refused, OSError, ValueError):
            return None
        return value if isinstance(value, dict) and value.get("scope") == SCOPE and value.get("action") == action else None

    # Application ------------------------------------------------------------------------------

    def containers(self, cfg: dict) -> list[dict]:
        ids = self.docker("ps", "--all", "--quiet", "--no-trunc", "--filter", "label=com.docker.compose.project=" + cfg["project"]).stdout.split()
        require(all(re.fullmatch(r"[a-f0-9]{64}", cid) for cid in ids), "container-id")
        return [self.inspect("container", cid) for cid in ids]

    @staticmethod
    def app(found: list[dict]) -> dict | None:
        apps = [c for c in found if ((c.get("Config") or {}).get("Labels") or {}).get("com.docker.compose.service") == "app"
                and ((c.get("Config") or {}).get("Labels") or {}).get("com.docker.compose.oneoff") != "True"]
        return apps[0] if len(apps) == 1 else None

    @staticmethod
    def serving_state(app: dict | None) -> tuple[bool, bool]:
        state = (app or {}).get("State") or {}
        running = state.get("Running") is True
        health = state.get("Health")
        return running, running and (health is None or health.get("Status") == "healthy")

    def loopback_health(self, port: int) -> bool:
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            try:
                connection.request("GET", "/api/health", headers={"Connection": "close"})
                response = connection.getresponse()
                response.read(65536)
                return response.status == 200
            finally:
                connection.close()
        except (OSError, http.client.HTTPException):
            return False

    def wait_for_health(self, port: int, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            if self.loopback_health(port):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(2)

    def wait_until_healthy(self, cfg: dict, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            if self.serving_state(self.app(self.containers(cfg)))[1]:
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(3)

    def wait_until_stopped(self, cfg: dict, timeout: float) -> bool:
        """Wait for a stop the daemon may already be carrying out; False if the app still runs at the deadline."""
        deadline = time.monotonic() + timeout
        while True:
            try:
                if not self.serving_state(self.app(self.containers(cfg)))[0]:
                    return True
            except (Refused, ValueError):
                pass  # A passing Docker error: keep waiting, then start the app regardless.
            if time.monotonic() >= deadline:
                return False
            time.sleep(1)

    def wait_until_serving(self, cfg: dict, timeout: float) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            app = self.app(self.containers(cfg))
            require(app is None or (app.get("Config") or {}).get("Image") == cfg["image"], "app-image-mismatch")
            running, healthy = self.serving_state(app)
            if healthy and self.loopback_health(cfg["port"]):
                return app
            if time.monotonic() >= deadline:
                raise Refused("app-unhealthy-before-backup")
            time.sleep(5)

    def free_bytes(self) -> int:
        disk = os.statvfs(self.s.deployment)
        return disk.f_bavail * disk.f_frsize

    def public_facts(self, origin: str) -> dict:
        """Public HTTPS health through Nginx, and the certificate's expiry (renewal failures)."""
        parsed = urllib.parse.urlsplit(origin)
        health, expires = False, None
        try:
            connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=15, context=ssl.create_default_context())
            try:
                connection.request("GET", "/api/health", headers={"User-Agent": "bangla-production-monitor", "Connection": "close"})
                certificate = connection.sock.getpeercert() or {}
                if certificate.get("notAfter"):
                    expires = float(ssl.cert_time_to_seconds(certificate["notAfter"]))
                response = connection.getresponse()
                response.read(65536)
                health = response.status == 200
            finally:
                connection.close()
        except (OSError, ssl.SSLError, http.client.HTTPException, ValueError):
            pass
        return {"health": health, "certificateExpiresEpoch": expires}

    # Backups ----------------------------------------------------------------------------------

    def prepare_backups(self, cfg: dict) -> None:
        """The deploy's own preparation: backups/ belongs to the app's user (uid 1000), mode 0700."""
        path = self.s.backups
        if not os.path.lexists(path):
            path.mkdir(mode=0o700)
        require(stat.S_ISDIR(path.lstat().st_mode), "unsafe-backup-directory")
        result = self.isolated_run("--network", "none", "--user", "root", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE",
                                   "--security-opt", "no-new-privileges:true", "--mount", f"type=bind,source={path},target=/backups",
                                   "--entrypoint", "sh", cfg["image"], "-c", "chown 0:0 /backups && chmod 0700 /backups && chown 1000:1000 /backups")
        require(result.returncode == 0, "backup-directory-initialization")

    def clear_stale_backup(self, cfg: dict) -> bool:
        """Remove the lock and staging copy that a killed backup helper leaves in backups/.

        Only after the helper is proven gone and while the deploy lock is held, so no backup can be running.
        """
        result = self.isolated_run("--network", "none", "--user", "1000:1000", "--read-only", "--cap-drop", "ALL",
                                   "--security-opt", "no-new-privileges:true", "--mount", f"type=bind,source={self.s.backups},target=/backups",
                                   "--entrypoint", "sh", cfg["image"], "-c", CLEAR_STALE_SCRIPT, timeout=300)
        lines = result.stdout.split()
        require(result.returncode == 0 and bool(lines) and lines[-1] in ("cleared", "clean"), "stale-backup-lock")
        return lines[-1] == "cleared"

    def backup_writer_running(self) -> bool:
        """Whether a running container can write to backups/, as only a backup in progress does.

        This tool's labelled helpers (found as remove_owned finds them) and anything else with backups/
        bind-mounted, such as a deploy's backup helper that outlived a killed deploy. A read-only mount,
        like the monitor's receipt reader, cannot hold the backup lock.
        """
        backups = str(self.s.backups)
        ids = set()
        for selector in ("label=io.bangla.scope=" + SCOPE, "volume=" + backups):
            ids.update(self.docker("ps", "--quiet", "--no-trunc", "--filter", selector).stdout.split())
        for cid in sorted(ids):
            require(re.fullmatch(r"[a-f0-9]{64}", cid) is not None, "container-id")
            for mount in self.inspect("container", cid).get("Mounts") or []:
                # Unknown shapes count as writable.
                if not isinstance(mount, dict) or (mount.get("RW") is not False
                                                   and {mount.get("Source"), mount.get("Destination")} & {backups, "/backups"}):
                    return True
        return False

    def receipt(self, cfg: dict, *, verify: bool) -> dict:
        """Read the newest successful-backup receipt in a short-lived container as uid 1000."""
        if not os.path.lexists(self.s.backups):
            return {"present": False, "backupLock": False}
        options = ["--network", "none", "--user", "1000:1000", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                   "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", "--mount", f"type=bind,source={self.s.backups},target=/backups,readonly"]
        if verify:
            # Verification unpacks the archive. The anonymous volume takes the image's empty,
            # app-owned /app/.next/cache, so it is disk-backed scratch that is removed afterwards.
            options += ["--mount", "type=volume,target=/app/.next/cache", "--env", "TMPDIR=/app/.next/cache"]
        result = self.isolated_run(*options, "--workdir", "/app", "--entrypoint", "python3", cfg["image"], "-", "verify" if verify else "read",
                                   data=RECEIPT_SCRIPT, timeout=BACKUP_TIMEOUT if verify else 120)
        require(result.returncode == 0, "backup-receipt-unreadable")
        lines = result.stdout.strip().splitlines()
        require(bool(lines), "backup-receipt-unreadable")
        value = json.loads(lines[-1])
        require(isinstance(value, dict) and type(value.get("present")) is bool, "backup-receipt-unreadable")
        # backup_restore.py's lock, seen in passing: the monitor reports one that outlived its backup.
        locked = value.get("backupLock") is True
        if not value["present"]:
            return {"present": False, "backupLock": locked}
        require(isinstance(value.get("archive"), str) and ARCHIVE.fullmatch(value["archive"]) is not None
                and isinstance(value.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is not None
                and type(value.get("bytes")) is int and value["bytes"] > 0, "backup-receipt-unreadable")
        if verify:
            created = None
            if value.get("verified") is True and isinstance(value.get("createdAt"), str):
                stamp = dt.datetime.fromisoformat(value["createdAt"])
                require(stamp.tzinfo is not None, "backup-unverified")
                created = stamp.timestamp()
            value = {**value, "verified": value.get("verified") is True and value.get("sha256Matches") is True, "createdEpoch": created}
        else:
            value = {**value, "createdEpoch": archive_epoch(value["archive"])}
        return {**value, "backupLock": locked}

    def backup(self) -> dict:
        self.check_user()
        lock = self.deploy_lock()  # Busy: deferred before anything is checked, stopped or changed.
        try:
            self.platform()
            cfg = self.env_settings()
            self.prepare_backups(cfg)
            # A lock left by a run whose recovery never ran (systemd's SIGKILL, a power cut) fails this backup
            # and every deploy's. It is provably stale here: this run holds the deploy lock, which every backup
            # path takes, and no container that could write to backups/ is running. Cleared before the app is
            # checked, as such a run may also have left the app stopped, and a deploy would start it again.
            require(not self.backup_writer_running(), "backup-helper-running")
            notices = ["stale-backup-lock-cleared-at-start"] if self.clear_stale_backup(cfg) else []
            try:
                self.wait_until_serving(cfg, PRECHECK_TIMEOUT)
                free = self.free_bytes()
                require(free >= MIN_FREE_BYTES, "disk-low")
            except Refused as exc:
                raise Refused(*exc.codes, *notices) from exc
            token = secrets.token_hex(12)
            stopping = stopped = resumed = killed = False
            cleaned = True
            stale = None
            failure: BaseException | None = None
            output = None
            began = back = 0.0
            try:
                began = time.monotonic()
                stopping = True  # Recovery runs from here on, also after a partial or interrupted stop.
                try:
                    self.compose(cfg, "stop", "app", timeout=120)
                except Refused as exc:
                    raise Refused("app-stop-failed") from exc
                stopped = True
                found = self.containers(cfg)
                require(not any(((c.get("State") or {}).get("Running")) for c in found), "writers-not-stopped")
                require(not self.docker("ps", "--quiet", "--filter", "volume=" + cfg["project"] + "_bangla-data").stdout.strip(), "source-still-in-use")
                # The deploy's backup command, with the current image; the labels only identify the helper.
                try:
                    result = self.compose(cfg, "run", "--rm", "--no-deps", "--label", "io.bangla.scope=" + SCOPE, "--label", "io.bangla.ops.id=" + token,
                                          "--volume", f"{self.s.backups}:/backups", "app", "bash", "scripts/backup.sh", "/backups", str(KEEP),
                                          "--application-stopped", image=cfg["image"], timeout=BACKUP_TIMEOUT, okay=True)
                except Refused as exc:
                    raise Refused("backup-timeout" if exc.code == "command-unavailable-or-timeout" else "backup-failed") from exc
                require(result.returncode == 0, "backup-failed")
                output = backup_output(result.stdout)
            except BaseException as exc:
                failure = exc
            finally:
                if stopping:
                    previous = quiet_signals()
                    try:
                        try:
                            # A helper still present was killed mid-run (timeout or stop request).
                            killed = self.remove_owned(token) > 0
                        except BaseException:
                            cleaned = False
                        try:
                            if not stopped:
                                # The daemon finishes a stop whose command was cut short: the app drains, then
                                # exits as stopped by hand, which `restart: unless-stopped` never undoes, while
                                # `up` meanwhile sees a running container and does nothing. So start it only once
                                # it has exited. Still running after the grace period means the stop never reached
                                # the daemon, which would have killed it: the app is then left as it is.
                                self.wait_until_stopped(cfg, STOP_GRACE + STOP_MARGIN)
                            # The same container again, whatever happened: never a recreated one.
                            self.compose(cfg, "up", "--detach", "--no-build", "--no-recreate", "app", timeout=HEALTH_TIMEOUT)
                            resumed = self.wait_for_health(cfg["port"], HEALTH_TIMEOUT)
                            back = time.monotonic()
                            # Serving already; also wait for Docker's own check, so the next monitor run
                            # does not see a container that is still "starting".
                            resumed = resumed and self.wait_until_healthy(cfg, HEALTH_TIMEOUT)
                        except BaseException:
                            resumed = False
                        if killed and cleaned:
                            # A killed backup_restore.py never removes its lock, which would make every later
                            # backup, and the deploy's own, fail. The app is already serving again.
                            try:
                                stale = "stale-backup-lock-cleared" if self.clear_stale_backup(cfg) else None
                            except BaseException:
                                stale = "stale-backup-lock"
                    finally:
                        restore_signals(previous)
            codes = []
            if failure is not None:
                codes += failure.codes if isinstance(failure, Refused) else ["interrupted" if isinstance(failure, (Stopped, KeyboardInterrupt)) else "backup-failed"]
            if not cleaned:
                codes.append("helper-cleanup-failed")
            if stale:
                codes.append(stale)
            if not resumed:
                codes.append("resume-failed")
            if codes:
                raise Refused(*codes, *notices)
            latest = self.receipt(cfg, verify=False)
            if not (latest["present"] and latest["archive"] == output["archive"] and latest["sha256"] == output["sha256"]):
                raise Refused("backup-unverified", *notices)
            # A passing run keeps its notice, so status shows the clean-up without failing.
            value = {"scope": SCOPE, "action": "backup", "verified": True, "status": "passed", "checkedAtEpoch": time.time(),
                     "invocationId": invocation_id(), "overridden": self.s.overridden, "codes": notices,
                     "checks": {"appServingBefore": True, "writersStopped": True, "backupVerified": True, "appResumedHealthy": True},
                     "backup": {"archive": output["archive"], "sha256": output["sha256"], "files": output["files"],
                                "bytes": latest["bytes"], "createdEpoch": latest["createdEpoch"], "retained": KEEP},
                     "measures": {"downtimeSeconds": round(back - began, 1), "freeDiskBytes": free}}
            self.write_status("backup", value)
            return value
        finally:
            os.close(lock)

    # Monitor ----------------------------------------------------------------------------------

    def offsite_configured(self) -> bool:
        return os.path.lexists(self.s.offsite / "offsite.env")

    def monitor(self) -> dict:
        self.check_user()
        private_dir(self.s.ops, self.s.uid)
        lock = self.lock(self.s.ops / ".monitor.lock", create=True)
        try:
            self.platform()
            if self.deploy_busy():
                raise Refused("transaction-busy")
            cfg = self.env_settings()
            found = self.containers(cfg)
            app = self.app(found)
            running, healthy = self.serving_state(app)
            try:
                latest = self.receipt(cfg, verify=False)
            except (Refused, ValueError, KeyError):
                latest = {"present": False, "backupLock": False}
            last = self.read_report("backup")
            offsite = None
            if self.offsite_configured():
                report = self.read_report("offsite") or {}
                success = report.get("lastSuccessEpoch")
                offsite = {"lastSuccessEpoch": success if numeric(success) and success > 0 else None}
            facts = {
                "checkedAtEpoch": time.time(), "loopbackHealth": self.loopback_health(cfg["port"]),
                "appRunning": running, "appHealthy": healthy,
                "appImageCurrent": app is not None and (app.get("Config") or {}).get("Image") == cfg["image"],
                "portsConfined": ports_confined(found, cfg["port"]), "freeDiskBytes": self.free_bytes(),
                "backup": {"present": latest["present"], "createdEpoch": latest.get("createdEpoch")},
                "lastBackupRunPassed": bool(last) and last.get("status") == "passed",
                # Read with the receipt, so no extra container. A backup holds the deploy lock, and the
                # deploy lock is checked again below before a failure is recorded.
                "backupLockPresent": latest.get("backupLock") is True,
                "public": self.public_facts(cfg["origin"]) if cfg["origin"] else None,
                "offsite": offsite,
            }
            value = evaluate_monitor(facts)
            # A deploy that began during the checks explains a stopped app or a backup lock: defer, do not alarm.
            if not value["verified"] and self.deploy_busy():
                raise Refused("transaction-busy")
            value.update(invocationId=invocation_id(), overridden=self.s.overridden)
            self.write_status("monitor", value)
            return value
        finally:
            os.close(lock)

    # Off-site ---------------------------------------------------------------------------------

    def secret_file(self, path: Path, safe_group: int | None) -> os.stat_result:
        """Mounted read-only into the restic container, which reads it through the user's private group."""
        try:
            info = regular(path, self.s.uid)
        except Refused as exc:
            raise Refused("offsite-file-missing" if exc.code == "missing-file" else "offsite-file-insecure") from exc
        mode = stat.S_IMODE(info.st_mode)
        require(safe_group is not None and info.st_gid == safe_group and mode & 0o040 and not mode & 0o137 and 0 < info.st_size <= 65536,
                "offsite-file-insecure")
        return info

    def offsite_settings(self) -> dict | None:
        folder = self.s.offsite
        env = folder / "offsite.env"
        if not os.path.lexists(env):
            return None
        safe_group = self.safe_group()
        try:
            info = folder.lstat()
            require(directory_problem(info, folder.resolve() == folder, (self.s.uid,), safe_group) is None, "offsite-file-insecure")
            info = regular(env, self.s.uid)
        except (Refused, OSError) as exc:
            raise Refused("offsite-file-insecure") from exc
        require(not stat.S_IMODE(info.st_mode) & 0o077 and info.st_size <= 65536, "offsite-file-insecure")
        password = folder / "restic-password"
        password_info = self.secret_file(password, safe_group)
        values = {}
        for raw in env.read_text(encoding="utf-8").splitlines():
            line = raw.lstrip()
            if not line or line.startswith("#"):
                continue
            name, separator, value = line.partition("=")
            require(separator == "=" and name in OFFSITE_NAMES and name not in values, "offsite-settings-invalid")
            # Docker's env-file keeps quotes and spaces literally, so a quoted value would be wrong.
            require(0 < len(value) <= 2048 and value == value.strip() and value[0] not in "\"'" and "\x00" not in value, "offsite-settings-invalid")
            values[name] = value
        repository = values.get("RESTIC_REPOSITORY", "")
        if self.s.test_repository:
            require(repository == "local:/repository", "offsite-backend-unsupported")
        else:
            backend, _, location = repository.partition(":")
            require(backend in ("s3", "b2", "rest", "azure", "gs") and bool(location), "offsite-backend-unsupported")
            # The repository password and backend credentials never travel over plain HTTP.
            require(backend != "rest" or location.startswith("https://"), "offsite-backend-unsupported")
            require(backend != "s3" or "://" not in location or location.startswith("https://"), "offsite-backend-unsupported")
        keep = [values.get(name) for name in KEEP_NAMES]
        retention = None
        if any(item is not None for item in keep):
            require(all(item is not None and re.fullmatch(r"[1-9][0-9]{0,3}", item) for item in keep), "offsite-retention-invalid")
            retention = tuple(int(item) for item in keep)
        gcs_key = None
        if repository.startswith("gs:"):
            gcs_key = folder / "gcs-key.json"
            self.secret_file(gcs_key, safe_group)
        # Rootless Docker shows the user's own group as group 0 inside the container.
        return {"env": env, "password": password, "retention": retention, "gcsKey": gcs_key,
                "secretGid": 0 if self.s.rootless else password_info.st_gid}

    def restic(self, conf: dict, *args: str, timeout: int = 600) -> subprocess.CompletedProcess:
        options = ["--user", "1000:1000", "--group-add", str(conf["secretGid"]), "--read-only", "--cap-drop", "ALL",
                   "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=512m",
                   "--tmpfs", "/cache:rw,noexec,nosuid,nodev,size=1g", "--env-file", str(conf["env"]),
                   "--env", "RESTIC_PASSWORD_FILE=/run/secrets/restic-password", "--env", "RESTIC_CACHE_DIR=/cache",
                   "--env", "HOME=/tmp", "--env", "TMPDIR=/tmp",
                   "--mount", f"type=bind,source={conf['password']},target=/run/secrets/restic-password,readonly",
                   "--mount", f"type=bind,source={self.s.backups},target=/backups,readonly"]
        if conf["gcsKey"]:
            options += ["--mount", f"type=bind,source={conf['gcsKey']},target=/run/secrets/gcs-key.json,readonly",
                        "--env", "GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcs-key.json"]
        if self.s.test_repository:
            options += ["--network", "none", "--mount", f"type=bind,source={self.s.test_repository},target=/repository"]
        return self.isolated_run(*options, "--entrypoint", "/usr/bin/restic", RESTIC_IMAGE, *args, timeout=timeout)

    def offsite(self) -> dict:
        self.check_user()
        private_dir(self.s.ops, self.s.uid)
        lock = self.lock(self.s.ops / ".offsite.lock", create=True)
        try:
            conf = self.offsite_settings()
            if conf is None:
                # Inert until the client chooses a destination; nothing is recorded.
                return {"scope": SCOPE, "action": "offsite", "verified": True, "status": "not-configured", "checkedAtEpoch": time.time(), "codes": []}
            deadline = time.monotonic() + OFFSITE_BUDGET

            def left(limit: int) -> int:
                return max(1, min(limit, int(deadline - time.monotonic())))
            self.platform()
            cfg = self.env_settings()
            latest = self.receipt(cfg, verify=True)
            require(latest["present"], "backup-missing")
            require(latest["verified"] and latest["createdEpoch"] is not None, "backup-unverified")
            age = time.time() - latest["createdEpoch"]
            require(-FUTURE_SKEW <= age <= MAX_BACKUP_AGE, "backup-stale-or-future")
            target = "/backups/" + latest["archive"]
            copy = self.restic(conf, "--retry-lock", "10m", "backup", "--json", "--quiet", "--host", RESTIC_HOST, "--tag", RESTIC_TAG, "--", target,
                               timeout=left(OFFSITE_TIMEOUT))
            require(copy.returncode == 0, restic_code(copy.returncode, "offsite-copy-failed"))
            snapshot = backup_snapshot(copy.stdout)
            listed = self.restic(conf, "--retry-lock", "10m", "snapshots", "--json", snapshot, timeout=left(600))
            require(listed.returncode == 0 and snapshot_matches(listed.stdout, snapshot, target), "offsite-unverified")
            copied = time.time()
            value = {"scope": SCOPE, "action": "offsite", "verified": True, "status": "passed", "checkedAtEpoch": copied,
                     "invocationId": invocation_id(), "overridden": self.s.overridden, "codes": [], "lastSuccessEpoch": copied,
                     "copy": {"archive": latest["archive"], "sha256": latest["sha256"], "bytes": latest["bytes"], "snapshotId": snapshot,
                              "backupAgeSeconds": round(age, 3), "resticVersion": RESTIC_VERSION},
                     "retention": {"configured": conf["retention"] is not None, "applied": False,
                                   "keepDaily": None, "keepWeekly": None, "keepMonthly": None}}
            if conf["retention"]:
                daily, weekly, monthly = conf["retention"]
                value["retention"].update(keepDaily=daily, keepWeekly=weekly, keepMonthly=monthly)
                # The copy is safe now: record it before retention, which can take long or be stopped.
                self.write_status("offsite", value)
                code = "offsite-retention-timeout" if deadline - time.monotonic() < 60 else None
                try:
                    if code is None:
                        forget = self.restic(conf, "--retry-lock", "10m", "forget", "--tag", RESTIC_TAG, "--host", RESTIC_HOST, "--group-by", "host,tags",
                                             "--keep-daily", str(daily), "--keep-weekly", str(weekly), "--keep-monthly", str(monthly), "--prune",
                                             timeout=left(OFFSITE_TIMEOUT))
                        if forget.returncode != 0:
                            code = restic_code(forget.returncode, "offsite-retention-failed")
                except Refused as exc:
                    code = "offsite-retention-timeout" if exc.code == "command-unavailable-or-timeout" else "offsite-retention-failed"
                if code is None:
                    value["retention"]["applied"] = True
                else:
                    value.update(verified=False, status="failed", codes=[code])
            self.write_status("offsite", value)
            return value
        finally:
            os.close(lock)

    # Status -----------------------------------------------------------------------------------

    def userctl(self, *args: str) -> subprocess.CompletedProcess:
        runtime = Path("/run/user") / str(self.s.uid)
        return self.command(["systemctl", "--user", "--no-pager", *args], okay=True, timeout=60,
                            extra_env={"XDG_RUNTIME_DIR": str(runtime), "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(runtime / "bus")})

    def timer_active(self, unit: str) -> bool:
        try:
            return self.userctl("is-enabled", "--quiet", unit).returncode == 0 and self.userctl("is-active", "--quiet", unit).returncode == 0
        except Refused:
            return False

    def service_failed(self, unit: str) -> bool:
        """A run that systemd killed records no result of its own; its unit stays failed."""
        try:
            return self.userctl("is-failed", "--quiet", unit).returncode == 0
        except Refused:
            return False

    def lingering(self) -> bool:
        try:
            return os.path.lexists(Path("/var/lib/systemd/linger") / pwd.getpwuid(self.s.uid).pw_name)
        except KeyError:
            return False

    def status(self) -> dict:
        self.check_user()
        private_dir(self.s.ops, self.s.uid)
        try:
            self.validate_installation()
            installed = True
        except Refused:
            installed = False
        facts = {"checkedAtEpoch": time.time(), "installed": installed, "offsiteConfigured": self.offsite_configured(),
                 "reports": {name: self.read_report(name) for name in REPORTS},
                 "timers": {name: self.timer_active(unit) for name, unit in TIMERS.items()},
                 "services": {name: self.service_failed(f"ba-production-{name}.service") for name in REPORTS}, "lingering": self.lingering()}
        value = evaluate_status(facts)
        value["overridden"] = self.s.overridden
        return value


# backup_restore.py's own names; uid 1000 owns them. Prints "cleared" when anything was left behind.
CLEAR_STALE_SCRIPT = r'''
set -eu
found=clean
for path in /backups/.bangla-backup.lock /backups/.bangla-snapshot-*; do
  if [ -e "$path" ] || [ -L "$path" ]; then rm -rf -- "$path"; found=cleared; fi
done
echo "$found"
'''

RECEIPT_SCRIPT = r'''
import hashlib,json,os,pathlib,re,subprocess,sys
root=pathlib.Path('/backups');marker=root/'.latest-backup.json'
pattern=re.compile(r'bangla-data-\d{8}T\d{12}Z-[0-9a-f]{12}\.tar\.gz')
locked=os.path.lexists(root/'.bangla-backup.lock')
def out(value):
 print(json.dumps(dict(value,backupLock=locked)));raise SystemExit(0)
try:
 if not marker.is_file() or marker.is_symlink() or marker.stat().st_size>4096:out(dict(present=False))
 receipt=json.loads(marker.read_text());name=receipt.get('archive');expected=receipt.get('sha256')
 if not isinstance(name,str) or not pattern.fullmatch(name) or not isinstance(expected,str) or not re.fullmatch('[0-9a-f]{64}',expected):out(dict(present=False))
 archive=root/name
 if archive.is_symlink() or not archive.is_file():out(dict(present=False))
 value=dict(present=True,archive=name,sha256=expected,bytes=archive.stat().st_size)
 if sys.argv[1]=='verify':
  digest=hashlib.sha256()
  with archive.open('rb') as source:
   for block in iter(lambda:source.read(1048576),b''):digest.update(block)
  value.update(sha256Matches=digest.hexdigest()==expected,verified=False,createdAt=None)
  result=subprocess.run(['python3','scripts/backup_restore.py','verify',str(archive)],capture_output=True,text=True)
  if result.returncode==0:
   checked=json.loads(result.stdout);value.update(verified=checked.get('verified') is True,createdAt=checked.get('created_at'))
 out(value)
except (OSError,ValueError,AttributeError):out(dict(present=False))
'''


def backup_output(stdout: str) -> dict:
    lines = [line for line in stdout.splitlines() if line.strip()]
    require(bool(lines), "backup-unverified")
    try:
        value = json.loads(lines[-1])
    except ValueError as exc:
        raise Refused("backup-unverified") from exc
    archive = value.get("archive") if isinstance(value, dict) else None
    require(isinstance(archive, str) and archive.startswith("/backups/") and ARCHIVE.fullmatch(archive[len("/backups/"):]) is not None
            and isinstance(value.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is not None
            and value.get("verified") is True and type(value.get("files")) is int, "backup-unverified")
    return {"archive": archive[len("/backups/"):], "sha256": value["sha256"], "files": value["files"]}


def restic_code(returncode: int, default: str) -> str:
    # restic's documented exit codes since 0.17.
    return {10: "offsite-repository-missing", 11: "offsite-repository-locked", 12: "offsite-password-wrong"}.get(returncode, default)


def backup_snapshot(stdout: str) -> str:
    for line in reversed(stdout.splitlines()):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get("message_type") == "summary":
            snapshot = value.get("snapshot_id")
            require(isinstance(snapshot, str) and re.fullmatch(r"[0-9a-f]{64}", snapshot) is not None, "offsite-unverified")
            return snapshot
    raise Refused("offsite-unverified")


def snapshot_matches(stdout: str, snapshot: str, target: str) -> bool:
    try:
        value = json.loads(stdout)
    except ValueError:
        return False
    return (isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict) and value[0].get("id") == snapshot
            and value[0].get("paths") == [target] and value[0].get("hostname") == RESTIC_HOST and RESTIC_TAG in (value[0].get("tags") or []))


def ports_confined(found: list[dict], port: int) -> bool:
    """Nothing in the project publishes a port except the app on 127.0.0.1:APP_PORT."""
    expected = {"3000/tcp": [("127.0.0.1", str(port))]}

    def bindings(table) -> dict:
        if not isinstance(table, dict):
            return {"invalid": []}
        return {key: sorted((entry.get("HostIp"), entry.get("HostPort")) for entry in value) for key, value in table.items() if value}

    for container in found:
        host = container.get("HostConfig") or {}
        labels = (container.get("Config") or {}).get("Labels") or {}
        allowed = expected if labels.get("com.docker.compose.service") == "app" and labels.get("com.docker.compose.oneoff") != "True" else {}
        if host.get("NetworkMode") == "host" or host.get("PublishAllPorts"):
            return False
        if bindings(host.get("PortBindings") or {}) != allowed:
            return False
        if (container.get("State") or {}).get("Running") and bindings((container.get("NetworkSettings") or {}).get("Ports") or {}) != allowed:
            return False
    return True


MONITOR_CODES = {
    "loopbackHealth": "health-unavailable", "appRunning": "app-not-running", "appHealthy": "app-unhealthy",
    "appImageCurrent": "app-image-mismatch", "portsConfined": "port-exposed", "diskSpace": "disk-low",
    "backupPresent": "backup-missing", "backupFresh": "backup-stale-or-future", "lastBackupRunPassed": "backup-job-failed",
    "backupLockClear": "stale-backup-lock-found", "publicHealth": "public-health-failed",
    "certificateValid": "certificate-expiring-or-invalid", "offsiteFresh": "offsite-stale",
}


def evaluate_monitor(facts: dict) -> dict:
    """Pure checks over bounded facts; None marks a check that does not apply."""
    expected = {"checkedAtEpoch", "loopbackHealth", "appRunning", "appHealthy", "appImageCurrent", "portsConfined",
                "freeDiskBytes", "backup", "lastBackupRunPassed", "backupLockPresent", "public", "offsite"}
    if not isinstance(facts, dict) or set(facts) != expected:
        raise ValueError("Invalid monitor facts")
    for name in ("loopbackHealth", "appRunning", "appHealthy", "appImageCurrent", "portsConfined", "lastBackupRunPassed", "backupLockPresent"):
        if type(facts[name]) is not bool:
            raise ValueError("Invalid monitor boolean")
    now = facts["checkedAtEpoch"]
    if not numeric(now) or now <= 0 or type(facts["freeDiskBytes"]) is not int or facts["freeDiskBytes"] < 0:
        raise ValueError("Invalid monitor number")

    def epoch(value) -> float | None:
        if value is not None and (not numeric(value) or value <= 0):
            raise ValueError("Invalid monitor time")
        return value

    def within(value: float | None, limit: float) -> bool:
        return value is not None and -FUTURE_SKEW <= now - value <= limit

    backup, public, offsite = facts["backup"], facts["public"], facts["offsite"]
    if not isinstance(backup, dict) or set(backup) != {"present", "createdEpoch"} or type(backup["present"]) is not bool:
        raise ValueError("Invalid backup facts")
    created = epoch(backup["createdEpoch"])
    if public is not None and (not isinstance(public, dict) or set(public) != {"health", "certificateExpiresEpoch"} or type(public["health"]) is not bool):
        raise ValueError("Invalid public facts")
    expires = epoch(public["certificateExpiresEpoch"]) if public is not None else None
    if offsite is not None and (not isinstance(offsite, dict) or set(offsite) != {"lastSuccessEpoch"}):
        raise ValueError("Invalid offsite facts")
    copied = epoch(offsite["lastSuccessEpoch"]) if offsite is not None else None
    checks = {
        "loopbackHealth": facts["loopbackHealth"], "appRunning": facts["appRunning"], "appHealthy": facts["appHealthy"],
        "appImageCurrent": facts["appImageCurrent"], "portsConfined": facts["portsConfined"],
        "diskSpace": facts["freeDiskBytes"] >= MIN_FREE_BYTES, "backupPresent": backup["present"],
        "backupFresh": backup["present"] and within(created, MAX_BACKUP_AGE), "lastBackupRunPassed": facts["lastBackupRunPassed"],
        "backupLockClear": not facts["backupLockPresent"],
        "publicHealth": None if public is None else public["health"],
        "certificateValid": None if public is None else expires is not None and expires - now >= MIN_CERTIFICATE_SECONDS,
        "offsiteFresh": None if offsite is None else within(copied, MAX_OFFSITE_AGE),
    }
    failures = [MONITOR_CODES[name] for name, passed in checks.items() if passed is False]
    return {
        "scope": SCOPE, "action": "monitor", "verified": not failures, "status": "healthy" if not failures else "failed",
        "checkedAtEpoch": now, "checks": checks, "codes": failures,
        "publicOriginConfigured": public is not None, "offsiteConfigured": offsite is not None,
        "measures": {"freeDiskBytes": facts["freeDiskBytes"],
                     "backupAgeSeconds": None if created is None else round(now - created, 3),
                     "certificateDaysLeft": None if expires is None else round((expires - now) / 86400, 2),
                     "offsiteAgeSeconds": None if copied is None else round(now - copied, 3)},
    }


GOOD = {"backup": "passed", "monitor": "healthy", "offsite": "passed"}
LIMITS = {"backup": MAX_BACKUP_REPORT_AGE, "monitor": MAX_MONITOR_REPORT_AGE, "offsite": MAX_OFFSITE_AGE}


def evaluate_status(facts: dict) -> dict:
    """One aggregate of the last results; failing or stale parts fail the whole."""
    now = facts["checkedAtEpoch"]
    codes = [] if facts["installed"] else ["installation-invalid"]
    parts = {}
    for name in REPORTS:
        report = facts["reports"].get(name)
        if name == "offsite" and not facts["offsiteConfigured"]:
            parts[name] = {"configured": False, "status": "not-configured", "checkedAtEpoch": None, "ageSeconds": None, "codes": []}
            continue
        if report is None or not numeric(report.get("checkedAtEpoch")):
            part = {"status": "missing", "checkedAtEpoch": None, "ageSeconds": None, "codes": []}
            codes.append(name + "-report-missing")
        else:
            age = now - report["checkedAtEpoch"]
            status = report.get("status") if report.get("status") in ("passed", "healthy", "failed", "deferred") else "invalid"
            part = {"status": status, "checkedAtEpoch": report["checkedAtEpoch"], "ageSeconds": round(age, 3), "codes": clean_codes(report.get("codes"))}
            if status != GOOD[name] or report.get("verified") is not True:
                codes.append(name + "-report-failed")
            elif not -FUTURE_SKEW <= age <= LIMITS[name]:
                codes.append(name + "-report-stale")
        if name == "offsite":
            success = (report or {}).get("lastSuccessEpoch")
            part.update(configured=True, lastSuccessEpoch=success if numeric(success) else None)
        parts[name] = part
    for name, active in facts["timers"].items():
        if active is not True:
            codes.append("timer-inactive-" + name)
    for name, failed in facts["services"].items():
        if failed is not False:
            codes.append("service-failed-" + name)
    if not facts["lingering"]:
        codes.append("user-linger-disabled")
    return {"scope": SCOPE, "action": "status", "verified": not codes, "status": "healthy" if not codes else "failed",
            "checkedAtEpoch": now, "codes": codes, "installed": facts["installed"], **parts,
            "timers": {name: facts["timers"][name] is True for name in REPORTS},
            "servicesFailed": {name: facts["services"][name] is not False for name in REPORTS}, "lingering": facts["lingering"]}


def interrupted(*_):
    # The first stop request interrupts the work; later ones must not interrupt its recovery.
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, signal.SIG_IGN)
    raise Stopped()


def quiet_signals() -> dict:
    """Recovery must finish: hang-ups and stop requests wait until the app is started again."""
    previous = {}
    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        previous[number] = signal.signal(number, signal.SIG_IGN)
    return previous


def restore_signals(previous: dict) -> None:
    for number, handler in previous.items():
        signal.signal(number, handler)


def failure_value(prod: Production | None, action: str, codes: list[str]) -> dict:
    deferred = codes == ["transaction-busy"]
    value = {"scope": SCOPE, "action": action, "verified": False, "status": "deferred" if deferred else "failed",
             "checkedAtEpoch": time.time(), "invocationId": invocation_id(), "codes": codes}
    if action == "offsite" and prod is not None:
        previous = prod.read_report("offsite") or {}
        success = previous.get("lastSuccessEpoch")
        value["lastSuccessEpoch"] = success if numeric(success) else None
    return value


def main(argv: list[str]) -> int:
    action = argv[1] if len(argv) == 2 and argv[1] in ACTIONS else "invalid"
    prod = None
    try:
        require(action != "invalid", "invalid-action")
        prod = Production(Settings())
        value = getattr(prod, action)()
        print(json.dumps(value, separators=(",", ":")))
        return 0 if value["verified"] else 1
    except (Exception, KeyboardInterrupt, Stopped) as exc:  # Any failure is recorded with a fixed code, never a trace.
        codes = exc.codes if isinstance(exc, Refused) else ["interrupted" if isinstance(exc, (Stopped, KeyboardInterrupt)) else "operation-failed"]
        value = failure_value(prod, action, codes)
        if prod is not None and action in REPORTS and value["status"] == "failed":
            try:
                prod.write_status(action, value)
            except (OSError, Refused):
                pass
        print(json.dumps(value, separators=(",", ":")))
        return 75 if value["status"] == "deferred" else 1


if __name__ == "__main__":
    os.umask(0o077)
    # Stop requests and hang-ups become exceptions, so a stopped app is always started again.
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, interrupted)
    raise SystemExit(main(sys.argv))
