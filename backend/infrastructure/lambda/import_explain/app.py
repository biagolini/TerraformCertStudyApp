"""Bulk exam import — Phase 2, Step Functions Task (one Map iteration per
approved draft).

Reads one human-reviewed draft (structure only — stem/alternatives/domain/
title, written by lambda/import_extract's Phase 1) and calls the AgentCore
Runtime review agent for the explanation content, then writes the final
Question item and flips the draft's `promoted` flag. This is the second
half of what used to be one combined call inside import_extract — split
out so a bad extraction can be caught and fixed on the review screen
before this (slower, AgentCore-backed) step ever runs on it.

Never raises — any failure here is caught internally and returned as a
normal {"status": "FAILED"} result, mirroring import_extract's own
fault-isolation philosophy, so one bad question never fails the whole Map.
"""

import json
import logging
import os
import re
import time
import uuid

import boto3
from aws_xray_sdk.core import patch_all, xray_recorder
from botocore.config import Config

patch_all()
logging.getLogger().setLevel(logging.INFO)

TABLE_NAME = os.environ["TABLE_NAME"]
IMPORT_DRAFTS_TABLE_NAME = os.environ["IMPORT_DRAFTS_TABLE_NAME"]
QUESTIONS_TABLE_NAME = os.environ["QUESTIONS_TABLE_NAME"]
COSTS_TABLE_NAME = os.environ["COSTS_TABLE_NAME"]
AGENT_RUNTIME_ARN = os.environ["AGENT_RUNTIME_ARN"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
import_drafts_table = dynamodb.Table(IMPORT_DRAFTS_TABLE_NAME)
questions_table = dynamodb.Table(QUESTIONS_TABLE_NAME)
# Dedicated `costs` table for usage/budget rows, not `table` (study-data) —
# see docs/dynamodb-schema.md and aws_dynamodb.tf's comment.
costs_table = dynamodb.Table(COSTS_TABLE_NAME)
# boto3's default read_timeout (60s) is too short for this call — observed
# directly: a real explain call that took 71s (reasoning + an extra MCP
# doc-lookup round-trip) succeeded on the agent side ("ok": true in its own
# CloudWatch logs) but this client gave up first and reported it as a
# "Read timeout" failure. That failure was previously misattributed
# entirely to the shared-MCP-client concurrency bug (see review_agent/
# app.py's _make_mcp_tools) — this is a second, independent cause of the
# same symptom. retries disabled: retrying a slow-but-working call would
# only double the cost of something that just needs more time to wait for.
agentcore = boto3.client(
    "bedrock-agentcore",
    config=Config(read_timeout=170, connect_timeout=10, retries={"max_attempts": 0}),
)


def handler(event, context):
    job_id = event["jobId"]
    sub = event["sub"]
    pack_id = event["packId"]
    draft_index = event["draftIndex"]
    pk = f"USER#{sub}"
    sk = f"DRAFT#{job_id}#{draft_index:04d}"

    try:
        draft_item = import_drafts_table.get_item(Key={"pk": pk, "sk": sk}).get("Item")
        if not draft_item:
            raise ValueError(f"Draft not found: {sk}")
        draft = json.loads(draft_item["data"])
        if draft.get("extractStatus") != "SUCCEEDED":
            raise ValueError("Draft did not extract successfully — cannot generate an explanation for it")

        budget_error = _check_budget(pk)
        if budget_error:
            raise ValueError(budget_error)

        pack = _load_pack(pk, pack_id)
        images = draft.get("images") or []
        explanation = _generate_explanation(
            draft["stem"],
            draft["alternatives"],
            pack,
            source_general_comment=draft.get("sourceGeneralComment"),
            images=images,
        )
        _write_usage_event(
            pk, "importExplain", explanation.get("modelId"), explanation.get("usage"),
            job_id=job_id, packId=pack_id, packName=pack.get("name"), packVersion=pack.get("version"),
        )
        _add_budget_spend(pk, _usage_cost_usd(explanation.get("modelId"), explanation.get("usage")))
        if explanation.get("relatedServicesUsage"):
            _write_usage_event(
                pk, "importExplain", explanation.get("relatedServicesModelId"),
                explanation.get("relatedServicesUsage"), job_id=job_id, packId=pack_id,
                packName=pack.get("name"), packVersion=pack.get("version"),
            )
            _add_budget_spend(
                pk, _usage_cost_usd(explanation.get("relatedServicesModelId"), explanation.get("relatedServicesUsage"))
            )
        comments_by_letter = explanation.get("comments") or {}
        alternatives = [
            {
                **alt,
                "text": _append_images(alt.get("text", ""), _images_for(images, "alternativeText", alt.get("letter"))),
                "comment": _append_images(
                    comments_by_letter.get(alt["letter"].upper(), ""),
                    _images_for(images, "alternativeComment", alt.get("letter")),
                ),
            }
            for alt in draft["alternatives"]
        ]

        question_id = f"{job_id}-{draft_index:03d}"
        now = int(time.time() * 1000)
        topics = explanation.get("topics")
        related_services = explanation.get("relatedServices")
        question = {
            "id": question_id,
            "packId": pack_id,
            "title": draft.get("title") or "Imported question",
            "domain": draft.get("domain") or "General",
            "language": draft.get("language") or "en",
            "stem": _append_images(draft["stem"], _images_for(images, "stem")),
            "alternatives": alternatives,
            "metadata": {
                "topics": topics if isinstance(topics, list) else [],
                "relatedServices": related_services if isinstance(related_services, list) else [],
            },
            "starred": False,
            "createdAt": now,
            "updatedAt": now,
        }
        general_comment = _append_images(explanation.get("generalComment") or "", _images_for(images, "generalComment"))
        if general_comment:
            question["generalComment"] = general_comment

        questions_table.put_item(
            Item={"pk": pk, "sk": f"QUESTION#{question_id}", "data": json.dumps(question)}
        )

        # Flip promoted rather than delete — lets the review screen show
        # "already generated" rows instead of a draft just vanishing.
        # TTL (see aws_dynamodb_table.import_drafts) is the real cleanup.
        draft["promoted"] = True
        draft["updatedAt"] = now
        import_drafts_table.update_item(
            Key={"pk": pk, "sk": sk},
            UpdateExpression="SET #d = :d",
            ExpressionAttributeNames={"#d": "data"},
            ExpressionAttributeValues={":d": json.dumps(draft)},
        )

        _increment_job_counters(pk, job_id, failed=False)
        return {"index": draft_index, "status": "SUCCEEDED", "questionId": question_id}
    except Exception as e:  # noqa: BLE001 — any failure here must degrade to a per-item result
        # Logged with the request id front and center so the "Show logs" button
        # (data Lambda's GET .../logs route) can find exactly this invocation's
        # output via logs:FilterLogEvents on the request id alone.
        logging.exception(
            "import_explain failed job=%s index=%s request_id=%s",
            job_id, draft_index, context.aws_request_id,
        )
        _increment_job_counters(pk, job_id, failed=True)
        return {
            "index": draft_index,
            "status": "FAILED",
            "error": str(e),
            "requestId": context.aws_request_id,
        }


USAGE_TTL_SECONDS = 365 * 24 * 60 * 60


def _write_usage_event(pk, action, model_id, usage, **extra):
    """Persists one AI-call token/usage record for the Costs page (see
    lambda/data/app.py's GET /data/usage) into the dedicated `costs` table —
    not `table` (study-data), see aws_dynamodb.tf's comment. Best-effort — a
    usage-logging failure must never fail the actual import."""
    if not usage or not model_id:
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
        logging.exception("usage-log-failed action=%s model=%s", action, model_id)


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


def _increment_job_counters(pk, job_id, failed):
    """Same atomic native-attribute increment lambda/import_extract uses —
    safe under the Map's concurrent iterations. The `data` Lambda's
    generate-explanations route resets both counters to 0 before starting
    this phase, so they always reflect only this phase's own run."""
    table.update_item(
        Key={"pk": pk, "sk": f"IMPORTJOB#{job_id}"},
        UpdateExpression="ADD processedCount :one, failedCount :failed",
        ExpressionAttributeValues={":one": 1, ":failed": 1 if failed else 0},
    )


def _load_pack(pk, pack_id):
    item = table.get_item(Key={"pk": pk, "sk": f"PACK#{pack_id}"}).get("Item")
    if not item:
        return {}
    return json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})


def _images_for(images, target, alternative_letter=None):
    """Keys of this draft's classified images matching one final-Question
    field — see ImportDraftImage on the frontend for the classification
    scheme. `Question` has no separate images concept of its own (see
    question.model.ts): every image is always inline Markdown within
    whichever text field it belongs to, so this is how a classified image
    gets attached to that field's final text (`_append_images`, below)."""
    return [
        img["key"]
        for img in images
        if img.get("target") == target
        and (alternative_letter is None or img.get("alternativeLetter") == alternative_letter)
    ]


def _append_images(text, image_keys):
    """Deterministic, not agent-authored — the review agent never sees or
    handles image Markdown itself (asking an LLM to place a placeholder
    correctly inside prose it's simultaneously composing was the exact
    reliability problem the `images` classification scheme replaced, see
    import_extract/prompt.py). Appending each image at the end of its
    target field, after the fact, is simpler and can't get the key wrong."""
    if not image_keys:
        return text
    markdown = "\n\n".join(f"![diagram]({key})" for key in image_keys)
    return f"{text}\n\n{markdown}" if text else markdown


def _pack_context(pack):
    """The shape the review agent expects — see
    agent/review_agent/app.py's _pack_context_block."""
    return {
        "name": pack.get("name", ""),
        "description": pack.get("description", ""),
        "domains": [
            {"name": d.get("name", ""), "description": d.get("description", "")}
            for d in (pack.get("domains") or [])
            if isinstance(d, dict) and d.get("name")
        ],
    }


def _generate_explanation(stem, alternatives, pack, output_language="", source_general_comment=None, images=None):
    """Calls the AgentCore Runtime review agent (mode=explain_structured,
    non-streaming) for the explanation content — moved verbatim from
    lambda/import_extract/app.py, which used to make this same call itself
    right after its own structure extraction. Structure (stem/alternatives/
    correct letter) is already known and passed through verbatim; the
    agent only writes. The agent returns schema-validated structured
    output for this mode, pre-rendered into the same {"topics",
    "generalComment", "comments", "relatedServices"} shape consumed
    directly by this function's caller — no parsing.

    `sourceComment`/`source_general_comment` are raw explanation text the
    ORIGINAL exam material already provided (captured during Phase 1
    extraction, see import_extract/prompt.py) — passed through as reference
    material the agent can ground itself in, ground-truth-check, and rewrite
    for depth, never relay uncritically (the agent's own skill/system
    prompt is what tells it to treat this as unverified input, not this
    Lambda). `images` are that same draft's classified images (see
    ImportDraftImage on the frontend) — passed through so the agent can
    reference a relevant diagram's key directly in the explanation it
    writes (e.g. `![...](key)`) rather than only describing it in prose."""
    payload = {
        "mode": "explain_structured",
        "stream": False,
        "pack": _pack_context(pack),
        "outputLanguage": output_language,
        "stem": stem,
        "alternatives": [
            {
                "letter": a["letter"],
                "text": a["text"],
                "isCorrect": a["isCorrect"],
                "sourceComment": a.get("sourceComment"),
            }
            for a in alternatives
        ],
        "sourceGeneralComment": source_general_comment,
        "images": images or [],
    }
    with xray_recorder.in_subsegment("invoke_review_agent"):
        response = agentcore.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            runtimeSessionId=uuid.uuid4().hex + uuid.uuid4().hex,
            payload=json.dumps(payload).encode("utf-8"),
        )
    # The agent's HTTP contract is always SSE-framed ("data: {...}" lines),
    # even for this logically non-streaming call — see review_agent/app.py's
    # module docstring on why (its entrypoint is always an async generator).
    result = None
    for line in response["response"].iter_lines(chunk_size=1):
        if not line:
            continue
        text = line.decode("utf-8")
        if text.startswith("data: "):
            text = text[len("data: "):]
        result = json.loads(text)
    if not result or "error" in result:
        raise ValueError(f"Review agent failed: {(result or {}).get('error', 'empty response')}")
    return result
