# Moving the repository to the client's GitHub organisation

The repository is at `omargad/Bangla-Adventure`, a personal account. The client will
receive it in their own GitHub organisation, named `ORG` below. This checklist covers
the move from start to finish: who needs which permission, the organisation settings,
the transfer itself, and what to check, re-create and relink afterwards.

Statements about how GitHub and the hosting services behave are marked:

- **Documented**: GitHub's documentation (or Railway's or Vercel's) says so; the
  [sources](#sources) are listed at the end.
- **Check in the UI**: the documentation does not say, or says it only indirectly. It is
  expected to work as described, but look at the setting after the move.

Never write a secret's value, the server's address or its SSH account in an issue, a
commit, a chat or this file. Note settings by name only.

## What the repository already does for the move

Nothing in the code has to change for the transfer:

| Part | Before the move | After the move | Setting needed |
| --- | --- | --- | --- |
| VPS workflows (`vps-*.yml`) | Run only in the repository with ID `1436643374` | Same repository, same ID: they keep running | None |
| CI image (`ci.yml`) | `ghcr.io/omargad/bangla-adventure` | `ghcr.io/ORG/bangla-adventure` (the owner in lowercase) | None |
| Image preflight (`vps-image-preflight.yml`) | Accepts digests in `ghcr.io/omargad/bangla-adventure` | Accepts digests in `ghcr.io/ORG/bangla-adventure` | None |
| Private staging image | `ghcr.io/omargad/bangla-adventure@sha256:5f9ac550...` | The same, until the image is copied | `STAGING_IMAGE_REPOSITORY`, once the copy exists ([Container images](#container-images)) |

**Why the VPS workflows check the repository ID.** They load the server's credentials and
connect to it, so they must run only in the one real repository, never in a fork or in a
copy someone makes of the project. They used to compare the repository's name,
`omargad/Bangla-Adventure`, which stops matching the moment the repository moves. They now
compare its numeric ID (`github.repository_id`, `1436643374`). GitHub keeps the same
repository, and so the same ID, through a transfer or a rename, while a fork or a copy always
gets a new one. (Check in the UI: the ID surviving a transfer follows from GitHub keeping the
repository object; step 1 of [After the transfer](#after-the-transfer) checks it.) Only if the
production repository were ever created again from scratch would the repository variable
`PRODUCTION_REPOSITORY_ID` name its new ID. The scripts the workflows call
(`scripts/private-staging.sh`, `scripts/private-staging-acceptance.sh`,
`scripts/production-ops-controller.sh`) check the same ID again before they read a
credential.

When someone asks for a server job anywhere else (a manual run, a commit marked to start
staging or acceptance, or the daily status check with `DEPLOY_ENABLED=true`), the
workflow's `other-repository` job explains why nothing ran, instead of leaving only
skipped jobs:

| Where the workflow runs | `PRODUCTION_REPOSITORY_ID` | Server jobs | `other-repository` job |
| --- | --- | --- | --- |
| `omargad/Bangla-Adventure` today | unset | run | skipped |
| `ORG/Bangla-Adventure` after the transfer | unset | run (same ID) | skipped |
| `ORG/Bangla-Adventure` after the transfer | set to `1436643374` | run | skipped |
| `ORG/Bangla-Adventure` after the transfer | set to any other ID by mistake | skipped | fails, naming both IDs |
| A fork | unset (a fork does not receive the repository's variables) | skipped | passes with a notice that forks never contact the server |
| A copy (imported, or created from a template) | unset | skipped | fails, saying a copy needs nothing and how to set the ID if it is meant to be production |

The other workflows (`ci.yml`, `moodle-plugin.yml`, `ingest-nctb.yml`) never named the owner.
The CI `deploy` job runs only when the repository variable `DEPLOY_ENABLED` is `true`,
which forks and copies do not have.

## Before the transfer

### 1. Ask the client for

- the organisation's exact name (`ORG`);
- whether the person sending the repository (`omargad`) will be a member allowed to create
  public repositories in it, or an owner for the day of the transfer;
- the organisation's plan (Free, Team or Enterprise) and its Actions policy;
- permission for the organisation to publish a public container package;
- who approves production releases (the `production` environment's required reviewers);
- who installs the Railway GitHub App on the organisation, if the Railway demo stays.

### 2. Permissions

- **Sender.** Needs administrator access to the repository (`omargad` has it) and permission
  to create a repository in `ORG`. Owners can always create repositories; a member can only if
  the organisation's member privileges allow creating public repositories. Otherwise an owner
  of `ORG` makes `omargad` an owner for the transfer, or an owner does it. GitHub documents no
  separate approval of an incoming transfer: permission to create repositories is enough. An
  organisation policy can also stop some users from transferring. (Documented.)
- **Name.** `ORG` must not already have a repository called `Bangla-Adventure` or a fork in
  the same network. Keep the name: renaming during the transfer needs an owner of `ORG`, and
  the image name `bangla-adventure` is fixed anyway. (Documented.)
- **Team members.** `.github/CODEOWNERS` names `omargad`, `MohammedAlAjmi24`, `Tlm0v`,
  `MAQ022`, `bahaa11-prog` and `104985376`. A code owner must have write access to the
  repository, so each needs write access in `ORG` (as a member or an outside collaborator),
  or GitHub ignores their lines and lists the error on the CODEOWNERS file. `omargad` is
  added as a collaborator by the transfer itself. (Documented.)
- **Production approvers.** Required reviewers of the `production` environment need at least
  read access to the repository. Up to six people or teams can be listed, and one approval is
  enough. (Documented.)

### 3. Organisation settings (an owner of `ORG`)

- **Actions** (Organisation settings > Actions > General > Policies): allow all actions, or
  "Allow select actions and reusable workflows" with "Allow actions created by GitHub"
  ticked. The workflows use only `actions/checkout`, `actions/setup-node` and
  `actions/upload-artifact`. Do not allow only actions from inside the organisation (that
  blocks `actions/checkout`), and do not turn on "Require actions to be pinned to a
  full-length commit SHA": the workflows use version tags such as `@v5`, which would then
  fail. (Documented.)
- **Workflow permissions**: either default works. Every job that publishes or reads images
  asks for its `packages` permission itself. (Documented.)
- **Packages** (Organisation settings > Packages): allow members to create public packages,
  and leave "Inherit access from source repository" on, so the repository's workflows can
  publish and read its package. (Documented.)
- **Plan and visibility**: keep the repository public. On Free and Team plans, required
  reviewers work only in public repositories, and on Free a private repository loses its
  environment protection rules and environment secrets. (Documented.)

### 4. Note down the settings, by name only

GitHub keeps a secret's value hidden for ever: nobody can read it back, so whoever holds each
value must be able to enter it again if a setting does not come across. Under
**Settings > Secrets and variables > Actions** and **Settings > Environments**, note:

| Where | Name | Kind | Who holds the value |
| --- | --- | --- | --- |
| `production` environment | `DEPLOY_SSH_KEY` | secret | the deployment key pair's holder |
| `production` environment (or repository) | `DEPLOY_HOST`, `DEPLOY_USER` | secrets | the server handover email |
| `production` environment (or repository) | `DEPLOY_KNOWN_HOSTS` | variable | can be read in the UI |
| `production` environment | `ELEVENLABS_API_KEY`, if set | secret | the client's ElevenLabs account |
| `production` environment | required reviewers, "Prevent self-review", deployment branches | protection rules | — |
| `production-status` environment, if created | `STATUS_SSH_KEY` | secret | nobody: a new status key can replace it ([After the transfer](#after-the-transfer), step 2) |
| `production-status` environment, if created | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS` | copies of the above | as above |
| `production-status` environment | no reviewers, only `main` may deploy | protection rules | — |
| Repository variables | `DEPLOY_ENABLED`, `DEPLOY_PORT`, `DEPLOY_PATH`, `DEPLOY_DOCKER_HOST`, `DEPLOY_DOCKER_CONTEXT`, `DEPLOY_HOST_FINGERPRINT`, `DEPLOY_KEY_FINGERPRINT`, `PUBLIC_HEALTH_URL`, `STATUS_SSH_PUBLIC_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_DAILY_CHARACTER_LIMIT` (whichever exist) | variables | can be read in the UI |

[`deploy/vps.github-variables.env.example`](../deploy/vps.github-variables.env.example)
lists the prepared values that are not secret. Also note the branch protection rules or
rulesets (**Settings > Branches**, **Settings > Rules**), webhooks (**Settings > Webhooks**),
deploy keys (**Settings > Deploy keys**) and installed GitHub Apps (**Settings > GitHub
Apps**, for example Railway). A screenshot of each page, with no secret value on it, is
enough.

### 5. A quiet window

- Note the value of `DEPLOY_ENABLED`. If it is `true`, set it to `false` for the move, so no
  deployment starts while settings are checked, and set it back at the end.
- Let running workflows finish, and do not push to `main` during the move.

## During the transfer

1. As `omargad`, open the repository's **Settings > General**, scroll to **Danger Zone** and
   choose **Transfer** (under "Transfer ownership").
2. Choose `ORG` as the new owner and keep the name `Bangla-Adventure`. Type the repository's
   name when asked to confirm, then choose **I understand, transfer this repository**.

What moves with it (documented): issues, pull requests, the wiki, stars and watchers;
webhooks, services, secrets and deploy keys stay attached; commits and contributions keep
their history; forks stay attached. `omargad` becomes a collaborator and the other
collaborators stay. Issue assignees who are not members of `ORG` are removed from their
issues. The new owner can administer the repository at once.

## After the transfer

1. **The repository.** Open `https://github.com/ORG/Bangla-Adventure`. Check its ID:
   `gh api repos/ORG/Bangla-Adventure --jq .id` must print `1436643374`. (Check in the UI.)
   If it ever printed another number, set the repository variable `PRODUCTION_REPOSITORY_ID`
   to that number; the VPS workflows say so themselves if it is needed.
2. **Environments, secrets and variables.** GitHub's transfer page says secrets stay but does
   not name Actions variables, environments or their rules. (Check in the UI.) Compare
   **Settings > Environments** and **Settings > Secrets and variables > Actions** with the list
   from [step 4](#4-note-down-the-settings-by-name-only):
   - If `production` or `production-status` is missing, re-create it **before any workflow
     runs**. A workflow that names a missing environment creates it, empty and without
     protection rules. (Documented.)
   - Check `DEPLOY_ENABLED` in particular. Without it, deploys, **VPS production
     operations** and the daily **VPS production status** check are skipped with no message,
     exactly as before go-live.
   - Re-enter any missing secret from its holder. A lost `STATUS_SSH_KEY` is replaced by a
     new status key: follow
     [Setting up the status key](PRODUCTION_OPERATIONS.md#setting-up-the-status-key) and
     [Replacing or removing the status key](PRODUCTION_OPERATIONS.md#replacing-or-removing-the-status-key),
     which ends with an approved `install` run of **VPS production operations**.
   - Required reviewers: re-add anyone missing. Reviewers must have read access in `ORG`.
     Check "Prevent self-review" and the deployment branches (`production-status`: only
     `main`).
3. **People and rules.** Give the team write access (for CODEOWNERS), then open
   `.github/CODEOWNERS` on GitHub: it shows any line it cannot use. Re-create branch
   protection rules or rulesets, webhooks and deploy keys that did not come across. (Check in
   the UI.) Check **Settings > Actions > General**: Actions are allowed for the repository.
4. **Container images.** See [Container images](#container-images) below.
5. **First runs.**
   - Run **CI** on `main` (push, or **Actions > CI > Run workflow**). `verify`, `e2e`,
     `container` and `publish` must pass; `publish` creates `ghcr.io/ORG/bangla-adventure`.
     `deploy` runs only with `DEPLOY_ENABLED=true` and waits for a reviewer.
   - Run **VPS SSH preflight** on `main` (with `DEPLOY_ENABLED` still `false`). It proves that
     the `production` environment's secrets work from the new location without changing the
     server.
   - If production is live, run **VPS production status** on `main` once by hand: it must end
     with `status: healthy`, which proves the `production-status` environment and the status
     key.
   - If a VPS workflow fails with "Not the production repository", follow its message
     (step 1 above).
   - Set `DEPLOY_ENABLED` back to its noted value.
6. **Railway demo.** See [Railway and Vercel](#railway-and-vercel).
7. **Local clones and links.** See [Clones and links](#clones-and-links).

## Container images

**What happens to the packages (documented).** A container package belongs to an account,
not to a repository, and a transfer does not move it. `ghcr.io/omargad/bangla-adventure`
stays under `omargad`, loses its link to the repository, and the repository's workflows lose
access to it. It is public, so it can still be pulled anonymously, including by digest, for
as long as `omargad` keeps it and keeps it public. GitHub has no way to move a package to
another owner; the image is copied instead.

**Order matters.** A workflow's `GITHUB_TOKEN` cannot push to a package that someone created
first from the command line and never connected to the repository. So:

1. **Let CI create the organisation's package.** The first CI run on `main` after the move
   publishes `ghcr.io/ORG/bangla-adventure:sha-COMMIT` and `latest`. Publishing from the
   workflow links the package to the repository and gives the repository's workflows access.
   If `publish` fails with a permission error, the package already existed unconnected: an
   owner of `ORG` opens the package's settings and either connects the repository (choosing
   to inherit its access) or adds the repository under **Manage Actions access** with the
   **Write** role. (Documented.)
2. **Make it public.** A first publish is private. To match today's package, an owner of
   `ORG` opens the package's settings, **Danger Zone > Change visibility > Public**. This
   cannot be undone. (Documented.) The production deploy would also work with a private
   package linked to the repository, because it signs in with the workflow's token.
3. **Copy the private staging image, keeping its digest.** Private staging runs one reviewed
   image: digest `sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13`,
   built from revision `a709cb3d2bc9fb0a271e6814bc96d1f16444c94f`, a single `linux/amd64`
   manifest. A byte-for-byte copy has the same digest under the new name. Sign in to
   `ghcr.io` with a token of an `ORG` member that has `write:packages`, then:

   ```sh
   crane copy ghcr.io/omargad/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13 ghcr.io/ORG/bangla-adventure:staging-a709cb3
   crane digest ghcr.io/ORG/bangla-adventure:staging-a709cb3
   # must print sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13
   crane config ghcr.io/ORG/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13 | jq -r '.config.Labels["org.opencontainers.image.revision"]'
   # must print a709cb3d2bc9fb0a271e6814bc96d1f16444c94f
   ```

   or, with skopeo, which fails rather than change the digest:

   ```sh
   skopeo copy --preserve-digests docker://ghcr.io/omargad/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13 docker://ghcr.io/ORG/bangla-adventure:staging-a709cb3
   ```

   `crane auth login ghcr.io -u USERNAME --password-stdin` (or `docker login ghcr.io`) signs
   in; `ORG` must be lowercase in image names. Do not use `docker buildx imagetools create`
   for this image without `--prefer-index=false`: it would wrap the single manifest in a new
   index with a new digest. Do not pull, re-tag and push with Docker either, since that is
   not guaranteed to keep the digest. The copy's source label still names
   `https://github.com/omargad/Bangla-Adventure`; labels are part of the image and cannot
   change, and the old address redirects. (Documented: crane and skopeo keep the digest.)
4. **Point private staging at the copy.** Set the repository variable
   `STAGING_IMAGE_REPOSITORY` to `ghcr.io/ORG/bangla-adventure` (lowercase, no tag or digest).
   The digest and revision are fixed in the scripts; only this path changes. Then run **VPS
   private staging** on `main` with its confirmation ticked: it pulls the same digest from the
   new path and restarts the stage on it. Run **VPS private acceptance** only after that,
   because acceptance requires the stage to be running exactly the configured path and stops
   with "if STAGING_IMAGE_REPOSITORY changed, run VPS private staging first" otherwise. Until
   the variable is set, staging keeps pulling the original public package, which also works.
5. **Keep the old package** public and in place until both private staging runs from the
   copy and production has had at least one successful deploy from `ORG`. A failed deploy
   starts the previous image again, and until then that previous image is in the old package.

**The server's `.env`.** Each deploy records the running image as `APP_IMAGE` in the
production `.env` in the deployment directory; nobody edits it. Before the first deploy from
`ORG` it names the old package (still pullable while it stays public); afterwards it names
`ghcr.io/ORG/bangla-adventure@sha256:...`. Private staging has no `.env` image: its
`release.json` records the path it was started from. No server file needs a manual change.

## Railway and Vercel

**Railway** (the demo service deploys from this repository's `main`). Railway reaches GitHub
through its GitHub App, and an app installed on `omargad` does not cover repositories owned
by `ORG`. (Documented.)

1. An owner of `ORG` installs the Railway app on the organisation with access to
   `Bangla-Adventure` (a member who selects the organisation sends the owner a request
   instead), and accepts any pending permission update for it.
2. In Railway, open the demo service's settings, disconnect its source repository and
   connect `ORG/Bangla-Adventure`, branch `main`. If it is not listed, use **Add > GitHub
   Repository > Refresh**. The CLI equivalent is `railway service source`. (Documented as
   Railway's general fix when automatic deploys stop.)
3. Push to `main` (or redeploy) and check a deployment starts. The service's variables,
   volume and domain belong to Railway and stay. (Check in the UI: Railway documents no
   transfer case, and some users needed Railway support to reconnect.)

**Vercel.** The repository has no Vercel configuration, so no Vercel project is expected. If
one exists, reconnect it under **Project Settings > Git > Connected Git Repository** (or
`vercel git disconnect`, then `vercel git connect`). (Check in the UI.)

## Clones and links

- **Git remotes.** Old clone, fetch and push addresses redirect, but update every clone:
  `git remote set-url origin https://github.com/ORG/Bangla-Adventure.git`. The deployments
  do not use a checkout on the server; they upload what they need over SSH. (Documented.)
- **Never create a repository or fork called `omargad/Bangla-Adventure`.** That deletes the
  redirects for good. If the repository had more than 100 clones or Actions uses in the week
  before the move, GitHub retires the old name anyway. (Documented.)
- **Links in the documents.** Links to `github.com/omargad/Bangla-Adventure`, including the
  commit links in the ownership records, keep working through the redirect. Update the
  canonical repository links (README, [HANDOVER.md](HANDOVER.md),
  [DELIVERABLES.md](DELIVERABLES.md), [DEPLOYMENT.md](DEPLOYMENT.md),
  [ACCEPTANCE.md](ACCEPTANCE.md)) and the image name `ghcr.io/omargad/bangla-adventure` in
  [DELIVERABLES.md](DELIVERABLES.md) and [PRIVATE_STAGING.md](PRIVATE_STAGING.md) in one
  commit after the move. GitHub Pages addresses are not redirected, but this repository has
  no Pages site. (Documented.)
- **Optional.** `ingest-nctb.yml` commits its extracted text as `omargad`; change the two
  `git config` lines if the client prefers another name. The `@omargad` lines in
  `.github/CODEOWNERS` keep working while `omargad` has write access; reassign them when that
  ends.

## Sources

- GitHub: [Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
- GitHub: [Restricting repository creation in your organization](https://docs.github.com/en/organizations/managing-organization-settings/restricting-repository-creation-in-your-organization)
- GitHub: [Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) and [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#required-reviewers)
- GitHub: [Disabling or limiting GitHub Actions for your organization](https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization)
- GitHub: [About permissions for GitHub Packages](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages#about-repository-transfers), [Configuring a package's access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility), [Connecting a repository to a package](https://docs.github.com/en/packages/learn-github-packages/connecting-a-repository-to-a-package) and [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- GitHub: [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- GitHub: [Installing a GitHub App from a third party](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- crane: [`crane copy`](https://github.com/google/go-containerregistry/blob/main/cmd/crane/doc/crane_copy.md); skopeo: [`skopeo copy`](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md); Docker: [`buildx imagetools create`](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/)
- Railway: [GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys#cant-enable-autodeploy) and [`railway service`](https://docs.railway.com/cli/service#manage-service-sources)
- Vercel: [`vercel git`](https://vercel.com/docs/cli/git)
