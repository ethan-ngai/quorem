import datetime
import decimal
import json
import os
import subprocess
import sys
import time

import psycopg2
from psycopg2 import sql

BIN = "/usr/lib/postgresql/17/bin"
INPUT_TYPES = {name: name for name in ("integer", "bigint", "numeric", "text", "boolean", "date", "timestamp", "timestamptz")}
OUTPUT_TYPE_NAMES = {16: "boolean", 20: "bigint", 21: "integer", 23: "integer", 25: "text", 700: "real", 701: "double precision", 1042: "text", 1043: "text", 1082: "date", 1114: "timestamp", 1184: "timestamptz", 1700: "numeric"}
OUTPUT_TYPES = set(OUTPUT_TYPE_NAMES)


def encode(value):
    if isinstance(value, decimal.Decimal):
        return {"$numeric": str(value)}
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    raise TypeError("unsupported SQL output type")


def main():
    request = json.load(sys.stdin)
    setup = request["args"][0]
    schema = request.get("sql") or {}
    if schema.get("tables"):
        definitions = {table["name"]: table["columns"] for table in schema["tables"]}
        setup = {"tables": [{"name": table["name"], "columns": definitions[table["name"]], "rows": table["rows"]} for table in setup["tables"]]}
    subprocess.run([f"{BIN}/initdb", "-D", "/tmp/pgdata", "--no-locale", "--encoding=UTF8", "--auth=trust"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    server = subprocess.Popen([f"{BIN}/postgres", "-D", "/tmp/pgdata", "-k", "/tmp", "-c", "listen_addresses=", "-c", "timezone=UTC", "-c", "fsync=off", "-c", "shared_buffers=12MB", "-c", "max_connections=5"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                connection = psycopg2.connect(host="/tmp", dbname="postgres", user="nobody")
                break
            except psycopg2.OperationalError:
                if server.poll() is not None:
                    raise
                time.sleep(.05)
        else:
            raise RuntimeError("PostgreSQL startup failed")
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute("CREATE ROLE contestant LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT")
            cursor.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC")
            for table in setup["tables"]:
                columns = table["columns"]
                if any(column["type"] not in INPUT_TYPES for column in columns):
                    raise ValueError("invalid column type")
                definitions = [sql.SQL("{} {}").format(sql.Identifier(column["name"]), sql.SQL(INPUT_TYPES[column["type"]])) for column in columns]
                cursor.execute(sql.SQL("CREATE TABLE {} ({})").format(sql.Identifier(table["name"]), sql.SQL(", ").join(definitions)))
                query = sql.SQL("INSERT INTO {} VALUES ({})").format(sql.Identifier(table["name"]), sql.SQL(", ").join(sql.Placeholder() for _ in columns))
                for row in table["rows"]:
                    cursor.execute(query, row)
                cursor.execute(sql.SQL("GRANT SELECT ON {} TO contestant").format(sql.Identifier(table["name"])))
        connection.close()
        connection = psycopg2.connect(host="/tmp", dbname="postgres", user="contestant")
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute("BEGIN READ ONLY")
            sys.stdout.buffer.write(b"\0")
            sys.stdout.buffer.flush()
            try:
                cursor.execute(request["source"])
                if not cursor.description:
                    result = {"status": "invalid_output", "stderr": "The query must return at least one column."}
                elif any(column.type_code not in OUTPUT_TYPES for column in cursor.description):
                    result = {"status": "invalid_output", "stderr": "The query returned an unsupported column type. Return supported scalar values."}
                else:
                    columns = [column.name for column in cursor.description]
                    rows = cursor.fetchmany(10001)
                    rows = [[{"$bigint": str(value)} if isinstance(value, int) and not isinstance(value, bool) and (value > 2147483647 or value < -2147483648) else value for value in row] for row in rows]
                    result = {"status": "executed", "actual": {"columns": columns, "rows": rows}, "sqlTypes": [OUTPUT_TYPE_NAMES[column.type_code] for column in cursor.description]}
            except psycopg2.Error as error:
                message = (error.diag.message_primary or "The query could not be executed.")[:1024]
                result = {"status": "syntax_error" if error.pgcode == "42601" else "runtime_error", "stderr": message}
                position = error.diag.statement_position
                if position and position.isdigit():
                    result["line"] = request["source"][:max(0, int(position) - 1)].count("\n") + 1
            print(json.dumps(result, default=encode, allow_nan=False, separators=(",", ":")))
        connection.close()
    finally:
        server.terminate()
        server.wait(timeout=3)


if __name__ == "__main__":
    main()
