import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest import mock

BRIDGE_DIR = pathlib.Path(__file__).resolve().parent
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

MODULE_PATH = BRIDGE_DIR / "verifier_gate_runner.py"
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


class InstallerContractTests(unittest.TestCase):
    def test_execstart_argv_order_correct(self):
        """Verify installer generates ExecStart using python3 <script> --root <root> order."""
        installer_path = pathlib.Path("/home/joevps/.cache/joeos-opencode-bridge/jmw7629__vitros-web-dashboard/project-byte-live-builder/issue-339/bridge/install_verifier.sh")
        content = installer_path.read_text()
        # The ExecStart in the generated service must use correct argv order:
        # python3 <script> --root <root> (not python3 --root <root> <script>)
        self.assertIn(
            "python3 $VERIFIER_CONTROL_ROOT/bridge/verifier_gate_runner.py --root $VERIFIER_CONTROL_ROOT",
            content,
            "Installer must generate ExecStart with correct argv order: script before --root"
        )
        # Verify the old bug pattern is NOT present
        self.assertNotIn(
            "$ROOT/bridge/verifier_gate_runner.py",
            content,
            "Installer must not generate the PR #338 bug pattern"
        )
        # Verify --root comes after the script path in the ExecStart
        import re
        matches = re.findall(r"ExecStart=/usr/bin/env python3 (.+)", content)
        self.assertTrue(matches, "Could not find ExecStart in installer content")
        args = matches[0]
        script_path = "/bridge/verifier_gate_runner.py"
        root_arg = "--root"
        self.assertIn(script_path, args, "Script path must appear in ExecStart args")
        root_index = args.find(root_arg)
        script_index = args.find(script_path)
        self.assertGreater(root_index, script_index, "--root must come after script path in ExecStart")

    def test_builder_root_cannot_redirect_verifier(self):
        """Verify that the installer uses an explicit independent verifier control root,
        not BRIDGE_ROOT from builder environment."""
        installer_path = pathlib.Path("/home/joevps/.cache/joeos-opencode-bridge/jmw7629__vitros-web-dashboard/project-byte-live-builder/issue-339/bridge/install_verifier.sh")
        content = installer_path.read_text()
        # The installer must define VERIFIER_CONTROL_ROOT_DEFAULT independent from BRIDGE_ROOT
        self.assertIn(
            "VERIFIER_CONTROL_ROOT_DEFAULT",
            content,
            "Installer must define VERIFIER_CONTROL_ROOT_DEFAULT"
        )
        # The dedicated path must not be derived from BRIDGE_ROOT or $ROOT
        self.assertIn(
            "/home/joevps/.local/share/joeos-opencode-bridge/vitros-verifier-control-v2",
            content,
            "Installer must use the dedicated verifier control checkout path"
        )
        # The generated service must use VERIFIER_CONTROL_ROOT, not $ROOT
        # Check that the installer does not use $ROOT for the verifier ExecStart
        self.assertNotIn(
            "$ROOT/bridge/verifier_gate_runner.py",
            content,
            "Installer must not use $ROOT/bridge/verifier_gate_runner.py for verifier ExecStart"
        )
        # Check that the installer defines the dirty-fail-closed logic for verifier control
        self.assertIn(
            "git status --porcelain",
            content,
            "Installer must check verifier control checkout cleanliness"
        )

    def test_dirty_verifier_control_root_fails_closed(self):
        """Verify that installation fails closed when verifier control checkout is dirty."""
        installer_path = pathlib.Path("/home/joevps/.cache/joeos-opencode-bridge/jmw7629__vitros-web-dashboard/project-byte-live-builder/issue-339/bridge/install_verifier.sh")
        content = installer_path.read_text()
        # The installer must have dirty-check logic for the verifier control checkout
        self.assertIn(
            "git status --porcelain",
            content,
            "Installer must check verifier control checkout cleanliness"
        )
        self.assertIn(
            "exit 1",
            content,
            "Installer must exit 1 when verifier control checkout is dirty"
        )
        self.assertIn(
            "failing closed",
            content.lower(),
            "Installer must fail closed on dirty verifier control checkout"
        )

    def test_clone_provision_failure_never_falls_back(self):
        """Verify that clone/provision failure never falls back to live/builder root."""
        installer_path = pathlib.Path("/home/joevps/.cache/joeos-opencode-bridge/jmw7629__vitros-web-dashboard/project-byte-live-builder/issue-339/bridge/install_verifier.sh")
        content = installer_path.read_text()
        # The installer must explicitly prohibit falling back to builder root
        self.assertIn(
            "falling back to builder root is prohibited",
            content,
            "Installer must explicitly prohibit falling back to builder root on failure"
        )
        # Verify there's no fallback to BRIDGE_ROOT or $ROOT as fallback
        self.assertIn(
            "Failed to clone verifier control checkout",
            content,
            "Installer must report clone failure"
        )
        self.assertIn(
            "exit 1",
            content,
            "Installer must exit 1 on clone failure (no fallback)"
        )

    def test_no_pyc_in_changed_files(self):
        """Verify that no __pycache__ or .pyc appears in changed files after tests."""
        import subprocess
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True, text=True,
            cwd="/home/joevps/.cache/joeos-opencode-bridge/jmw7629__vitros-web-dashboard/project-byte-live-builder/issue-339"
        )
        changed = result.stdout.splitlines()
        pyc_files = [f for f in changed if "__pycache__" in f or f.endswith(".pyc")]
        self.assertEqual(
            len(pyc_files),
            0,
            f"No .pyc or __pycache__ files should be in changed files, found: {pyc_files}"
        )
