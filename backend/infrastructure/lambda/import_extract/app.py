"""Bulk exam import — Step Functions Task #2 (one Map iteration per chunk).

Makes a single Bedrock Converse call per question chunk, forcing structured
JSON output via tool-use — no Markdown-generate-then-regex-parse round trip,
since this is a batch job with no interactive streaming UI to serve. Any
extraction failure is caught internally and returned as a normal
`{"status": "FAILED"}` result rather than raised, so one bad question never
fails the whole Map (see the ASL template's Catch for the rarer case of an
infrastructure-level failure, e.g. a Lambda timeout, that Python can't catch).
"""

import json
import os
import random
import re
import time
from urllib.parse import unquote

import boto3
from botocore.exceptions import ClientError

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
QUESTIONS_TABLE_NAME = os.environ["QUESTIONS_TABLE_NAME"]
ASSETS_BUCKET_NAME = os.environ["ASSETS_BUCKET_NAME"]
DEFAULT_MODEL_ID = os.environ["BEDROCK_EXTRACTION_MODEL_ID"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
questions_table = dynamodb.Table(QUESTIONS_TABLE_NAME)
s3 = boto3.client("s3")
bedrock = boto3.client("bedrock-runtime")

IMG_PLACEHOLDER_RE = re.compile(r"\{\{IMG:(\d+)\}\}")
MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def handler(event, context):
    chunk = event["chunk"]
    job_id = event["jobId"]
    sub = event["sub"]
    pack_id = event["packId"]
    index = chunk["index"]
    question_id = f"{job_id}-{index:03d}"
    pk = f"USER#{sub}"
    model_id = event.get("modelId") or DEFAULT_MODEL_ID

    preview = _chunk_preview(chunk)
    try:
        question = _extract_question(chunk, pk, sub, job_id, question_id, pack_id, model_id)
        questions_table.put_item(
            Item={"pk": pk, "sk": f"QUESTION#{question_id}", "data": json.dumps(question)}
        )
        _increment_job_counters(pk, job_id, failed=False)
        return {"index": index, "status": "SUCCEEDED", "questionId": question_id}
    except Exception as e:  # noqa: BLE001 — any failure here must degrade to a per-item result
        _increment_job_counters(pk, job_id, failed=True)
        return {"index": index, "status": "FAILED", "error": str(e), "preview": preview}


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


def _increment_job_counters(pk, job_id, failed):
    """Atomic native-attribute increment — safe under the Map's concurrent
    iterations (up to a handful at a time). See lambda/data/app.py's comment
    on why these two counters live outside the `data` JSON blob."""
    table.update_item(
        Key={"pk": pk, "sk": f"IMPORTJOB#{job_id}"},
        UpdateExpression="ADD processedCount :one, failedCount :failed",
        ExpressionAttributeValues={":one": 1, ":failed": 1 if failed else 0},
    )


def _get_pack_domain_names(pk, pack_id):
    """The pack's configured domain names, so the model is constrained to
    pick from real values instead of inventing a new one for every question
    that lacks an explicit category in its source text."""
    item = table.get_item(Key={"pk": pk, "sk": f"PACK#{pack_id}"}).get("Item")
    if not item:
        return []
    data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
    names = []
    for d in data.get("domains") or []:
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


def _extract_question(chunk, pk, sub, job_id, question_id, pack_id, model_id):
    image_blocks, image_keys = _load_images(chunk)
    domain_names = _get_pack_domain_names(pk, pack_id)

    user_text = _build_user_text(chunk)
    if domain_names:
        user_text += "\n\nReminder — the \"domain\" field must be exactly one of: " + ", ".join(domain_names)

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
    question_input = _extract_tool_input(response)

    stem = (question_input.get("stem") or "").strip()
    # Bedrock tool-use doesn't strictly enforce a tool schema's `required`
    # fields (same looseness observed with `enum` for domain) — an
    # occasional generation glitch leaves a stray empty {} in the
    # alternatives array. Drop anything without real letter+text before
    # counting, rather than let junk entries masquerade as real answers.
    alternatives = [
        a for a in (question_input.get("alternatives") or [])
        if isinstance(a, dict) and a.get("letter") and (a.get("text") or "").strip()
    ]

    if not stem:
        print(f"[validation-failure] question_id={question_id} reason=empty_stem raw={json.dumps(question_input)[:2000]}")
        raise ValueError("Extracted question failed validation: empty stem")
    if len(alternatives) < 2:
        print(f"[validation-failure] question_id={question_id} reason=too_few_alternatives ({len(alternatives)}) raw={json.dumps(question_input)[:2000]}")
        raise ValueError(f"Extracted question failed validation: only {len(alternatives)} usable alternative(s) (need at least 2)")
    if not any(a.get("isCorrect") for a in alternatives):
        print(f"[validation-failure] question_id={question_id} reason=no_correct_marked raw={json.dumps(question_input)[:2000]}")
        raise ValueError("Extracted question failed validation: no alternative marked correct")

    kind = chunk["kind"]
    stem = _rewrite_images(stem, kind, image_keys, sub, job_id, question_id)
    for alt in alternatives:
        alt["text"] = _rewrite_images(alt.get("text", ""), kind, image_keys, sub, job_id, question_id)
        alt["comment"] = _rewrite_images(alt.get("comment", ""), kind, image_keys, sub, job_id, question_id)

    topics = question_input.get("topics")
    related_services = question_input.get("relatedServices")
    now = int(time.time() * 1000)
    return {
        "id": question_id,
        "packId": pack_id,
        "title": question_input.get("title") or "Imported question",
        "domain": _resolve_domain(question_input.get("domain"), domain_names),
        "stem": stem,
        "alternatives": alternatives,
        "metadata": {
            "topics": topics if isinstance(topics, list) else [],
            "relatedServices": related_services if isinstance(related_services, list) else [],
        },
        "starred": False,
        "createdAt": now,
        "updatedAt": now,
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


def _rewrite_images(text, chunk_kind, image_keys, sub, job_id, question_id):
    """Resolves image references to permanent, presign-able S3 keys,
    promoting only the images actually referenced in the surviving output —
    not every candidate image sent to the model. Two passes, because the
    model doesn't reliably follow just one convention:
    1. The intended path — `{{IMG:n}}` placeholders the model was told to use.
    2. A safety net for markdown/ZIP sources — despite being told not to,
       the model sometimes copies the source's own `![alt](ref)` syntax
       through verbatim instead of using a placeholder. Rather than leave a
       reference that resolves nowhere, still try to match it by basename
       against this chunk's known images.
    """
    if not text:
        return text

    def replace_placeholder(m):
        n = int(m.group(1))
        if n < 0 or n >= len(image_keys):
            return ""
        filename = os.path.basename(image_keys[n])
        _promote_image(image_keys[n], sub, job_id, question_id, filename)
        return f"![diagram]({job_id}/{question_id}/{filename})"

    text = IMG_PLACEHOLDER_RE.sub(replace_placeholder, text)

    if chunk_kind == "markdown":
        def replace_stray_markdown_image(m):
            alt, ref = m.group(1), m.group(2)
            basename = os.path.basename(unquote(ref))
            scratch_key = next((k for k in image_keys if k.endswith(f"/{basename}")), None)
            if not scratch_key:
                return ""  # points nowhere resolvable — drop rather than leave a broken reference
            _promote_image(scratch_key, sub, job_id, question_id, basename)
            return f"![{alt}]({job_id}/{question_id}/{basename})"

        text = MARKDOWN_IMAGE_RE.sub(replace_stray_markdown_image, text)

    return text


def _promote_image(scratch_key, sub, job_id, question_id, filename):
    permanent_key = f"images/{sub}/{job_id}/{question_id}/{filename}"
    s3.copy_object(
        Bucket=ASSETS_BUCKET_NAME,
        CopySource={"Bucket": ASSETS_BUCKET_NAME, "Key": scratch_key},
        Key=permanent_key,
    )
