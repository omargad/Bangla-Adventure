# Verification record — deployment and recovery fixes

Date: 28 October 2026. Repository: `omargad/Bangla-Adventure`.
Baseline commit: `1655010e856569d90319d8052ea816a51b758aea`.
This record covers the changes in the commit containing this file; it is not a live-server acceptance certificate.

## Executed locally

Environment: Linux x64, Node.js 22.23.4, npm 10.9.9, Python 3.12, Chrome for Testing 151.0.7922.34.

| Check | Result |
| --- | --- |
| Clean `npm ci --no-audit --no-fund` on Node 22 | Passed |
| `npm run lint` | Passed |
| `npm test` | 117 passed |
| `NEXT_DIST_DIR=.next-test npm run build` | Passed |
| `npm run typecheck` after build | Passed |
| `NEXT_DIST_DIR=.next-test npm run test:integration` | 26 passed, isolated temporary databases |
| Browser suite using the existing `.next-test` build | 23 passed initially; the remaining test had an ambiguous global status locator, corrected in this change |
| Targeted `tests/e2e/complete-workflow.spec.ts` rerun | Both tests passed, including the corrected complete teacher/student/admin/recovery journey; all 24 distinct browser checks are covered across the runs |
| Python backup/restore integration tests | 13 passed, including WAL data, external data paths, restore, tampering/traversal, permissions, retention and mocked offsite transfer |
| Shell syntax | Backup, restore, offsite and Docker smoke scripts passed `bash -n` |
| Documentation/template checks | Relative Markdown links resolve; portable service syntax checked with the local Node path substituted |

The first install used the environment's Node 24 and failed during native-addon setup. The documented Node 22 clean installation passed. The Playwright CDN returned an invalid download in this environment; the matching test browser was obtained from the official Google release and verified. Its missing executable bit was corrected before browser tests ran. These environment issues did not require dependency changes.

## CI and remaining deployment evidence

The CI workflow runs lint, unit/backup checks, draft pilot validators, build, typecheck, API integration and the full browser suite. A separate container job validates Compose, builds the Docker image, checks non-root startup/fresh schema, and recreates a container to verify database/media persistence.

No local Docker engine was available, so this record does not claim a local Docker pass. Use the actual CI run result for the final commit as container evidence; a workflow definition alone is not a successful execution.

No production database, live accounts, actual backup repository or server services were changed. The read-only request to the supplied HTTPS IP failed hostname validation in this environment, so live HTTPS/health was not verified. Production deployment, configured encrypted off-server storage/scheduling, and a restore drill with the intended data remain operator tasks requiring authorized host access and an approved destination.

Human content, language, rights, accessibility, privacy/safeguarding and client approvals remain pending in [ACCEPTANCE.md](ACCEPTANCE.md). No review status or publication gate was bypassed. The optional Moodle pilot remains separate from the current custom app.

