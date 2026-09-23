"""Cert Study Assistant — CRUD Lambda for DynamoDB user data."""

import base64
import json
import os
import re
import time
import uuid

import boto3
from aws_xray_sdk.core import patch_all
from boto3.dynamodb.conditions import Key
from botocore.client import Config
from botocore.exceptions import ClientError
from flask import Flask, Response, request

patch_all()

TABLE_NAME = os.environ.get("TABLE_NAME", "cert-stud-data")
QUESTIONS_TABLE_NAME = os.environ.get("QUESTIONS_TABLE_NAME", "cert-stud-questions")
QUIZ_ATTEMPTS_TABLE_NAME = os.environ.get("QUIZ_ATTEMPTS_TABLE_NAME", "cert-stud-quiz-attempts")
IMPORT_DRAFTS_TABLE_NAME = os.environ.get("IMPORT_DRAFTS_TABLE_NAME", "cert-stud-import-drafts")
COSTS_TABLE_NAME = os.environ.get("COSTS_TABLE_NAME", "cert-stud-costs")
ASSETS_BUCKET_NAME = os.environ.get("ASSETS_BUCKET_NAME", "cert-stud-assets")
IMPORT_STATE_MACHINE_ARN = os.environ.get("IMPORT_STATE_MACHINE_ARN", "")
IMPORT_EXPLAIN_STATE_MACHINE_ARN = os.environ.get("IMPORT_EXPLAIN_STATE_MACHINE_ARN", "")
IMPORT_EXTRACT_LAMBDA_ARN = os.environ.get("IMPORT_EXTRACT_LAMBDA_ARN", "")
IMPORT_FINALIZE_LAMBDA_ARN = os.environ.get("IMPORT_FINALIZE_LAMBDA_ARN", "")
IMPORT_EXPLAIN_LOG_GROUP_NAME = os.environ.get("IMPORT_EXPLAIN_LOG_GROUP_NAME", "")
# Mirrors lambda/import_extract/app.py's own VALID_IMAGE_TARGETS — a manual
# draft edit must accept only the same classifications extraction itself
# can produce, see ImportDraftImage on the frontend.
VALID_IMAGE_TARGETS = {"stem", "alternativeText", "alternativeComment", "generalComment", "unplaced"}
# Mirrors lambda/import_extract/app.py's own IMPORT_DRAFT_TTL_SECONDS — a
# manually-added draft (create_draft) must expire on the same schedule as
# an extracted one.
IMPORT_DRAFT_TTL_SECONDS = 14 * 24 * 60 * 60
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)  # settings, packs, scripts, chats, import jobs
questions_table = dynamodb.Table(QUESTIONS_TABLE_NAME)
quiz_attempts_table = dynamodb.Table(QUIZ_ATTEMPTS_TABLE_NAME)
import_drafts_table = dynamodb.Table(IMPORT_DRAFTS_TABLE_NAME)
# Usage-log/budget rows — dedicated table, not `table` (study-data), so this
# app's own full-partition Query on login (get_all/_query_all_items) never
# has to scan a growing usage history. See docs/dynamodb-schema.md and
# aws_dynamodb.tf's comment on aws_dynamodb_table.costs.
costs_table = dynamodb.Table(COSTS_TABLE_NAME)
lambda_client = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "us-east-1"))
# Boto3 defaults us-east-1 S3 presigned URLs to legacy SigV2 (which AWS has
# been shutting off — it now 403s), unless SigV4 is forced explicitly.
s3 = boto3.client(
    "s3",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
    config=Config(signature_version="s3v4"),
)
sfn = boto3.client("stepfunctions", region_name=os.environ.get("AWS_REGION", "us-east-1"))
logs_client = boto3.client("logs", region_name=os.environ.get("AWS_REGION", "us-east-1"))

# Bedrock control-plane client (model discovery — NOT the runtime client).
bedrock_ctl = boto3.client("bedrock", region_name=os.environ.get("AWS_REGION", "us-east-1"))
# Bedrock runtime client — used only by generate_draft_title's single plain
# Converse call (no tool-use), a small enough ask that pulling in the
# structured-output/AgentCore machinery elsewhere in this pipeline would be
# overkill. A fixed, fast/cheap model — this is a one-line convenience
# feature, not something worth a user-facing model picker.
bedrock_runtime = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))
TITLE_MODEL_ID = "us.amazon.nova-lite-v1:0"

# Model IDs known to support the Converse reasoning capability (reasoningConfig).
# There is no API flag for this, so it is maintained explicitly. Extend as AWS
# adds Converse reasoning support to more models.
REASONING_MODEL_PATTERNS = ("nova-2",)

# In-memory cache for the usable-models list. Lambda reuses the execution
# environment across invocations, so this avoids calling the Bedrock
# control-plane on every request. The list changes very rarely.
_MODELS_TTL_SECONDS = 3600
_models_cache = {"ts": 0.0, "data": None}

# --- Costs page (GET /data/usage) — static on-demand pricing, USD per 1K
# tokens, looked up via the AWS Price List API (GetProducts, AmazonBedrock
# service code, us-east-1) for the models this app actually defaults to
# server-side (converse/app.py's MODEL_ID, review_agent's BEDROCK_MODEL_ID,
# import_extract's BEDROCK_EXTRACTION_MODEL_ID, this file's TITLE_MODEL_ID,
# review_agent's RELATED_SERVICES_MODEL_ID — all Amazon Nova). Bedrock
# doesn't expose per-call pricing via any API, and this account's live model
# catalog (GET /data/models, below) can include preview/internal models
# with no published on-demand price at all — a model missing here shows
# its real token counts with a null cost rather than a guessed number.
# Keyed by base model id (a cross-region inference-profile id like
# "us.amazon.nova-lite-v1:0" prices the same as "amazon.nova-lite-v1:0").
MODEL_PRICING_PER_1K_USD = {
    "amazon.nova-micro-v1:0": {"input": 0.000035, "output": 0.00014},
    "amazon.nova-lite-v1:0": {"input": 0.00006, "output": 0.00024},
    "amazon.nova-pro-v1:0": {"input": 0.0008, "output": 0.0032},
    "amazon.nova-2-lite-v1:0": {"input": 0.00033, "output": 0.00275},
}


def _model_price(model_id):
    base_id = re.sub(r"^(us|eu|apac)\.", "", model_id or "")
    return MODEL_PRICING_PER_1K_USD.get(base_id)


def _usage_cost_usd(model_id, input_tokens, output_tokens):
    price = _model_price(model_id)
    if not price:
        return None
    return round((input_tokens / 1000) * price["input"] + (output_tokens / 1000) * price["output"], 6)


USAGE_TTL_SECONDS = 365 * 24 * 60 * 60


def _write_usage_event(pk, action, model_id, usage, **extra):
    """Persists one AI-call token/usage record for the Costs page, into the
    dedicated `costs_table` — not `table` (study-data), see this file's
    COSTS_TABLE_NAME comment. Shared by this file's own AI call sites
    (generate_draft_title); converse/review/import_extract/import_explain
    each keep their own small copy of this same helper (no shared Lambda
    layer in this project — see root CLAUDE.md). Best-effort — a
    usage-logging failure must never break the actual feature."""
    if not pk or not usage or not model_id:
        return
    now_ms = int(time.time() * 1000)
    extra = {k: v for k, v in extra.items() if v is not None}
    try:
        costs_table.put_item(Item={
            "pk": pk,
            "sk": f"USAGE#{now_ms}#{uuid.uuid4().hex[:8]}",
            "ttl": int(time.time()) + USAGE_TTL_SECONDS,
            "data": json.dumps({
                "action": action,
                "modelId": model_id,
                "inputTokens": usage.get("inputTokens", 0),
                "outputTokens": usage.get("outputTokens", 0),
                "totalTokens": usage.get("totalTokens", 0),
                "createdAt": now_ms,
                **extra,
            }),
        })
    except Exception:  # noqa: BLE001
        print(f"[usage-log-failed] action={action} model={model_id}")


BUDGET_TTL_SECONDS = 400 * 24 * 60 * 60  # ~13 months — hygiene only, a past month's counter is never read again


def _current_month_key():
    return time.strftime("%Y-%m", time.gmtime())


def _check_budget(pk):
    """Returns None if the call may proceed, or a user-facing error message
    if the monthly AI budget has been reached. Fails open — a read failure,
    a never-configured budget, or a disabled budget must never themselves
    block a real feature. Shared by this file's own AI call site
    (generate_draft_title); converse/review/import_extract/import_explain
    each keep their own small copy (no shared Lambda layer — see root
    CLAUDE.md), same as _write_usage_event above."""
    if not pk:
        return None
    try:
        config_item = costs_table.get_item(Key={"pk": pk, "sk": "BUDGET#CONFIG"}).get("Item")
    except Exception:  # noqa: BLE001
        return None
    if not config_item:
        return None
    config = json.loads(config_item["data"]) if isinstance(config_item.get("data"), str) else config_item.get("data", {})
    if not config.get("enabled"):
        return None
    limit_usd = config.get("monthlyLimitUsd")
    if not limit_usd or limit_usd <= 0:
        return None
    try:
        counter_item = costs_table.get_item(Key={"pk": pk, "sk": f"BUDGET#{_current_month_key()}"}).get("Item")
    except Exception:  # noqa: BLE001
        return None
    spent_usd = int((counter_item or {}).get("spentMicros", 0)) / 1_000_000
    if spent_usd < limit_usd:
        return None
    return (
        f"Monthly AI budget of ${limit_usd:.2f} reached (${spent_usd:.2f} spent this month). "
        "Increase the limit or turn it off from the Costs page to continue."
    )


def _add_budget_spend(pk, cost_usd):
    """Best-effort atomic increment of this month's spend counter —
    `spentMicros` (cost * 1,000,000, integer) is a native top-level
    attribute, not inside the JSON `data` blob, same reasoning as
    IMPORTJOB#'s processedCount/failedCount: only a native attribute
    supports a genuinely atomic `ADD`, safe under concurrent calls, and
    integer micro-dollars avoid the rounding drift a float ADD would
    accumulate over many small increments. Never raises — a failure here
    must not undo or fail an AI call that already succeeded."""
    if not pk or not cost_usd:
        return
    micros = int(round(cost_usd * 1_000_000))
    if micros <= 0:
        return
    try:
        costs_table.update_item(
            Key={"pk": pk, "sk": f"BUDGET#{_current_month_key()}"},
            UpdateExpression="ADD spentMicros :m SET #ttl = if_not_exists(#ttl, :ttl)",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={":m": micros, ":ttl": int(time.time()) + BUDGET_TTL_SECONDS},
        )
    except Exception:  # noqa: BLE001
        print("[budget-spend-update-failed]")


app = Flask(__name__)


def _user_pk():
    """Extract userId from JWT token (already validated by API Gateway Cognito authorizer)."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        # Decode JWT payload (no verification needed — API Gateway already validated)
        payload = token.split(".")[1]
        # Add padding
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += "=" * padding
        decoded = json.loads(base64.b64decode(payload))
        sub = decoded.get("sub", "")
        if not sub:
            return None
        return f"USER#{sub}"
    except Exception:
        return None


def _json(data, status=200):
    return Response(json.dumps(data), status=status, mimetype="application/json",
                    headers={"Access-Control-Allow-Origin": "*"})


def _error(msg, status=400):
    return _json({"error": msg}, status)


def _query_all_items(dynamo_table, pk):
    """A DynamoDB Query only returns up to ~1MB per call — a single
    unpaginated query here silently truncated results once a user's total
    item size (packs/questions, each with full Markdown review text) grew
    past that, dropping whichever items sorted past the cutoff by sort key
    (observed directly: a freshly bulk-imported pack's 75 questions missing
    from GET /data while earlier-sorting packs were fine). Must loop on
    LastEvaluatedKey until the whole partition is read.
    """
    items = []
    kwargs = {"KeyConditionExpression": Key("pk").eq(pk)}
    while True:
        resp = dynamo_table.query(**kwargs)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            return items
        kwargs["ExclusiveStartKey"] = last_key


@app.route("/data", methods=["GET"])
def get_all():
    """Return all user data grouped by entity type."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    items = _query_all_items(table, pk)

    result = {"packs": [], "questions": [], "scripts": [], "chats": [], "settings": None}
    for item in items:
        sk = item["sk"]
        data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
        if sk == "SETTINGS":
            result["settings"] = data
        elif sk.startswith("PACK#"):
            result["packs"].append(data)
        elif sk.startswith("SCRIPT#"):
            result["scripts"].append(data)
        elif sk.startswith("CHAT#"):
            result["chats"].append(data)

    for item in _query_all_items(questions_table, pk):
        data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
        result["questions"].append(data)

    return _json(result)


@app.route("/data", methods=["PUT"])
def put_all():
    """Batch write all entities (used for sync/migration)."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    body = request.get_json(force=True) or {}

    with table.batch_writer() as batch:
        if body.get("settings"):
            batch.put_item(Item={"pk": pk, "sk": "SETTINGS", "data": json.dumps(body["settings"])})

        for pack in body.get("packs", []):
            if pack.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"PACK#{pack['id']}", "data": json.dumps(pack)})

        for s in body.get("scripts", []):
            if s.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"SCRIPT#{s['id']}", "data": json.dumps(s)})

        for c in body.get("chats", []):
            if c.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"CHAT#{c['id']}", "data": json.dumps(c)})

    with questions_table.batch_writer() as q_batch:
        for q in body.get("questions", []):
            if q.get("id"):
                q_batch.put_item(Item={"pk": pk, "sk": f"QUESTION#{q['id']}", "data": json.dumps(q)})

    return _json({"ok": True})


@app.route("/data/settings", methods=["PUT"])
def put_settings():
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    table.put_item(Item={"pk": pk, "sk": "SETTINGS", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/packs/<item_id>", methods=["PUT"])
def put_pack(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    data["id"] = item_id
    table.put_item(Item={"pk": pk, "sk": f"PACK#{item_id}", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/questions/<item_id>", methods=["PUT"])
def put_question(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    data["id"] = item_id
    questions_table.put_item(Item={"pk": pk, "sk": f"QUESTION#{item_id}", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/scripts/<item_id>", methods=["PUT"])
def put_script(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    data["id"] = item_id
    table.put_item(Item={"pk": pk, "sk": f"SCRIPT#{item_id}", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/chats/<item_id>", methods=["PUT"])
def put_chat(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    data["id"] = item_id
    table.put_item(Item={"pk": pk, "sk": f"CHAT#{item_id}", "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/packs/<item_id>", methods=["DELETE"])
def delete_pack(item_id):
    """Deleting a pack cascades to everything that only makes sense in the
    context of it — previously this deleted just the bare pack record,
    leaving its questions, their S3 images, its import job history, that
    history's draft rows and uploads/scratch S3 content, and its quiz
    attempts all permanently invisible (nothing in the UI can reach a
    question or job whose pack no longer exists) but still fully live and
    billable in DynamoDB/S3 forever. Reuses the same per-item cleanup
    delete_question/delete_import already use rather than duplicating it."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")

    # Questions belonging to this pack — no packId index, so a full
    # (paginated) scan of this user's own questions, filtered in Python.
    resp = questions_table.query(KeyConditionExpression=Key("pk").eq(pk))
    while True:
        for q_item in resp.get("Items", []):
            data = json.loads(q_item["data"]) if isinstance(q_item.get("data"), str) else q_item.get("data", {})
            if data.get("packId") != item_id:
                continue
            _delete_question_images(sub, data)
            questions_table.delete_item(Key={"pk": pk, "sk": q_item["sk"]})
        if "LastEvaluatedKey" not in resp:
            break
        resp = questions_table.query(
            KeyConditionExpression=Key("pk").eq(pk), ExclusiveStartKey=resp["LastEvaluatedKey"]
        )

    # Import jobs belonging to this pack, plus their drafts and S3 content
    # — same cleanup delete_import does for a single job.
    resp = table.query(KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with("IMPORTJOB#"))
    while True:
        for item in resp.get("Items", []):
            data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
            if data.get("packId") != item_id:
                continue
            job_id = item["sk"].removeprefix("IMPORTJOB#")
            _delete_job_drafts(pk, job_id)
            _delete_s3_prefix(f"uploads/{sub}/{job_id}/")
            _delete_s3_prefix(f"scratch/{job_id}/")
            table.delete_item(Key={"pk": pk, "sk": item["sk"]})
        if "LastEvaluatedKey" not in resp:
            break
        resp = table.query(
            KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with("IMPORTJOB#"),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )

    # Quiz attempt history for this pack — no longer actionable once the
    # pack (and its questions) are gone.
    resp = quiz_attempts_table.query(KeyConditionExpression=Key("pk").eq(pk))
    while True:
        for item in resp.get("Items", []):
            data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
            if data.get("packId") != item_id:
                continue
            quiz_attempts_table.delete_item(Key={"pk": pk, "sk": item["sk"]})
        if "LastEvaluatedKey" not in resp:
            break
        resp = quiz_attempts_table.query(
            KeyConditionExpression=Key("pk").eq(pk), ExclusiveStartKey=resp["LastEvaluatedKey"]
        )

    table.delete_item(Key={"pk": pk, "sk": f"PACK#{item_id}"})
    return _json({"ok": True})


QUESTION_IMAGE_REF_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def _question_image_keys(data):
    """Every `![alt](relativeKey)` reference across a question's stem and its
    alternatives' text/comment — validated the same way the presign GET
    endpoint validates a key, so a hand-edited question can never make this
    delete arbitrary S3 paths."""
    texts = [data.get("stem", "")]
    for alt in data.get("alternatives") or []:
        texts.append(alt.get("text", ""))
        texts.append(alt.get("comment", ""))
    keys = set()
    for text in texts:
        for ref in QUESTION_IMAGE_REF_RE.findall(text or ""):
            valid = _validate_image_relative_key(ref)
            if valid:
                keys.add(valid)
    return keys


def _delete_question_images(sub, data):
    """Best-effort — an image cleanup failure must never block the actual
    question delete the user asked for."""
    for key in _question_image_keys(data):
        try:
            s3.delete_object(Bucket=ASSETS_BUCKET_NAME, Key=f"images/{sub}/{key}")
        except Exception:
            pass


@app.route("/data/questions/<item_id>", methods=["DELETE"])
def delete_question(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")
    item = questions_table.get_item(Key={"pk": pk, "sk": f"QUESTION#{item_id}"}).get("Item")
    if item:
        data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
        _delete_question_images(sub, data)
    questions_table.delete_item(Key={"pk": pk, "sk": f"QUESTION#{item_id}"})
    return _json({"ok": True})


@app.route("/data/scripts/<item_id>", methods=["DELETE"])
def delete_script(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    table.delete_item(Key={"pk": pk, "sk": f"SCRIPT#{item_id}"})
    return _json({"ok": True})


@app.route("/data/chats/<item_id>", methods=["DELETE"])
def delete_chat(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    table.delete_item(Key={"pk": pk, "sk": f"CHAT#{item_id}"})
    return _json({"ok": True})


# ==========================================================================
# Quiz attempts — own table, sk embeds the exam slug for a fast prefix Query
# ==========================================================================


@app.route("/data/attempts/<item_id>", methods=["PUT"])
def put_attempt(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    data = request.get_json(force=True) or {}
    data["id"] = item_id
    exam_slug = data.get("examSlug") or "unknown"
    started_at = int(data.get("startedAt") or time.time() * 1000)
    sk = f"ATTEMPT#{exam_slug}#{started_at:013d}#{item_id}"
    quiz_attempts_table.put_item(Item={"pk": pk, "sk": sk, "data": json.dumps(data)})
    return _json({"ok": True})


@app.route("/data/attempts/<item_id>", methods=["DELETE"])
def delete_attempt(item_id):
    """Discards an in-progress (or finished) attempt. examSlug/startedAt are
    required query params — the sk embeds both, so a delete by id alone can't
    address the correct item without a preceding read. Mirrors put_attempt's sk
    construction exactly, but WITHOUT its startedAt fallback: a wrong/defaulted
    value here would reconstruct the wrong sk and silently delete nothing
    (delete_item on a missing key is a no-op, not an error), leaving the real
    item behind while looking like success to the caller."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    exam_slug = request.args.get("examSlug")
    started_at_raw = request.args.get("startedAt")
    if not exam_slug or not started_at_raw:
        return _error("examSlug and startedAt query params are required", 400)
    try:
        started_at = int(started_at_raw)
    except ValueError:
        return _error("startedAt must be an integer", 400)
    sk = f"ATTEMPT#{exam_slug}#{started_at:013d}#{item_id}"
    quiz_attempts_table.delete_item(Key={"pk": pk, "sk": sk})
    return _json({"ok": True})


@app.route("/data/attempts", methods=["GET"])
def get_attempts():
    """List the user's quiz attempts, most-recent first. Not part of GET /data —
    history can grow unbounded, unlike packs/scripts/settings, so it's only
    fetched when the History view actually opens."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    exam_slug = request.args.get("examSlug")
    prefix = f"ATTEMPT#{exam_slug}#" if exam_slug else "ATTEMPT#"
    resp = quiz_attempts_table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(prefix),
        ScanIndexForward=False,
    )
    items = resp.get("Items", [])
    attempts = [
        json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
        for item in items
    ]
    return _json({"attempts": attempts})


# ==========================================================================
# Costs page — per-user AI token/spend history
# ==========================================================================


@app.route("/data/usage", methods=["GET"])
def get_usage():
    """The Costs page's raw data source: every logged AI-call usage event,
    most-recent first, each priced against the current MODEL_PRICING_PER_1K_USD
    table — see this app's write side: _write_usage_event above, plus the
    small copies of that same helper in lambda/converse, lambda/review,
    lambda/import_extract and lambda/import_explain.

    Deliberately returns raw items only, no server-side grouping — the
    frontend fetches this once per page load and does ALL filtering
    (time-range) and grouping (by action/model/pack/pack+model) itself from
    that cached copy, so switching either one never re-hits this endpoint.
    Not part of GET /data for the same reason /data/attempts isn't — this
    history can grow (bounded by each row's own 365-day TTL, not by this
    endpoint)."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    resp = costs_table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with("USAGE#"),
        ScanIndexForward=False,
    )

    items = []
    total_cost_usd = 0.0
    total_tokens = 0
    any_priced = False

    for raw in resp.get("Items", []):
        entry = json.loads(raw["data"]) if isinstance(raw.get("data"), str) else raw.get("data", {})
        input_tokens = entry.get("inputTokens", 0)
        output_tokens = entry.get("outputTokens", 0)
        cost_usd = _usage_cost_usd(entry.get("modelId"), input_tokens, output_tokens)
        entry["costUsd"] = cost_usd
        items.append(entry)

        total_tokens += entry.get("totalTokens", input_tokens + output_tokens)
        if cost_usd is not None:
            total_cost_usd += cost_usd
            any_priced = True

    return _json({
        "items": items,
        "totals": {
            "totalCostUsd": round(total_cost_usd, 6) if any_priced else None,
            "totalTokens": total_tokens,
            "count": len(items),
        },
    })


@app.route("/data/budget", methods=["GET"])
def get_budget():
    """The Costs page's "Monthly budget" card — the config a user edits
    plus the running counter _check_budget/_add_budget_spend (above) use to
    enforce it. See docs on those functions for the item shapes."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    config_item = costs_table.get_item(Key={"pk": pk, "sk": "BUDGET#CONFIG"}).get("Item")
    config = (
        json.loads(config_item["data"]) if isinstance((config_item or {}).get("data"), str) else (config_item or {}).get("data", {})
    )
    month_key = _current_month_key()
    counter_item = costs_table.get_item(Key={"pk": pk, "sk": f"BUDGET#{month_key}"}).get("Item")
    spent_usd = int((counter_item or {}).get("spentMicros", 0)) / 1_000_000

    return _json({
        "enabled": bool(config.get("enabled")),
        "monthlyLimitUsd": config.get("monthlyLimitUsd"),
        "currentSpendUsd": round(spent_usd, 6),
        "month": month_key,
    })


@app.route("/data/budget", methods=["PUT"])
def put_budget():
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    body = request.get_json(force=True) or {}
    enabled = bool(body.get("enabled"))
    limit_raw = body.get("monthlyLimitUsd")

    if enabled:
        try:
            limit_usd = float(limit_raw)
        except (TypeError, ValueError):
            return _error("monthlyLimitUsd must be a positive number", 400)
        if limit_usd <= 0:
            return _error("monthlyLimitUsd must be a positive number", 400)
    else:
        # Disabling doesn't require a valid limit — keep whatever was there
        # (or None) so re-enabling later can still show the last value.
        try:
            limit_usd = float(limit_raw) if limit_raw is not None else None
        except (TypeError, ValueError):
            limit_usd = None

    costs_table.put_item(Item={
        "pk": pk,
        "sk": "BUDGET#CONFIG",
        "data": json.dumps({"enabled": enabled, "monthlyLimitUsd": limit_usd}),
    })
    return _json({"enabled": enabled, "monthlyLimitUsd": limit_usd})


# ==========================================================================
# Bulk exam import — job creation/status + presigned asset URLs
# ==========================================================================
# Uploading the raw file to the presigned URL below (not this endpoint)
# triggers the actual Step Functions import pipeline, via an S3 -> EventBridge
# rule on the assets bucket's `uploads/` prefix (see aws_eventbridge_import.tf).
# Job records share the general `table`, keyed like packs/settings/scripts —
# EXCEPT processedCount/failedCount, which live as native top-level DynamoDB
# attributes (not inside the `data` JSON blob) so the import-extract Lambda's
# concurrent Map iterations can increment them with a genuinely atomic `ADD`,
# which isn't possible on a value trapped inside an opaque JSON string.

IMPORT_FILE_EXTENSIONS = (".pdf", ".md", ".zip", ".html", ".htm")
SAFE_FILENAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
SAFE_KEY_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _safe_import_filename(raw_filename):
    """Basename-only, restricted charset, must end in an allowed extension."""
    name = os.path.basename(str(raw_filename or "")).strip()
    if not name or not SAFE_FILENAME_RE.fullmatch(name):
        return None
    if os.path.splitext(name)[1].lower() not in IMPORT_FILE_EXTENSIONS:
        return None
    return name


def _validate_image_relative_key(key):
    """Must be exactly 3 safe segments: `{jobId}/{questionId}/{filename}`.
    This value is client-supplied (either the presign GET's query param, or
    an image reference embedded in a possibly hand-edited question) and is
    always prefixed with the caller's own sub before it touches S3, so a
    forged key can only ever resolve under the caller's own prefix."""
    if not key:
        return None
    segments = key.split("/")
    if len(segments) != 3:
        return None
    if not all(SAFE_KEY_SEGMENT_RE.fullmatch(s) for s in segments):
        return None
    return key


@app.route("/data/imports", methods=["POST"])
def create_import():
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")

    body = request.get_json(force=True) or {}
    pack_id = body.get("packId")
    if not pack_id:
        return _error("packId is required", 400)
    if not table.get_item(Key={"pk": pk, "sk": f"PACK#{pack_id}"}).get("Item"):
        return _error("Pack not found", 400)

    filename = _safe_import_filename(body.get("filename"))
    if not filename:
        return _error("filename must end in .pdf, .md, or .zip", 400)

    # Soft hint only — shown back as a mismatch warning on the review
    # screen, never validated/enforced here or anywhere in the pipeline.
    expected_questions = body.get("expectedQuestions")
    if not isinstance(expected_questions, int) or expected_questions <= 0:
        expected_questions = None

    job_id = str(uuid.uuid4())
    job = {
        "id": job_id,
        "packId": pack_id,
        "filename": filename,
        "status": "AWAITING_UPLOAD",
        "totalQuestions": None,
        "expectedQuestions": expected_questions,
        "createdAt": int(time.time() * 1000),
        "completedAt": None,
        "error": None,
    }
    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{job_id}",
        "data": json.dumps(job),
        "processedCount": 0,
        "failedCount": 0,
    })

    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": ASSETS_BUCKET_NAME, "Key": f"uploads/{sub}/{job_id}/{filename}"},
        ExpiresIn=900,
    )
    return _json({"jobId": job_id, "uploadUrl": upload_url})


@app.route("/data/imports/<item_id>/confirm-upload", methods=["POST"])
def confirm_upload(item_id):
    """Called by the browser right after its presigned PUT resolves — the
    upload and the processing decision are deliberately separate steps, so
    a job sits at UPLOADED (not auto-queued) until the user picks it."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not item:
        return _error("Not found", 404)
    data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
    data["status"] = "UPLOADED"
    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{item_id}",
        "data": json.dumps(data),
        "processedCount": item.get("processedCount", 0),
        "failedCount": item.get("failedCount", 0),
    })
    return _json({"ok": True})


@app.route("/data/imports/<item_id>/process", methods=["POST"])
def process_import(item_id):
    """Explicitly starts the Step Functions extraction pipeline for one
    already-uploaded file. Never triggered automatically by the S3 upload
    itself — the user decides when (and whether) an uploaded file gets
    processed, possibly alongside other files uploaded earlier."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")
    if not IMPORT_STATE_MACHINE_ARN:
        return _error("Import pipeline is not configured", 500)

    item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not item:
        return _error("Not found", 404)
    data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
    if data.get("status") == "EXTRACTING":
        return _error("Already extracting", 409)

    body = request.get_json(silent=True) or {}
    model_id = (body.get("modelId") or "").strip()

    # Allow retrying a previously FAILED job — reset the counters so a retry
    # doesn't inherit a stale processedCount/failedCount from before.
    data["status"] = "EXTRACTING"
    data["totalQuestions"] = None
    data["completedAt"] = None
    data["error"] = None
    if model_id:
        data["modelId"] = model_id
    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{item_id}",
        "data": json.dumps(data),
        "processedCount": 0,
        "failedCount": 0,
    })

    # Mirrors the shape import-preprocess already expects (it used to come
    # straight from an S3 -> EventBridge event) so that Lambda needs no changes.
    sfn.start_execution(
        stateMachineArn=IMPORT_STATE_MACHINE_ARN,
        input=json.dumps({
            "detail": {
                "bucket": {"name": ASSETS_BUCKET_NAME},
                "object": {"key": f"uploads/{sub}/{item_id}/{data['filename']}"},
            }
        }),
    )
    return _json({"ok": True})


def _job_from_item(item):
    data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
    data["processedCount"] = int(item.get("processedCount", 0))
    data["failedCount"] = int(item.get("failedCount", 0))
    return data


@app.route("/data/imports/<item_id>", methods=["GET"])
def get_import(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not item:
        return _error("Not found", 404)
    return _json(_job_from_item(item))


@app.route("/data/imports/<item_id>", methods=["PUT"])
def update_import(item_id):
    """Edits a job's soft metadata before Phase 1 has run — currently just
    `expectedQuestions` (the user forgot to set it at upload time, or wants
    to correct it). Restricted to AWAITING_UPLOAD/UPLOADED: once extraction
    has started, totalQuestions already reflects the real chunk count and
    this hint's only job (a mismatch warning on the review screen) has
    already been served by whatever value was set before "Process"."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not item:
        return _error("Not found", 404)
    data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
    if data.get("status") not in ("AWAITING_UPLOAD", "UPLOADED"):
        return _error("Can only edit a job before it's processed", 409)

    body = request.get_json(force=True) or {}
    if "expectedQuestions" in body:
        expected = body.get("expectedQuestions")
        data["expectedQuestions"] = expected if isinstance(expected, int) and expected > 0 else None

    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{item_id}",
        "data": json.dumps(data),
        "processedCount": item.get("processedCount", 0),
        "failedCount": item.get("failedCount", 0),
    })
    return _json(_job_from_item({**item, "data": json.dumps(data)}))


@app.route("/data/imports/<item_id>", methods=["DELETE"])
def delete_import(item_id):
    """Removes a job's history entry, its draft rows, and its S3 scratch
    space — never touches the questions it already produced (those live
    independently in study-questions once explained) or the permanent
    images/ prefix those questions reference. uploads/ and scratch/ would
    eventually expire on their own via the bucket's lifecycle rule (14
    days — long enough for an unhurried review), and any remaining draft
    rows would too (TTL), but a user explicitly deleting a job wants that
    storage back immediately, not in two weeks — so this deletes both
    prefixes synchronously rather than waiting on lifecycle expiry."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")
    table.delete_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"})
    _delete_job_drafts(pk, item_id)
    _delete_s3_prefix(f"uploads/{sub}/{item_id}/")
    _delete_s3_prefix(f"scratch/{item_id}/")
    return _json({"ok": True})


@app.route("/data/imports/<item_id>/original-url", methods=["GET"])
def get_original_upload_url(item_id):
    """Presigned GET for the exact file the user uploaded for this job — a
    quick way to re-open it in another tab while reviewing, instead of
    hunting for it on their own machine again. Only works within the
    uploads/ prefix's 2-day lifecycle window (see aws_s3_assets.tf); past
    that the file is genuinely gone and this returns a clear error rather
    than a presigned URL that would 404 when actually opened."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")

    item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not item or "data" not in item:
        return _error("Job not found", 404)
    job = json.loads(item["data"])
    filename = job.get("filename")
    if not filename:
        return _error("Job has no associated file", 404)

    key = f"uploads/{sub}/{item_id}/{filename}"
    try:
        s3.head_object(Bucket=ASSETS_BUCKET_NAME, Key=key)
    except ClientError:
        return _error("The original file is no longer available — uploads are kept for 2 days", 404)

    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": ASSETS_BUCKET_NAME, "Key": key},
        ExpiresIn=300,
    )
    return _json({"url": url, "filename": filename})


def _delete_s3_prefix(prefix):
    """Deletes every object under an S3 prefix, paginating both the list
    and the delete (delete_objects caps at 1000 keys per call)."""
    continuation = None
    while True:
        kwargs = {"Bucket": ASSETS_BUCKET_NAME, "Prefix": prefix}
        if continuation:
            kwargs["ContinuationToken"] = continuation
        resp = s3.list_objects_v2(**kwargs)
        keys = [{"Key": obj["Key"]} for obj in resp.get("Contents", [])]
        if keys:
            s3.delete_objects(Bucket=ASSETS_BUCKET_NAME, Delete={"Objects": keys})
        if not resp.get("IsTruncated"):
            return
        continuation = resp.get("NextContinuationToken")


def _delete_job_drafts(pk, job_id):
    resp = import_drafts_table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(f"DRAFT#{job_id}#"),
        ProjectionExpression="sk",
    )
    with import_drafts_table.batch_writer() as batch:
        for item in resp.get("Items", []):
            batch.delete_item(Key={"pk": pk, "sk": item["sk"]})


@app.route("/data/imports", methods=["GET"])
def list_imports():
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    resp = table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with("IMPORTJOB#"),
    )
    jobs = [_job_from_item(item) for item in resp.get("Items", [])]
    jobs.sort(key=lambda j: j.get("createdAt", 0), reverse=True)
    return _json({"jobs": jobs})


@app.route("/data/imports/<item_id>/drafts", methods=["GET"])
def list_import_drafts(item_id):
    """Structure-only extraction results for one job, awaiting human review
    before Phase 2 (explanation generation) — see lambda/import_extract and
    lambda/import_explain."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    resp = import_drafts_table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(f"DRAFT#{item_id}#"),
    )
    drafts = [json.loads(item["data"]) for item in resp.get("Items", [])]
    drafts.sort(key=lambda d: d.get("index", 0))
    return _json({"drafts": drafts})


@app.route("/data/imports/<item_id>/drafts/<int:index>", methods=["PUT"])
def update_draft(item_id, index):
    """Directly overwrites one draft's content with what the reviewer typed
    — no AI call, for a quick correction (fix a typo, adjust an
    alternative's wording, flip which one is correct, add/remove an
    alternative, reassign or drop an image) that doesn't need a full
    re-extraction. The edit form round-trips the FULL draft (including
    sourceComment/sourceGeneralComment/images), so this route trusts the
    submitted body as the complete new state rather than merging against
    the old one. Same validation the extraction Lambda itself applies
    (non-empty stem, >=2 alternatives, >=1 marked correct) — a manual edit
    shouldn't be able to produce a draft the review screen would otherwise
    never let through. A previously-FAILED draft that now passes becomes
    SUCCEEDED and selectable, same as a successful re-extract."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sk = f"DRAFT#{item_id}#{index:04d}"
    draft_item = import_drafts_table.get_item(Key={"pk": pk, "sk": sk}).get("Item")
    if not draft_item:
        return _error("Draft not found", 404)
    draft = json.loads(draft_item["data"])

    body = request.get_json(force=True) or {}
    stem = (body.get("stem") or "").strip()
    alternatives = [
        {
            "letter": a.get("letter"),
            "text": (a.get("text") or "").strip(),
            "isCorrect": bool(a.get("isCorrect")),
            "sourceComment": (a.get("sourceComment") or "").strip() or None,
        }
        for a in (body.get("alternatives") or [])
        if isinstance(a, dict) and a.get("letter") and (a.get("text") or "").strip()
    ]
    if not stem:
        return _error("Stem cannot be empty", 400)
    if len(alternatives) < 2:
        return _error("Need at least 2 alternatives", 400)
    if not any(a["isCorrect"] for a in alternatives):
        return _error("Mark at least one alternative as correct", 400)

    valid_letters = {a["letter"] for a in alternatives}
    images = []
    for img in (body.get("images") or []):
        if not isinstance(img, dict) or not img.get("key"):
            continue
        target = img.get("target")
        if target not in VALID_IMAGE_TARGETS:
            target = "unplaced"
        alt_letter = img.get("alternativeLetter")
        if target not in ("alternativeText", "alternativeComment") or alt_letter not in valid_letters:
            alt_letter = None
        images.append({"key": img["key"], "target": target, "alternativeLetter": alt_letter})

    draft.update({
        "extractStatus": "SUCCEEDED",
        "title": (body.get("title") or "").strip() or draft.get("title") or "Imported question",
        "domain": (body.get("domain") or "").strip() or draft.get("domain"),
        "stem": stem,
        "alternatives": alternatives,
        "sourceGeneralComment": (body.get("sourceGeneralComment") or "").strip() or None,
        "images": images,
        "error": None,
        "updatedAt": int(time.time() * 1000),
    })
    import_drafts_table.put_item(Item={
        "pk": pk,
        "sk": sk,
        "ttl": draft_item.get("ttl"),
        "data": json.dumps(draft),
    })
    return _json({"draft": draft})


@app.route("/data/imports/<item_id>/drafts", methods=["POST"])
def create_draft(item_id):
    """Manually adds a brand-new, blank question to this job's review list
    — for something extraction missed entirely, not a correction to an
    existing one (that's update_draft). Starts out in the same
    FAILED-with-a-message shape a genuine extraction failure uses (see
    import_extract/app.py's validationError handling) purely so the review
    screen's existing "needs attention, click edit to fill in" treatment
    applies here for free — the reviewer clicks the pencil, fills in the
    stem/alternatives, and update_draft flips it to SUCCEEDED exactly like
    fixing any other failed extraction. Has no `chunk` (no source material
    to re-extract from) — see re_extract_draft's guard for that."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    job_item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not job_item or "data" not in job_item:
        return _error("Job not found", 404)
    job_data = json.loads(job_item["data"])

    resp = import_drafts_table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(f"DRAFT#{item_id}#"),
        ProjectionExpression="sk",
    )
    existing_indices = [int(i["sk"].rsplit("#", 1)[1]) for i in resp.get("Items", [])]
    next_index = (max(existing_indices) + 1) if existing_indices else 0

    now = int(time.time() * 1000)
    draft = {
        "jobId": item_id,
        "index": next_index,
        "packId": job_data.get("packId"),
        "extractStatus": "FAILED",
        "title": None,
        "domain": None,
        "stem": None,
        "alternatives": [],
        "sourceGeneralComment": None,
        "images": [],
        "error": "New question — click edit to fill in the details",
        "preview": None,
        "promoted": False,
        "reExtractCount": 0,
        "lastHint": None,
        "createdAt": now,
        "updatedAt": now,
    }
    import_drafts_table.put_item(Item={
        "pk": pk,
        "sk": f"DRAFT#{item_id}#{next_index:04d}",
        "ttl": int(time.time()) + IMPORT_DRAFT_TTL_SECONDS,
        "data": json.dumps(draft),
    })
    _adjust_total_questions(pk, item_id, delta=1)
    return _json({"draft": draft})


@app.route("/data/imports/<item_id>/drafts/<int:index>", methods=["DELETE"])
def delete_draft(item_id, index):
    """Removes one question from the review list entirely — for a
    duplicate, a source chunk that never should have been its own
    question, or anything else not worth fixing by hand. Indices are
    stable identifiers, not a dense array — deleting one never renumbers
    the others."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sk = f"DRAFT#{item_id}#{index:04d}"
    if not import_drafts_table.get_item(Key={"pk": pk, "sk": sk}).get("Item"):
        return _error("Draft not found", 404)
    import_drafts_table.delete_item(Key={"pk": pk, "sk": sk})
    _adjust_total_questions(pk, item_id, delta=-1)
    return _json({"ok": True})


def _adjust_total_questions(pk, job_id, delta):
    """Keeps the job's totalQuestions count in sync with manual add/delete
    on the review screen — otherwise the "Ready to review" list's "N
    extracted" badge and the expected-vs-found mismatch warning drift out
    of sync with what's actually there."""
    item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{job_id}"}).get("Item")
    if not item or "data" not in item:
        return
    data = json.loads(item["data"])
    if isinstance(data.get("totalQuestions"), int):
        data["totalQuestions"] = max(0, data["totalQuestions"] + delta)
    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{job_id}",
        "data": json.dumps(data),
        "processedCount": item.get("processedCount", 0),
        "failedCount": item.get("failedCount", 0),
    })


@app.route("/data/imports/<item_id>/drafts/<int:index>/generate-title", methods=["POST"])
def generate_draft_title(item_id, index):
    """Edit form's 'Generate title' button — many extracted questions have
    no usable title (the source material simply didn't have one, e.g. a
    plain numbered list of questions). Reads stem/alternatives from the
    REQUEST BODY, not the stored draft, so it reflects whatever the
    reviewer has typed in the edit form even before they hit Save. Never
    persists anything itself — the caller fills the title field and still
    has to click Save, same as typing one by hand."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    budget_error = _check_budget(pk)
    if budget_error:
        return _error(budget_error, 402)

    body = request.get_json(force=True) or {}
    stem = (body.get("stem") or "").strip()
    if not stem:
        return _error("Stem is required to generate a title", 400)
    alternatives = body.get("alternatives") or []
    correct = next(
        (a.get("text") for a in alternatives if isinstance(a, dict) and a.get("isCorrect") and a.get("text")),
        None,
    )

    user_text = f"Question:\n{stem}"
    if correct:
        user_text += f"\n\nCorrect answer: {correct}"

    try:
        response = bedrock_runtime.converse(
            modelId=TITLE_MODEL_ID,
            system=[{"text": (
                "Write a short, descriptive title (5-10 words) for this exam "
                "question — name the specific service/pattern/concept it "
                "tests, not a generic label like 'AWS Question'. Reply with "
                "ONLY the title text: no quotes, no trailing punctuation, no "
                "preamble."
            )}],
            messages=[{"role": "user", "content": [{"text": user_text}]}],
            inferenceConfig={"maxTokens": 60},
        )
        title = response["output"]["message"]["content"][0]["text"].strip().strip('"').strip()
        usage = response.get("usage") or {}
        _write_usage_event(pk, "titleGeneration", TITLE_MODEL_ID, usage, jobId=item_id)
        _add_budget_spend(pk, _usage_cost_usd(TITLE_MODEL_ID, usage.get("inputTokens", 0), usage.get("outputTokens", 0)))
    except Exception as e:  # noqa: BLE001 — surface as a normal error, not a 500
        return _error(f"Title generation failed: {e}", 502)

    if not title:
        return _error("Title generation returned nothing", 502)
    return _json({"title": title})


@app.route("/data/imports/<item_id>/drafts/<int:index>/re-extract", methods=["POST"])
def re_extract_draft(item_id, index):
    """Re-runs structure extraction for exactly one question, synchronously,
    reusing the Phase 1 Lambda directly rather than a one-off Step
    Functions execution — that Lambda is already a complete, self-contained
    single-chunk unit of work (see its own module docstring), so wrapping
    one invocation in a throwaway state machine execution would only add a
    second orchestration layer for no benefit. An optional `hint` (what the
    reviewer noticed was wrong) is threaded straight into the re-extraction
    prompt as an authoritative correction.

    Known accepted risk: API Gateway's REST integration timeout is a hard
    29s cap, and import-extract's own throttling backoff can in the worst
    case approach that under heavy concurrent load. A lone re-extract call
    has nothing to compete with, so this is unlikely in practice — flagged
    here rather than silently ignored."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")
    if not IMPORT_EXTRACT_LAMBDA_ARN:
        return _error("Import pipeline is not configured", 500)

    job_item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not job_item:
        return _error("Job not found", 404)
    job_data = json.loads(job_item["data"]) if isinstance(job_item.get("data"), str) else job_item.get("data", {})

    sk = f"DRAFT#{item_id}#{index:04d}"
    draft_item = import_drafts_table.get_item(Key={"pk": pk, "sk": sk}).get("Item")
    if not draft_item:
        return _error("Draft not found", 404)
    draft_data = json.loads(draft_item["data"])
    if not draft_data.get("chunk"):
        # A manually-added question (create_draft) has no source chunk to
        # re-run extraction against — edit it by hand instead.
        return _error("This question was added manually and has no source material to re-extract from", 400)

    body = request.get_json(silent=True) or {}
    hint = (body.get("hint") or "").strip() or None

    payload = {
        "chunk": draft_data["chunk"],
        "jobId": item_id,
        "sub": sub,
        "packId": job_data.get("packId"),
        "modelId": job_data.get("modelId"),
        "hint": hint,
    }
    response = lambda_client.invoke(
        FunctionName=IMPORT_EXTRACT_LAMBDA_ARN,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode("utf-8"),
    )
    if response.get("FunctionError"):
        return _error("Re-extract failed unexpectedly — see import-extract Lambda logs", 500)

    # import-extract writes the draft itself (success or failure) — re-read
    # rather than trust the invoke response, which is just {index, status}.
    updated_item = import_drafts_table.get_item(Key={"pk": pk, "sk": sk}).get("Item")
    if not updated_item:
        return _error("Re-extract did not produce a draft", 500)
    return _json({"draft": json.loads(updated_item["data"])})


@app.route("/data/imports/<item_id>/drafts/<int:index>/logs", methods=["GET"])
def get_draft_logs(item_id, index):
    """Real CloudWatch logs for the specific import-explain invocation that
    failed on this draft — surfaced next to a failed "Refine extraction
    with AI" result so a bad run can be diagnosed without leaving the app.
    `requestId` isn't on the draft itself — a failed explain call never
    updates its draft (see lambda/import_explain/app.py, which only writes
    the draft on success) — it's recorded on the JOB's `failures` list by
    lambda/import_finalize/app.py's _normalize_failure. A draft with no
    matching failure entry (never ran Phase 2, or succeeded) returns an
    empty result rather than an error."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    if not IMPORT_EXPLAIN_LOG_GROUP_NAME:
        return _error("Logs are not configured", 500)

    job_item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not job_item:
        return _error("Job not found", 404)
    job_data = json.loads(job_item["data"]) if isinstance(job_item.get("data"), str) else job_item.get("data", {})
    failure = next((f for f in (job_data.get("failures") or []) if f.get("index") == index), None)
    request_id = failure.get("requestId") if failure else None
    if not request_id:
        return _json({"requestId": None, "events": []})

    resp = logs_client.filter_log_events(
        logGroupName=IMPORT_EXPLAIN_LOG_GROUP_NAME,
        filterPattern=f'"{request_id}"',
        limit=200,
    )
    events = [
        {"timestamp": e["timestamp"], "message": e["message"]}
        for e in resp.get("events", [])
    ]
    return _json({"requestId": request_id, "events": events})


@app.route("/data/imports/<item_id>/generate-explanations", methods=["POST"])
def generate_explanations(item_id):
    """Starts Phase 2 (explanation generation) for a set of approved
    drafts. Never triggered automatically — the user decides which
    reviewed questions to send, exactly like `process_import` starting
    Phase 1. `draftIndices` omitted means "all of them": the frontend's
    "select all" + "process selected" and a literal "process all" collapse
    to the same call either way, since the server-side default is already
    every successfully-extracted, not-yet-promoted draft for this job."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")
    if not IMPORT_EXPLAIN_STATE_MACHINE_ARN:
        return _error("Import pipeline is not configured", 500)

    job_item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not job_item:
        return _error("Job not found", 404)
    job_data = json.loads(job_item["data"]) if isinstance(job_item.get("data"), str) else job_item.get("data", {})
    if job_data.get("status") == "GENERATING":
        return _error("Already generating", 409)

    resp = import_drafts_table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(f"DRAFT#{item_id}#"),
    )
    drafts_by_index = {}
    for item in resp.get("Items", []):
        d = json.loads(item["data"])
        drafts_by_index[d["index"]] = d

    body = request.get_json(silent=True) or {}
    requested = body.get("draftIndices")
    if requested is None:
        # Default: every successfully-extracted, not-yet-promoted draft.
        indices = [i for i, d in drafts_by_index.items() if d.get("extractStatus") == "SUCCEEDED" and not d.get("promoted")]
    else:
        # Defensive filter — never queue an index that doesn't belong to
        # this job or didn't extract successfully, regardless of what the
        # client sent.
        indices = [
            i for i in requested
            if i in drafts_by_index and drafts_by_index[i].get("extractStatus") == "SUCCEEDED"
        ]
    if not indices:
        return _error("No approved questions to process", 400)
    indices.sort()

    job_data["status"] = "GENERATING"
    job_data["explainTotal"] = len(indices)
    job_data["completedAt"] = None
    job_data["error"] = None
    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{item_id}",
        "data": json.dumps(job_data),
        "processedCount": 0,
        "failedCount": 0,
    })

    sfn.start_execution(
        stateMachineArn=IMPORT_EXPLAIN_STATE_MACHINE_ARN,
        input=json.dumps({
            "jobId": item_id,
            "sub": sub,
            "packId": job_data.get("packId"),
            "draftIndices": indices,
        }),
    )
    return _json({"ok": True, "queued": len(indices)})


def _images_for(images, target, alternative_letter=None):
    """Mirrors lambda/import_explain/app.py's own helper of the same name
    — kept as a small duplicate rather than a shared module, same
    reasoning as that file's docstring (no shared-layer mechanism exists
    in this repo, and ~15 lines of duplication beats inventing one)."""
    return [
        img["key"]
        for img in images
        if img.get("target") == target
        and (alternative_letter is None or img.get("alternativeLetter") == alternative_letter)
    ]


def _append_images(text, image_keys):
    if not image_keys:
        return text
    markdown = "\n\n".join(f"![diagram]({key})" for key in image_keys)
    return f"{text}\n\n{markdown}" if text else markdown


@app.route("/data/imports/<item_id>/save-as-is", methods=["POST"])
def save_drafts_as_is(item_id):
    """Bulk-finalizes every pending, successfully-extracted draft directly
    into its final Question — no AI call at all. Each alternative's final
    `comment` (and the question's `generalComment`) is exactly the raw
    sourceComment/sourceGeneralComment text captured during extraction,
    verbatim — the fast alternative to 'Refine extraction with AI'
    (generate_explanations) for a job whose source material was already
    good enough on its own, not a replacement for it. Synchronous — unlike
    Phase 2's AgentCore calls, nothing here is slow enough to need Step
    Functions; reuses import-finalize's own status decision afterward
    (AWAITING_REVIEW/SUCCEEDED/PARTIAL/FAILED, see its module docstring)
    rather than duplicating that logic here."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")

    job_item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"}).get("Item")
    if not job_item or "data" not in job_item:
        return _error("Job not found", 404)
    job_data = json.loads(job_item["data"])
    pack_id = job_data.get("packId")

    resp = import_drafts_table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(f"DRAFT#{item_id}#"),
    )
    now = int(time.time() * 1000)
    saved = 0
    for item in resp.get("Items", []):
        draft = json.loads(item["data"])
        if draft.get("promoted") or draft.get("extractStatus") != "SUCCEEDED":
            continue

        images = draft.get("images") or []
        question_id = f"{item_id}-{draft['index']:03d}"
        alternatives = [
            {
                "letter": alt.get("letter"),
                "text": _append_images(alt.get("text") or "", _images_for(images, "alternativeText", alt.get("letter"))),
                "isCorrect": bool(alt.get("isCorrect")),
                "comment": _append_images(
                    alt.get("sourceComment") or "",
                    _images_for(images, "alternativeComment", alt.get("letter")),
                ),
            }
            for alt in (draft.get("alternatives") or [])
        ]
        question = {
            "id": question_id,
            "packId": pack_id,
            "title": draft.get("title") or "Imported question",
            "domain": draft.get("domain") or "General",
            "language": draft.get("language") or "en",
            "stem": _append_images(draft.get("stem") or "", _images_for(images, "stem")),
            "alternatives": alternatives,
            "metadata": {"topics": [], "relatedServices": []},
            "starred": False,
            "createdAt": now,
            "updatedAt": now,
        }
        general_comment = _append_images(
            draft.get("sourceGeneralComment") or "", _images_for(images, "generalComment")
        )
        if general_comment:
            question["generalComment"] = general_comment

        questions_table.put_item(Item={"pk": pk, "sk": f"QUESTION#{question_id}", "data": json.dumps(question)})

        draft["promoted"] = True
        draft["updatedAt"] = now
        import_drafts_table.put_item(Item={
            "pk": pk,
            "sk": item["sk"],
            "ttl": item.get("ttl"),
            "data": json.dumps(draft),
        })
        saved += 1

    if saved > 0 and IMPORT_FINALIZE_LAMBDA_ARN:
        lambda_client.invoke(
            FunctionName=IMPORT_FINALIZE_LAMBDA_ARN,
            InvocationType="RequestResponse",
            Payload=json.dumps({
                "jobId": item_id,
                "sub": sub,
                "phase": "explain",
                "results": [{"index": None, "status": "SUCCEEDED"}] * saved,
            }).encode("utf-8"),
        )
    return _json({"ok": True, "saved": saved})


@app.route("/data/assets/presign", methods=["GET"])
def presign_asset():
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")

    relative_key = _validate_image_relative_key(request.args.get("key", ""))
    if not relative_key:
        return _error("Invalid key", 400)

    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": ASSETS_BUCKET_NAME, "Key": f"images/{sub}/{relative_key}"},
        ExpiresIn=300,
    )
    return _json({"url": url})


MANUAL_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp")


def _safe_image_filename(raw_filename):
    """Basename-only, restricted charset, must end in a supported image
    extension — mirrors `_safe_import_filename` but for a single hand-picked
    image rather than a whole exam file."""
    name = os.path.basename(str(raw_filename or "")).strip()
    if not name or not SAFE_FILENAME_RE.fullmatch(name):
        return None
    if os.path.splitext(name)[1].lower() not in MANUAL_IMAGE_EXTENSIONS:
        return None
    return name


@app.route("/data/assets/upload", methods=["POST"])
def create_manual_image_upload():
    """Presigned PUT for a single image the user attaches by hand while
    writing or editing a question (Add ready-made / edit mode) — distinct
    from the bulk-import pipeline's own per-job image promotion. Mints its
    own id to stand in for both the `jobId` and `questionId` path segments
    `_validate_image_relative_key` expects, since a hand-added image isn't
    tied to any import job and the question itself may not be saved yet."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    sub = pk.removeprefix("USER#")

    body = request.get_json(force=True) or {}
    filename = _safe_image_filename(body.get("filename"))
    if not filename:
        return _error("filename must be a .png, .jpg, .jpeg, .gif, or .webp file", 400)

    image_id = str(uuid.uuid4())
    relative_key = f"{image_id}/{image_id}/{filename}"
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": ASSETS_BUCKET_NAME, "Key": f"images/{sub}/{relative_key}"},
        ExpiresIn=900,
    )
    return _json({"relativeKey": relative_key, "uploadUrl": upload_url})


# ==========================================================================
# Model discovery — list Bedrock models usable by this app
# ==========================================================================


def _supports_reasoning(model_id):
    """Whether a model id supports the Converse reasoning capability."""
    return any(pattern in model_id for pattern in REASONING_MODEL_PATTERNS)


def _model_id_from_arn(arn):
    """Extract the base foundation-model id from a model ARN."""
    return arn.split("/")[-1] if arn else ""


def _is_text_streaming(meta):
    """True if a foundation-model summary is a text-in/text-out streaming model that is active."""
    if not meta:
        return False
    return (
        meta.get("responseStreamingSupported", False)
        and "TEXT" in meta.get("outputModalities", [])
        and "TEXT" in meta.get("inputModalities", [])
        and meta.get("modelLifecycle", {}).get("status") == "ACTIVE"
    )


def _list_usable_models():
    """Build the list of models usable with converse_stream for this app.

    Combines foundation models (text output) with system-defined inference
    profiles (the invokable ids for models that require cross-region inference,
    e.g. Amazon Nova 2). Profiles are preferred over the base model id when both
    exist for the same underlying model.
    """
    # 1. Foundation models with TEXT output, indexed by base model id.
    fm_resp = bedrock_ctl.list_foundation_models(byOutputModality="TEXT")
    by_id = {m["modelId"]: m for m in fm_resp.get("modelSummaries", [])}

    results = {}  # keyed by underlying base model id, to deduplicate

    # 2. System-defined inference profiles (paginated).
    next_token = None
    profiles = []
    while True:
        kwargs = {"typeEquals": "SYSTEM_DEFINED", "maxResults": 1000}
        if next_token:
            kwargs["nextToken"] = next_token
        resp = bedrock_ctl.list_inference_profiles(**kwargs)
        profiles.extend(resp.get("inferenceProfileSummaries", []))
        next_token = resp.get("nextToken")
        if not next_token:
            break

    for profile in profiles:
        if profile.get("status") != "ACTIVE":
            continue
        models = profile.get("models", [])
        if not models:
            continue
        base_id = _model_id_from_arn(models[0].get("modelArn", ""))
        meta = by_id.get(base_id)
        if not _is_text_streaming(meta):
            continue
        results[base_id] = {
            "id": profile["inferenceProfileId"],
            "name": meta.get("modelName", profile.get("inferenceProfileName", base_id)),
            "provider": meta.get("providerName", ""),
            "reasoning": _supports_reasoning(base_id),
        }

    # 3. Foundation models invokable directly on-demand, not already covered.
    for model_id, meta in by_id.items():
        if model_id in results:
            continue
        if "ON_DEMAND" not in meta.get("inferenceTypesSupported", []):
            continue
        if not _is_text_streaming(meta):
            continue
        results[model_id] = {
            "id": model_id,
            "name": meta.get("modelName", model_id),
            "provider": meta.get("providerName", ""),
            "reasoning": _supports_reasoning(model_id),
        }

    models_list = list(results.values())
    models_list.sort(key=lambda x: (x["provider"], x["name"]))
    return models_list


def _get_models_cached():
    now = time.time()
    if _models_cache["data"] is not None and (now - _models_cache["ts"]) < _MODELS_TTL_SECONDS:
        return _models_cache["data"]
    data = _list_usable_models()
    _models_cache["data"] = data
    _models_cache["ts"] = now
    return data


@app.route("/data/models", methods=["GET"])
def get_models():
    """Return the list of Bedrock models usable by this app."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    try:
        return _json({"models": _get_models_cached()})
    except Exception as e:  # noqa: BLE001 — surface a clean error to the client
        return _error(f"Failed to list models: {e}", 500)


@app.route("/", methods=["GET"])
def health():
    return "OK"
