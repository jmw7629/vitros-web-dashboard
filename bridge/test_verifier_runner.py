import importlib.util
import pathlib
import unittest

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

    def test_product_and_github_credentials_are_stripped_from_opencode(self):
        required = {
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "SUPABASE_SERVICE_ROLE_KEY",
            "VERCEL_TOKEN",
            "CONVEX_DEPLOY_KEY",
        }
        self.assertTrue(required.issubset(vr.OPEN_CODE_STRIPPED_ENV))

    def test_verifier_markers_are_explicit(self):
        self.assertEqual(vr.VERIFY_MARKER, "<!-- vitros-opencode-verify:v1 -->")
        self.assertEqual(vr.LEGACY_VERIFY_MARKER, "joeos-opencode-bridge:v1")


if __name__ == "__main__":
    unittest.main()
