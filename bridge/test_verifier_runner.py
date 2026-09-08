import importlib.util
import json
import pathlib
import unittest
from unittest import mock
from pathlib import Path

MODULE_PATH = pathlib.Path(__file__).with_name("verifier_runner.py")
SPEC = importlib.util.spec_from_file_location("vitros_verifier_runner", MODULE_PATH)
vr = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(vr)


class VerifierRunnerTests(unittest.TestCase):
    def test_parse_target_requires_pr_and_exact_sha(self):
        sha = "a" * 40
        pr, parsed = vr.parse_target(f"Independent verifier for PR #193 exact head `{sha}`.")
        self.assertEqual(pr, 193)
        self.assertEqual(parsed, sha)
        with self.assertRaises(vr.BridgeError):
            vr.parse_target(f"exact head {sha}")
        with self.assertRaises(vr.BridgeError):
            vr.parse_target("PR #193 but no sha")

    def test_first_sha_is_target_not_later_base(self):
        target = "1" * 40
        base = "2" * 40
        pr, parsed = vr.parse_target(f"PR #191 exact target {target}; base {base}")
        self.assertEqual(pr, 191)
        self.assertEqual(parsed, target)

    def test_prompt_supplies_exact_challenged_terminal_grammar(self):
        target = "a" * 40
        nonce = "0123456789abcdef" * 2
        prompt = vr.build_prompt(
            {"body": "approved verifier issue"}, 320, target, "b" * 40, nonce, "CI; Vercel Preview"
        )
        self.assertIn(f"VERIFY=PASS SHA={target} NONCE={nonce}", prompt)
        self.assertIn(f"VERIFY=FAIL SHA={target} NONCE={nonce} REASON=<concise reason>", prompt)
        self.assertIn(f"VERIFY=BLOCKED SHA={target} NONCE={nonce} REASON=<concise reason>", prompt)
        self.assertIn("Do not use bash/echo to emit it", prompt)
        self.assertIn("do not omit PASS/FAIL/BLOCKED", prompt)

    def test_terminal_requires_exact_target_and_nonce(self):
        target = "b" * 40
        nonce = "1a" * 16
        status, reason = vr.extract_terminal(
            f"event text VERIFY=PASS SHA={target} NONCE={nonce}", "", target, nonce
        )
        self.assertEqual((status, reason), ("PASS", ""))

        wrong_sha = "c" * 40
        status, reason = vr.extract_terminal(
            f"VERIFY=PASS SHA={wrong_sha} NONCE={nonce}", "", target, nonce
        )
        self.assertEqual(status, "BLOCKED")
        self.assertIn("instead of", reason)

        wrong_nonce = "2b" * 16
        status, reason = vr.extract_terminal(
            f"VERIFY=PASS SHA={target} NONCE={wrong_nonce}", "", target, nonce
        )
        self.assertEqual(status, "BLOCKED")
        self.assertIn("challenge", reason)

    def test_echoed_issue_terminal_without_nonce_cannot_pass(self):
        target = "d" * 40
        nonce = "3c" * 16
        echoed = f'{{"text":"VERIFY=PASS SHA={target}"}}'
        status, reason = vr.extract_terminal(echoed, "", target, nonce)
        self.assertEqual(status, "BLOCKED")
        self.assertIn("challenged terminal", reason)

    def test_json_embedded_terminal_can_pass_with_active_nonce(self):
        target = "e" * 40
        nonce = "4d" * 16
        output = f'{{"type":"text","part":{{"text":"checks ok\\nVERIFY=PASS SHA={target} NONCE={nonce}"}}}}'
        status, reason = vr.extract_terminal(output, "", target, nonce)
        self.assertEqual((status, reason), ("PASS", ""))

    def test_terminal_missing_is_blocked(self):
        status, reason = vr.extract_terminal("all checks looked good", "", "f" * 40, "5e" * 16)
        self.assertEqual(status, "BLOCKED")
        self.assertIn("challenged terminal", reason)

    def test_secret_sanitizer_redacts_common_credentials(self):
        sample = (
            "Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n"
            "CONVEX_DEPLOY_KEY=super-secret-value\n"
            "token: another-secret-value\n"
        )
        sanitized = vr.sanitize(sample)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", sanitized)
        self.assertNotIn("super-secret-value", sanitized)
        self.assertNotIn("another-secret-value", sanitized)
        self.assertGreaterEqual(sanitized.count("[REDACTED]"), 3)

    def test_nonzero_opencode_diagnostic_prefers_structured_message_and_redacts(self):
        proc = mock.Mock(
            returncode=1,
            stderr="",
            stdout=json.dumps({
                "type": "error",
                "error": {
                    "data": {
                        "message": "Insufficient balance. Manage billing at https://opencode.ai/workspace/wrk_sensitive/billing CONVEX_DEPLOY_KEY=super-secret-value"
                    }
                },
            }),
        )
        reason = vr.opencode_failure_reason(proc)
        self.assertIn("OpenCode exited with code 1", reason)
        self.assertIn("Insufficient balance", reason)
        self.assertIn("OpenCode billing page", reason)
        self.assertNotIn("wrk_sensitive", reason)
        self.assertNotIn("super-secret-value", reason)
        self.assertIn("[REDACTED]", reason)
        self.assertLessEqual(len(reason), 900)

    def test_nonzero_opencode_diagnostic_prefers_stderr_and_is_bounded(self):
        proc = mock.Mock(returncode=7, stderr="provider unavailable " + ("x" * 5000), stdout="ignored")
        reason = vr.opencode_failure_reason(proc)
        self.assertTrue(reason.startswith("OpenCode exited with code 7: provider unavailable"))
        self.assertNotIn("ignored", reason)
        self.assertLessEqual(len(reason), 900)

    def test_product_and_github_credentials_are_stripped_from_opencode(self):
        required = {
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "SUPABASE_ACCESS_TOKEN",
            "SUPABASE_SERVICE_ROLE_KEY",
            "VERCEL_TOKEN",
            "CONVEX_DEPLOY_KEY",
            "CONVEX_SELF_HOSTED_ADMIN_KEY",
        }
        self.assertTrue(required.issubset(vr.OPEN_CODE_STRIPPED_ENV))

    def test_static_permission_policy_denies_mutation_network_and_project_execution(self):
        policy = vr.static_permission_policy()
        self.assertEqual(policy["*"], "deny")
        for capability in (
            "edit",
            "external_directory",
            "task",
            "webfetch",
            "websearch",
            "lsp",
            "skill",
            "question",
        ):
            self.assertEqual(policy[capability], "deny")
        self.assertEqual(policy["bash"]["*"], "deny")
        for command in (
            "git status*",
            "git diff*",
            "git log*",
            "git show*",
            "git grep*",
            "git ls-files*",
            "git rev-parse*",
            "git cat-file*",
            "git ls-tree*",
            "git merge-base*",
        ):
            self.assertEqual(policy["bash"][command], "allow")
        for forbidden in ("npm *", "node *", "python *", "pnpm *", "yarn *", "git commit*", "gh *"):
            self.assertNotIn(forbidden, policy["bash"])

    def test_inline_config_applies_same_static_policy_to_build_agent(self):
        payload = json.loads(vr.inline_opencode_config())
        self.assertEqual(payload["permission"], vr.static_permission_policy())
        self.assertEqual(payload["agent"]["build"]["permission"], vr.static_permission_policy())

    def test_resolve_pr_uses_stable_rest_payload(self):
        target = "a" * 40
        base = "b" * 40
        proc = mock.Mock()
        proc.stdout = json.dumps({
            "head": {"sha": target},
            "base": {"sha": base},
            "html_url": "https://github.com/jmw7629/vitros-web-dashboard/pull/314",
            "title": "Verifier compatibility",
            "state": "open",
        })
        with mock.patch.object(vr, "run", return_value=proc) as run_mock:
            result = vr.resolve_pr("jmw7629/vitros-web-dashboard", 314, target)
        self.assertEqual(result["head"], target)
        self.assertEqual(result["base"], base)
        self.assertEqual(result["state"], "OPEN")
        run_mock.assert_called_once_with([
            "gh", "api", "--method", "GET",
            "repos/jmw7629/vitros-web-dashboard/pulls/314",
        ])

    def test_resolve_pr_rejects_moved_head_from_rest_payload(self):
        expected = "c" * 40
        moved = "d" * 40
        proc = mock.Mock()
        proc.stdout = json.dumps({
            "head": {"sha": moved},
            "base": {"sha": "e" * 40},
            "state": "open",
        })
        with mock.patch.object(vr, "run", return_value=proc):
            with self.assertRaises(vr.BridgeError) as ctx:
                vr.resolve_pr("jmw7629/vitros-web-dashboard", 314, expected)
        self.assertIn("head moved", str(ctx.exception))

    def test_verifier_opencode_timeout_is_bounded_and_validated(self):
        with mock.patch.dict(vr.os.environ, {}, clear=True):
            self.assertEqual(vr.verifier_opencode_timeout_seconds(), 900)
        with mock.patch.dict(vr.os.environ, {"BRIDGE_VERIFIER_OPENCODE_TIMEOUT_SECONDS": "10"}, clear=True):
            self.assertEqual(vr.verifier_opencode_timeout_seconds(), 60)
        with mock.patch.dict(vr.os.environ, {"BRIDGE_VERIFIER_OPENCODE_TIMEOUT_SECONDS": "9999"}, clear=True):
            self.assertEqual(vr.verifier_opencode_timeout_seconds(), 1800)
        with mock.patch.dict(vr.os.environ, {"BRIDGE_VERIFIER_OPENCODE_TIMEOUT_SECONDS": "nope"}, clear=True):
            with self.assertRaises(vr.BridgeError):
                vr.verifier_opencode_timeout_seconds()

    def test_verifier_markers_are_explicit(self):
        self.assertEqual(vr.VERIFY_MARKER, "<!-- vitros-opencode-verify:v1 -->")
        self.assertEqual(vr.LEGACY_VERIFY_MARKER, "joeos-opencode-bridge:v1")


class EnsureRepoTests(unittest.TestCase):
    def test_ensure_repo_clean_succeeds(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            git_dir = Path(tmp) / ".git"
            git_dir.mkdir(parents=True, exist_ok=True)
            (git_dir / "HEAD").write_text("ref: refs/heads/main\n")
            with mock.patch.object(vr, "run") as run_mock:
                status_proc = mock.Mock(stdout="", stderr="")
                remote_proc = mock.Mock(stdout="https://github.com/jmw7629/vitros-web-dashboard.git\n", stderr="")
                run_mock.side_effect = lambda *args, **kwargs: status_proc if args[0] == ["git", "status", "--porcelain"] else remote_proc
                vr.ensure_repo(Path(tmp), "jmw7629/vitros-web-dashboard")

    def test_ensure_repo_dirty_fails(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            git_dir = Path(tmp) / ".git"
            git_dir.mkdir(parents=True, exist_ok=True)
            (git_dir / "HEAD").write_text("ref: refs/heads/main\n")
            (Path(tmp) / "test.txt").write_text("hello")
            with mock.patch.object(vr, "run") as run_mock:
                dirty_proc = mock.Mock(stdout="test.txt\n", stderr="")
                remote_proc = mock.Mock(stdout="https://github.com/jmw7629/vitros-web-dashboard.git\n", stderr="")
                run_mock.side_effect = lambda *args, **kwargs: dirty_proc if args[0] == ["git", "status", "--porcelain"] else remote_proc
                with self.assertRaises(vr.BridgeError) as ctx:
                    vr.ensure_repo(Path(tmp), "jmw7629/vitros-web-dashboard")
                self.assertIn("dirty", str(ctx.exception).lower())

    def test_ensure_repo_wrong_origin_fails(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            git_dir = Path(tmp) / ".git"
            git_dir.mkdir(parents=True, exist_ok=True)
            (git_dir / "HEAD").write_text("ref: refs/heads/main\n")
            with mock.patch.object(vr, "run") as run_mock:
                status_proc = mock.Mock(stdout="", stderr="")
                remote_proc = mock.Mock(stdout="https://github.com/other/repo.git\n", stderr="")
                run_mock.side_effect = lambda *args, **kwargs: status_proc if args[0] == ["git", "status", "--porcelain"] else remote_proc
                with self.assertRaises(vr.BridgeError) as ctx:
                    vr.ensure_repo(Path(tmp), "jmw7629/vitros-web-dashboard")
                self.assertIn("Unexpected origin", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
