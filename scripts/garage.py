"""Local S3-compatible profile storage; credentials persist outside Git."""

import json
import os
from pathlib import Path
import secrets


def prepare_garage(root: Path, environment: dict[str, str]) -> bool:
    endpoint = "http://127.0.0.1:53900"
    if environment.get("AVATAR_S3_ENDPOINT", endpoint) != endpoint:
        return False
    directory = root / ".local"
    directory.mkdir(parents=True, exist_ok=True)
    credentials = directory / "garage-preview.json"
    if not credentials.exists():
        values = {
            "AVATAR_S3_ACCESS_KEY_ID": "GK" + secrets.token_hex(16),
            "AVATAR_S3_SECRET_ACCESS_KEY": secrets.token_hex(32),
            "GARAGE_RPC_SECRET": secrets.token_hex(32),
        }
        descriptor = os.open(credentials, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(values, stream, indent=2)
    values = json.loads(credentials.read_text())
    for key in ("AVATAR_S3_ACCESS_KEY_ID", "AVATAR_S3_SECRET_ACCESS_KEY"):
        environment.setdefault(key, values[key])
    environment.setdefault("AVATAR_S3_ENDPOINT", endpoint)
    environment.setdefault("AVATAR_S3_REGION", "garage")
    environment.setdefault("AVATAR_S3_BUCKET", "quorem-avatars")
    configuration = directory / "garage.toml"
    descriptor = os.open(configuration, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(
            'metadata_dir = "/var/lib/garage/meta"\n'
            'data_dir = "/var/lib/garage/data"\n'
            'db_engine = "sqlite"\n'
            'replication_factor = 1\n'
            'rpc_bind_addr = "127.0.0.1:3901"\n'
            'rpc_public_addr = "127.0.0.1:3901"\n'
            f'rpc_secret = "{values["GARAGE_RPC_SECRET"]}"\n'
            '\n[s3_api]\n'
            's3_region = "garage"\n'
            'api_bind_addr = "0.0.0.0:3900"\n'
        )
    return True
