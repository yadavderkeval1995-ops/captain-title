import os
from functools import lru_cache

import boto3
from botocore.config import Config

APP_NAME = "captain-title"


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


@lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "s3",
        endpoint_url=_required("S3_ENDPOINT_URL"),
        aws_access_key_id=_required("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=_required("S3_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("S3_REGION", "auto"),
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 4, "mode": "standard"},
            connect_timeout=10,
            read_timeout=120,
        ),
    )


def _bucket() -> str:
    return _required("S3_BUCKET")


def init_storage(force: bool = False):
    if force:
        _client.cache_clear()
    _client().head_bucket(Bucket=_bucket())
    return True


def put_object(path: str, data: bytes, content_type: str):
    _client().put_object(
        Bucket=_bucket(),
        Key=path,
        Body=data,
        ContentType=content_type,
    )
    return {"path": path, "size": len(data)}


def get_object(path: str):
    response = _client().get_object(Bucket=_bucket(), Key=path)
    return response["Body"].read(), response.get("ContentType", "application/octet-stream")
