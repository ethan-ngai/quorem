#!/usr/bin/env python3
"""Validate candidate JSON with Quorem's canonical publication validator."""
import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    subprocess.run(['node', '--experimental-strip-types', 'apps/api/src/cli/validate.ts',
                    str(args.directory.resolve())], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
