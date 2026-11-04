#!/usr/bin/env bash
# The checks every change must pass, on any CI system or a developer's computer: lint, unit,
# backup, Moodle and integration tests, the production build and the type check.
# Needs Node 22 and Python 3. Every CI system's file runs it (docs/CI_CD.md).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export CI="${CI:-true}"
step() { printf '\n==> %s\n' "$*"; "$@"; }
# The dependencies' install scripts and the tests need no secrets: on a CI system that gives every
# job the publishing and deploying settings, they are dropped here.
unset REGISTRY_PASSWORD DEPLOY_SSH_KEY DEPLOY_SSH_KEY_FILE DEPLOY_SSH_KEY_BASE64 DOCKERHUB_TOKEN

step npm ci
step npm run lint
step npm test
step python3 -m unittest discover -s tests -p 'backup_restore_test.py'
step npm run verify:moodle-pilot
step npm run verify:moodle-plugin
step npm run verify:moodle-infra
step npm run build
step npm run typecheck
step npm run test:integration
