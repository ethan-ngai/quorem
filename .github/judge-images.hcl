group "default" {
  targets = ["judge"]
}

target "judge" {
  matrix = {
    language = ["python", "java", "typescript", "ocaml", "postgres"]
  }
  name       = "judge-${language}"
  context    = "."
  dockerfile = language == "python" ? "apps/runner/Dockerfile" : "apps/runner/Dockerfile.${language}"
  tags       = ["quorem-${language}:local"]
  cache-from = ["type=gha,scope=quorem-judge-${language}"]
  cache-to   = ["type=gha,scope=quorem-judge-${language},ignore-error=true,timeout=1m"]
}
