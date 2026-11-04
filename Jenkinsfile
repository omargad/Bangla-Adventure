// The same pipeline as .github/workflows/ci.yml, for Jenkins: each stage runs one of the shared
// scripts in scripts/ci (docs/DEPLOYMENT.md "Automatic deployment").
// The agent needs Node 22, Python 3, Docker with the Compose plugin, bash, git and ssh.
// Publishing runs on main when REGISTRY_IMAGE is set (for example ghcr.io/OWNER/REPOSITORY), with
// the username/password credential "registry". Deploying also needs DEPLOY_HOST and DEPLOY_KNOWN_HOSTS
// (plus DEPLOY_USER, DEPLOY_PORT and DEPLOY_PATH when they differ from the defaults) as environment
// variables, and the SSH private key credential "deploy-ssh-key".
pipeline {
  agent any
  options {
    disableConcurrentBuilds()
    timeout(time: 90, unit: 'MINUTES')
  }
  environment {
    CI = 'true'
    LOCAL_IMAGE = "bangla-adventures:ci-${env.BUILD_NUMBER}"
  }
  stages {
    stage('Verify') {
      steps { sh 'bash scripts/ci/verify.sh' }
    }
    stage('Browser tests') {
      steps { sh 'bash scripts/ci/e2e.sh' }
    }
    stage('Container') {
      steps { sh 'bash scripts/ci/container.sh "$LOCAL_IMAGE"' }
    }
    stage('Publish') {
      when { allOf { branch 'main'; expression { return env.REGISTRY_IMAGE?.trim() as boolean } } }
      steps {
        withCredentials([usernamePassword(credentialsId: 'registry', usernameVariable: 'REGISTRY_USER', passwordVariable: 'REGISTRY_PASSWORD')]) {
          sh 'bash scripts/ci/publish.sh push "$LOCAL_IMAGE" "$REGISTRY_IMAGE:sha-$GIT_COMMIT" "$REGISTRY_IMAGE:latest"'
        }
      }
    }
    stage('Deploy') {
      when { allOf { branch 'main'; expression { return (env.REGISTRY_IMAGE?.trim() && env.DEPLOY_HOST?.trim()) as boolean } } }
      steps {
        withCredentials([
          sshUserPrivateKey(credentialsId: 'deploy-ssh-key', keyFileVariable: 'DEPLOY_SSH_KEY_FILE'),
          usernamePassword(credentialsId: 'registry', usernameVariable: 'REGISTRY_USER', passwordVariable: 'REGISTRY_PASSWORD')
        ]) {
          sh 'bash scripts/deploy.sh "$REGISTRY_IMAGE:sha-$GIT_COMMIT"'
        }
      }
    }
  }
  post {
    always { sh 'docker image rm "$LOCAL_IMAGE" >/dev/null 2>&1 || true' }
  }
}
