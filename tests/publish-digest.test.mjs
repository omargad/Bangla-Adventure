import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/ci/publish.sh", import.meta.url));
const repository = "ghcr.io/example/bangla";
const tag = `sha-${"a".repeat(40)}`;
const target = `${repository}:${tag}`;
const digest = `sha256:${"b".repeat(64)}`;
const pinned = `${repository}@${digest}`;
const pushOutput = `The push refers to repository [${repository}]\nlayer: Pushed\n${tag}: digest: ${digest} size: 4231\n`;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "bangla-publish-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "bin"));
  mkdirSync(path.join(root, "temporary"));
  const output = path.join(root, "github-output");
  const log = path.join(root, "commands.jsonl");
  writeFileSync(path.join(root, "bin", "docker"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'tag' || args[0] === 'pull') process.exit(0);
if (args[0] === 'push') {
  const stream = process.env.MOCK_STDERR ? process.stderr : process.stdout;
  stream.write(process.env.MOCK_PUSH_OUTPUT);
  process.exit(Number(process.env.MOCK_PUSH_EXIT || 0));
}
if (args[0] === 'context' && args[1] === 'show') { process.stdout.write('fixture-context\\n'); process.exit(0); }
if (args[0] === 'buildx' && args[1] === 'imagetools') {
  if (process.env.MOCK_NO_BUILDX) process.exit(1);
  if (args.includes('--help')) process.stdout.write('--prefer-index\\n');
  process.exit(0);
}
process.stderr.write('Unexpected Docker invocation: ' + JSON.stringify(args));
process.exit(97);
`, { mode: 0o755 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PUBLISH_|REGISTRY_|DOCKER_|MOCK_|GITHUB_OUTPUT$)/.test(key)));
  Object.assign(env, {
    PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
    TMPDIR: path.join(root, "temporary"), MOCK_LOG: log, MOCK_PUSH_OUTPUT: pushOutput,
  });
  return {
    root, output,
    run(args = ["push", "tested-local:ci", target], changes = {}) {
      const result = spawnSync("bash", [script, ...args], {
        cwd: root, env: { ...env, PUBLISH_DIGEST_OUTPUT: output, ...changes }, encoding: "utf8", timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      return result;
    },
    calls: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [],
    outputs: () => existsSync(output) ? readFileSync(output, "utf8") : "",
    temporary: () => readdirSync(path.join(root, "temporary")),
  };
}

test("push publishes its verified immutable digest without resolving the mutable tag again", t => {
  for (const changes of [{}, { MOCK_STDERR: "1", MOCK_PUSH_OUTPUT: pushOutput.replaceAll("\n", "\r\n") }]) {
    const f = fixture(t);
    const result = f.run(undefined, changes);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(f.outputs(), `image=${repository}\ndigest=${digest}\nimage_ref=${pinned}\n`);
    assert.deepEqual(f.calls(), [["tag", "tested-local:ci", target], ["push", target]], "no post-push tag lookup can race with another workflow");
    assert.deepEqual(f.temporary(), []);
  }
});

test("failed or unverifiable pushes emit no deployable output", t => {
  for (const changes of [
    { MOCK_PUSH_EXIT: "1" },
    { MOCK_PUSH_OUTPUT: "" },
    { MOCK_PUSH_OUTPUT: pushOutput.replace(digest, "sha256:abc") },
    { MOCK_PUSH_OUTPUT: pushOutput.replace(digest, `sha256:${"G".repeat(64)}`) },
    { MOCK_PUSH_OUTPUT: pushOutput.replace(repository, "ghcr.io/attacker/other") },
    { MOCK_PUSH_OUTPUT: pushOutput.replace(`${tag}: digest:`, "another-tag: digest:") },
    { MOCK_PUSH_OUTPUT: pushOutput.replace(`The push refers to repository [${repository}]\n`, "") },
    { MOCK_PUSH_OUTPUT: `${pushOutput}${tag}: digest: ${digest} size: 4231\n` },
    { MOCK_PUSH_OUTPUT: `${pushOutput}The push refers to repository [${repository}]\n` },
  ]) {
    const f = fixture(t);
    const result = f.run(undefined, changes);
    assert.notEqual(result.status, 0, JSON.stringify(changes));
    assert.equal(f.outputs(), "", "failed validation must not hand an image to later jobs");
    assert.deepEqual(f.temporary(), []);
  }
});

test("digest output rejects ambiguous inputs before Docker is called", t => {
  for (const args of [
    ["push", "local", "bangla:tag"],
    ["push", "local", "team/bangla:tag"],
    ["push", "local", `${repository}@${digest}`],
    ["push", "local", repository],
    ["push", "local", `${repository}:tag\nimage_ref=evil`],
    ["push", "local", target, `${repository}:latest`],
    ["promote", pinned, `${repository}:latest`],
  ]) {
    const f = fixture(t);
    assert.notEqual(f.run(args).status, 0, args.join(" "));
    assert.deepEqual(f.calls(), []);
    assert.equal(f.outputs(), "");
  }
});

test("a registry port and independent output file preserve an exact image reference", t => {
  const f = fixture(t);
  const portRepository = "localhost:5000/team/bangla";
  const result = f.run(["push", "local", `${portRepository}:${tag}`], {
    MOCK_PUSH_OUTPUT: pushOutput.replace(repository, portRepository), GITHUB_OUTPUT: path.join(f.root, "unrelated-output"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.outputs(), new RegExp(`image_ref=localhost:5000/team/bangla@${digest}`));
  assert.equal(existsSync(path.join(f.root, "unrelated-output")), false, "only the explicitly configured output file is written");
});

test("generic CI push and promotion remain compatible without the output option", t => {
  const f = fixture(t);
  assert.equal(f.run(["push", "local", "team/bangla:one", "team/bangla:two"], { PUBLISH_DIGEST_OUTPUT: "", MOCK_PUSH_OUTPUT: "legacy push output\n" }).status, 0);
  assert.equal(f.run(["promote", "team/bangla:one", "team/bangla:latest"], { PUBLISH_DIGEST_OUTPUT: "" }).status, 0);
  assert.ok(f.calls().some(args => args[0] === "buildx" && args.includes("team/bangla:one")));
  assert.equal(f.outputs(), "");
});

test("promotion consumes the captured digest even if the commit tag was replaced", t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const imageRef = /^image_ref=(.*)$/m.exec(f.outputs())[1];
  assert.equal(f.run(["promote", imageRef, `${repository}:latest`], { PUBLISH_DIGEST_OUTPUT: "" }).status, 0);
  const promote = f.calls().find(args => args[0] === "buildx" && args[2] === "create" && !args.includes("--help"));
  assert.equal(promote.at(-1), pinned);
  assert.equal(promote.includes(target), false);
});

test("credential and push temporary files are removed on digest-validation failures", t => {
  const f = fixture(t);
  const result = f.run(undefined, { REGISTRY_USER: "fixture-user", REGISTRY_PASSWORD: "fictional-password-only", MOCK_PUSH_OUTPUT: "unverified\n" });
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.temporary(), []);
  assert.equal(f.outputs(), "");
  assert.ok(!`${result.stdout}${result.stderr}`.includes("fictional-password-only"));
});

test("GitHub passes the captured immutable reference to both promotion and deployment", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /image_ref: \$\{\{ steps\.push\.outputs\.image_ref \}\}/);
  assert.match(workflow, /PUBLISH_DIGEST_OUTPUT="\$GITHUB_OUTPUT" bash scripts\/ci\/publish\.sh push/);
  assert.equal((workflow.match(/IMAGE_REF: \$\{\{ needs\.container\.outputs\.image_ref \}\}/g) || []).length, 2);
  assert.match(workflow, /publish\.sh promote "\$\{IMAGE_REF:\?Missing verified image digest\}"/);
  assert.match(workflow, /deploy\.sh "\$\{IMAGE_REF:\?Missing verified image digest\}"/);
  assert.doesNotMatch(workflow, /(?:promote|deploy\.sh) "\$IMAGE:sha-/);
});
