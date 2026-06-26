"""Cert Study Assistant — Flask streaming app for Lambda Web Adapter.

Receives POST /converse, calls Bedrock converse_stream with the requested
model, and streams response tokens back via NDJSON chunks. The set of usable
models is discovered dynamically by the data Lambda (GET /data/models); here we
only validate the id format and rely on the scoped Bedrock IAM policy.
"""

import json
import os
import re

import boto3
from flask import Flask, Response, request

bedrock = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))
DEFAULT_MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0")

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
