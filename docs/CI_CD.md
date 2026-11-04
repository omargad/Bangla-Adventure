# Running the pipeline on any CI/CD system

The checks, publishing and deployment are shared scripts in `scripts/ci/` and `scripts/deploy.sh`
([DEPLOYMENT.md](DEPLOYMENT.md#automatic-deployment) describes what they do and how a server is set
up once). Each CI/CD system below has a small file in the repository that only calls those
scripts, so the pipeline behaves the same wherever it runs:

1. On every branch and pull request: `scripts/ci/verify.sh` (lint, tests, build),
   `scripts/ci/e2e.sh` (browser tests) and `scripts/ci/container.sh` (builds the image and runs
   the container test).
2. On the default branch: the image is published under its commit (`sha-COMMIT`) once its container
   test passes, and once every check has passed it is marked `latest` and deployed to the server
   with `scripts/deploy.sh`.
3. Publishing waits until a registry is set (`REGISTRY_IMAGE`, or the CI system's own registry),
   and deploying until `DEPLOY_HOST` is set; until then those steps are skipped and say so.

| CI/CD system | File | Runs on | Container test |
| --- | --- | --- | --- |
| GitHub Actions | `.github/workflows/ci.yml` | GitHub-hosted Ubuntu | In full |
| GitLab CI/CD | `.gitlab-ci.yml` | Docker images; Docker-in-Docker for the image | In full |
| Jenkins | `Jenkinsfile` | Your agents | In full |
| Bitbucket Pipelines | `bitbucket-pipelines.yml` | Docker images; Runtime v3 Docker for the image | In full, or skips a refused option |
| CircleCI | `.circleci/config.yml` | `cimg/node`; a Linux VM for the image | In full |
| Azure Pipelines | `azure-pipelines.yml` | Microsoft-hosted Ubuntu | In full |
| TeamCity | `.teamcity/settings.kts` | Your agents or TeamCity Cloud | In full |
| AWS CodeBuild / CodePipeline | `buildspec.yml` | `aws/codebuild/standard:8.0`, privileged | In full |
| Google Cloud Build | `cloudbuild.yaml` | Docker images on the build machine | In full |
| Travis CI | `.travis.yml` | Ubuntu 24.04 VMs | In full |

The files were written against each vendor's current documentation and checked with its schema or
validator; GitHub Actions is the one that runs on every push today.

## How every pipeline behaves

**Only the newest commit.** Pipelines can finish out of order, and an old one can be run again. So on every CI system, publishing `latest` and deploying go ahead only when `scripts/ci/newest.sh` finds that the commit is still the tip of the default branch on the remote origin. Otherwise the step is skipped with a notice and the pipeline still passes. When the check cannot read the remote (no credentials, no network), it prints a warning and carries on.

**Restricted Docker services.** Some CI systems' Docker services refuse some `docker run` options. `scripts/test-container.sh` tries each option on a throwaway container before the check that needs it. If the option is refused, the test fails and names it. On such a CI system, set `CONTAINER_TEST_ALLOW_SKIP=1` for the container job: that check is then skipped, the `compose.yaml` check is skipped when Compose is missing, and the test lists what it skipped at the end. The core checks always run: start as a non-root user, fresh database, backup tool, data kept across a new container, and a clean stop. A service that cannot attach a named volume (neither `--mount` nor `--volume`) cannot run the container job at all. Leave the setting unset everywhere else.

**Secrets on one line.** For CI systems whose secret variables hold a single line, `DEPLOY_SSH_KEY_BASE64` and `DEPLOY_KNOWN_HOSTS_BASE64` take the same texts as one line of base64 (`base64 -w0 FILE`; on macOS `base64 -i FILE`). If more than one form of a setting is set, `DEPLOY_SSH_KEY_FILE` is used first, then the text or file path, then the base64 one.

## GitHub Actions

The settings go under Settings > Secrets and variables > Actions, as listed in
[DEPLOYMENT.md](DEPLOYMENT.md#automatic-deployment). Secrets can hold several lines, so `DEPLOY_SSH_KEY` stays as the key text. The newest-commit check uses the token that `actions/checkout` leaves in the checkout, so it works for private repositories too. A run whose commit is no longer the newest, such as an old run started again, still publishes its own `sha-` image. It skips marking it `latest` and deploying, and says so in a notice on the run.

## GitLab

GitLab uses the same names under Settings > CI/CD > Variables. Protected variables reach only protected branches, such as the default branch. GitLab can mask only a single-line value, so either:
- make `DEPLOY_SSH_KEY` a protected File variable (or a Variable with visibility Visible); or, better,
- add the key as `DEPLOY_SSH_KEY_BASE64` (the output of `base64 -w0` on the key file). That value is one line, so it can be protected and set to Masked and hidden.

`DEPLOY_KNOWN_HOSTS` can be a Variable or File variable, or `DEPLOY_KNOWN_HOSTS_BASE64`. The publish and deploy jobs read the default branch's tip with the job's own checkout before tagging `latest` or deploying. The deploy job runs in `alpine:3.20` and installs bash, git and the SSH client. The container jobs use Docker-in-Docker over TLS: a self-managed runner must be privileged and share `/certs/client` (in its `config.toml`, `privileged = true` and `volumes = ["/certs/client", "/cache"]`). GitLab.com's hosted runners already are. Nothing in the container test is skipped there.

## Jenkins

Jenkins runs the `Jenkinsfile` as a multibranch pipeline on an agent with Node 22, Python 3, Docker with Compose, bash, git and ssh. The browser tests install Chromium's system libraries, so the agent must either run as root or have passwordless sudo, or have those libraries installed once (`sudo npx playwright install-deps chromium` in a checkout of the repository) with `PLAYWRIGHT_INSTALL_DEPS=0` set on the agent. It publishes when `REGISTRY_IMAGE` is set (lowercase, for example `ghcr.io/OWNER/REPOSITORY`), using the username and password credential `registry`. It deploys when `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` (or `DEPLOY_KNOWN_HOSTS_BASE64`) are also set, using the SSH key credential `deploy-ssh-key`. Every build of `main` pushes its `sha-` image, but only the newest commit of `main` is also pushed as `latest` and deployed. The check reads the repository with the agent's own git access, because Jenkins does not keep the checkout credentials. For a private repository, give the agent read access (for example a deploy key in its `~/.ssh`). Without it, the check warns and carries on, and builds of one branch still run one at a time.

## Bitbucket Pipelines

Bitbucket Pipelines runs `bitbucket-pipelines.yml` once Pipelines is turned on (Repository settings > Pipelines > Settings). Every branch runs the checks, the browser tests and the container test as parallel steps; on `main` the image is then published, marked `latest` and deployed, and, as on GitHub, only the newest commit on `main` is marked `latest` and deployed. Set these repository variables (Repository settings > Pipelines > Repository variables): `REGISTRY_IMAGE`, the image's name in lowercase, and, to deploy, `DEPLOY_HOST`. For Bitbucket's own container registry, `REGISTRY_IMAGE` is `crg.apkg.io/WORKSPACE/bangla-adventures` and the pipeline signs in with its own credentials, so nothing else is stored. Bitbucket documents that registry as not fully OCI-compatible and limits uploads to 7 minutes; if it refuses the image, use another registry such as `docker.io/OWNER/bangla-adventures`, with `REGISTRY_USER` and `REGISTRY_PASSWORD` (Secured). Leave `REGISTRY_IMAGE` and `DEPLOY_HOST` unsecured: the steps' conditions read them, and conditions cannot read secured variables. While either is unset, the steps that need it are skipped. Bitbucket variables hold a single line, so the other deploy settings go on the Production environment (Repository settings > Deployments) with the key and host keys base64-encoded: `DEPLOY_SSH_KEY_BASE64` (Secured; `base64 -w0 < KEY`, on macOS `base64 -i KEY`), `DEPLOY_KNOWN_HOSTS_BASE64` (`base64 -w0 < server.keys`), and `DEPLOY_USER`, `DEPLOY_PORT` and `DEPLOY_PATH` when they differ from the defaults. Deploys run one at a time: the deploy step is in a concurrency group, and Bitbucket pauses a second deployment to the same environment while one is running (resume it from its pipeline). To approve each deploy first, add `trigger: manual` to the deploy step. The container step uses Runtime v3, whose Docker accepts every option the container test uses, with a `docker:29-dind` service of 6 GB in a 2x step (8 GB, and twice the build minutes). `CONTAINER_TEST_ALLOW_SKIP=1` is set there, so should Bitbucket's Docker still refuse an option, that part of the test is skipped with a message instead of failing. The other steps fit the default size (4 GB). If the main branch has another name, change `main` in both places in the file.

## CircleCI

CircleCI runs `.circleci/config.yml` once the repository is set up as a CircleCI project. The checks and the browser tests run in `cimg/node:22.23` (Docker executor, `medium`: 2 CPUs and 4 GB; the browser tests install Chromium's libraries with the image's passwordless sudo), and the container test on an `ubuntu-2604` Linux VM (machine executor, `medium`), whose own Docker runs the whole test. On the default branch the image is then published, marked `latest` and deployed. Only the newest commit is marked `latest` and deployed, and deploys run one at a time: the deploy job is in a serial group, which also skips an older pipeline's deploy while a newer one is waiting. CircleCI has no container registry, so set these (where, see below): `REGISTRY_IMAGE` (lowercase, for example `docker.io/OWNER/bangla-adventures`), `REGISTRY_USER` and `REGISTRY_PASSWORD` to publish, and `DEPLOY_HOST`, `DEPLOY_SSH_KEY_BASE64` and `DEPLOY_KNOWN_HOSTS_BASE64` to deploy, plus `DEPLOY_USER`, `DEPLOY_PORT` and `DEPLOY_PATH` when they differ from the defaults. As CircleCI recommends for multi-line values, the key and the host keys are given base64-encoded (`base64 -w0 < FILE`; on macOS `base64 -i FILE`). While `REGISTRY_IMAGE` or `DEPLOY_HOST` is unset, the job that needs it says so and does nothing. Put them in the context `bangla-release` (Organization Settings > Contexts), restricted to the default branch with the expression restriction `pipeline.git.branch == "main"`, not in project variables, which reach every job of every branch. Only the default branch's container, promote and deploy jobs use that context, and the checks also drop these settings before installing dependencies. Create the context, even empty, before the default branch's first build: its jobs cannot start without it. CircleCI builds pull requests from forks only once Project Settings > Advanced > "Build forked pull requests" is On (organisations signed in with OAuth; leave "Pass secrets to builds from forked pull requests" Off). GitHub App organisations cannot build them.

## Azure Pipelines

Azure Pipelines runs `azure-pipelines.yml`. Create a pipeline from the repository (Pipelines > New pipeline, then "Existing Azure Pipelines YAML file"). It runs on Microsoft-hosted Ubuntu agents, which have Docker with Compose, so the container test runs in full. Those agents have 2 cores, 7 GB of memory and about 10 GB of free disk. An organisation's free grant is one parallel job of up to 60 minutes and 1,800 minutes a month, so the jobs then run one after another. A self-hosted agent downloads Node 22 itself. It needs Python 3, Docker with the Compose plugin, bash, git, ssh and passwordless sudo, or Chromium's libraries installed and the pipeline variable `PLAYWRIGHT_INSTALL_DEPS=0`. Azure has no registry for the pipeline to use, so on `main` the image is published only when `REGISTRY_IMAGE` is set (lowercase, for example `ghcr.io/OWNER/REPOSITORY` or `NAME.azurecr.io/bangla-adventures`). It signs in with `REGISTRY_USER` and `REGISTRY_PASSWORD`. Set these as variables of the pipeline (Edit > Variables). Mark only `REGISTRY_PASSWORD` "Keep this value secret": the conditions and scripts read the others, and scripts see a secret only where the pipeline maps it. Deploying also needs:

- `DEPLOY_HOST`;
- `DEPLOY_KNOWN_HOSTS_BASE64`: the output of `base64 -w0 server.keys` (on macOS, `base64 -i server.keys`), because a variable holds one line;
- `DEPLOY_SSH_KEY_BASE64`: the output of `base64 -w0` on the deploy user's private key, marked "Keep this value secret";
- `DEPLOY_USER`, `DEPLOY_PORT` and `DEPLOY_PATH`, only when they differ from the defaults.

Deploys go to the environment `production`. Create it under Pipelines > Environments before setting `DEPLOY_HOST`. Under its Approvals and checks, add Exclusive lock, so that one deploy runs at a time and a newer run's deploy replaces one still waiting. Add Approvals there to approve each deploy. The first deploy asks you to permit the pipeline to use the environment. As on GitHub, only the newest commit on `main` is marked `latest` and deployed. The pipeline's `pr` trigger builds pull requests from GitHub or Bitbucket. For Azure Repos, add the pipeline as a build validation branch policy instead.

## TeamCity

TeamCity reads `.teamcity/settings.kts` (Kotlin DSL, TeamCity 2025.11 or newer). First create a project for the settings, then create the versioned project inside it from the repository's URL, and choose to import the settings from `.teamcity`. Check that the VCS root's branch specification is `+:refs/heads/*`, so every branch is built. Pull requests themselves, including those from forks, are not built and get no result on the pull request; add TeamCity's Pull Requests and Commit status publisher features if that is wanted, and then keep the secrets on Publish and Deploy only. Verify, E2E and Container run on every branch. Publish and Deploy take only the default branch. On the default branch, Deploy's trigger runs the whole chain, and only one Deploy runs at a time. Verify and E2E run in the `node:22-bookworm` image. The agent itself needs Linux, Docker with the Compose plugin, bash, git and ssh, but not Node. TeamCity Cloud's JetBrains-hosted Ubuntu agents have these. Choose Medium (8 GB) or larger, because the image build runs `npm ci` and the production build inside Docker.

The settings are parameters of the outer project, which this project inherits. That way neither secrets nor edits made in the web interface end up in the repository. On the outer project's Parameters page, add:

- to publish: `env.REGISTRY_IMAGE` (lowercase, for example `ghcr.io/OWNER/REPOSITORY`), `env.REGISTRY_USER` and `env.REGISTRY_PASSWORD` (type Password);
- to deploy: `env.DEPLOY_HOST`, `env.DEPLOY_KNOWN_HOSTS_BASE64` (`base64 -w0 server.keys`) and `env.DEPLOY_SSH_KEY_BASE64` (`base64 -w0` of the private key, type Password);
- `env.DEPLOY_USER`, `env.DEPLOY_PORT` and `env.DEPLOY_PATH`, only when they differ from the defaults.

Without `env.REGISTRY_IMAGE`, Publish and Deploy say so and do nothing; without `env.DEPLOY_HOST`, Deploy does the same. The check that only the newest commit is marked `latest` and deployed asks the repository directly. For a private repository it cannot sign in, so it says so and carries on. TeamCity's build queue does replace a waiting chain with a newer commit's when that does not delay it. To check changes to the settings before committing them, run `mvn -Dteamcity.server.url=https://YOUR-TEAMCITY teamcity-configs:generate` in `.teamcity`. The server provides the DSL for the build steps and triggers.

## AWS CodeBuild

AWS CodeBuild runs `buildspec.yml`. Create a build project with the managed image `aws/codebuild/standard:8.0` (Ubuntu; it has Node 22, Python 3 and Docker with Compose). Turn on Privileged, because Docker needs it. Choose a compute type with at least 8 GB of memory (`BUILD_GENERAL1_MEDIUM`; Small's 4 GB is too little) and a timeout of 90 minutes, and add a webhook for push and pull request events. Settings are environment variables of the project:

- `REGISTRY_IMAGE` turns publishing on. For an Amazon ECR repository it is `ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY`. The build signs in with its service role, which needs `ecr:GetAuthorizationToken` and both push and pull rights on the repository (for example AmazonEC2ContainerRegistryPowerUser, or the same actions limited to the repository), because the server pulls with the same sign-in. Leave the repository's tags mutable so that `latest` can move. The server pulls with the same sign-in, which lasts 12 hours and is not stored there.
- Another registry works with `REGISTRY_USER` and `REGISTRY_PASSWORD` (type Secrets Manager).
- Deploying also needs `DEPLOY_HOST`, plus `DEPLOY_USER`, `DEPLOY_PORT` and `DEPLOY_PATH` when they differ from the defaults.
- `DEPLOY_KNOWN_HOSTS` is type Parameter: a Parameter Store parameter holding the contents of `server.keys`.
- `DEPLOY_SSH_KEY` is type Secrets Manager: a plaintext secret holding the key. Its line breaks are kept.
- The service role needs `ssm:GetParameters` and `secretsmanager:GetSecretValue` for the parameter and the secret. A role the console creates allows only names that start with `/CodeBuild/`.

Project variables reach every build of the project, pull requests included. So build pull requests, and pushes to other branches, in a second project without these variables, whose role cannot push or read the secrets, and give the deploying project a webhook filter for pushes to `main` only. Webhook builds run side by side. Only the newest commit of `main` is marked `latest` and deployed, and the server runs one deploy at a time, refusing a second that starts meanwhile. If the build cannot read the branch from the repository, as can happen with a private one, the newest-commit check says so and carries on. The container test runs in full; nothing is skipped.

## AWS CodePipeline

AWS CodePipeline runs the same `buildspec.yml` as the CodeBuild action of its build stage, with a project set up as above. No other buildspec is needed. Use a V2 pipeline whose source is the repository connection on `main`, in execution mode SUPERSEDED (the default) or QUEUED. That way only one execution is in the stage at a time, so deploys never overlap, and a newer commit waiting at the stage takes the place of an older one. Put the settings above on the build action (Environment variables, of type Plaintext, Parameter or Secrets Manager). Also set `BRANCH` to `#{SourceVariables.BranchName}`, because a build started by CodePipeline is not told its branch and otherwise publishes nothing. With the default output artifact format the source has no Git history. The image is then tagged with the commit CodePipeline reports, and the newest-commit check says it cannot check and carries on, with the pipeline's own ordering taking its place. The output artifact format "Full clone" keeps the history; the build's role then also needs `codeconnections:UseConnection`.

## Google Cloud Build

Google Cloud Build runs `cloudbuild.yaml`. Connect the repository and create two triggers that use this file: one for pushes to the branch `^main$`, with the substitutions below, and one for pull requests without them. Branches without a pull request are checked once one is opened, or add a third trigger for pushes to other branches set up like the pull request one. On the push trigger:

- `_REGISTRY_IMAGE` is the image in an Artifact Registry Docker repository: `REGION-docker.pkg.dev/PROJECT/REPOSITORY/bangla-adventures`.
- To deploy, set `_DEPLOY_HOST`, plus `_DEPLOY_USER`, `_DEPLOY_PORT` and `_DEPLOY_PATH` when they differ from the defaults.

Put the deploy key and the contents of `server.keys` in Secret Manager as the secrets `deploy-ssh-key` and `deploy-known-hosts`, for example `gcloud secrets create deploy-ssh-key --data-file=KEY_FILE`. To use other names, set them in `_DEPLOY_SSH_KEY_SECRET` and `_DEPLOY_KNOWN_HOSTS_SECRET`. The secrets are read only when a deploy runs, so builds work before they exist.

The push trigger's service account needs Artifact Registry Writer on the repository, Secret Manager Secret Accessor on the two secrets, and Logs Writer, because the build logs go to Cloud Logging only. It signs in to Artifact Registry with a one-hour access token (user `oauth2accesstoken`). The server pulls with a new token, which is not stored there. Give the pull request trigger its own service account with Logs Writer only, so code in a pull request can neither read the deploy key nor publish, and keep comment control (`/gcbrun`) on for pull requests from forks. To approve each deploy, turn on "Require approval" on the push trigger.

The default machine (e2-standard-2: 2 vCPUs, 8 GB) is enough, within the file's 90-minute timeout. The browser tests install Chromium's libraries as root, and the container test uses the build machine's own Docker, so nothing is skipped. Cloud Build does not queue builds of a trigger. Only the newest commit of `main` is marked `latest` and deployed, and the server runs one deploy at a time, refusing a second that starts meanwhile. If the build cannot read the branch from the repository, the newest-commit check says so and carries on.

## Travis CI

Travis CI (travis-ci.com) runs `.travis.yml` once the repository is activated there. Its jobs run on Ubuntu 24.04 virtual machines (2 CPUs, about 7.5 GB of memory) with Docker, the Compose plugin and passwordless sudo, so the browser tests install Chromium's libraries themselves and the container test runs in full; nvm installs Node 22. Pushes and pull requests run the checks. Publishing and deploying run for pushes to `main`, and for builds of `main` started with Trigger build, in stages that start only once every earlier job has passed; each job must finish within Travis's limit of 50 minutes on a public repository (120 on a private one). Travis has no registry, so set `REGISTRY_IMAGE` (lowercase, for example `ghcr.io/OWNER/REPOSITORY` or `docker.io/USER/bangla-adventures`), `REGISTRY_USER` and `REGISTRY_PASSWORD`, then `DEPLOY_HOST` and the other deploy settings, under the repository's More options > Settings > Environment Variables. Publishing is skipped while `REGISTRY_IMAGE` is unset, and deploying while `DEPLOY_HOST` is.

Travis variables hold one line each and go into the build script as they are written, so the deploy key and the host keys are given in base64 on one line: `DEPLOY_SSH_KEY_BASE64` is the output of `base64 -w0 ~/.ssh/bangla_deploy` and `DEPLOY_KNOWN_HOSTS_BASE64` that of `base64 -w0 server.keys` (on macOS, `base64 -i FILE`). A value with characters special to bash, such as some passwords, goes in single quotes. Base64 variables are used rather than `travis encrypt-file`, which would add an encrypted key file and its decryption step to the repository. Leave Display value in build log off for `REGISTRY_PASSWORD` and `DEPLOY_SSH_KEY_BASE64`, and restrict both to the branch `main`. Pull requests from forks never receive them, and the test jobs remove them from their environment before running the dependencies' install scripts. The image build pulls its base image from Docker Hub, which limits pulls by address, and Travis's addresses are shared. If the container job hits that limit, set `DOCKERHUB_USER` and `DOCKERHUB_TOKEN` (a Docker Hub access token) to pull signed in. `IMAGE_SOURCE`, the repository's web address, optionally links a ghcr.io image to the repository. Only the newest commit of `main` is marked `latest` and deployed; an old build restarted skips those steps with a notice. Travis cannot hold a deploy back while another runs: the server refuses a deploy that overlaps one in progress, and that job can be restarted once the other has finished.

## Other CI/CD tools

The scripts in `scripts/ci/` also suit these, without a configuration file in the repository:

- **Buildkite** runs its agent on your own machines (or Buildkite's hosted ones), so the scripts run as they are on an agent with the same tools as Jenkins: Node 22, Python 3, Docker with Compose, bash, git and ssh. A `.buildkite/pipeline.yml` lists `bash scripts/ci/...` command steps, a `wait` step before publishing, `branches: "main"` on the publish and deploy steps, and `concurrency: {limit: 1, group: deploy}` on the deploy step so only one runs at a time. Secrets come from Buildkite secrets (`secrets:` on a step) or an agent hook.
- **Drone** and **Woodpecker** run each step in a container: `node:22-bookworm` for verify and the browser tests, as on GitLab. The container test needs a Docker daemon: the host's `/var/run/docker.sock` mounted, or a privileged `docker:dind` service, and either one needs an administrator to mark the repository trusted. Without that, Drone's exec runner or Woodpecker's local backend runs the steps on the host, like a Jenkins agent. Secrets are per repository (`from_secret`), and Drone keeps them from pull requests by default.
- **Semaphore**'s Ubuntu 24.04 machines have Docker with `docker compose`, nvm (`nvm install 22`), Python 3 and passwordless sudo, so all the scripts run unchanged. Publishing and deploying go in a promotion with `auto_promote: when: branch = 'main' AND result = 'passed'`, and a named queue keeps deploys one at a time. A secret can be a file, so `DEPLOY_SSH_KEY_FILE` and `DEPLOY_KNOWN_HOSTS` can name secret files.
- **Harness CI** on Harness Cloud runs each stage on a Linux VM with Docker, where Run steps execute on the host, so the scripts run unchanged. On a Kubernetes build infrastructure, the container test needs a privileged Docker-in-Docker background step. Secrets are text or file secrets (`<+secrets.getValue("NAME")>`).
- **Bamboo** (Data Center) defines plans with Bamboo Specs (YAML or Java) kept in the repository, and runs the scripts in Script tasks on an agent with the same tools as Jenkins. Bamboo exports its variables as `$bamboo_NAME`, so each task passes them on (`REGISTRY_USER="$bamboo_REGISTRY_USER" bash scripts/ci/publish.sh ...`). Deploying fits a deployment project.
- **Argo CD** and **Flux** deliver to Kubernetes from Git and run no scripts. The checks and publishing stay on one of the CI systems above, and they replace `scripts/deploy.sh` for a Kubernetes deployment like the outline in "Other container hosts" (`strategy: Recreate`, a ReadWriteOnce volume). They can follow the `latest` tag, which the pipeline moves only after every check: Flux image automation with `digestReflectionPolicy: Always`, or Argo CD Image Updater's `digest` strategy. The `sha-` tags cannot be ordered, so use neither tool's newest-tag policy on them. Unlike `deploy-remote.sh`, they take no backup before switching and do not go back to the previous image on a failed health check, so schedule backups separately.
