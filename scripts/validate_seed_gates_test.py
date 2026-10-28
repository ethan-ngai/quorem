import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("seed_gates", ROOT / "scripts/validate-seed-gates.py")
gates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gates)


class SeedGatesTest(unittest.TestCase):
    def test_dependencies(self):
        gates.validate({})
        enabled = {"TF_VAR_" + name: "true" for name in (
            "api_lossless_results", "api_lossless_cases", "judge_lossless_results", "judge_lossless_cases")}
        gates.validate(enabled)
        for name in ("api_lossless_results", "judge_lossless_results", "judge_lossless_cases"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                gates.validate({**enabled, "TF_VAR_" + name: "false"})
        with self.assertRaises(ValueError):
            gates.validate({"TF_VAR_judge_lossless_cases": "true"})
        with self.assertRaises(ValueError):
            gates.validate({"TF_VAR_api_lossless_cases": "TRUE"})

    def test_workflow_uses_api_gates_before_seed(self):
        workflow = (ROOT / ".github/workflows/deploy.yaml").read_text()
        for flag in ("cases", "results"):
            self.assertIn("TF_VAR_api_lossless_" + flag + ": ${{ vars.QUOREM_API_LOSSLESS_" + flag.upper() + " || 'false' }}", workflow)
        self.assertIn("QUOREM_LOSSLESS_CASES: ${{ env.TF_VAR_api_lossless_cases }}", workflow)
        self.assertIn("QUOREM_LOSSLESS_RESULT_WRITES: ${{ env.TF_VAR_api_lossless_results }}", workflow)
        self.assertLess(workflow.index("python3 scripts/validate-seed-gates.py"), workflow.index(".local/deploy/provision --seed"))


if __name__ == "__main__":
    unittest.main()
