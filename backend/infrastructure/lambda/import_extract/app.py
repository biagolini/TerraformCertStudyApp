"""Bulk exam import — Phase 1, Step Functions Task #2 (one Map iteration per
chunk).

Makes a single Bedrock Converse call per question chunk, forcing structured
JSON output via tool-use — no Markdown-generate-then-regex-parse round trip,
since this is a batch job with no interactive streaming UI to serve. This
Lambda extracts STRUCTURE ONLY (stem/alternatives/domain/title) and writes a
"draft" row to the import-drafts table for human review — it does not call
the AI explanation agent and does not write to the `questions` table at all
(see lambda/import_explain/app.py for Phase 2, which reads an approved draft
and does that). This split exists so a bad extraction can be caught and
fixed (via a re-extract, this same handler invoked directly on one chunk,
optionally with a `hint`) before the more expensive explanation step ever
runs on it.

Any extraction failure is caught internally and always still produces a
draft row (`extractStatus: "FAILED"`, with `error`/`preview` set) rather
than leaving that chunk's slot in the review list empty — so the review
screen is the single place both "wrong" and "outright failed" extractions
get fixed. A validation failure (empty stem, too few alternatives, none
marked correct) keeps whatever partial title/domain/stem/alternatives/
images the model DID produce rather than discarding them — the reviewer
fixes the one broken field instead of retyping the whole question; only a
genuine exception (Bedrock/S3/etc, no model output to salvage) leaves those
fields empty. The Step Functions result returned from `handler()` mirrors
this via `{"status": "FAILED"}` rather than raising, so one bad question
never fails the whole Map (see the ASL template's Catch for the rarer case
of an infrastructure-level failure, e.g. a Lambda timeout, that Python
can't catch).
"""

import json
import os
import random
import re
import time
import uuid

import boto3
from aws_xray_sdk.core import patch_all
from botocore.exceptions import ClientError

patch_all()

from prompt import build_system_prompt, build_tool_schema

# ModelErrorException in particular is a known non-deterministic Nova Lite
# glitch ("Model produced invalid sequence as part of ToolUse") that often
# succeeds on a plain retry. Step Functions' own Retry never actually
# engages for these — this Lambda catches everything internally and
# returns a normal FAILED result rather than raising, by design (so one bad
# question never fails the whole Map) — so the retry has to live here.
RETRYABLE_BEDROCK_ERRORS = {
    "ModelErrorException",
    "ThrottlingException",
    "ModelTimeoutException",
    "ServiceUnavailableException",
}
# Some models have a much tighter requests-per-minute ceiling than others —
# e.g. this account's cross-region "Nova Pro" quota is 25 req/min, vs. 200
# req/min for "Nova Lite" — and the Map's 4-way concurrency alone is enough
# to exceed the smaller budget. A short, fixed backoff (previously 1.5s,
# 3s) isn't nearly enough runway for that; this uses a longer exponential
# backoff with jitter (jitter spreads out the 4 concurrent workers so they
# don't all retry in lockstep and collide again) while staying well within
# the Lambda's own timeout.
MAX_CONVERSE_ATTEMPTS = 5
THROTTLE_BASE_DELAY_SECONDS = 3
THROTTLE_MAX_DELAY_SECONDS = 20

TABLE_NAME = os.environ["TABLE_NAME"]
IMPORT_DRAFTS_TABLE_NAME = os.environ["IMPORT_DRAFTS_TABLE_NAME"]
COSTS_TABLE_NAME = os.environ["COSTS_TABLE_NAME"]
ASSETS_BUCKET_NAME = os.environ["ASSETS_BUCKET_NAME"]
DEFAULT_MODEL_ID = os.environ["BEDROCK_EXTRACTION_MODEL_ID"]

# Matches the import-drafts DynamoDB table's TTL window — see aws_dynamodb.tf
# and the matching aws_s3_assets.tf `scratch/` lifecycle rule (a draft's
# `chunk` field points at scratch/ keys; both must expire together or a
# still-listed draft could point at an already-deleted chunk).
IMPORT_DRAFT_TTL_SECONDS = 14 * 24 * 60 * 60

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
import_drafts_table = dynamodb.Table(IMPORT_DRAFTS_TABLE_NAME)
# Dedicated `costs` table for usage/budget rows, not `table` (study-data) —
# see docs/dynamodb-schema.md and aws_dynamodb.tf's comment.
costs_table = dynamodb.Table(COSTS_TABLE_NAME)
s3 = boto3.client("s3")
bedrock = boto3.client("bedrock-runtime")

MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
VALID_IMAGE_TARGETS = {"stem", "alternativeText", "alternativeComment", "generalComment", "unplaced"}

# Deterministic safety net for UI-chrome that leaks into the START of an
# extracted stem when the model doesn't fully obey the prompt's "ignore
# 'Pergunta N'/status/expand-explanation link" rule. Seen live: a stem
# beginning "Pergunta 3 Ignorado Explique melhor A global financial services
# company..." or "Question 7 Skipped Explain this further As a DevOps
# Engineer...". The true stem starts only after all of that chrome. We strip,
# from the very beginning of the string only, in order: an optional question
# heading ("Question 7" OR a "7. Question" numbered heading), an optional
# "Category: <domain>" line, an optional past-attempt status word, and an
# optional expand-explanation link label — in any subset/order, repeated.
# Anchored to the start so these same words are never touched if they
# legitimately appear later inside the scenario.
#
# Status words / link labels below cover the variants observed across the
# practice-exam source formats this pipeline ingests:
#   status label values seen: Skipped, Ignorado, Correct, Incorrect,
#     Incorreto, Correto.
#   expand-explanation link values seen: "Explain this further" (English
#     exports) and "Explique melhor" (Portuguese exports). "Explain
#     further"/"Explain better" are tolerated as near-variants so a minor
#     platform-copy change doesn't silently reopen the leak.
#   Some Markdown exports prefix each question with a "Category: <domain>"
#     line (e.g. "Category: DOP – SDLC Automation") between the repeated
#     "N. Question" headings and the real stem.
# Other Markdown exports start each stem clean (just a "#### N. Question"
# heading then the scenario), so they need no prefix stripping here.
_CHROME_STATUS_WORDS = r"Ignorado|Ignored|Skipped|Pulad[ao]|Correto|Incorreto|Correct|Incorrect|Corrigido"
_CHROME_EXPLAIN_LABELS = r"Explique melhor|Explain(?:\s+this)?\s+further|Explain better"
_CHROME_PREFIX_RE = re.compile(
    r"^(?:\s*(?:"
    r"(?:Pergunta|Question)\s+\d+"           # "Question 7" heading
    r"|\d+\.\s*(?:Question|Pergunta)"        # numbered "7. Question" heading
    r"|(?:" + _CHROME_STATUS_WORDS + r")"     # past-attempt status
    r"|(?:" + _CHROME_EXPLAIN_LABELS + r")"   # expand-explanation link
    r")\b[\s:.\-–—]*)+",
    re.IGNORECASE,
)

# Some Markdown exports prefix each question with "Category: <domain>" (e.g.
# "Category: DOP – SDLC Automation") between the repeated "N. Question"
# headings and the real stem. Unlike the fixed chrome words above, the
# domain text is free-form and multi-word, so a regex can't reliably tell
# where the domain name ends and the scenario begins in the model's
# already-normalized (newline-free) stem. Instead we strip it using the
# pack's KNOWN domain names as the exact delimiter — 100% safe, since we
# only remove a leading "Category: <one-of-the-pack's-real-domains>".
_CATEGORY_LABEL_RE = re.compile(r"^\s*Category\s*[:\-–—]?\s*", re.IGNORECASE)
# An optional "DOP – " / "SAA – " style exam-code prefix before the domain name.
_DOMAIN_CODE_RE = re.compile(r"^\s*[A-Z]{2,5}\s*[:\-–—]\s*", re.IGNORECASE)


def _strip_category_prefix(text, domain_names):
    """Removes a leading "Category: [CODE –] <domain>" prefix, using the
    pack's real domain names as the exact right-hand delimiter so we never
    eat into the scenario. No-op unless the stem starts with "Category:" AND
    what follows begins with one of the pack's known domains (optionally
    after a "DOP – "-style exam-code prefix)."""
    if not text or not domain_names:
        return text
    m = _CATEGORY_LABEL_RE.match(text)
    if not m:
        return text
    rest = text[m.end():]
    code_m = _DOMAIN_CODE_RE.match(rest)
    after_code = rest[code_m.end():] if code_m else rest
    for domain in sorted(domain_names, key=len, reverse=True):
        if after_code[: len(domain)].lower() == domain.lower():
            return after_code[len(domain):].lstrip(" :.-–—\t")
    return text


def _strip_chrome_prefix(text, domain_names=None):
    """Removes leading source-export UI chrome from an extracted stem:
    - a question-number heading ("Question 7" or a numbered "7. Question"),
    - a past-attempt status label ("Skipped"/"Correct"/"Ignorado"/...),
    - the expand-explanation link ("Explain this further"/"Explique melhor"),
    - a "Category: <domain>" line (only when domain_names is
      given, using them as the exact delimiter — see _strip_category_prefix).
    Only strips from the absolute start, so a legitimate later mention of e.g.
    the word 'Correct' inside the scenario is untouched. No-op when the stem
    already starts with the real scenario text (the common case). Two chrome
    passes bracket the category strip because the real source order is
    headings -> Category -> (status), so the category can sit between two
    chrome runs."""
    if not text:
        return text
    text = _CHROME_PREFIX_RE.sub("", text, count=1).lstrip()
    text = _strip_category_prefix(text, domain_names)
    text = _CHROME_PREFIX_RE.sub("", text, count=1).lstrip()
    return text


def handler(event, context):
    chunk = event["chunk"]
    job_id = event["jobId"]
    sub = event["sub"]
    pack_id = event["packId"]
    index = chunk["index"]
    question_id = f"{job_id}-{index:03d}"
    pk = f"USER#{sub}"
    sk = f"DRAFT#{job_id}#{index:04d}"
    model_id = event.get("modelId") or DEFAULT_MODEL_ID
    hint = event.get("hint")

    # Re-reading the existing draft (if any) lets a re-extract — whole-job
    # retry or a single-question re-extract — preserve `createdAt` and bump
    # `reExtractCount` instead of looking like a brand-new row every time.
    existing_item = import_drafts_table.get_item(Key={"pk": pk, "sk": sk}).get("Item")
    existing_data = json.loads(existing_item["data"]) if existing_item else None
    created_at = existing_data["createdAt"] if existing_data else int(time.time() * 1000)
    re_extract_count = (existing_data.get("reExtractCount", 0) + 1) if existing_data else 0

    preview = _chunk_preview(chunk)
    now = int(time.time() * 1000)
    draft = {
        "jobId": job_id,
        "index": index,
        "packId": pack_id,
        "chunk": chunk,
        "promoted": (existing_data or {}).get("promoted", False),
        "reExtractCount": re_extract_count,
        "lastHint": hint,
        "createdAt": created_at,
        "updatedAt": now,
    }
    try:
        budget_error = _check_budget(pk)
        if budget_error:
            raise ValueError(budget_error)
        extracted = _extract_question(chunk, pk, sub, job_id, question_id, pack_id, model_id, hint)
        # A validation issue (empty stem, too few alternatives, no correct
        # one marked) still keeps whatever the model DID manage to extract —
        # see `_extract_question`'s own comment. The review screen shows
        # this partial content plus the error, so a reviewer fixes the one
        # broken field by hand instead of retyping the whole question from
        # the original source file.
        validation_error = extracted["validationError"]
        _write_usage_event(
            pk, extracted.get("modelId"), extracted.get("usage"), job_id=job_id, packId=pack_id,
            packName=extracted.get("packName"), packVersion=extracted.get("packVersion"),
        )
        _add_budget_spend(pk, _usage_cost_usd(extracted.get("modelId"), extracted.get("usage")))
        draft.update({
            "extractStatus": "FAILED" if validation_error else "SUCCEEDED",
            "title": extracted["title"],
            "domain": extracted["domain"],
            "language": extracted["language"],
            "stem": extracted["stem"],
            "alternatives": extracted["alternatives"],
            "sourceGeneralComment": extracted["sourceGeneralComment"],
            "images": extracted["images"],
            "error": validation_error,
            "preview": preview,
        })
        result = {
            "index": index,
            "status": "FAILED" if validation_error else "SUCCEEDED",
            "questionId": question_id,
        }
        if validation_error:
            result["error"] = validation_error
        failed = bool(validation_error)
    except Exception as e:  # noqa: BLE001 — a genuine failure (Bedrock/S3/etc) with no partial data to keep
        draft.update({
            "extractStatus": "FAILED",
            "title": None,
            "domain": None,
            "language": None,
            "stem": None,
            "alternatives": [],
            "sourceGeneralComment": None,
            "images": [],
            "error": str(e),
            "preview": preview,
        })
        result = {"index": index, "status": "FAILED", "error": str(e), "preview": preview}
        failed = True

    import_drafts_table.put_item(
        Item={
            "pk": pk,
            "sk": sk,
            "ttl": int(time.time()) + IMPORT_DRAFT_TTL_SECONDS,
            "data": json.dumps(draft),
        }
    )
    _increment_job_counters(pk, job_id, failed=failed)
    return result


def _chunk_preview(chunk):
    """A short, human-locatable snippet for the job's failure report — lets
    the user find which question in their source file a failure refers to."""
    try:
        if chunk["kind"] == "markdown":
            text = s3.get_object(Bucket=ASSETS_BUCKET_NAME, Key=chunk["textKey"])["Body"].read().decode("utf-8")
            return " ".join(text.split())[:140]
        page_count = len(chunk.get("pageKeys") or [])
        return f"PDF question chunk ({page_count} page image(s))"
    except Exception:  # noqa: BLE001 — a missing preview must never break extraction
        return None


USAGE_TTL_SECONDS = 365 * 24 * 60 * 60


def _write_usage_event(pk, model_id, usage, **extra):
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
                "action": "importExtract",
                "modelId": model_id,
                "inputTokens": usage.get("inputTokens", 0),
                "outputTokens": usage.get("outputTokens", 0),
                "totalTokens": usage.get("totalTokens", 0),
                "createdAt": now_ms,
                **extra,
            }),
        })
    except Exception:  # noqa: BLE001
        print(f"[usage-log-failed] model={model_id}")


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
    """Atomic native-attribute increment — safe under the Map's concurrent
    iterations (up to a handful at a time). See lambda/data/app.py's comment
    on why these two counters live outside the `data` JSON blob."""
    table.update_item(
        Key={"pk": pk, "sk": f"IMPORTJOB#{job_id}"},
        UpdateExpression="ADD processedCount :one, failedCount :failed",
        ExpressionAttributeValues={":one": 1, ":failed": 1 if failed else 0},
    )


def _load_pack(pk, pack_id):
    """Raw pack `data` dict — source for both the vision call's domain enum
    (names only) and the review agent's fuller pack context (name/
    description/domains)."""
    item = table.get_item(Key={"pk": pk, "sk": f"PACK#{pack_id}"}).get("Item")
    if not item:
        return {}
    return json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})


def _pack_domain_names(pack):
    """The pack's configured domain names, so the vision model is
    constrained to pick from real values instead of inventing a new one for
    every question that lacks an explicit category in its source text."""
    names = []
    for d in pack.get("domains") or []:
        if isinstance(d, dict) and d.get("name"):
            names.append(d["name"])
        elif isinstance(d, str) and d.strip():
            names.append(d.strip())
    return names


def _resolve_domain(raw_domain, domain_names):
    """Bedrock tool-use `enum` constraints are a hint, not a hard guarantee
    — Nova Lite in particular still sometimes invents a domain outside the
    given list. This deterministically forces the final value to always be
    one of the pack's real configured domains (when it has any configured),
    via exact match, then case-insensitive, then substring, then closest
    token overlap — rather than trusting the model's raw output."""
    if not domain_names:
        return raw_domain or "General"
    if not raw_domain:
        return domain_names[0]
    if raw_domain in domain_names:
        return raw_domain

    lower_map = {d.lower(): d for d in domain_names}
    if raw_domain.lower() in lower_map:
        return lower_map[raw_domain.lower()]

    for d in domain_names:
        if d.lower() in raw_domain.lower() or raw_domain.lower() in d.lower():
            return d

    raw_tokens = set(re.findall(r"[a-z]+", raw_domain.lower()))
    best, best_score = domain_names[0], 0
    for d in domain_names:
        score = len(raw_tokens & set(re.findall(r"[a-z]+", d.lower())))
        if score > best_score:
            best, best_score = d, score
    return best


def _normalize_language_code(raw_language):
    """Defensive against the model returning something other than a clean
    ISO 639-1 code (e.g. 'English' instead of 'en', or omitting the field
    entirely despite the schema) — same looseness `_resolve_domain` already
    has to guard against for `enum`/`required`. Defaults to 'en' since
    that's true for the overwhelming majority of source material this
    pipeline has actually seen."""
    if not raw_language or not isinstance(raw_language, str):
        return "en"
    code = raw_language.strip().lower()[:2]
    return code if code.isalpha() and len(code) == 2 else "en"


def _converse_with_retry(**kwargs):
    last_error = None
    for attempt in range(MAX_CONVERSE_ATTEMPTS):
        try:
            return bedrock.converse(**kwargs)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            last_error = e
            if code not in RETRYABLE_BEDROCK_ERRORS or attempt == MAX_CONVERSE_ATTEMPTS - 1:
                raise
            delay = min(THROTTLE_BASE_DELAY_SECONDS * (2**attempt), THROTTLE_MAX_DELAY_SECONDS)
            time.sleep(delay + random.uniform(0, delay * 0.5))
    raise last_error  # pragma: no cover — loop always returns or raises above


def _extract_question(chunk, pk, sub, job_id, question_id, pack_id, model_id, hint=None):
    image_blocks, image_keys = _load_images(chunk)
    pack = _load_pack(pk, pack_id)
    domain_names = _pack_domain_names(pack)

    user_text = _build_user_text(chunk)
    if domain_names:
        user_text += "\n\nReminder — the \"domain\" field must be exactly one of: " + ", ".join(domain_names)
    if hint:
        # User-supplied correction from the review screen's re-extract
        # action — e.g. "the correct answer is C, not B" or "the stem
        # continues after 'the following diagram'". Authoritative: it comes
        # from a human who already looked at this specific question and the
        # first extraction attempt, not a guess.
        user_text += (
            "\n\nA human reviewer already looked at a previous extraction "
            "attempt for this exact question and left this correction — "
            "treat it as authoritative and apply it:\n" + hint
        )

    response = _converse_with_retry(
        modelId=model_id,
        system=[{"text": build_system_prompt(domain_names)}],
        messages=[{"role": "user", "content": image_blocks + [{"text": user_text}]}],
        toolConfig={
            "tools": [build_tool_schema(domain_names)],
            "toolChoice": {"tool": {"name": "emit_question"}},
        },
        # Nova Lite writes verbose, multi-paragraph comments per alternative
        # when the source explanation is long — 4096 tokens wasn't always
        # enough, and Bedrock closes the tool-call gracefully rather than
        # erroring when it runs out, leaving some alternatives empty/missing
        # (observed directly: one real question got `"stem": "(Provided
        # above)"` and only 1 of ~5 alternatives, a token-budget shortcut).
        inferenceConfig={"maxTokens": 8192},
    )
    usage = response.get("usage") or {}
    question_input = _extract_tool_input(response)

    stem = (question_input.get("stem") or "").strip()
    # Strip leading source-export UI chrome (question number/status/expand-
    # explanation link/"Category: <domain>" line) up front so the empty-stem
    # validation below sees the real scenario text, and a stem that was ONLY
    # chrome correctly fails validation instead of masquerading as a valid
    # extraction. See _strip_chrome_prefix.
    stem = _strip_chrome_prefix(stem, domain_names)
    # Bedrock tool-use doesn't strictly enforce a tool schema's `required`
    # fields (same looseness observed with `enum` for domain) — an
    # occasional generation glitch leaves a stray empty {} in the
    # alternatives array. Drop anything without real letter+text before
    # counting, rather than let junk entries masquerade as real answers.
    alternatives = [
        a for a in (question_input.get("alternatives") or [])
        if isinstance(a, dict) and a.get("letter") and (a.get("text") or "").strip()
    ]

    # A failure here no longer aborts the extraction — whatever the model
    # DID manage to produce (a stem with only 1 alternative, alternatives
    # with none marked correct, ...) is still worth keeping as a head start
    # for the reviewer to fix by hand, rather than throwing it all away and
    # leaving the review screen's edit form empty. See handler()'s use of
    # `validationError` for how this maps to `extractStatus`.
    validation_error = None
    if not stem:
        validation_error = "Extraction failed validation: empty stem"
    elif len(alternatives) < 2:
        validation_error = f"Extraction failed validation: only {len(alternatives)} usable alternative(s) (need at least 2)"
    elif not any(a.get("isCorrect") for a in alternatives):
        validation_error = "Extraction failed validation: no alternative marked correct"
    if validation_error:
        print(f"[validation-failure] question_id={question_id} reason={validation_error} raw={json.dumps(question_input)[:2000]}")

    kind = chunk["kind"]
    valid_letters = {a["letter"] for a in alternatives}
    # Text fields are plain prose per the prompt — but the model isn't
    # strictly bound to that instruction (same looseness as `enum` fields),
    # so strip any stray image Markdown it copies through verbatim from the
    # source rather than leave a reference to a scratch-only key that was
    # never promoted and will never resolve.
    stem = MARKDOWN_IMAGE_RE.sub("", stem).strip()
    for alt in alternatives:
        alt["text"] = _strip_chrome_prefix(MARKDOWN_IMAGE_RE.sub("", alt.get("text", "")).strip(), domain_names)
        source_comment = MARKDOWN_IMAGE_RE.sub("", (alt.get("sourceComment") or "")).strip() or None
        alt["sourceComment"] = source_comment

    source_general_comment = MARKDOWN_IMAGE_RE.sub("", (question_input.get("generalComment") or "")).strip() or None

    # Every image supplied to the model gets classified and promoted — even
    # a genuinely decorative one (e.g. a repeated page header) still has
    # nowhere sensible to go, so it's classified "unplaced" rather than
    # silently dropped, keeping it visible for the reviewer to reassign.
    raw_classifications = question_input.get("images") or []
    by_index = {
        c["index"]: c
        for c in raw_classifications
        if isinstance(c, dict) and isinstance(c.get("index"), int)
    }
    images = []
    for i, key in enumerate(image_keys):
        classification = by_index.get(i) or {}
        target = classification.get("target")
        if target not in VALID_IMAGE_TARGETS:
            target = "unplaced"
        alt_letter = classification.get("alternativeLetter")
        if target in ("alternativeText", "alternativeComment") and alt_letter not in valid_letters:
            # Can't anchor to a nonexistent alternative — surface it instead
            # of silently dropping it.
            target, alt_letter = "unplaced", None
        elif target not in ("alternativeText", "alternativeComment"):
            alt_letter = None
        filename = os.path.basename(key)
        _promote_image(key, sub, job_id, question_id, filename)
        images.append({
            "key": f"{job_id}/{question_id}/{filename}",
            "target": target,
            "alternativeLetter": alt_letter,
        })

    # `sourceComment`/`sourceGeneralComment` are raw material the source exam
    # already provided — NOT the final `comment`/`generalComment` a Question
    # ships with (Phase 2/lambda/import_explain still generates those fresh
    # via the review agent, which uses this as grounding rather than
    # relaying it uncritically — the "source" prefix keeps the two from
    # ever being confused for each other). See prompt.py's module docstring.
    return {
        "title": question_input.get("title") or "Imported question",
        "domain": _resolve_domain(question_input.get("domain"), domain_names),
        "language": _normalize_language_code(question_input.get("language")),
        "stem": stem,
        "alternatives": [
            {
                "letter": a["letter"],
                "text": a["text"],
                "isCorrect": bool(a.get("isCorrect")),
                "sourceComment": a["sourceComment"],
            }
            for a in alternatives
        ],
        "sourceGeneralComment": source_general_comment,
        "images": images,
        "validationError": validation_error,
        "usage": usage,
        "modelId": model_id,
        "packName": pack.get("name"),
        "packVersion": pack.get("version"),
    }


# Bedrock Converse's supported image formats, keyed by file extension.
# Anything else (e.g. bmp, tiff, svg) has no safe fallback — a wrong guess
# here (previously EVERY non-.png file defaulted to "jpeg", regardless of
# its true type) causes a hard Converse validation error, since Bedrock
# checks the file's actual bytes against the declared format.
def _sniff_image_format(body):
    """Detect the real image format from its magic bytes rather than trusting
    the file extension — a real-world HTML export was found to serve some
    "*.jpg" images that are actually PNG-encoded, which Bedrock rejects with
    a MIME-mismatch ValidationException when told they're JPEG."""
    if body[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if body[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if body[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "webp"
    return None


def _load_images(chunk):
    """Returns (Converse image content blocks, scratch keys) in the same
    order — index N of the returned key list is what a `{{IMG:n}}`
    placeholder in the model's output refers to, for BOTH markdown/ZIP and
    PDF sources alike. Images in an unsupported format are skipped rather
    than sent with a guessed (and likely wrong) format."""
    keys = chunk.get("pageKeys") or chunk.get("imageKeys") or []
    blocks = []
    used_keys = []
    for key in keys:
        body = s3.get_object(Bucket=ASSETS_BUCKET_NAME, Key=key)["Body"].read()
        fmt = _sniff_image_format(body)
        if not fmt:
            continue
        blocks.append({"image": {"format": fmt, "source": {"bytes": body}}})
        used_keys.append(key)
    return blocks, used_keys


def _build_user_text(chunk):
    if chunk["kind"] == "markdown":
        # Chunk text lives in scratch/ (not inline in the chunk itself) — a
        # raw markdown chunk per question, embedded directly in Step
        # Functions state, blew past its 256KB state-size limit for a real
        # ~75-question exam.
        text = s3.get_object(Bucket=ASSETS_BUCKET_NAME, Key=chunk["textKey"])["Body"].read().decode("utf-8")
        return (
            "Raw exam chunk (Markdown, possibly with duplicated headings and "
            "meaningless 'Correct'/'Incorrect' placeholder lines):\n\n" + text
        )
    return (
        "The attached images are consecutive pages from a practice-exam PDF "
        "results export, all belonging to a single question. Extract that "
        "one multiple-choice question."
    )


def _extract_tool_input(response):
    for block in response["output"]["message"]["content"]:
        if "toolUse" in block:
            return block["toolUse"]["input"]
    raise ValueError("Model did not call the emit_question tool")


def _promote_image(scratch_key, sub, job_id, question_id, filename):
    permanent_key = f"images/{sub}/{job_id}/{question_id}/{filename}"
    s3.copy_object(
        Bucket=ASSETS_BUCKET_NAME,
        CopySource={"Bucket": ASSETS_BUCKET_NAME, "Key": scratch_key},
        Key=permanent_key,
    )
