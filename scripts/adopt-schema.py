#!/usr/bin/env python3
"""Adopt the flattened baseline only when a local database's schema matches exactly."""

import argparse
import difflib
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit
import uuid


def run(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout


def schema_dump(url, schema):
    dump = run("pg_dump", url, "--schema-only", "--no-owner", "--no-privileges",
               f"--schema={schema}", f"--exclude-table={schema}.schema_migrations")
    # pg_dump adds a random psql restriction key and version-specific session settings.
    return re.sub(r"^--.*\n|^\\.*\n|^SET .*\n|^SELECT pg_catalog.set_config.*\n", "", dump, flags=re.M).strip()


def adopt(url, service):
    parsed = urlsplit(url)
    if parsed.scheme not in ("postgres", "postgresql") or parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("Baseline adoption requires an explicit loopback PostgreSQL URL")
    if parsed.path in ("", "/", "/postgres", "/template0", "/template1"):
        raise RuntimeError("Choose an application database")
    schema = "public" if service == "product" else "quorem_auth"
    owner = "api" if service == "product" else "auth"
    directory = Path(__file__).resolve().parents[1] / "apps" / owner / "migrations"
    temporary = "quorem_baseline_" + uuid.uuid4().hex
    reference = urlunsplit(parsed._replace(path="/" + temporary))
    run("createdb", f"--maintenance-db={url}", temporary)
    lock = None
    try:
        if service == "auth":
            run("psql", reference, "-Xq", "-v", "ON_ERROR_STOP=1", "-c", "CREATE SCHEMA quorem_auth")
        for migration in sorted(directory.glob("*.sql")):
            run("psql", reference, "-Xq", "-v", "ON_ERROR_STOP=1", "-f", str(migration))
        # Hold the same lock as startup while inspecting and changing only the ledger.
        lock = subprocess.Popen(["psql", url, "-XqAt", "-v", "ON_ERROR_STOP=1"],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        advisory = "740010" if service == "product" else "714901,1"
        lock.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock({advisory}); SELECT 'locked';\n")
        lock.stdin.flush()
        while lock.stdout.readline().strip() != "locked":
            if lock.poll() is not None:
                raise RuntimeError(lock.stderr.read().strip())
        actual, expected = schema_dump(url, schema), schema_dump(reference, schema)
        if actual != expected:
            diff = "\n".join(list(difflib.unified_diff(expected.splitlines(), actual.splitlines(),
                                                    fromfile="baseline", tofile="existing"))[:100])
            raise RuntimeError("Schema differs; database unchanged. Use a fresh database or review the difference:\n" + diff)
        values = ",".join("('" + path.name.replace("'", "''") + "')" for path in sorted(directory.glob("*.sql")))
        lock.stdin.write(f"CREATE TABLE IF NOT EXISTS {schema}.schema_migrations(name text PRIMARY KEY); "
                         f"DELETE FROM {schema}.schema_migrations; "
                         f"INSERT INTO {schema}.schema_migrations(name) VALUES {values}; COMMIT;\n")
        lock.stdin.close()
        if lock.wait():
            raise RuntimeError(lock.stderr.read().strip())
        print(f"{service}: schema matches; baseline ledger adopted, application data unchanged")
    finally:
        if lock and lock.poll() is None:
            lock.stdin.close()
            lock.wait()
        run("dropdb", f"--maintenance-db={url}", temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=("product", "auth"), required=True)
    parser.add_argument("--database-url", help="Defaults to DATABASE_URL or AUTH_DATABASE_URL")
    args = parser.parse_args()
    url = args.database_url or os.environ.get("DATABASE_URL" if args.service == "product" else "AUTH_DATABASE_URL")
    if not url:
        parser.error("Provide --database-url or the service's database environment variable")
    try:
        adopt(url, args.service)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
