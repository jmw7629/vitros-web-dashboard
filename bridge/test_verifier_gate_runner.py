import hashlib
import importlib.util
import json
import os
import pathlib
import shlex
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

BRIDGE_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = BRIDGE_DIR.parent
HELPER_PATH = BRIDGE_DIR / "verifier_install_helpers.sh"
INSTALLER_PATH = BRIDGE_DIR / "install_verifier.sh"
CANONICAL_REMOTE = "https://github.com/jmw7629/vitros-web-dashboard.git"

if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

MODULE_PATH = BRIDGE_DIR / "verifier_gate_runner.py"
SPEC = importlib.util.spec_from_file_location("vitros_verifier_gate_runner", MODULE_PATH)
vg = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(vg)


def run_cmd(args, *, cwd=None, env=None, check=True):
    return subprocess.run(
        [str(item) for item in args],
        cwd=str(cwd) if cwd else None,
        env=env,
        text=True,
        capture_output=True,
        check=check,
    )


def hash_tree(root: pathlib.Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        rel = path.relative_to(root).as_posix().encode()
        digest.update(rel)
        if path.is_symlink():
            digest.update(b"L")
            digest.update(os.readlink(path).encode())
        elif path.is_file():
            digest.update(b"F")
            digest.update(path.read_bytes())
        elif path.is_dir():
            digest.update(b"D")
    return digest.hexdigest()


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
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name)
        self.seed = self.base / "seed"
        self.bare = self.base / "remote.git"
        self.git_config = self.base / "gitconfig"

        run_cmd(["git", "init", "-b", "main", self.seed])
        run_cmd(["git", "config", "user.name", "VITROS Test"], cwd=self.seed)
        run_cmd(["git", "config", "user.email", "vitros-test@example.invalid"], cwd=self.seed)
        (self.seed / "bridge").mkdir()
        (self.seed / "bridge" / "verifier_gate_runner.py").write_text("print('seed')\n")
        (self.seed / "marker.txt").write_text("first\n")
        run_cmd(["git", "add", "."], cwd=self.seed)
        run_cmd(["git", "commit", "-m", "first"], cwd=self.seed)
        self.first_sha = run_cmd(["git", "rev-parse", "HEAD"], cwd=self.seed).stdout.strip()

        (self.seed / "marker.txt").write_text("second\n")
        run_cmd(["git", "add", "marker.txt"], cwd=self.seed)
        run_cmd(["git", "commit", "-m", "second"], cwd=self.seed)
        self.second_sha = run_cmd(["git", "rev-parse", "HEAD"], cwd=self.seed).stdout.strip()

        run_cmd(["git", "init", "--bare", self.bare])
        run_cmd(["git", "--git-dir", self.bare, "symbolic-ref", "HEAD", "refs/heads/main"])
        run_cmd(["git", "remote", "add", "origin", CANONICAL_REMOTE], cwd=self.seed)
        run_cmd(["git", "remote", "add", "publish", self.bare], cwd=self.seed)
        run_cmd(["git", "push", "publish", "main:main"], cwd=self.seed)

        run_cmd(
            [
                "git",
                "config",
                "--file",
                self.git_config,
                f"url.file://{self.bare}.insteadOf",
                CANONICAL_REMOTE,
            ]
        )
        self.env = os.environ.copy()
        self.env["GIT_CONFIG_GLOBAL"] = str(self.git_config)
        self.env["GIT_CONFIG_NOSYSTEM"] = "1"
        self.env["GIT_TERMINAL_PROMPT"] = "0"

    def tearDown(self):
        self.tmp.cleanup()

    def helper(self, function, *args, env=None):
        shell = 'set -euo pipefail; source "$1"; shift; fn="$1"; shift; "$fn" "$@"'
        return run_cmd(
            ["bash", "-c", shell, "bash", HELPER_PATH, function, *args],
            env=env or self.env,
            check=False,
        )

    def clone_control(self, path):
        run_cmd(["git", "clone", "--quiet", CANONICAL_REMOTE, path], env=self.env)

    def test_matching_exact_head_reuses_existing_control_without_mutation(self):
        control = self.base / "control"
        self.clone_control(control)
        before = hash_tree(control)
        proc = self.helper("verifier_select_control_root", CANONICAL_REMOTE, control, self.second_sha)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(pathlib.Path(proc.stdout.strip()), control)
        self.assertEqual(hash_tree(control), before)

    def test_mismatched_clean_control_is_preserved_and_unique_root_is_exact_head(self):
        control = self.base / "control"
        self.clone_control(control)
        run_cmd(["git", "checkout", "--quiet", "--detach", self.first_sha], cwd=control)
        before = hash_tree(control)

        proc = self.helper("verifier_select_control_root", CANONICAL_REMOTE, control, self.second_sha)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        selected = pathlib.Path(proc.stdout.strip())
        self.assertNotEqual(selected, control)
        self.assertEqual(hash_tree(control), before)
        self.assertEqual(run_cmd(["git", "rev-parse", "HEAD"], cwd=selected).stdout.strip(), self.second_sha)
        self.assertEqual(run_cmd(["git", "status", "--porcelain"], cwd=selected).stdout.strip(), "")
        self.assertEqual(
            run_cmd(["git", "remote", "get-url", "origin"], cwd=selected).stdout.strip(),
            CANONICAL_REMOTE,
        )

    def test_dirty_existing_control_fails_closed_and_preserves_bytes(self):
        control = self.base / "control"
        self.clone_control(control)
        (control / "marker.txt").write_text("dirty\n")
        before = hash_tree(control)

        proc = self.helper("verifier_select_control_root", CANONICAL_REMOTE, control, self.second_sha)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("dirty", proc.stderr.lower())
        self.assertEqual(hash_tree(control), before)

    def test_non_git_existing_control_fails_closed_and_preserves_bytes(self):
        control = self.base / "control"
        control.mkdir()
        (control / "keep.txt").write_text("preserve me\n")
        before = hash_tree(control)

        proc = self.helper("verifier_select_control_root", CANONICAL_REMOTE, control, self.second_sha)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("not a Git checkout", proc.stderr)
        self.assertEqual(hash_tree(control), before)

    def test_clone_failure_never_falls_back_to_builder_root(self):
        bad_config = self.base / "bad-gitconfig"
        missing_remote = self.base / "missing.git"
        run_cmd(
            [
                "git",
                "config",
                "--file",
                bad_config,
                f"url.file://{missing_remote}.insteadOf",
                CANONICAL_REMOTE,
            ]
        )
        bad_env = self.env.copy()
        bad_env["GIT_CONFIG_GLOBAL"] = str(bad_config)
        builder = self.base / "builder-live"
        builder.mkdir()
        (builder / "keep.txt").write_text("builder untouched\n")
        before = hash_tree(builder)
        control = self.base / "control"

        proc = self.helper(
            "verifier_select_control_root",
            CANONICAL_REMOTE,
            control,
            self.second_sha,
            env=bad_env,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("falling back to builder root is prohibited", proc.stderr)
        self.assertEqual(hash_tree(builder), before)
        self.assertNotEqual(proc.stdout.strip(), str(builder))

    def test_dirty_builder_source_validation_fails_closed_without_mutation(self):
        (self.seed / "marker.txt").write_text("builder dirty\n")
        before = hash_tree(self.seed)
        proc = self.helper("verifier_validate_source_checkout", self.seed)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("clean", proc.stderr.lower())
        self.assertEqual(hash_tree(self.seed), before)

    def test_rendered_unit_ignores_builder_root_and_execstart_argv_runs(self):
        control = self.base / "dedicated-control"
        bridge = control / "bridge"
        bridge.mkdir(parents=True)
        script = bridge / "verifier_gate_runner.py"
        script.write_text(
            "import argparse\n"
            "p=argparse.ArgumentParser()\n"
            "p.add_argument('--root', required=True)\n"
            "a=p.parse_args()\n"
            "print(a.root)\n"
        )
        env_file = self.base / "vitros.env"
        env_file.write_text("BRIDGE_ROOT=/different/live-builder\n")
        home = self.base / "home"
        home.mkdir()

        proc = self.helper("verifier_render_unit", control, env_file, home)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        unit = proc.stdout
        self.assertIn(f"WorkingDirectory={control}", unit)
        self.assertNotIn("WorkingDirectory=/different/live-builder", unit)
        exec_line = next(line for line in unit.splitlines() if line.startswith("ExecStart="))
        argv = shlex.split(exec_line.split("=", 1)[1])
        self.assertEqual(argv[0:2], ["/usr/bin/env", "python3"])
        self.assertEqual(pathlib.Path(argv[2]), script)
        self.assertEqual(argv[3:5], ["--root", str(control)])

        launched = run_cmd(argv, check=False)
        self.assertEqual(launched.returncode, 0, launched.stderr)
        self.assertEqual(launched.stdout.strip(), str(control))

    def test_installer_wires_authoritative_helper_contract(self):
        content = INSTALLER_PATH.read_text()
        self.assertIn('source "$HELPERS"', content)
        self.assertIn('verifier_validate_source_checkout "$ROOT"', content)
        self.assertIn(
            'verifier_select_control_root "$REMOTE" "$VERIFIER_CONTROL_ROOT_DEFAULT" "$SOURCE_HEAD"',
            content,
        )
        self.assertIn('verifier_render_unit "$VERIFIER_CONTROL_ROOT" "$ENV_FILE" "$HOME"', content)
        self.assertNotIn("rm -rf", content)
        self.assertNotIn("git reset", content)
        self.assertNotIn("git clean", content)
        self.assertNotIn("git stash", content)

    def test_no_python_bytecode_is_tracked_or_changed(self):
        tracked = run_cmd(["git", "ls-files"], cwd=REPO_ROOT).stdout.splitlines()
        changed = run_cmd(["git", "diff", "--name-only", "HEAD"], cwd=REPO_ROOT).stdout.splitlines()
        offenders = [
            name
            for name in tracked + changed
            if "__pycache__" in name or name.endswith(".pyc")
        ]
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
