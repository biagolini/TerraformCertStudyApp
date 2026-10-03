"""Cert Study Assistant — Flask streaming app for Lambda Web Adapter.

Receives POST /review from the frontend (question-input "Generate with AI",
review-viewer "Refine with AI"), invokes the AgentCore Runtime review agent
(see backend/infrastructure/agent/review_agent/), and relays its SSE
response back to the browser as NDJSON — the agent already yields
{"type": "TOKEN"/"END"/"ERROR", ...} events (see review_agent/app.py), so
this Lambda's only job is decoding the "data: " SSE framing and re-emitting
those same JSON objects one per line, exactly the envelope
core/services/bedrock.service.ts already parses for /converse.
"""

import base64
import json
import os
import re
import time
import uuid

import boto3
from aws_xray_sdk.core import patch_all, xray_recorder
from botocore.config import Config
from flask import Flask, Response, request

patch_all()

# --- Usage logging (Costs page — see lambda/data/app.py's GET /data/usage) ---
# Dedicated `costs` table, not `study-data` — see docs/dynamodb-schema.md and
# aws_dynamodb.tf's comment on why usage/budget data gets its own table.
COSTS_TABLE_NAME = os.environ.get("COSTS_TABLE_NAME", "")
dynamodb = boto3.resource("dynamodb") if COSTS_TABLE_NAME else None
usage_table = dynamodb.Table(COSTS_TABLE_NAME) if dynamodb else None
USAGE_TTL_SECONDS = 365 * 24 * 60 * 60


def _user_pk():
    """Same JWT-decode pattern as lambda/data/app.py's `_user_pk`."""
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
    """Best-effort — a usage-logging failure must never break the review
    the user is waiting on. pack_name/pack_version are snapshotted at call
    time so the Costs page still shows a real label after the pack is later
    deleted — see converse/app.py's identical comment."""
    if not usage_table or not usage or not model_id or not pk:
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


# boto3's default read_timeout (60s) applies to any gap between received
# chunks, not just total call duration — normally fine for the streaming
# path (tokens keep the read timeout resetting), but a slow MCP doc-lookup
# tool round-trip that produces no token output for a while could still
# trip it (confirmed happening for the non-streaming explain_structured
# path in lambda/import_explain/app.py, which has no per-token flow to
# reset the clock at all). Same generous timeout here as a precaution.
agentcore = boto3.client(
    "bedrock-agentcore",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
    config=Config(read_timeout=170, connect_timeout=10, retries={"max_attempts": 0}),
)
RUNTIME_ARN = os.environ["AGENT_RUNTIME_ARN"]

app = Flask(__name__)


@app.route("/review", methods=["POST"])
def review():
    body = request.get_json(force=True) or {}
    pack = body.get("pack") or {}
    pack_id = body.get("packId") or None
    pack_name = body.get("packName") or None
    pack_version = body.get("packVersion") or None
    output_language = body.get("outputLanguage", "")

    if body.get("currentReview") is not None:
        mode = "refine"
        payload = {
            "mode": mode,
            "currentReview": body.get("currentReview", ""),
            "feedback": body.get("feedback", ""),
        }
    else:
        mode = "from_scratch"
        payload = {"mode": mode, "questionText": body.get("questionText", "")}

    payload["pack"] = pack
    payload["outputLanguage"] = output_language
    payload["stream"] = True

    if mode == "from_scratch" and not payload["questionText"].strip():
        return _error_response("questionText is required", 400)
    if mode == "refine" and not payload["currentReview"].strip():
        return _error_response("currentReview is required", 400)

    action = "reviewGenerate" if mode == "from_scratch" else "reviewRefine"
    # Resolved here, NOT inside generate() below — see converse/app.py's
    # identical comment: Flask's request context is torn down before a
    # streaming Response's generator is actually pulled by the WSGI server,
    # so `request.headers` silently raises if touched from inside generate().
    usage_pk = _user_pk()

    budget_error = _check_budget(usage_pk)
    if budget_error:
        return _error_response(budget_error, 402)

    def generate():
        try:
            with xray_recorder.in_subsegment("invoke_review_agent"):
                response = agentcore.invoke_agent_runtime(
                    agentRuntimeArn=RUNTIME_ARN,
                    runtimeSessionId=uuid.uuid4().hex + uuid.uuid4().hex,
                    payload=json.dumps(payload).encode("utf-8"),
                )
            content_type = response.get("contentType", "")
            if "text/event-stream" in content_type:
                for line in response["response"].iter_lines(chunk_size=1):
                    if not line:
                        continue
                    text = line.decode("utf-8")
                    if text.startswith("data: "):
                        text = text[len("data: "):]
                    # The agent already emits our exact {"type": ...} envelope.
                    # Intercept METADATA (see review_agent/app.py) to log usage
                    # for the Costs page — still relayed to the client as-is.
                    try:
                        event = json.loads(text)
                    except ValueError:
                        event = None
                    if isinstance(event, dict) and event.get("type") == "METADATA":
                        event_model_id = event.get("modelId")
                        event_usage = event.get("usage")
                        _write_usage_event(usage_pk, action, event_model_id, event_usage, pack_id, pack_name, pack_version)
                        _add_budget_spend(usage_pk, _usage_cost_usd(event_model_id, event_usage))
                    yield text + "\n"
            else:
                body_bytes = b"".join(chunk for chunk in response.get("response", []))
                yield json.dumps({"type": "ERROR", "message": body_bytes.decode("utf-8", "replace")}) + "\n"
        except Exception as e:  # noqa: BLE001
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
