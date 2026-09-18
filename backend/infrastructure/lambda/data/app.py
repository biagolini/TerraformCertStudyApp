"""Cert Study Assistant — CRUD Lambda for DynamoDB user data."""

import base64
import json
import os
import re
import time
import uuid

import boto3
from boto3.dynamodb.conditions import Key
from botocore.client import Config
from flask import Flask, Response, request

TABLE_NAME = os.environ.get("TABLE_NAME", "cert-stud-data")
QUESTIONS_TABLE_NAME = os.environ.get("QUESTIONS_TABLE_NAME", "cert-stud-questions")
QUIZ_ATTEMPTS_TABLE_NAME = os.environ.get("QUIZ_ATTEMPTS_TABLE_NAME", "cert-stud-quiz-attempts")
IMPORT_DRAFTS_TABLE_NAME = os.environ.get("IMPORT_DRAFTS_TABLE_NAME", "cert-stud-import-drafts")
ASSETS_BUCKET_NAME = os.environ.get("ASSETS_BUCKET_NAME", "cert-stud-assets")
IMPORT_STATE_MACHINE_ARN = os.environ.get("IMPORT_STATE_MACHINE_ARN", "")
IMPORT_EXPLAIN_STATE_MACHINE_ARN = os.environ.get("IMPORT_EXPLAIN_STATE_MACHINE_ARN", "")
IMPORT_EXTRACT_LAMBDA_ARN = os.environ.get("IMPORT_EXTRACT_LAMBDA_ARN", "")
# Mirrors lambda/import_extract/app.py's own VALID_IMAGE_TARGETS — a manual
# draft edit must accept only the same classifications extraction itself
# can produce, see ImportDraftImage on the frontend.
VALID_IMAGE_TARGETS = {"stem", "alternativeText", "alternativeComment", "generalComment", "unplaced"}
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)  # settings, packs, scripts, chats, import jobs
questions_table = dynamodb.Table(QUESTIONS_TABLE_NAME)
quiz_attempts_table = dynamodb.Table(QUIZ_ATTEMPTS_TABLE_NAME)
import_drafts_table = dynamodb.Table(IMPORT_DRAFTS_TABLE_NAME)
lambda_client = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "us-east-1"))
# Boto3 defaults us-east-1 S3 presigned URLs to legacy SigV2 (which AWS has
# been shutting off — it now 403s), unless SigV4 is forced explicitly.
s3 = boto3.client(
    "s3",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
    config=Config(signature_version="s3v4"),
)
sfn = boto3.client("stepfunctions", region_name=os.environ.get("AWS_REGION", "us-east-1"))

# Bedrock control-plane client (model discovery — NOT the runtime client).
bedrock_ctl = boto3.client("bedrock", region_name=os.environ.get("AWS_REGION", "us-east-1"))

# Model IDs known to support the Converse reasoning capability (reasoningConfig).
# There is no API flag for this, so it is maintained explicitly. Extend as AWS
# adds Converse reasoning support to more models.
REASONING_MODEL_PATTERNS = ("nova-2",)

# In-memory cache for the usable-models list. Lambda reuses the execution
# environment across invocations, so this avoids calling the Bedrock
# control-plane on every request. The list changes very rarely.
_MODELS_TTL_SECONDS = 3600
_models_cache = {"ts": 0.0, "data": None}

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
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
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
