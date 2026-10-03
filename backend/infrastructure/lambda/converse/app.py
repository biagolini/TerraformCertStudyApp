"""Cert Study Assistant — Flask streaming app for Lambda Web Adapter.

Receives POST /converse, calls Bedrock converse_stream with the requested
model, and streams response tokens back via NDJSON chunks. The set of usable
models is discovered dynamically by the data Lambda (GET /data/models); here we
only validate the id format and rely on the scoped Bedrock IAM policy.
"""

import base64
import json
import os
import re
import time
import uuid

import boto3
from aws_xray_sdk.core import patch_all
from flask import Flask, Response, request

patch_all()

bedrock = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))
DEFAULT_MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0")

# --- Usage logging (Costs page — see lambda/data/app.py's GET /data/usage) ---
# Dedicated `costs` table, not `study-data` — see docs/dynamodb-schema.md and
# aws_dynamodb.tf's comment on why usage/budget data gets its own table.
COSTS_TABLE_NAME = os.environ.get("COSTS_TABLE_NAME", "")
dynamodb = boto3.resource("dynamodb") if COSTS_TABLE_NAME else None
usage_table = dynamodb.Table(COSTS_TABLE_NAME) if dynamodb else None
USAGE_TTL_SECONDS = 365 * 24 * 60 * 60


def _user_pk():
    """Same JWT-decode pattern as lambda/data/app.py's `_user_pk` — API
    Gateway's Cognito authorizer already validated this token, so no local
    signature check is needed here either."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = token.split(".")[1]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += "=" * padding
        decoded = json.loads(base64.b64decode(payload))
        sub = decoded.get("sub")
        return f"USER#{sub}" if sub else None
    except Exception:
        return None


def _write_usage_event(pk, action, model_id, usage, pack_id=None, pack_name=None, pack_version=None):
    """Best-effort — a usage-logging failure must never break the actual
    chat/translate/summary/etc. response the user is waiting on. pack_name/
    pack_version are snapshotted at call time (not just pack_id) so the
    Costs page can still show a real label after the pack itself is later
    deleted — DynamoDB has no cascading deletes, the row would otherwise be
    stuck with an unresolvable id forever."""
    if not usage_table or not usage or not pk:
        return
    now_ms = int(time.time() * 1000)
    data = {
        "action": action,
        "modelId": model_id,
        "inputTokens": usage.get("inputTokens", 0),
        "outputTokens": usage.get("outputTokens", 0),
        "totalTokens": usage.get("totalTokens", 0),
        "createdAt": now_ms,
    }
    if pack_id:
        data["packId"] = pack_id
    if pack_name:
        data["packName"] = pack_name
    if pack_version:
        data["packVersion"] = pack_version
    try:
        usage_table.put_item(Item={
            "pk": pk,
            "sk": f"USAGE#{now_ms}#{uuid.uuid4().hex[:8]}",
            "ttl": int(time.time()) + USAGE_TTL_SECONDS,
            "data": json.dumps(data),
        })
    except Exception:  # noqa: BLE001
        print(f"[usage-log-failed] action={action} model={model_id}")


# --- Monthly AI budget (Costs page — see lambda/data/app.py's GET/PUT
# /data/budget, _check_budget/_add_budget_spend for the full docs; this is a
# small duplicate, no shared Lambda layer in this project — see root
# CLAUDE.md) ---
MODEL_PRICING_PER_1K_USD = {
    "amazon.nova-micro-v1:0": {"input": 0.000035, "output": 0.00014},
    "amazon.nova-lite-v1:0": {"input": 0.00006, "output": 0.00024},
    "amazon.nova-pro-v1:0": {"input": 0.0008, "output": 0.0032},
    "amazon.nova-2-lite-v1:0": {"input": 0.00033, "output": 0.00275},
}
BUDGET_TTL_SECONDS = 400 * 24 * 60 * 60


def _usage_cost_usd(model_id, usage):
    base_id = re.sub(r"^(us|eu|apac)\.", "", model_id or "")
    price = MODEL_PRICING_PER_1K_USD.get(base_id)
    if not price or not usage:
        return None
    return (usage.get("inputTokens", 0) / 1000) * price["input"] + (usage.get("outputTokens", 0) / 1000) * price["output"]


def _current_month_key():
    return time.strftime("%Y-%m", time.gmtime())


def _check_budget(pk):
    """Returns None if the call may proceed, or a user-facing error message
    if the monthly AI budget has been reached. Fails open."""
    if not usage_table or not pk:
        return None
    try:
        config_item = usage_table.get_item(Key={"pk": pk, "sk": "BUDGET#CONFIG"}).get("Item")
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
        counter_item = usage_table.get_item(Key={"pk": pk, "sk": f"BUDGET#{_current_month_key()}"}).get("Item")
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
    if not usage_table or not pk or not cost_usd:
        return
    micros = int(round(cost_usd * 1_000_000))
    if micros <= 0:
        return
    try:
        usage_table.update_item(
            Key={"pk": pk, "sk": f"BUDGET#{_current_month_key()}"},
            UpdateExpression="ADD spentMicros :m SET #ttl = if_not_exists(#ttl, :ttl)",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={":m": micros, ":ttl": int(time.time()) + BUDGET_TTL_SECONDS},
        )
    except Exception:  # noqa: BLE001
        print("[budget-spend-update-failed]")


# Accept Bedrock model ids and inference-profile ids, e.g.:
#   amazon.nova-lite-v1:0
#   us.amazon.nova-2-lite-v1:0
# This guards against malformed/injection-style input; the IAM role is the
# real authorization boundary (scoped to bedrock foundation-models + profiles).
_MODEL_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9.\-:]{0,200}$")

# Model ids known to support the Converse reasoning capability (reasoningConfig).
# Kept in sync with the data Lambda. Extend as AWS adds Converse reasoning support.
REASONING_MODEL_PATTERNS = ("nova-2",)


def _supports_reasoning(model_id):
    return any(pattern in model_id for pattern in REASONING_MODEL_PATTERNS)


app = Flask(__name__)


@app.route("/converse", methods=["POST"])
def converse():
    """Stream Bedrock converse response as NDJSON."""
    body = request.get_json(force=True) or {}
    messages = body.get("messages", [])
    system_prompt = body.get("system_prompt", "")
    # max_tokens is optional. When omitted, Bedrock defaults to the maximum
    # allowed value for the model, so we let the model use its full capacity
    # unless the caller explicitly caps it.
    max_tokens = body.get("max_tokens")
    model_id = body.get("model_id") or DEFAULT_MODEL_ID
    action = body.get("action") or "unknown"
    pack_id = body.get("pack_id") or None
    pack_name = body.get("pack_name") or None
    pack_version = body.get("pack_version") or None
    # Resolved here, NOT inside generate() below: Flask only guarantees
    # `request` is valid for the duration of the view function itself — a
    # generator returned as a streaming Response is pulled lazily by the
    # WSGI server after this function returns, by which point the request
    # context is already torn down (`flask.stream_with_context` exists
    # specifically to work around this). Touching `request.headers` from
    # inside generate() silently raised RuntimeError, caught by generate()'s
    # own try/except and turned into a spurious trailing ERROR event —
    # which is why the very first usage rows never actually got logged.
    usage_pk = _user_pk()

    budget_error = _check_budget(usage_pk)
    if budget_error:
        return _error_response(budget_error, 402)

    if not messages:
        return _error_response("messages is required", 400)

    if not _MODEL_ID_RE.match(model_id):
        return _error_response(f"invalid model_id: {model_id}", 400)

    # Build converse params
    inference_config = {"temperature": 0.7}
    if max_tokens is not None:
        inference_config["maxTokens"] = max_tokens

    params = {
        "modelId": model_id,
        "messages": messages,
        "inferenceConfig": inference_config,
    }
    if system_prompt:
        params["system"] = [{"text": system_prompt}]

    # Enable extended reasoning for models that support it. "low" effort suits
    # the structured parsing/classification this app performs and keeps
    # temperature usable (only "high" forbids temperature/topP/topK).
    if _supports_reasoning(model_id):
        params["additionalModelRequestFields"] = {
            "reasoningConfig": {"type": "enabled", "maxReasoningEffort": "low"}
        }

    def generate():
        try:
            response = bedrock.converse_stream(**params)
            for event in response["stream"]:
                if "contentBlockDelta" in event:
                    delta = event["contentBlockDelta"]["delta"]
                    # Only emit answer text. Reasoning deltas arrive under
                    # "reasoningContent" and are intentionally not streamed.
                    if "text" in delta:
                        yield json.dumps({"type": "TOKEN", "text": delta["text"]}) + "\n"
                elif "messageStop" in event:
                    yield json.dumps({"type": "END", "stopReason": event["messageStop"].get("stopReason", "end_turn")}) + "\n"
                elif "metadata" in event:
                    usage = event["metadata"].get("usage", {})
                    yield json.dumps({"type": "METADATA", "usage": usage}) + "\n"
                    _write_usage_event(usage_pk, action, model_id, usage, pack_id, pack_name, pack_version)
                    _add_budget_spend(usage_pk, _usage_cost_usd(model_id, usage))
        except Exception as e:
            yield json.dumps({"type": "ERROR", "message": str(e)}) + "\n"

    return Response(generate(), mimetype="text/event-stream", headers={
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/", methods=["GET"])
def health():
    """Readiness check for Lambda Web Adapter."""
    return "OK"


def _error_response(message, status_code):
    return Response(
        json.dumps({"type": "ERROR", "message": message}) + "\n",
        status=status_code,
        mimetype="text/event-stream",
        headers={"Access-Control-Allow-Origin": "*"},
    )
