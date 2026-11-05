#!/usr/bin/env python3
"""Delete only the ten frozen, audited branch heads after main contains them."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request


REPOSITORY = "omargad/Bangla-Adventure"
MARKER = "[cleanup-audited-branches]"
AUDITED_HEADS = {
    "ccr-61fb71f1-s7zqvh": "01651e59c6ce25a9fc8b0fdb6b2c07fdeee918ea",
    "codex/admin-content-approval": "552bf67834b9fd652a34bbde4b302f3e509e6a59",
    "codex/automatic-content-narration": "80df38366865e4b836f876e7ce4b386d476e8f6f",
    "codex/connected-four-role-demo": "9bd56cc225788d1c38c4fe45663e7009cfc5a836",
    "codex/content-review-corrections": "3fb18edc907d5cb3fad97ecbd87765ba8df1e0d2",
    "codex/demo-polish-fixes": "79ac8db16358cd096b32acb40fd3838dd50f45d0",
    "codex/elevenlabs-demo-voices": "4a292c6b596e284a5cdf36b1b1dbe4e54b660a8b",
    "codex/final-client-release": "7d81fcb7b31aa731b7f5a4b26d68de808bc95cdc",
    "codex/rootless-vps-deployment": "055f8f15b3644547fbeda1cee0bb97cb0ac1d12f",
    "codex/vps-ssh-preflight-20261105": "78b514192b9b9a218d3d55963ccf1fff487c42b6",
}


class CleanupRefused(RuntimeError):
    """A safety condition was not met; nothing else should be deleted."""


def git(directory, *args, check=True):
    result = subprocess.run(
        ["git", "-C", str(directory), *args],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if check and result.returncode:
        # Do not print Git's stderr: remote authentication errors can contain credentials.
        raise CleanupRefused(f"Git operation {args[0]} failed (exit {result.returncode}).")
    return result


def remote_heads(directory):
    heads = {}
    for line in git(directory, "ls-remote", "--heads", "origin").stdout.splitlines():
        sha, ref = line.split()
        if not ref.startswith("refs/heads/") or not re.fullmatch(r"[a-f0-9]{40}", sha):
            raise CleanupRefused("Unexpected remote branch listing.")
        heads[ref.removeprefix("refs/heads/")] = sha
    return heads


def cleanup_repository(directory, audited_heads, protected_refs, expected_main):
    """The CLI always supplies the frozen manifest; arguments allow isolated git tests."""
    if not re.fullmatch(r"[a-f0-9]{40}", expected_main):
        raise CleanupRefused("Invalid expected main commit.")
    if git(directory, "symbolic-ref", "--quiet", "HEAD").stdout.strip() != "refs/heads/main":
        raise CleanupRefused("Only a checked-out main branch may perform cleanup.")
    if git(directory, "rev-parse", "HEAD").stdout.strip() != expected_main:
        raise CleanupRefused("Checked-out main does not match this workflow commit.")
    for name, sha in audited_heads.items():
        if name == "main" or name in protected_refs:
            raise CleanupRefused(f"Refusing default or protected branch: {name}.")
        if not re.fullmatch(r"[a-f0-9]{40}", sha) or git(directory, "check-ref-format", f"refs/heads/{name}", check=False).returncode:
            raise CleanupRefused("Invalid frozen branch manifest.")

    before = remote_heads(directory)
    unknown = set(before) - {"main"} - set(audited_heads)
    if unknown:
        raise CleanupRefused("Remote contains branches outside the frozen audit: " + ", ".join(sorted(unknown)))
    if before.get("main") != expected_main:
        raise CleanupRefused("Remote main moved; run from its current checked-out commit.")
    deletions = {}
    for name, expected in audited_heads.items():
        actual = before.get(name)
        if actual is None:
            continue  # A previous successful cleanup may already have removed it.
        if actual != expected:
            raise CleanupRefused(f"Audited branch moved: {name}.")
        if git(directory, "merge-base", "--is-ancestor", expected, expected_main, check=False).returncode:
            raise CleanupRefused(f"Audited branch is not an ancestor of main: {name}.")
        deletions[name] = expected

    # Recheck the entire inventory immediately before the single atomic push.
    if remote_heads(directory) != before:
        raise CleanupRefused("Remote branches changed during preflight; retry after auditing.")
    if deletions:
        leases = [f"--force-with-lease=refs/heads/{name}:{sha}" for name, sha in deletions.items()]
        refspecs = [f":refs/heads/{name}" for name in deletions]
        git(directory, "push", "--atomic", *leases, "origin", *refspecs)
    if remote_heads(directory) != {"main": expected_main}:
        raise CleanupRefused("Post-cleanup verification failed: remote must contain only unchanged main. Unknown or moved refs were not deleted.")
    return {"main": expected_main, "deleted": sorted(deletions), "already_missing": sorted(set(audited_heads) - set(deletions))}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def github_json(endpoint, token):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}{endpoint}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            return json.load(response)
    except (urllib.error.URLError, json.JSONDecodeError) as error:
        raise CleanupRefused("Unable to verify repository protection using GitHub's API.") from error


def workflow_authorized(environment, event):
    if environment.get("GITHUB_REPOSITORY") != REPOSITORY or environment.get("GITHUB_REF") != "refs/heads/main":
        raise CleanupRefused("Cleanup is restricted to the audited repository's main branch.")
    if environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        if environment.get("CONFIRM_CLEANUP") != "true":
            raise CleanupRefused("Manual cleanup requires confirm_cleanup=true.")
    elif environment.get("GITHUB_EVENT_NAME") == "push":
        if MARKER not in event.get("head_commit", {}).get("message", ""):
            raise CleanupRefused("Push cleanup requires the explicit audit marker.")
        if event.get("after") != environment.get("GITHUB_SHA") or event.get("deleted") is not False:
            raise CleanupRefused("Push event does not identify the checked-out main update.")
    else:
        raise CleanupRefused("This event cannot authorize branch cleanup.")


def main():
    if len(sys.argv) != 1:
        raise CleanupRefused("This fixed audit accepts no command-line arguments.")
    environment = os.environ
    event = json.loads(Path(environment["GITHUB_EVENT_PATH"]).read_text())
    workflow_authorized(environment, event)
    directory = Path(environment["GITHUB_WORKSPACE"])
    remote = git(directory, "remote", "get-url", "origin").stdout.strip()
    if remote not in {f"https://github.com/{REPOSITORY}", f"https://github.com/{REPOSITORY}.git"}:
        raise CleanupRefused("Origin is not the audited GitHub repository.")
    token = environment.get("GH_TOKEN", "")
    if not token:
        raise CleanupRefused("The workflow's scoped GitHub token is required.")
    repository = github_json("", token)
    if repository.get("full_name") != REPOSITORY or repository.get("default_branch") != "main":
        raise CleanupRefused("Repository identity or default branch changed.")
    protected_refs = set()
    for page in range(1, 101):
        branches = github_json(f"/branches?protected=true&per_page=100&page={page}", token)
        if not isinstance(branches, list) or any(not isinstance(branch, dict) or branch.get("protected") is not True or not isinstance(branch.get("name"), str) for branch in branches):
            raise CleanupRefused("Unexpected protected-branch API response.")
        protected_refs.update(branch["name"] for branch in branches)
        if len(branches) < 100:
            break
    else:
        raise CleanupRefused("Protected-branch listing exceeded the bounded audit.")
    report = cleanup_repository(directory, AUDITED_HEADS, protected_refs, environment.get("GITHUB_SHA", ""))
    print(json.dumps(report, indent=2))
    summary = environment.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as output:
            output.write("## Audited branch cleanup\n\n")
            output.write(f"Verified only `main` remains, unchanged at `{report['main']}`.\n\n")
            output.write(f"Deleted {len(report['deleted'])} audited branches; {len(report['already_missing'])} were already absent.\n\n")
            for name in report["deleted"]:
                output.write(f"- Deleted `{name}` at `{AUDITED_HEADS[name]}`.\n")


if __name__ == "__main__":
    try:
        main()
    except (CleanupRefused, KeyError, OSError, json.JSONDecodeError) as error:
        print(f"Audited cleanup refused: {error}", file=sys.stderr)
        sys.exit(1)
