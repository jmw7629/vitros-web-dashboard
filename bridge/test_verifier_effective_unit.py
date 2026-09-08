import os
import pathlib
import subprocess
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
HELPERS = ROOT / "verifier_install_helpers.sh"
CONTROL = "/tmp/vitros-verifier-control"
SERVICE = "vitros-opencode-verifier.service"


def structured_exec(argv=None, path="/usr/bin/env"):
    argv = argv or f"/usr/bin/env python3 {CONTROL}/bridge/verifier_gate_runner.py --root {CONTROL}"
    return f"{{ path={path} ; argv[]={argv} ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }}"


class EffectiveUnitTests(unittest.TestCase):
    def run_case(self, working=CONTROL, exec_value=None, fail_property=None, activate=False, dropin=None):
        exec_value = structured_exec() if exec_value is None else exec_value
        with tempfile.TemporaryDirectory() as td:
            td = pathlib.Path(td)
            log = td / "actions.log"
            drop = td / "override.conf"
            if dropin is not None:
                drop.write_bytes(dropin)
            fake = td / "systemctl"
            fake.write_text(textwrap.dedent(f"""\
                #!/usr/bin/env bash
                printf '%s\\n' "$*" >> {log}
                case "$*" in
                  *--property=WorkingDirectory*)
                    [[ "{fail_property or ''}" == "WorkingDirectory" ]] && exit 9
                    printf '%s\\n' {working!r}
                    ;;
                  *--property=ExecStart*)
                    [[ "{fail_property or ''}" == "ExecStart" ]] && exit 9
                    printf '%s\\n' {exec_value!r}
                    ;;
                  *enable*|*start*|*restart*) exit 0 ;;
                  *) exit 7 ;;
                esac
            """))
            fake.chmod(0o755)
            shell = (
                'source "$1"; '
                f'verifier_validate_effective_unit_properties {CONTROL!r} {SERVICE!r}'
            )
            if activate:
                shell += f' && systemctl --user enable --now {SERVICE!r}'
            env = dict(os.environ, PATH=f"{td}:{os.environ['PATH']}")
            cp = subprocess.run(["bash", "-c", shell, "_", str(HELPERS)], text=True, capture_output=True, env=env)
            actions = log.read_text() if log.exists() else ""
            after = drop.read_bytes() if drop.exists() else None
            return cp, actions, after

    def assert_failed_before_activation(self, **kwargs):
        cp, actions, _ = self.run_case(activate=True, **kwargs)
        self.assertNotEqual(cp.returncode, 0)
        self.assertNotIn(" enable ", f" {actions} ")
        self.assertNotIn(" start ", f" {actions} ")
        self.assertNotIn(" restart ", f" {actions} ")
        return cp

    def test_exact_effective_values_pass_and_allow_activation(self):
        cp, actions, _ = self.run_case(activate=True)
        self.assertEqual(cp.returncode, 0, cp.stderr)
        self.assertIn("enable --now", actions)

    def test_wrong_workdir_fails_closed(self):
        self.assert_failed_before_activation(working="/tmp/wrong-control")

    def test_empty_workdir_fails_closed(self):
        self.assert_failed_before_activation(working="")

    def test_show_failures_fail_closed(self):
        self.assert_failed_before_activation(fail_property="WorkingDirectory")
        self.assert_failed_before_activation(fail_property="ExecStart")

    def test_exec_replacements_and_argument_changes_fail_closed(self):
        bad = [
            structured_exec(path="/bin/sh"),
            structured_exec(argv=f"/usr/bin/env python3 {CONTROL}/bridge/verifier_gate_runner.py --root {CONTROL} --extra"),
            structured_exec(argv=f"/usr/bin/env python3 {CONTROL}/bridge/verifier_gate_runner.py"),
            structured_exec(argv="/usr/bin/env python3 /tmp/other/bridge/verifier_gate_runner.py --root /tmp/other"),
            "malformed SECRET_SENTINEL argv=/usr/bin/env",
        ]
        for value in bad:
            with self.subTest(value=value[:32]):
                cp = self.assert_failed_before_activation(exec_value=value)
                self.assertNotIn("SECRET_SENTINEL", cp.stderr)
                self.assertNotIn("argv=/usr/bin/env", cp.stderr)

    def test_dropin_bytes_are_never_mutated(self):
        sentinel = b"[Service]\nEnvironment=SAFE_SENTINEL=1\n"
        cp, _, after = self.run_case(dropin=sentinel)
        self.assertEqual(cp.returncode, 0, cp.stderr)
        self.assertEqual(after, sentinel)
        cp, _, after = self.run_case(working="/tmp/conflict", dropin=sentinel)
        self.assertNotEqual(cp.returncode, 0)
        self.assertEqual(after, sentinel)


if __name__ == "__main__":
    unittest.main()
