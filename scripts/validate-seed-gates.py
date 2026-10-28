"""Validate rollout dependencies before the deployment seed can write cases."""
import os


def validate(env):
    names = ("api_lossless_results", "api_lossless_cases", "judge_lossless_results",
             "judge_lossless_cases", "judge_resumable_execution")
    values = {}
    for name in names:
        value = env.get("TF_VAR_" + name, "false")
        if value not in ("true", "false"):
            raise ValueError("Rollout flags must be true or false")
        values[name] = value == "true"
    if values["judge_lossless_cases"] and not values["judge_lossless_results"]:
        raise ValueError("Lossless judge cases require lossless result writes")
    if values["api_lossless_cases"] and not all(values[name] for name in
            ("api_lossless_results", "judge_lossless_cases", "judge_lossless_results")):
        raise ValueError("Lossless API cases require lossless API results and capable judges")


if __name__ == "__main__":
    validate(os.environ)
