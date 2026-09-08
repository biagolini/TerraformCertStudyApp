"""Bulk exam import — Step Functions Task #3.

Runs once, after the extraction Map completes, and aggregates its per-item
results into the job's final status. Since it runs strictly after every
concurrent Map iteration has finished, a plain read-modify-write on the
`data` blob is safe here (no other writer racing on this item any more).
"""

import json
import os
import time

import boto3

TABLE_NAME = os.environ["TABLE_NAME"]
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def _normalize_failure(result):
    """A failed Map item is normally the clean shape import-extract itself
    returns ({index, status, error, preview}) — caught internally, never
    raised. The ASL Catch shape ({chunk: {index}, error: {Error, Cause}}) is
    only a backstop for infra-level failures (timeout, throttling exhausted)
    that Python can't catch, and needs separate handling here."""
    if not isinstance(result, dict):
        return {"index": None, "error": "Unknown failure", "preview": None}
    if "index" in result and "status" in result:
        return {
            "index": result.get("index"),
            "error": result.get("error", "Unknown error"),
            "preview": result.get("preview"),
        }
    chunk = result.get("chunk") or {}
    err = result.get("error") or {}
    return {
        "index": chunk.get("index"),
        "error": err.get("Cause") or err.get("Error") or "Unknown error",
        "preview": None,
    }


def handler(event, context):
    job_id = event["jobId"]
    sub = event["sub"]
    pk = f"USER#{sub}"
    results = event.get("results") or []

    total = len(results)
    is_succeeded = lambda r: isinstance(r, dict) and r.get("status") == "SUCCEEDED"  # noqa: E731
    succeeded = sum(1 for r in results if is_succeeded(r))
    failed = total - succeeded
    failures = sorted(
        (_normalize_failure(r) for r in results if not is_succeeded(r)),
        key=lambda f: (f["index"] is None, f["index"]),
    )

    if total == 0 or succeeded == 0:
        status = "FAILED"
    elif failed == 0:
        status = "SUCCEEDED"
    else:
        status = "PARTIAL"

    item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{job_id}"}).get("Item") or {}
    data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
    data["status"] = status
    data["completedAt"] = int(time.time() * 1000)
    data["failures"] = failures
    data["error"] = f"{failed} of {total} question(s) failed to extract." if failed > 0 else None

    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{job_id}",
        "data": json.dumps(data),
        "processedCount": item.get("processedCount", total),
        "failedCount": item.get("failedCount", failed),
    })
    return {"jobId": job_id, "status": status, "succeeded": succeeded, "failed": failed}
