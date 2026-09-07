import importlib.util
import json
import pathlib
import types
import unittest
from unittest import mock

MODULE_PATH = pathlib.Path(__file__).with_name("verifier_gate_runner.py")
SPEC = importlib.util.spec_from_file_location("vitros_verifier_gate_runner", MODULE_PATH)
vg = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(vg)


class VerifierGateRunnerTests(unittest.TestCase):
    def _proc(self, payload):
        return types.SimpleNamespace(stdout=json.dumps(payload))

    def test_requires_vercel_status_on_exact_commit(self):
        with mock.patch.object(vg, "_ORIGINAL_CI_EVIDENCE", return_value="CI"), mock.patch.object(
            vg.vr, "run", return_value=self._proc({"statuses": []})
        ):
            with self.assertRaises(vg.vr.BridgeError) as ctx:
                vg.exact_ci_and_vercel_evidence("jmw7629/vitros-web-dashboard", "a" * 40)
        self.assertIn("Vercel preview status is missing", str(ctx.exception))

    def test_latest_vercel_status_must_be_success(self):
        payload = {
            "statuses": [
                {
                    "id": 1,
                    "context": "Vercel",
                    "state": "success",
                    "created_at": "2026-09-07T01:00:00Z",
                    "updated_at": "2026-09-07T01:00:00Z",
                    "target_url": "https://vercel.com/team/project/old",
                },
                {
                    "id": 2,
                    "context": "Vercel",
                    "state": "failure",
                    "description": "Deployment rate limited — retry later.",
                    "created_at": "2026-09-07T02:00:00Z",
                    "updated_at": "2026-09-07T02:00:00Z",
                    "target_url": "https://vercel.com/team/project/new",
                },
            ]
        }
        with mock.patch.object(vg, "_ORIGINAL_CI_EVIDENCE", return_value="CI"), mock.patch.object(
            vg.vr, "run", return_value=self._proc(payload)
        ):
            with self.assertRaises(vg.vr.BridgeError) as ctx:
                vg.exact_ci_and_vercel_evidence("jmw7629/vitros-web-dashboard", "b" * 40)
        self.assertIn("not READY", str(ctx.exception))
        self.assertIn("rate limited", str(ctx.exception))

    def test_success_requires_trusted_vercel_evidence_url(self):
        payload = {
            "statuses": [
                {
                    "id": 3,
                    "context": "Vercel",
                    "state": "success",
                    "created_at": "2026-09-07T03:00:00Z",
                    "updated_at": "2026-09-07T03:00:00Z",
                    "target_url": "https://example.invalid/not-vercel",
                }
            ]
        }
        with mock.patch.object(vg, "_ORIGINAL_CI_EVIDENCE", return_value="CI"), mock.patch.object(
            vg.vr, "run", return_value=self._proc(payload)
        ):
            with self.assertRaises(vg.vr.BridgeError) as ctx:
                vg.exact_ci_and_vercel_evidence("jmw7629/vitros-web-dashboard", "c" * 40)
        self.assertIn("trusted Vercel evidence URL", str(ctx.exception))

    def test_success_adds_vercel_preview_to_verifier_evidence(self):
        payload = {
            "statuses": [
                {
                    "id": 4,
                    "context": "Vercel",
                    "state": "success",
                    "description": "Deployment completed",
                    "created_at": "2026-09-07T04:00:00Z",
                    "updated_at": "2026-09-07T04:00:00Z",
                    "target_url": "https://vercel.com/team/project/deployment",
                }
            ]
        }
        with mock.patch.object(
            vg, "_ORIGINAL_CI_EVIDENCE", return_value="Auth Guard Fail-Closed Security, CI"
        ), mock.patch.object(vg.vr, "run", return_value=self._proc(payload)):
            evidence = vg.exact_ci_and_vercel_evidence(
                "jmw7629/vitros-web-dashboard", "d" * 40
            )
        self.assertEqual(evidence, "Auth Guard Fail-Closed Security, CI; Vercel Preview")


if __name__ == "__main__":
    unittest.main()
