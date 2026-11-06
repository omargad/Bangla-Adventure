"""Run the real controller with fake transports; never contacts a VPS or registry."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
DIGEST = "sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13"
IMAGE = "ghcr.io/omargad/bangla-adventure@" + DIGEST
# The same digest copied to a new owner's package after a repository transfer.
TRANSFERRED_IMAGE = "ghcr.io/client-org/bangla-adventure@" + DIGEST
REVISION = "a709cb3d2bc9fb0a271e6814bc96d1f16444c94f"


class PrivateStagingControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bangla-private-controller-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        (self.root / "deploy").mkdir()
        shutil.copy(ROOT / "scripts/private-staging.sh", self.root / "scripts/private-staging.sh")
        (self.root / "deploy/private-staging.compose.yaml").write_text("name: isolated-fixture\n")
        for name in ["proxy.mjs", "remote.sh", "verify.mjs", "drill.sh", "qa.sh"]:
            (self.root / f"scripts/private-staging-{name}").write_text("isolated fixture payload\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        transport = self.bin / "transport"
        transport.write_text(r'''#!/usr/bin/env python3
import json,os,shlex,subprocess,sys,time
from pathlib import Path
tool=Path(sys.argv[0]).name
args=sys.argv[1:]
log=Path(os.environ["FIXTURE_LOG"])
def record(kind,**extra):
 with log.open("a") as f: f.write(json.dumps({"kind":kind,"args":args,**extra})+"\n")
if tool=="ssh-keygen":
 if "-y" in args: print("ssh-ed25519 RklYVFVSRQ== fixture")
 elif "-F" in args:
  names=Path(args[args.index("-f")+1]).read_text().split()[0].split(",")
  sys.exit(0 if args[args.index("-F")+1] in names else 1)
 elif "-l" in args:
  public=Path(args[args.index("-f")+1]).name=="public_key"
  pin="SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ" if public else "SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8"
  if os.environ.get("FIXTURE_BAD_PIN"): pin="SHA256:wrong"
  print("256",pin,"fixture (ED25519)")
elif tool=="curl":
 record("http")
 url=args[-1]
 print("403" if "sign-up" in url else os.environ.get("FIXTURE_PROTECTED_STATUS","401") if "profiles" in url else "200",end="")
elif tool=="node":
 record("qa_browser")
 hook=os.environ["PRIVATE_QA_CONTROLLER"];qid=os.environ["PRIVATE_QA_ID"]
 for action in ["verify","approve-fixtures","cleanup"]:
  p=subprocess.run([hook,action,qid],capture_output=True,text=True)
  if p.returncode: sys.exit(1)
 if os.environ.get("FIXTURE_BROWSER_FAIL"):
  step="REGISTRY_TOKEN_MUST_NOT_LEAK" if os.environ.get("FIXTURE_BROWSER_UNKNOWN_STEP") else "parent-browser-login"
  report={"kind":"disposable-qa-browser-auth","passed":False,"failedStep":step,"cleanupVerified":True,"secret":"REGISTRY_TOKEN_MUST_NOT_LEAK"}
  if os.environ.get("FIXTURE_BROWSER_SUBSTEP"):
   report.update({"failedOperation":"submit-and-response","errorCode":"sign-in-response-not-successful","loginResponseStatus":403})
  if os.environ.get("FIXTURE_BROWSER_UNSAFE_SUBSTEP"): report["failedOperation"]="REGISTRY_TOKEN_MUST_NOT_LEAK"
  if os.environ.get("FIXTURE_BROWSER_INVALID_STATUS"): report["loginResponseStatus"]=600
  print(json.dumps(report))
  sys.exit(1)
 out=Path(os.environ["PRIVATE_QA_ARTIFACTS"])/f"qa-browser-{qid}"
 out.mkdir();(out/"result.json").write_text('{"fixtureBrowser":true}')
elif tool=="ssh":
 command=args[-1]
 if "-L" in args:
  record("tunnel")
  while True: time.sleep(1)
 data=sys.stdin.read()
 if command=="bash -s":
  record("inventory")
  if os.environ.get("FIXTURE_INVENTORY_REFUSE"):
   print("REGISTRY_TOKEN_MUST_NOT_LEAK",file=sys.stderr); sys.exit(7)
  print(json.dumps({"scope":"private-staging","inventory":"passed","uid":1002,"rootless":True,"hostPortsPublished":0,"productionConflict":False,"productionFilesPresent":2,"occupiedReservedTcpPorts":2,"unrelatedContainers":1,"unrelatedVolumes":1,"unrelatedNetworks":3,"availableDiskKiB":9000000,"availableMemoryKiB":2000000}))
 elif "mktemp -d" in command:
  record("incoming"); print("/opt/bangla-adventures/.private-stage-payload.Fixture123ABC")
 elif "tar --extract" in command: record("upload",hasToken="REGISTRY_TOKEN_MUST_NOT_LEAK" in data)
 elif "private-staging-qa.sh" in command:
  action,qid=command.split()[-2:];record("qa_"+action)
  if action=="prepare" and os.environ.get("FIXTURE_QA_REMOTE_FAIL"):
   print("REGISTRY_TOKEN_MUST_NOT_LEAK",file=sys.stderr)
   print("PRIVATE_QA_DIAGNOSTIC:prepare:untrusted-REGISTRY_TOKEN_MUST_NOT_LEAK",file=sys.stderr)
   print("PRIVATE_QA_DIAGNOSTIC:prepare:prepare-ready",file=sys.stderr)
   sys.exit(7)
  clean={"users":0,"pendingTopics":15,"pendingLessons":18}
  if action in ["prepare","verify"]:
   digest=os.environ["FIXTURE_IMAGE"].split("@")[1]
   if os.environ.get("FIXTURE_QA_BAD_IMAGE"): digest="sha256:"+"0"*64
   print(json.dumps({"verified":True,"kind":"bangla-private-qa","qaId":qid,"imageDigest":digest,"baseURL":"http://127.0.0.1:3001","isolated":True,"actualStage":clean,"qa":clean,"socket":f"/opt/bangla-adventures/private-staging/qa/{qid}/runtime/http.sock","prepared":action=="prepare"}))
  elif action=="approve-fixtures": print(json.dumps({"verified":True,"qaId":qid,"approvedAdults":1,"approvedStudents":1,"noContentApprovals":True}))
  else: print(json.dumps({"verified":True,"qaId":qid,"removed":True,"actualStage":clean}))
 elif "private-staging-remote.sh" in command:
  record("prepare",tokenViaStdin=data.strip()=="REGISTRY_TOKEN_MUST_NOT_LEAK",image=shlex.split(command)[2])
  def verifier(restarted):
   return {"verified":True,"stateDigest":"a"*64,"counts":{"pendingTopics":15,"pendingLessons":18,"shippedStates":33,"users":0,"approvals":0,"baselines":0,"businessRows":0,"mediaFiles":0},"checks":{"integrity":True,"foreignKeys":True,"unpublished":True,"cleanIdentities":True,"expectedStateMatched":True if restarted else None,"databaseWriteRolledBack":None if restarted else True,"mediaWriteRemoved":None if restarted else True}}
  result={"scope":"private-staging","status":"healthy","image":os.environ["FIXTURE_IMAGE"],"revision":"a709cb3d2bc9fb0a271e6814bc96d1f16444c94f","project":"bangla-adventures-staging","origin":"http://127.0.0.1:3001","socket":"/opt/bangla-adventures/private-staging/runtime/http.sock","publishedPorts":0,
   "cleanVerifier":verifier(False),"restartVerifier":verifier(True),
   "restoreDrill":{"verified":True,"checks":{k:True for k in ["sourceUnchanged","cleanSnapshotVerified","probeSnapshotVerified","probeDatabaseRestored","probeMediaRestored","cleanOriginalRestored","integrity","foreignKeys","archivesUnchanged"]},"counts":{"pendingTopics":15,"pendingLessons":18,"sourceUsers":0,"probeRecords":3,"probeMediaFiles":2},"artifactsRetained":False,"scope":"disposable clone only"},
   "containerReplacement":{"appReplaced":True,"beforeAppId":"b"*64,"afterAppId":"c"*64,"stateDigestUnchanged":True}}
  if os.environ.get("FIXTURE_UNKNOWN_PROOF_KEY"): result["cleanVerifier"]["unexpected"]="REGISTRY_TOKEN_MUST_NOT_LEAK"
  print(json.dumps(result))
 else: record("cleanup")
''')
        transport.chmod(0o700)
        for name in ["ssh", "ssh-keygen", "curl", "node"]:
            (self.bin / name).symlink_to(transport)
        self.env = {
            **{k: v for k, v in os.environ.items() if k not in {"PRODUCTION_REPOSITORY_ID", "STAGING_IMAGE_REPOSITORY"}}, "PATH": f"{self.bin}:{os.environ['PATH']}",
            "DEPLOY_ENABLED": "false", "REPOSITORY_GATE_CONFIRMED": "disabled",
            "GITHUB_REPOSITORY_ID": "1436643374", "GITHUB_REF": "refs/heads/main",
            "DEPLOY_HOST": "192.0.2.10", "DEPLOY_USER": "example-user",
            "DEPLOY_SSH_KEY": "PRIVATE_KEY_MUST_NOT_LEAK",
            "DEPLOY_KNOWN_HOSTS": "192.0.2.10 ssh-ed25519 RklYVFVSRQ== fixture public key",
            "REGISTRY_USER": "fixture", "REGISTRY_PASSWORD": "REGISTRY_TOKEN_MUST_NOT_LEAK",
            "PRIVATE_STAGING_EVIDENCE_DIR": str(self.root / "evidence"),
            "FIXTURE_LOG": str(self.root / "calls.jsonl"), "FIXTURE_IMAGE": IMAGE,
        }

    def run_controller(self, **overrides):
        env = {key: value for key, value in {**self.env, **overrides}.items() if value is not None}
        result = subprocess.run(["bash", str(self.root / "scripts/private-staging.sh")], env=env, text=True, capture_output=True, timeout=15)
        self.assertNotIn("PRIVATE_KEY_MUST_NOT_LEAK", result.stdout + result.stderr)
        self.assertNotIn("REGISTRY_TOKEN_MUST_NOT_LEAK", result.stdout + result.stderr)
        return result

    def calls(self):
        log = self.root / "calls.jsonl"
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def test_success_proves_real_tunnel_contract_and_exports_only_public_evidence(self):
        result = self.run_controller()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        kinds = [call["kind"] for call in calls]
        self.assertLess(kinds.index("inventory"), kinds.index("incoming"))
        self.assertLess(kinds.index("incoming"), kinds.index("upload"))
        self.assertTrue(next(call for call in calls if call["kind"] == "prepare")["tokenViaStdin"])
        self.assertFalse(next(call for call in calls if call["kind"] == "upload")["hasToken"])
        tunnel = next(call for call in calls if call["kind"] == "tunnel")["args"]
        self.assertIn("127.0.0.1:3001:/opt/bangla-adventures/private-staging/runtime/http.sock", tunnel)
        self.assertIn("ExitOnForwardFailure=yes", tunnel)
        self.assertIn("ClearAllForwardings=no", tunnel)
        self.assertIn("StrictHostKeyChecking=yes", tunnel)
        remote = [call for call in calls if call["kind"] not in {"http", "qa_browser"}]
        self.assertIn("qa_prepare", [call["kind"] for call in remote])
        for call in remote:
            self.assertIn("example-user@192.0.2.10", call["args"], call["kind"])
        evidence = self.root / "evidence"
        self.assertEqual(set(path.name for path in evidence.iterdir()), {"inventory.json", "staging-result.json", "staging_known_hosts", "tunnel-probes.json", "qa-cleanup.json", "qa-browser", "attempt-status.json"})
        self.assertEqual(json.loads((evidence/"attempt-status.json").read_text())["overall"],"passed")
        self.assertEqual(json.loads((evidence / "tunnel-probes.json").read_text())["stageAccountsCreated"], 0)
        self.assertTrue(json.loads((evidence / "tunnel-probes.json").read_text())["qaBrowserLoginVerified"])
        proof=json.loads((evidence / "staging-result.json").read_text())
        self.assertEqual(proof["cleanVerifier"]["stateDigest"], proof["restartVerifier"]["stateDigest"])
        self.assertNotEqual(proof["containerReplacement"]["beforeAppId"],proof["containerReplacement"]["afterAppId"])
        all_evidence = "".join(path.read_text() for path in evidence.rglob("*") if path.is_file())
        self.assertNotIn("PRIVATE_KEY_MUST_NOT_LEAK", all_evidence)
        self.assertNotIn("REGISTRY_TOKEN_MUST_NOT_LEAK", all_evidence)
        self.assertEqual((evidence / "staging_known_hosts").read_text(), "bangla-adventures-vps ssh-ed25519 RklYVFVSRQ==\n")
        self.assertNotIn("192.0.2.10", all_evidence)

    def test_missing_or_invalid_server_variables_prevent_all_remote_contact(self):
        for overrides in [{"DEPLOY_HOST": ""}, {"DEPLOY_USER": ""}, {"DEPLOY_HOST": "192.0.2.10;id"}, {"DEPLOY_USER": "Example User"}]:
            log = self.root / "calls.jsonl"
            if log.exists(): log.unlink()
            result = self.run_controller(**overrides)
            self.assertNotEqual(result.returncode, 0)
            name = "HOST" if "DEPLOY_HOST" in overrides else "USER"
            self.assertIn(f"The DEPLOY_{name} secret is missing or invalid (set it as a repository secret or a production environment secret, named exactly DEPLOY_{name}).", result.stderr)
            self.assertNotIn("repository secret DEPLOY_", result.stderr)
            # Neither the fixture's address nor an overriding value is ever printed.
            for address in {self.env["DEPLOY_HOST"], overrides.get("DEPLOY_HOST")} - {None, ""}:
                self.assertNotIn(address, result.stderr)
            self.assertEqual(self.calls(), [])
            self.assertFalse((self.root / "evidence").exists())

    def test_a_missing_host_is_named_before_the_known_hosts_line_it_gates(self):
        # The workflow passes DEPLOY_KNOWN_HOSTS only with the DEPLOY_HOST secret, which masks the address in it.
        result = self.run_controller(DEPLOY_HOST="", DEPLOY_KNOWN_HOSTS="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("The DEPLOY_HOST secret is missing or invalid", result.stderr)
        self.assertNotIn("credentials are missing", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_pinned_host_key_must_name_the_configured_server(self):
        result = self.run_controller(DEPLOY_HOST="192.0.2.11")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not cover the configured VPS address", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_inventory_refusal_precedes_every_remote_write(self):
        result = self.run_controller(FIXTURE_INVENTORY_REFUSE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([call["kind"] for call in self.calls()], ["inventory"])
        self.assertFalse((self.root / "evidence").exists())

    def test_repository_is_recognised_by_its_id_whatever_its_owner_name(self):
        # A transfer keeps the numeric ID, so the gate does not depend on the owner name.
        self.assertEqual(self.run_controller(GITHUB_REPOSITORY="client-org/Bangla-Adventure").returncode, 0)
        for overrides in [{"GITHUB_REPOSITORY_ID": None}, {"GITHUB_REPOSITORY_ID": "1"}, {"GITHUB_REF": "refs/heads/other"}]:
            (self.root / "calls.jsonl").unlink(missing_ok=True)
            result = self.run_controller(**overrides)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Private staging runs only from the audited repository main branch.", result.stderr)
            self.assertEqual(self.calls(), [])
        # Only a re-created repository names its own ID, through the repository variable.
        (self.root / "calls.jsonl").unlink(missing_ok=True)
        shutil.rmtree(self.root / "evidence", ignore_errors=True)
        self.assertEqual(self.run_controller(GITHUB_REPOSITORY_ID="1", PRODUCTION_REPOSITORY_ID="1").returncode, 0)

    def test_staging_image_defaults_to_the_original_package(self):
        result = self.run_controller()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(next(call for call in self.calls() if call["kind"] == "prepare")["image"], IMAGE)

    def test_staging_image_repository_changes_only_the_registry_path(self):
        result = self.run_controller(STAGING_IMAGE_REPOSITORY="ghcr.io/client-org/bangla-adventure", FIXTURE_IMAGE=TRANSFERRED_IMAGE)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(next(call for call in self.calls() if call["kind"] == "prepare")["image"], TRANSFERRED_IMAGE)
        self.assertEqual(json.loads((self.root / "evidence/staging-result.json").read_text())["image"], TRANSFERRED_IMAGE)

    def test_invalid_staging_image_repository_prevents_all_remote_contact(self):
        for value in ["docker.io/client-org/bangla-adventure", "ghcr.io/client-org/other", "ghcr.io/Client-Org/bangla-adventure", "ghcr.io/client-org/bangla-adventure@sha256:" + "0" * 64, "ghcr.io/client-org/bangla-adventure:latest", "ghcr.io/client-/bangla-adventure"]:
            (self.root / "calls.jsonl").unlink(missing_ok=True)
            result = self.run_controller(STAGING_IMAGE_REPOSITORY=value)
            self.assertNotEqual(result.returncode, 0, value)
            self.assertIn("STAGING_IMAGE_REPOSITORY must be ghcr.io/<lowercase owner>/bangla-adventure.", result.stderr)
            self.assertEqual(self.calls(), [])

    def test_wrong_key_pin_prevents_all_remote_contact(self):
        result = self.run_controller(FIXTURE_BAD_PIN="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_enabled_production_gate_prevents_all_remote_contact(self):
        result = self.run_controller(DEPLOY_ENABLED="true")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_protected_endpoint_failure_never_publishes_success_evidence(self):
        result = self.run_controller(FIXTURE_PROTECTED_STATUS="200")
        self.assertNotEqual(result.returncode, 0)
        evidence=self.root/"evidence"
        self.assertTrue((evidence/"staging-result.json").exists())
        self.assertEqual(json.loads((evidence/"attempt-status.json").read_text())["overall"],"failed")
        self.assertFalse((evidence/"qa-browser").exists())

    def test_unattested_qa_clone_never_reaches_browser_and_is_cleaned(self):
        result = self.run_controller(FIXTURE_QA_BAD_IMAGE="1")
        self.assertNotEqual(result.returncode, 0)
        kinds = [call["kind"] for call in self.calls()]
        self.assertNotIn("qa_browser", kinds)
        self.assertIn("qa_cleanup", kinds)
        evidence=self.root/"evidence"
        status=json.loads((evidence/"attempt-status.json").read_text())
        self.assertEqual(status,{"overall":"failed","phase":"qa-prepare","qaBrowserLoginVerified":False,"qaCleanupVerified":True})
        self.assertTrue((evidence/"staging-result.json").exists())
        self.assertFalse(json.loads((evidence/"tunnel-probes.json").read_text())["qaBrowserLoginVerified"])
        self.assertFalse((evidence/"qa-browser").exists())

    def test_remote_qa_failure_retains_only_allowlisted_diagnostics_and_prior_stage_proof(self):
        result=self.run_controller(FIXTURE_QA_REMOTE_FAIL="1")
        self.assertNotEqual(result.returncode,0)
        self.assertIn("action=prepare code=remote-exit helper=prepare-ready",result.stderr)
        evidence=self.root/"evidence"
        diagnostics=json.loads((evidence/"qa-diagnostics.json").read_text())
        self.assertEqual(diagnostics,[{"action":"prepare","code":"remote-exit","remoteExitCode":7,"helperCode":"prepare-ready"}])
        self.assertEqual(json.loads((evidence/"attempt-status.json").read_text())["overall"],"failed")
        self.assertFalse((evidence/"qa-browser").exists())
        for path in evidence.rglob("*"):
            if path.is_file(): self.assertNotIn("REGISTRY_TOKEN_MUST_NOT_LEAK",path.read_text())

    def test_unknown_aggregate_proof_keys_are_refused_without_export(self):
        result = self.run_controller(FIXTURE_UNKNOWN_PROOF_KEY="1")
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn("tunnel",[call["kind"] for call in self.calls()])
        self.assertFalse((self.root / "evidence").exists())

    def test_browser_failure_exports_only_fixed_report_fields(self):
        result=self.run_controller(FIXTURE_BROWSER_FAIL="1")
        self.assertNotEqual(result.returncode,0)
        self.assertIn("failedStep=parent-browser-login; cleanupVerified=true",result.stderr)
        evidence=self.root/"evidence"
        report=json.loads((evidence/"qa-browser-failure.json").read_text())
        self.assertEqual(report,{"passed":False,"failedStep":"parent-browser-login","cleanupVerified":True})
        self.assertFalse((evidence/"qa-browser").exists())
        self.assertEqual(json.loads((evidence/"attempt-status.json").read_text())["overall"],"failed")

    def test_unknown_browser_failure_step_is_never_exported(self):
        result=self.run_controller(FIXTURE_BROWSER_FAIL="1",FIXTURE_BROWSER_UNKNOWN_STEP="1")
        self.assertNotEqual(result.returncode,0)
        evidence=self.root/"evidence"
        self.assertFalse((evidence/"qa-browser-failure.json").exists())
        self.assertFalse((evidence/"qa-browser").exists())
        for path in evidence.rglob("*"):
            if path.is_file(): self.assertNotIn("REGISTRY_TOKEN_MUST_NOT_LEAK",path.read_text())

    def test_browser_static_substep_and_response_status_are_exported_without_other_fields(self):
        result=self.run_controller(FIXTURE_BROWSER_FAIL="1",FIXTURE_BROWSER_SUBSTEP="1")
        self.assertNotEqual(result.returncode,0)
        report=json.loads((self.root/"evidence/qa-browser-failure.json").read_text())
        self.assertEqual(report,{"passed":False,"failedStep":"parent-browser-login","cleanupVerified":True,"failedOperation":"submit-and-response","errorCode":"sign-in-response-not-successful","loginResponseStatus":403})
        self.assertIn("failedOperation=submit-and-response; errorCode=sign-in-response-not-successful; loginResponseStatus=403",result.stderr)

    def test_unknown_browser_substep_and_out_of_range_status_are_refused(self):
        for flag in ("FIXTURE_BROWSER_UNSAFE_SUBSTEP","FIXTURE_BROWSER_INVALID_STATUS"):
            with self.subTest(flag=flag):
                result=self.run_controller(FIXTURE_BROWSER_FAIL="1",FIXTURE_BROWSER_SUBSTEP="1",**{flag:"1"})
                self.assertNotEqual(result.returncode,0)
                self.assertFalse((self.root/"evidence/qa-browser-failure.json").exists())
                for path in (self.root/"evidence").rglob("*"):
                    if path.is_file(): self.assertNotIn("REGISTRY_TOKEN_MUST_NOT_LEAK",path.read_text())


if __name__ == "__main__":
    unittest.main()
