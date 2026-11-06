"""Offline acceptance orchestration and managed-helper transaction tests; no SSH/Docker."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'ghcr.io/omargad/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13'
REVISION = 'a709cb3d2bc9fb0a271e6814bc96d1f16444c94f'
SOURCE = (ROOT / 'scripts/private-staging-acceptance.sh').read_text()
UNITS = ['ba-private-stage-backup.service', 'ba-private-stage-backup.timer', 'ba-private-stage-monitor.service', 'ba-private-stage-monitor.timer']

TRANSPORT = r'''#!/usr/bin/env python3
import json,os,struct,subprocess,sys,time
from pathlib import Path
args=sys.argv[1:];tool=Path(sys.argv[0]).name;log=Path(os.environ['FIXTURE_LOG'])
def record(kind,**extra):
 with log.open('a')as f:f.write(json.dumps(dict(kind=kind,args=args,**extra))+'\n')
def emit(value):print(json.dumps(value))
clean=dict(users=0,pendingTopics=15,pendingLessons=18)
base=dict(scope='private-staging-operations',verified=True,status='passed')
now=time.time()
monitor=dict(**{**base,'status':'healthy'},action='monitor',checkedAtEpoch=now,invocationId='c'*32,checks={k:True for k in ['applicationHealth','containersHealthy','noPublishedPorts','diskSpace','backupVerified','backupFresh','lastBackupRunPassed']},codes=[],measures=dict(freeDiskBytes=9000000000,backupAgeSeconds=2.125))
exercise=dict(**base,action='exercise',checkedAtEpoch=now,invocationId=None,checks={k:True for k in ['writersQuiesced','applicationResumedHealthy','expectedBackupFailureObserved','logicalDataUnchanged','realBackupArchivesUnchanged','disposableVolumeRemoved']},codes=[])
if tool=='ssh-keygen':
 if '-y'in args:print('ssh-ed25519 RklYVFVSRQ== fixture')
 elif '-F'in args:
  names=Path(args[args.index('-f')+1]).read_text().split()[0].split(',')
  sys.exit(0 if args[args.index('-F')+1]in names else 1)
 elif '-l'in args:
  public=Path(args[args.index('-f')+1]).name=='public_key'
  pin='SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ'if public else'SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8'
  print('256',('SHA256:wrong'if os.environ.get('FIXTURE_BAD_PIN')else pin),'fixture(ED25519)')
 sys.exit(0)
if tool=='curl':record('http');print('200',end='');sys.exit(0)
if tool=='node':
 record('browser');hook=os.environ['PRIVATE_QA_CONTROLLER'];qid=os.environ['PRIVATE_QA_ID']
 for action in ['verify','bootstrap-admin','cleanup']:
  p=subprocess.run([hook,action,qid],text=True,capture_output=True)
  if p.returncode:sys.exit(1)
 if os.environ.get('FIXTURE_BROWSER_FAIL'):
  emit(dict(kind='disposable-qa-role-acceptance',passed=False,failedStep='student-work',failedOperation='api',errorCode='acceptance-api-status',loginResponseStatus=403,cleanupVerified=True,secret='SECRET_MUST_NOT_LEAK'));sys.exit(1)
 output=Path(os.environ['PRIVATE_QA_ARTIFACTS'])/f'role-acceptance-{qid}';output.mkdir()
 names=['admin-pending-users.png','admin-class-publication.png','teacher-students.png','teacher-results.png','teacher-attendance.png','teacher-announcements.png','teacher-lessons.png','student-learning.png','student-results.png','student-topic.png','student-lesson.png','parent-learning.png']
 for name in names:(output/name).write_bytes(b'\x89PNG\r\n\x1a\n'+struct.pack('>I',13)+b'IHDR'+struct.pack('>II',1280,900)+b'\0'*30)
 scenario=dict(fixtureAdults=3,fixtureStudents=4,enrolledStudents=3,pendingAccounts=1,classes=1,publishedActivities=1,pendingActivities=1,submissions=2,attendanceSessions=2,attendanceMarks=6,announcements=3,linkedChildren=1,accountApprovalFlow=True,teacherCannotPublish=True,activityHiddenUntilApproved=True,topicEditHiddenUntilApproved=True,parentOnlyLinkedChild=True,audienceFiltering=True,resultsMatchAcrossRoles=True,bundledAudioAvailable=True,lessonAvailable=True,unexpectedBrowserErrors=0,fullyLoadedDashboards=True)
 roles=[dict(role=r,realFormLogin=True,secureHttpOnlyCookie=True,cookieSurvivedReload=True,serverSessionAuthenticated=True,fullyLoadedScreens=True)for r in ['admin','teacher','student','parent']]
 result=dict(kind='disposable-qa-role-acceptance',passed=True,origin='http://127.0.0.1:3001',revision=os.environ['FIXTURE_REVISION'],imageDigest=os.environ['FIXTURE_IMAGE'].split('@')[1],roles=roles,scenario=scenario,cleanupVerified=True,actualStageAfterCleanup=clean,screenshotCount=12,loginResponseStatus=200)
 (output/'result.json').write_text(json.dumps(result))
 if os.environ.get('FIXTURE_EXTRA_BROWSER_FILE'):(output/'raw.log').write_text('SECRET_MUST_NOT_LEAK')
 sys.exit(0)
if tool!='ssh':sys.exit(93)
command=args[-1]
if '-L'in args:
 record('tunnel')
 while True:time.sleep(1)
data=sys.stdin.read()
if command=='bash -s':
 record('inventory')
 if os.environ.get('FIXTURE_INVENTORY_FAIL'):print('SECRET_MUST_NOT_LEAK',file=sys.stderr);sys.exit(7)
 count=sum(json.loads(x)['kind']=='inventory'for x in log.read_text().splitlines())
 digest='b'*64 if os.environ.get('FIXTURE_STATE_CHANGED')and count>=4 else'a'*64
 emit(dict(scope='private-staging-acceptance',verified=True,image=os.environ['FIXTURE_IMAGE'],revision=os.environ['FIXTURE_REVISION'],rootless=True,publishedPorts=0,stageHealthy=True,stage={**clean,'stateDigest':digest,'appId':'d'*64}))
elif 'mktemp -d'in command:record('incoming');print('/opt/bangla-adventures/.private-acceptance-payload.Fixture12ABC')
elif 'tar --extract'in command:record('upload',hasSecret='SECRET_MUST_NOT_LEAK'in data)
elif command.startswith('bash -s --'):
 record('install');emit(dict(kind='private-staging-acceptance-install',verified=True,qaHelperUpdated=True,manifestPreserved=True,applicationRecreated=False))
elif 'private-staging-ops-install.sh'in command:
 record('ops_install')
 if os.environ.get('FIXTURE_OPS_FAIL_CODE'):
  emit(dict(scope='private-staging-operations',action='install',verified=False,status='failed',codes=[os.environ['FIXTURE_OPS_FAIL_CODE']]));print('SECRET_MUST_NOT_LEAK',file=sys.stderr);sys.exit(7)
 value=dict(**base,action='install',timers=dict(backup=True,monitor=True),initialBackupVerified=True,initialMonitorVerified=True,localOnly=True,retentionCount=14,backupSchedule='03:30 UTC daily',monitorIntervalSeconds=300,initialRuns=dict(backup=dict(invocationId='b'*32,checkedAtEpoch=now,archiveSha256='e'*64),monitor=dict(invocationId='c'*32,checkedAtEpoch=now,backupAgeSeconds=2.125)))
 if os.environ.get('FIXTURE_OPS_BAD_RECEIPT'):value['initialRuns']['backup']['invocationId']='not-a-systemd-run'
 emit(value)
elif 'private-staging-ops.sh exercise'in command:record('ops_exercise');emit(exercise)
elif 'private-staging-ops.sh status'in command:record('ops_status');emit(dict(**base,action='status',reports=dict(backup={},monitor=monitor,exercise=exercise)))
elif 'private-staging-rollback.sh'in command:
 record('rollback')
 if os.environ.get('FIXTURE_ROLLBACK_EXIT'):
  print('SECRET_MUST_NOT_LEAK',file=sys.stderr);print('PRIVATE_ROLLBACK_DIAGNOSTIC:SECRET_MUST_NOT_LEAK',file=sys.stderr);print('PRIVATE_ROLLBACK_DIAGNOSTIC:engine',file=sys.stderr);print('PRIVATE_ROLLBACK_DIAGNOSTIC:cleanup',file=sys.stderr);sys.exit(7)
 value=dict(kind='private-staging-rollback',verified=True,runId=command.split()[-1],checks={k:True for k in ['candidateUnhealthy','automaticRollback','previousImageRestored','configurationRestored','environmentRestored','scriptRestored','dataUnchanged','healthRestored','sourceStageUnchanged','cleanupComplete']},sourceStage=clean,publishedPorts=0,previousImage=os.environ['FIXTURE_IMAGE'],candidateImageId='sha256:'+'f'*64,beforeStateDigest='a'*64,afterStateDigest='a'*64,candidateHealthStatus=503)
 if os.environ.get('FIXTURE_BAD_ROLLBACK'):value['checks']['automaticRollback']=False
 emit(value)
elif 'private-staging-qa.sh'in command:
 action,qid=command.split()[-2:];record('qa_'+action)
 if action in {'prepare','verify'}:
  emit(dict(verified=True,kind='bangla-private-qa',qaId=qid,imageDigest=('sha256:'+'0'*64 if os.environ.get('FIXTURE_BAD_QA')else os.environ['FIXTURE_IMAGE'].split('@')[1]),baseURL='http://127.0.0.1:3001',isolated=True,socket=f'/opt/bangla-adventures/private-staging/qa/{qid}/runtime/http.sock',actualStage=clean,qa=clean,prepared=action=='prepare'))
 elif action=='bootstrap-admin':emit(dict(verified=True,qaId=qid,bootstrapAdmin=True,approvedAdults=1,approvedStudents=0,noContentApprovals=True))
 else:emit(dict(verified=True,qaId=qid,removed=True,actualStage=clean))
else:record('payload_cleanup')
'''


class AcceptanceControllerTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory(prefix='bangla-acceptance-controller-');self.addCleanup(tmp.cleanup);self.root=Path(tmp.name)
        for folder in ['scripts','deploy/private-staging-ops','bin']:(self.root/folder).mkdir(parents=True)
        (self.root/'scripts/private-staging-acceptance.sh').write_text(SOURCE)
        for name in ['private-staging-qa.sh','private-staging-rollback.sh','deploy-remote.sh','private-staging-verify.mjs','private-staging-ops.sh','private-staging-ops.py','private-staging-ops-check.py','private-staging-ops-install.sh','private-staging-ops-install.py']:(self.root/'scripts'/name).write_text('reviewed fixture payload\n')
        for name in UNITS:(self.root/'deploy/private-staging-ops'/name).write_text('fixture unit\n')
        transport=self.root/'bin/transport';transport.write_text(TRANSPORT);transport.chmod(0o700)
        for name in ['ssh','ssh-keygen','curl','node']:(self.root/'bin'/name).symlink_to(transport)
        self.env={**os.environ,'PATH':str(self.root/'bin')+':'+os.environ['PATH'],'DEPLOY_ENABLED':'false','REPOSITORY_GATE_CONFIRMED':'disabled','GITHUB_REPOSITORY':'omargad/Bangla-Adventure','GITHUB_REF':'refs/heads/main','DEPLOY_HOST':'192.0.2.10','DEPLOY_USER':'example-user','DEPLOY_SSH_KEY':'SECRET_MUST_NOT_LEAK','DEPLOY_KNOWN_HOSTS':'192.0.2.10 ssh-ed25519 RklYVFVSRQ== public fixture comment','PRIVATE_ACCEPTANCE_EVIDENCE_DIR':str(self.root/'evidence'),'FIXTURE_LOG':str(self.root/'calls.jsonl'),'FIXTURE_IMAGE':IMAGE,'FIXTURE_REVISION':REVISION}

    def run_controller(self,**changes):
        result=subprocess.run(['bash',str(self.root/'scripts/private-staging-acceptance.sh')],env={**self.env,**changes},capture_output=True,text=True,timeout=20)
        self.assertNotIn('SECRET_MUST_NOT_LEAK',result.stdout+result.stderr)
        evidence=self.root/'evidence'
        if evidence.exists():
            for p in evidence.rglob('*'):
                if p.is_file():self.assertNotIn(b'SECRET_MUST_NOT_LEAK',p.read_bytes())
        return result

    def calls(self):
        log=self.root/'calls.jsonl';return [json.loads(x)for x in log.read_text().splitlines()]if log.exists()else[]

    def kinds(self):
        return [call['kind']for call in self.calls()]

    def test_success_runs_operations_then_real_engine_drill_then_four_roles_without_recreating_stage(self):
        result=self.run_controller();self.assertEqual(result.returncode,0,result.stderr);kinds=self.kinds()
        for left,right in [('inventory','incoming'),('incoming','upload'),('upload','install'),('install','ops_install'),('ops_status','rollback'),('rollback','qa_prepare'),('qa_prepare','browser')]:self.assertLess(kinds.index(left),kinds.index(right))
        self.assertEqual(kinds.count('inventory'),4);self.assertIn('qa_bootstrap-admin',kinds);self.assertIn('payload_cleanup',kinds)
        evidence=self.root/'evidence';self.assertEqual(json.loads((evidence/'attempt-status.json').read_text()),dict(overall='passed',phase='completed',qaCleanupVerified=True))
        self.assertEqual(len(list((evidence/'synthetic-role-screens').glob('*.png'))),12)
        self.assertEqual(json.loads((evidence/'stage-before.json').read_text()),json.loads((evidence/'stage-after.json').read_text()))
        self.assertEqual(set(p.name for p in evidence.iterdir()),{'stage-before.json','staging_known_hosts','helper-install.json','operations.json','rollback.json','qa-cleanup.json','stage-after.json','synthetic-role-screens','roles.json','attempt-status.json'})
        self.assertEqual((evidence/'staging_known_hosts').read_text(),'bangla-adventures-vps ssh-ed25519 RklYVFVSRQ==\n')
        for p in evidence.rglob('*'):
            if p.is_file():self.assertNotIn(b'192.0.2.10',p.read_bytes(),p.name)
        remote=[call for call in self.calls()if call['kind']not in {'http','browser'}];self.assertIn('qa_prepare',[call['kind']for call in remote])
        for call in remote:self.assertIn('example-user@192.0.2.10',call['args'],call['kind'])

    def test_missing_or_invalid_server_variables_prevent_remote_contact(self):
        for changes in [dict(DEPLOY_HOST=''),dict(DEPLOY_USER=''),dict(DEPLOY_HOST='192.0.2.10;id'),dict(DEPLOY_USER='Example User')]:
            result=self.run_controller(**changes);self.assertNotEqual(result.returncode,0)
            name='HOST'if'DEPLOY_HOST'in changes else'USER'
            self.assertIn(f'The DEPLOY_{name} secret is missing or invalid (set it as a repository secret or a production environment secret, named exactly DEPLOY_{name}).',result.stderr)
            for address in {self.env['DEPLOY_HOST'],changes.get('DEPLOY_HOST')}-{None,''}:self.assertNotIn(address,result.stderr)
            self.assertEqual(self.kinds(),[])

    def test_a_missing_host_is_named_before_the_known_hosts_line_it_gates(self):
        # The workflow passes DEPLOY_KNOWN_HOSTS only with the DEPLOY_HOST secret, which masks the address in it.
        result=self.run_controller(DEPLOY_HOST='',DEPLOY_KNOWN_HOSTS='');self.assertNotEqual(result.returncode,0)
        self.assertIn('The DEPLOY_HOST secret is missing or invalid',result.stderr);self.assertNotIn('credentials are missing',result.stderr);self.assertEqual(self.kinds(),[])

    def test_pinned_host_key_must_name_the_configured_server(self):
        result=self.run_controller(DEPLOY_HOST='192.0.2.11');self.assertNotEqual(result.returncode,0)
        self.assertIn('does not cover the configured VPS address',result.stderr);self.assertEqual(self.kinds(),[])

    def test_repository_gate_and_key_pin_precede_remote_contact(self):
        for changes in [dict(DEPLOY_ENABLED='true'),dict(REPOSITORY_GATE_CONFIRMED='refused'),dict(FIXTURE_BAD_PIN='1')]:
            self.assertNotEqual(self.run_controller(**changes).returncode,0);self.assertEqual(self.kinds(),[])

    def test_readonly_inventory_refusal_prevents_every_remote_write(self):
        self.assertNotEqual(self.run_controller(FIXTURE_INVENTORY_FAIL='1').returncode,0);self.assertEqual(self.kinds(),['inventory']);self.assertFalse((self.root/'evidence').exists())

    def test_invalid_fresh_systemd_receipt_refuses_before_rollback_or_browser(self):
        self.assertNotEqual(self.run_controller(FIXTURE_OPS_BAD_RECEIPT='1').returncode,0);self.assertNotIn('rollback',self.kinds());self.assertNotIn('browser',self.kinds());self.assertFalse((self.root/'evidence/operations.json').exists())

    def test_false_automatic_rollback_refuses_before_qa(self):
        self.assertNotEqual(self.run_controller(FIXTURE_BAD_ROLLBACK='1').returncode,0);self.assertNotIn('qa_prepare',self.kinds());self.assertFalse((self.root/'evidence/rollback.json').exists())

    def test_failed_operations_exports_only_a_shared_fixed_code(self):
        self.assertNotEqual(self.run_controller(FIXTURE_OPS_FAIL_CODE='initial-operations-check').returncode,0)
        self.assertEqual(json.loads((self.root/'evidence/operations-failure.json').read_text()),dict(scope='private-staging-operations',action='install',verified=False,status='failed',codes=['initial-operations-check']))
        self.assertNotIn('rollback',self.kinds())

    def test_unknown_operations_failure_code_is_not_exported(self):
        self.assertNotEqual(self.run_controller(FIXTURE_OPS_FAIL_CODE='SECRET_MUST_NOT_LEAK').returncode,0)
        self.assertFalse((self.root/'evidence/operations-failure.json').exists())

    def test_failed_rollback_exports_the_first_recognized_phase_only(self):
        self.assertNotEqual(self.run_controller(FIXTURE_ROLLBACK_EXIT='1').returncode,0)
        report=json.loads((self.root/'evidence/rollback-failure.json').read_text());self.assertEqual(set(report),{'kind','verified','runId','phase'});self.assertEqual(report['phase'],'engine');self.assertIs(report['verified'],False)
        self.assertRegex(report['runId'],r'^[a-f0-9]{24}$');self.assertNotIn('qa_prepare',self.kinds())

    def test_unattested_qa_never_reaches_browser_and_cleanup_is_attempted(self):
        self.assertNotEqual(self.run_controller(FIXTURE_BAD_QA='1').returncode,0);self.assertNotIn('browser',self.kinds());self.assertIn('qa_cleanup',self.kinds())

    def test_browser_failure_exports_only_fixed_diagnostic_fields(self):
        self.assertNotEqual(self.run_controller(FIXTURE_BROWSER_FAIL='1').returncode,0)
        report=json.loads((self.root/'evidence/browser-failure.json').read_text());self.assertEqual(report,dict(passed=False,failedStep='student-work',cleanupVerified=True,failedOperation='api',errorCode='acceptance-api-status',loginResponseStatus=403))
        self.assertFalse((self.root/'evidence/roles.json').exists());self.assertFalse((self.root/'evidence/synthetic-role-screens').exists());self.assertGreaterEqual(self.kinds().count('qa_cleanup'),2)

    def test_changed_source_stage_digest_never_publishes_success(self):
        self.assertNotEqual(self.run_controller(FIXTURE_STATE_CHANGED='1').returncode,0);self.assertFalse((self.root/'evidence/roles.json').exists());self.assertTrue(json.loads((self.root/'evidence/attempt-status.json').read_text())['qaCleanupVerified'])

    def test_unknown_browser_artifact_is_not_copied(self):
        self.assertNotEqual(self.run_controller(FIXTURE_EXTRA_BROWSER_FILE='1').returncode,0);self.assertFalse((self.root/'evidence/synthetic-role-screens').exists());self.assertFalse((self.root/'evidence/roles.json').exists())


class ManifestTransactionTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory(prefix='bangla-acceptance-manifest-');self.addCleanup(tmp.cleanup);self.root=Path(tmp.name);self.stage=self.root/'private-staging';self.stage.mkdir(mode=0o700);(self.stage/'tools').mkdir()
        self.incoming=self.root/'.private-acceptance-payload.Fixture12ABC';self.incoming.mkdir(mode=0o700);(self.incoming/'private-staging-qa.sh').write_text('new reviewed QA helper\n')
        (self.stage/'.private-staging-marker').write_text('bangla-adventures-private-staging-v1\n')
        files=['compose.yaml','tools/private-staging-proxy.mjs','tools/private-staging-remote.sh','tools/private-staging-verify.mjs','tools/private-staging-drill.sh','tools/private-staging-qa.sh']
        for name in files:(self.stage/name).write_text('previous managed '+name+'\n')
        self.manifest=dict(scope='private-staging',phase='healthy',image=IMAGE,revision=REVISION,project='bangla-adventures-staging',volume='bangla-adventures-staging_bangla-data',origin='http://127.0.0.1:3001',preservedExtra='retain',files={name:hashlib.sha256((self.stage/name).read_bytes()).hexdigest()for name in files})
        (self.stage/'release.json').write_text(json.dumps(self.manifest))
        self.code=SOURCE.split("<<'INSTALL_PY'\n",1)[1].split('\nINSTALL_PY\n',1)[0].replace('OWNER=1002','OWNER=os.getuid()').replace("r'/opt/bangla-adventures/\\.private-acceptance-payload\\.[a-zA-Z0-9]{12}'",repr(str(self.root)+r'/\.private-acceptance-payload\.[a-zA-Z0-9]{12}'))

    def run_installer(self,prefix=''):
        return subprocess.run(['python3','-c',prefix+self.code,str(self.stage),str(self.incoming)],capture_output=True,text=True)

    def test_only_qa_helper_hash_changes_and_other_manifest_fields_are_preserved(self):
        result=self.run_installer();self.assertEqual(result.returncode,0,result.stderr);after=json.loads((self.stage/'release.json').read_text());expected=json.loads(json.dumps(self.manifest));expected['files']['tools/private-staging-qa.sh']=hashlib.sha256((self.incoming/'private-staging-qa.sh').read_bytes()).hexdigest();self.assertEqual(after,expected)
        self.assertEqual((self.stage/'tools/private-staging-qa.sh').stat().st_mode&0o777,0o644)

    def test_failure_between_replacements_restores_original_helper_and_manifest_bytes(self):
        helper=self.stage/'tools/private-staging-qa.sh';old=helper.read_bytes();manifest=(self.stage/'release.json').read_bytes()
        prefix="import os\nreal_replace=os.replace\nfailed=False\ndef fail_once(src,dst):\n global failed\n if str(dst).endswith('/release.json')and not failed:\n  failed=True;raise OSError('fixture transaction failure')\n return real_replace(src,dst)\nos.replace=fail_once\n"
        self.assertNotEqual(self.run_installer(prefix).returncode,0);self.assertEqual(helper.read_bytes(),old);self.assertEqual((self.stage/'release.json').read_bytes(),manifest)

    def test_any_preexisting_managed_hash_change_refuses_without_replacing_helper(self):
        helper=self.stage/'tools/private-staging-qa.sh';old=helper.read_bytes();(self.stage/'compose.yaml').write_text('unreviewed change')
        self.assertNotEqual(self.run_installer().returncode,0);self.assertEqual(helper.read_bytes(),old)


class AcceptanceWorkflowTests(unittest.TestCase):
    def test_local_scenario_is_secret_free_and_private_job_is_explicitly_gated(self):
        program="const y=require('js-yaml'),f=require('fs');console.log(JSON.stringify(y.load(f.readFileSync('.github/workflows/vps-acceptance.yml','utf8'))));"
        workflow=json.loads(subprocess.check_output(['node','-e',program],cwd=ROOT,text=True))
        self.assertEqual(workflow['concurrency'],dict(group='vps-private-staging',**{'cancel-in-progress':False}))
        validate=workflow['jobs']['validate'];self.assertNotIn('[vps-acceptance-run]',validate['if']);self.assertNotIn('environment',validate)
        self.assertNotIn('secrets.',json.dumps(validate));self.assertIn('npx playwright test -c playwright.acceptance.config.ts --project=chromium',json.dumps(validate))
        gate=workflow['jobs']['repository-settings'];self.assertNotIn('environment',gate);self.assertIn('[vps-acceptance-run]',gate['if']);self.assertNotIn('secrets.',json.dumps(gate))
        private=workflow['jobs']['acceptance'];self.assertEqual(private['environment'],'production');self.assertEqual(set(private['needs']),{'validate','repository-settings'});self.assertIn('[vps-acceptance-run]',private['if'])
        credentials=[i for i,step in enumerate(private['steps'])if 'DEPLOY_SSH_KEY'in step.get('env',{})];self.assertEqual(len(credentials),1)
        server=private['steps'][credentials[0]]['env'];self.assertEqual((server['DEPLOY_HOST'],server['DEPLOY_USER']),('${{ secrets.DEPLOY_HOST }}','${{ secrets.DEPLOY_USER }}'))
        self.assertTrue(any('playwright install --with-deps chromium'in step.get('run','')for step in private['steps'][:credentials[0]]))
        artifact=next(step for step in validate['steps']if step.get('with',{}).get('name')=='private-acceptance-local')
        self.assertEqual(artifact['if'],'${{ always() }}');self.assertNotIn('trace',artifact['with']['path']);self.assertNotIn('error-context',artifact['with']['path'])


if __name__=='__main__':unittest.main()
