#!/usr/bin/env python3
"""Pure, bounded aggregate checks for private staging operations; no network or writes."""
from __future__ import annotations

import json
import math
import sys

MIN_FREE_BYTES = 1024 ** 3
MAX_BACKUP_AGE_SECONDS = 36 * 3600


def evaluate(value: dict) -> dict:
    expected = {"checkedAtEpoch", "health", "containersHealthy", "publishedPorts", "freeDiskBytes", "backup", "lastBackupRunPassed"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Invalid aggregate fields")
    for field in ("health", "containersHealthy", "lastBackupRunPassed"):
        if type(value[field]) is not bool:
            raise ValueError("Invalid aggregate boolean")
    for field in ("publishedPorts", "freeDiskBytes"):
        if type(value[field]) is not int or value[field] < 0:
            raise ValueError("Invalid aggregate number")
    now = value["checkedAtEpoch"]
    if type(now) not in (int, float) or not math.isfinite(now) or now <= 0:
        raise ValueError("Invalid check time")
    backup = value["backup"]
    if not isinstance(backup, dict) or set(backup) != {"verified", "createdEpoch"} or type(backup["verified"]) is not bool:
        raise ValueError("Invalid backup aggregate")
    created = backup["createdEpoch"]
    if created is not None and (type(created) not in (int, float) or not math.isfinite(created) or created <= 0):
        raise ValueError("Invalid backup time")
    age = None if created is None else now - created
    checks = {
        "applicationHealth": value["health"],
        "containersHealthy": value["containersHealthy"],
        "noPublishedPorts": value["publishedPorts"] == 0,
        "diskSpace": value["freeDiskBytes"] >= MIN_FREE_BYTES,
        "backupVerified": backup["verified"],
        "backupFresh": age is not None and -300 <= age <= MAX_BACKUP_AGE_SECONDS,
        "lastBackupRunPassed": value["lastBackupRunPassed"],
    }
    codes = {
        "applicationHealth": "health-unavailable", "containersHealthy": "container-unhealthy",
        "noPublishedPorts": "port-exposed", "diskSpace": "disk-low", "backupVerified": "backup-unverified",
        "backupFresh": "backup-stale-or-future", "lastBackupRunPassed": "backup-job-failed",
    }
    failures = [codes[key] for key, passed in checks.items() if not passed]
    return {
        "scope": "private-staging-operations", "action": "monitor", "verified": not failures,
        "status": "healthy" if not failures else "failed", "checkedAtEpoch": now,
        "checks": checks, "codes": failures,
        "measures": {"freeDiskBytes": value["freeDiskBytes"], "backupAgeSeconds": None if age is None else round(age, 3)},
    }


if __name__ == "__main__":
    try:
        data = sys.stdin.read(16385)
        if len(data) > 16384:
            raise ValueError("Oversize aggregates")
        result = evaluate(json.loads(data))
        print(json.dumps(result, separators=(",", ":")))
        raise SystemExit(0 if result["verified"] else 1)
    except (ValueError, TypeError, KeyError):
        print(json.dumps({"scope": "private-staging-operations", "action": "monitor", "verified": False, "status": "failed", "codes": ["invalid-aggregates"]}))
        raise SystemExit(1)
