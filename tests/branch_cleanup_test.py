"""Exercise real atomic leased deletions only against throwaway local bare repos."""

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest


MODULE = Path(__file__).resolve().parents[1] / "scripts/ci/cleanup_audited_branches.py"
spec = importlib.util.spec_from_file_location("cleanup_audited_branches", MODULE)
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class BranchCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bangla-cleanup-fixture-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.remote = root / "remote.git"
        self.work = root / "work"
        self.run_git(root, "init", "--bare", str(self.remote))
        self.run_git(root, "init", "-b", "main", str(self.work))
        self.run_git(self.work, "config", "user.name", "Isolated cleanup fixture")
        self.run_git(self.work, "config", "user.email", "fixture@example.invalid")
        self.run_git(self.work, "remote", "add", "origin", str(self.remote))
        self.first = self.commit("first")
        self.run_git(self.work, "branch", "audited/first")
        self.second = self.commit("second")
        self.run_git(self.work, "branch", "audited/second")
        self.head = self.commit("main includes both")
        self.manifest = {"audited/first": self.first, "audited/second": self.second}
        self.run_git(self.work, "push", "origin", "--all")

    @staticmethod
    def run_git(directory, *args):
        result = subprocess.run(["git", "-C", str(directory), *args], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            raise AssertionError(f"Fixture git {args[0]} failed: {result.stderr}")
        return result.stdout.strip()

    def commit(self, message):
        self.run_git(self.work, "commit", "--allow-empty", "-m", message)
        return self.run_git(self.work, "rev-parse", "HEAD")

    def assert_refusal_preserves_every_ref(self, message, manifest=None, protected=()):
        before = cleanup.remote_heads(self.work)
        with self.assertRaisesRegex(cleanup.CleanupRefused, message):
            cleanup.cleanup_repository(self.work, self.manifest if manifest is None else manifest, set(protected), self.head)
        self.assertEqual(cleanup.remote_heads(self.work), before)

    def test_deletes_only_exact_merged_heads_atomically_and_is_idempotent(self):
        report = cleanup.cleanup_repository(self.work, self.manifest, {"main"}, self.head)
        self.assertEqual(report["deleted"], sorted(self.manifest))
        self.assertEqual(cleanup.remote_heads(self.work), {"main": self.head})
        again = cleanup.cleanup_repository(self.work, self.manifest, {"main"}, self.head)
        self.assertEqual(again["deleted"], [])
        self.assertEqual(again["already_missing"], sorted(self.manifest))

    def test_refuses_moved_head_without_deleting_other_audited_head(self):
        self.run_git(self.work, "push", "origin", f"{self.head}:refs/heads/audited/first")
        self.assert_refusal_preserves_every_ref("Audited branch moved")

    def test_refuses_unmerged_head_without_deleting_other_audited_head(self):
        self.run_git(self.work, "switch", "-c", "unmerged", self.first)
        unmerged = self.commit("work not in main")
        self.run_git(self.work, "switch", "main")
        self.run_git(self.work, "push", "--force", "origin", f"{unmerged}:refs/heads/audited/first")
        manifest = {**self.manifest, "audited/first": unmerged}
        self.assert_refusal_preserves_every_ref("not an ancestor of main", manifest)

    def test_refuses_unknown_branch(self):
        self.run_git(self.work, "push", "origin", f"{self.first}:refs/heads/not-audited")
        self.assert_refusal_preserves_every_ref("outside the frozen audit")

    def test_refuses_protected_or_default_ref(self):
        self.assert_refusal_preserves_every_ref("protected branch", protected={"audited/second"})
        self.assert_refusal_preserves_every_ref("default or protected", {**self.manifest, "main": self.head})

    def test_refuses_moved_remote_main(self):
        self.run_git(self.work, "push", "--force", "origin", f"{self.second}:refs/heads/main")
        self.assert_refusal_preserves_every_ref("Remote main moved")

    def test_workflow_requires_repo_main_and_explicit_event_authorization(self):
        environment = {"GITHUB_REPOSITORY": cleanup.REPOSITORY, "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "workflow_dispatch", "CONFIRM_CLEANUP": "false"}
        with self.assertRaisesRegex(cleanup.CleanupRefused, "confirm_cleanup"):
            cleanup.workflow_authorized(environment, {})
        cleanup.workflow_authorized({**environment, "CONFIRM_CLEANUP": "true"}, {})
        push = {**environment, "GITHUB_EVENT_NAME": "push", "GITHUB_SHA": self.head}
        with self.assertRaisesRegex(cleanup.CleanupRefused, "audit marker"):
            cleanup.workflow_authorized(push, {"head_commit": {"message": "ordinary update"}})
        cleanup.workflow_authorized(push, {"head_commit": {"message": f"Consolidate audited work {cleanup.MARKER}"}, "after": self.head, "deleted": False})
        with self.assertRaisesRegex(cleanup.CleanupRefused, "restricted"):
            cleanup.workflow_authorized({**environment, "GITHUB_REF": "refs/heads/audited/first"}, {})


if __name__ == "__main__":
    unittest.main()
