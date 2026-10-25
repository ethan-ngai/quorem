#!/usr/bin/env bash
set -eu
main_revision="$(git ls-remote origin refs/heads/main | cut -f1)"
if [ "$main_revision" != "$GITHUB_SHA" ]; then
  echo "::error::Main advanced; deploy its current revision instead."
  exit 1
fi
