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

import json
import os
import uuid

import boto3
from botocore.config import Config
from flask import Flask, Response, request

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

    def generate():
        try:
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
