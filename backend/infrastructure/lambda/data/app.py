"""Cert Study Assistant — CRUD Lambda for DynamoDB user data."""

import base64
import json
import os
import time

import boto3
from boto3.dynamodb.conditions import Key
from flask import Flask, Response, request

TABLE_NAME = os.environ.get("TABLE_NAME", "cert-stud-data")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

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
        elif sk.startswith("QUESTION#"):
            result["questions"].append(data)
        elif sk.startswith("SCRIPT#"):
            result["scripts"].append(data)
        elif sk.startswith("CHAT#"):
            result["chats"].append(data)

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

        for q in body.get("questions", []):
            if q.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"QUESTION#{q['id']}", "data": json.dumps(q)})

        for s in body.get("scripts", []):
            if s.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"SCRIPT#{s['id']}", "data": json.dumps(s)})

        for c in body.get("chats", []):
            if c.get("id"):
                batch.put_item(Item={"pk": pk, "sk": f"CHAT#{c['id']}", "data": json.dumps(c)})

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
    table.put_item(Item={"pk": pk, "sk": f"QUESTION#{item_id}", "data": json.dumps(data)})
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


@app.route("/data/questions/<item_id>", methods=["DELETE"])
def delete_question(item_id):
    pk = _user_pk()
    if not pk:
        return _error("Unauthorized", 401)
    table.delete_item(Key={"pk": pk, "sk": f"QUESTION#{item_id}"})
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
