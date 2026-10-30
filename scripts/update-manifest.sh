#!/usr/bin/env bash
# Rewrite MANIFEST.sha256: the SHA-256 of every file git tracks or has staged,
# except the manifest itself. Stage new files first so they are listed.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."
git -c core.quotepath=off ls-files -z | grep -zv '^MANIFEST\.sha256$' | xargs -0 sha256sum > MANIFEST.sha256
