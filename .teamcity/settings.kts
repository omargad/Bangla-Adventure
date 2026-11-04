import jetbrains.buildServer.configs.kotlin.*
import jetbrains.buildServer.configs.kotlin.buildSteps.ScriptBuildStep
import jetbrains.buildServer.configs.kotlin.buildSteps.script
import jetbrains.buildServer.configs.kotlin.triggers.vcs

// The same pipeline as .github/workflows/ci.yml, for TeamCity: each build configuration runs one of
// the shared scripts in scripts/ci (docs/DEPLOYMENT.md "Automatic deployment"). Create the project
// from this repository's URL and TeamCity loads these settings; give its VCS root the branch
// specification +:refs/heads/* so that every branch is built.
// Verify and E2E run in the node:22-bookworm image; the agent needs Linux, Docker with the Compose
// plugin, bash, git and ssh.
// On the default branch the tested image is published when env.REGISTRY_IMAGE is set (for example
// ghcr.io/OWNER/REPOSITORY), signing in with env.REGISTRY_USER and env.REGISTRY_PASSWORD (a Password
// parameter), and deployed when env.DEPLOY_HOST is also set, with env.DEPLOY_KNOWN_HOSTS_BASE64 and
// env.DEPLOY_SSH_KEY_BASE64 (a Password parameter), each `base64 -w0 FILE`, plus env.DEPLOY_USER,
// env.DEPLOY_PORT and env.DEPLOY_PATH when they differ from the defaults. Add these parameters to a
// parent project, whose settings are not kept in the repository; this project inherits them.
// Shell variables are written ${'$'}NAME below, since Kotlin would otherwise read $NAME itself.

version = "2025.11"

project {
    description = "Bangla Adventures: tests, the container image, publishing and deployment"

    buildType(Verify)
    buildType(E2E)
    buildType(Container)
    buildType(Publish)
    buildType(Deploy)
    buildTypesOrder = arrayListOf(Verify, E2E, Container, Publish, Deploy)
}

// Verify, E2E and Container are triggered on every branch except the default one; on the default
// branch, Deploy's trigger runs the whole chain: Verify, E2E and Container, then Publish, then Deploy.

object Verify : BuildType({
    name = "Verify"
    description = "Lint, unit, backup and integration tests, the production build and the type check"
    vcs { root(DslContext.settingsRoot) }
    steps {
        script {
            name = "bash scripts/ci/verify.sh"
            scriptContent = "bash scripts/ci/verify.sh"
            dockerImage = "node:22-bookworm"
            dockerImagePlatform = ScriptBuildStep.ImagePlatform.Linux
        }
    }
    triggers { vcs { branchFilter = "+:*\n-:<default>" } }
})

object E2E : BuildType({
    name = "E2E"
    description = "The browser tests"
    vcs { root(DslContext.settingsRoot) }
    steps {
        script {
            name = "bash scripts/ci/e2e.sh"
            scriptContent = "bash scripts/ci/e2e.sh"
            dockerImage = "node:22-bookworm"
            dockerImagePlatform = ScriptBuildStep.ImagePlatform.Linux
        }
    }
    triggers { vcs { branchFilter = "+:*\n-:<default>" } }
})

object Container : BuildType({
    name = "Container"
    description = "Builds the production image and runs the container smoke test"
    vcs { root(DslContext.settingsRoot) }
    // Unique to this build, as the builds of every branch may share one Docker daemon.
    params { param("ci.localImage", "bangla-adventures:ci-%teamcity.build.id%") }
    steps {
        script {
            name = "bash scripts/ci/container.sh"
            scriptContent = """bash scripts/ci/container.sh "%ci.localImage%""""
        }
        // Each tested image is kept under its commit; it is only marked latest and deployed once
        // every build of the chain has passed.
        script {
            name = "Publish this commit's image"
            conditions { equals("teamcity.build.branch.is_default", "true") }
            scriptContent = """
                if [ -n "${'$'}{REGISTRY_IMAGE:-}" ]; then
                  bash scripts/ci/publish.sh push "%ci.localImage%" "${'$'}REGISTRY_IMAGE:sha-%build.vcs.number%"
                else
                  echo "Not published: REGISTRY_IMAGE is not set."
                fi
            """.trimIndent()
        }
        script {
            name = "Remove the local image"
            executionMode = BuildStep.ExecutionMode.ALWAYS
            scriptContent = """docker image rm "%ci.localImage%" >/dev/null 2>&1 || true"""
        }
    }
    triggers { vcs { branchFilter = "+:*\n-:<default>" } }
    failureConditions { executionTimeoutMin = 35 }
    requirements {
        contains("teamcity.agent.jvm.os.name", "Linux")
        exists("docker.server.osType")
    }
})

// Builds of the default branch can finish in any order, and an old build run again would put its
// older commit back, so only the newest commit of the branch is marked latest and deployed.
object Publish : BuildType({
    name = "Publish"
    description = "Marks the tested image latest"
    vcs {
        root(DslContext.settingsRoot)
        branchFilter = "+:<default>"
    }
    steps {
        script {
            name = "Mark the tested image as latest"
            scriptContent = """
                if [ -z "${'$'}{REGISTRY_IMAGE:-}" ]; then
                  echo "Not published: REGISTRY_IMAGE is not set."
                  exit 0
                fi
                branch="%teamcity.build.branch%"
                if bash scripts/ci/newest.sh "${'$'}{branch#refs/heads/}"; then
                  bash scripts/ci/publish.sh promote "${'$'}REGISTRY_IMAGE:sha-%build.vcs.number%" "${'$'}REGISTRY_IMAGE:latest"
                fi
            """.trimIndent()
        }
    }
    dependencies {
        for (check in listOf(Verify, E2E, Container)) {
            snapshot(check) {
                onDependencyFailure = FailureAction.FAIL_TO_START
                onDependencyCancel = FailureAction.CANCEL
            }
        }
    }
    requirements {
        contains("teamcity.agent.jvm.os.name", "Linux")
        exists("docker.server.osType")
    }
})

object Deploy : BuildType({
    name = "Deploy"
    description = "Deploys the tested image to the server when DEPLOY_HOST is set"
    vcs {
        root(DslContext.settingsRoot)
        branchFilter = "+:<default>"
    }
    // One deployment at a time.
    maxRunningBuilds = 1
    steps {
        script {
            name = "Deploy to the server"
            scriptContent = """
                if [ -z "${'$'}{REGISTRY_IMAGE:-}" ] || [ -z "${'$'}{DEPLOY_HOST:-}" ]; then
                  echo "Not deployed: REGISTRY_IMAGE and DEPLOY_HOST are not both set."
                  exit 0
                fi
                branch="%teamcity.build.branch%"
                if bash scripts/ci/newest.sh "${'$'}{branch#refs/heads/}"; then
                  bash scripts/deploy.sh "${'$'}REGISTRY_IMAGE:sha-%build.vcs.number%"
                fi
            """.trimIndent()
        }
    }
    triggers {
        vcs {
            branchFilter = "+:<default>"
            watchChangesInDependencies = true
        }
    }
    dependencies {
        snapshot(Publish) {
            onDependencyFailure = FailureAction.FAIL_TO_START
            onDependencyCancel = FailureAction.CANCEL
        }
    }
    requirements { contains("teamcity.agent.jvm.os.name", "Linux") }
})
