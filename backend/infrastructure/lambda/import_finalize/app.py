"""Bulk exam import — Finalize, shared by both pipeline phases.

Runs once, after either phase's Map completes, and aggregates its per-item
results into the job's status. Since it runs strictly after every concurrent
Map iteration has finished, a plain read-modify-write on the `data` blob is
safe here (no other writer racing on this item any more). The aggregation
logic (succeeded/failed counts, failures list) is identical between phases
— only the STATUS VOCABULARY differs, selected by `event["phase"]`:
  - "extract" (Phase 1, structure only): lands on AWAITING_REVIEW (drafts
    exist, waiting on a human) instead of SUCCEEDED/PARTIAL, or FAILED if
    every chunk failed outright.
  - "explain" (Phase 2, default — the only phase that existed before this
    split): SUCCEEDED/PARTIAL/FAILED, EXCEPT this batch is never the whole
    story — the user can submit fewer than every approved draft on purpose
    (a deliberate partial submission, "Process selected" instead of
    "Process all"), and a failed explanation leaves its draft unpromoted
    exactly like an unsubmitted one. Either way there's still actionable
    work waiting on the review screen, so status stays AWAITING_REVIEW
    whenever ANY successfully-extracted draft for this job is still
    unpromoted — regardless of whether THIS batch itself was clean. Without
    this check, submitting 6 of 7 approved drafts and having all 6 succeed
    would land the job on SUCCEEDED — indistinguishable from "fully done"
    — leaving the 7th silently unreachable through the UI even though its
    draft still exists.
"""

import json
import os
import time

import boto3
from aws_xray_sdk.core import patch_all
from boto3.dynamodb.conditions import Key

patch_all()

TABLE_NAME = os.environ["TABLE_NAME"]
IMPORT_DRAFTS_TABLE_NAME = os.environ["IMPORT_DRAFTS_TABLE_NAME"]
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
import_drafts_table = dynamodb.Table(IMPORT_DRAFTS_TABLE_NAME)


def _count_remaining(pk, job_id):
    """How many successfully-extracted drafts for this job are still
    unpromoted — covers both "not yet submitted to Phase 2" and "submitted
    but explanation generation failed," since both leave promoted=False."""
    resp = import_drafts_table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(f"DRAFT#{job_id}#"),
    )
    count = 0
    for item in resp.get("Items", []):
        d = json.loads(item["data"])
        if d.get("extractStatus") == "SUCCEEDED" and not d.get("promoted"):
            count += 1
    return count


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
            "requestId": result.get("requestId"),
        }
    chunk = result.get("chunk") or {}
    err = result.get("error") or {}
    return {
        "index": chunk.get("index"),
        "error": err.get("Cause") or err.get("Error") or "Unknown error",
        "preview": None,
        "requestId": None,
    }


def handler(event, context):
    job_id = event["jobId"]
    sub = event["sub"]
    phase = event.get("phase", "explain")
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

    if phase == "extract":
        # At least one draft exists — hand off to the human reviewer even
        # if some chunks failed; the review screen is where those get fixed
        # (via re-extract), not a separate Phase-1 retry.
        status = "AWAITING_REVIEW" if succeeded > 0 else "FAILED"
    elif _count_remaining(pk, job_id) > 0:
        status = "AWAITING_REVIEW"
    elif total == 0 or succeeded == 0:
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
    action = "extract" if phase == "extract" else "generate an explanation for"
    data["error"] = f"{failed} of {total} question(s) failed to {action}." if failed > 0 else None

    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{job_id}",
        "data": json.dumps(data),
        "processedCount": item.get("processedCount", total),
        "failedCount": item.get("failedCount", failed),
    })
    return {"jobId": job_id, "status": status, "succeeded": succeeded, "failed": failed}
