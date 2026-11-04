#!/usr/bin/env bash
# The browser tests (Playwright, Chromium). Needs Node 22.
# Installing Chromium's system libraries needs root or sudo; where the CI agent has neither,
# install them once on the agent and set PLAYWRIGHT_INSTALL_DEPS=0.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export CI="${CI:-true}"
step() { printf '\n==> %s\n' "$*"; "$@"; }
# The dependencies' install scripts and the tests need no secrets: on a CI system that gives every
# job the publishing and deploying settings, they are dropped here.
unset REGISTRY_PASSWORD DEPLOY_SSH_KEY DEPLOY_SSH_KEY_FILE DEPLOY_SSH_KEY_BASE64 DOCKERHUB_TOKEN

step npm ci
if [ "${PLAYWRIGHT_INSTALL_DEPS:-1}" = 1 ]; then
  step npx playwright install --with-deps chromium
else
  step npx playwright install chromium
fi
step npm run test:e2e
