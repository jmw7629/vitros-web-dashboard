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

    def test_terminal_requires_exact_target_sha(self):
        target = "b" * 40
        status, reason = vr.extract_terminal(
            f"evidence\nVERIFY=PASS SHA={target}\n", "", target
        )
        self.assertEqual((status, reason), ("PASS", ""))

        wrong = "c" * 40
        status, reason = vr.extract_terminal(
            f"VERIFY=PASS SHA={wrong}\n", "", target
        )
        self.assertEqual(status, "BLOCKED")
        self.assertIn("instead of", reason)

    def test_terminal_missing_is_blocked(self):
        status, reason = vr.extract_terminal("all checks looked good", "", "d" * 40)
        self.assertEqual(status, "BLOCKED")
        self.assertIn("required terminal", reason)

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

    def test_verifier_markers_are_explicit(self):
        self.assertEqual(vr.VERIFY_MARKER, "<!-- vitros-opencode-verify:v1 -->")
        self.assertEqual(vr.LEGACY_VERIFY_MARKER, "joeos-opencode-bridge:v1")


if __name__ == "__main__":
    unittest.main()
