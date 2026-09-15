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
ASSETS_BUCKET_NAME = os.environ.get("ASSETS_BUCKET_NAME", "cert-stud-assets")
IMPORT_STATE_MACHINE_ARN = os.environ.get("IMPORT_STATE_MACHINE_ARN", "")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)  # settings, packs, scripts, chats, import jobs
questions_table = dynamodb.Table(QUESTIONS_TABLE_NAME)
quiz_attempts_table = dynamodb.Table(QUIZ_ATTEMPTS_TABLE_NAME)
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


@app.route("/data", methods=["GET"])
def get_all():
    """Return all user data grouped by entity type."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)

    resp = table.query(KeyConditionExpression=Key("pk").eq(pk))
    items = resp.get("Items", [])

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

    q_resp = questions_table.query(KeyConditionExpression=Key("pk").eq(pk))
    for item in q_resp.get("Items", []):
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

    job_id = str(uuid.uuid4())
    job = {
        "id": job_id,
        "packId": pack_id,
        "filename": filename,
        "status": "AWAITING_UPLOAD",
        "totalQuestions": None,
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
    if data.get("status") == "PROCESSING":
        return _error("Already processing", 409)

    body = request.get_json(silent=True) or {}
    model_id = (body.get("modelId") or "").strip()

    # Allow retrying a previously FAILED/PARTIAL job — reset the counters so
    # a retry doesn't inherit a stale processedCount/failedCount from before.
    data["status"] = "PROCESSING"
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


@app.route("/data/imports/<item_id>", methods=["DELETE"])
def delete_import(item_id):
    """Removes a job's history entry only — never touches the questions it
    already produced (those live independently in study-questions once
    extracted) or the permanent images/ prefix. uploads/ and scratch/ for
    the job expire on their own via the bucket's lifecycle rule."""
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    table.delete_item(Key={"pk": pk, "sk": f"IMPORTJOB#{item_id}"})
    return _json({"ok": True})


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
