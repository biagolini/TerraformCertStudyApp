"""
One-time migration: Question v1 (free-text `review` Markdown) -> v2 (structured
alternatives/comments/metadata), moving questions from the general/config table
into their own dedicated table.

This is a RECORD of the migration that was run against production on 2026-08-29,
not a re-runnable idempotent tool — it assumes the v1 QUESTION# items still live
in the general table and the v2 "study-questions" table exists (see
aws_dynamodb.tf) but is empty. Do not re-run as-is against a table that already
has v2 data without re-checking the diff logic.

See docs/dynamodb-schema.md for the v1 -> v2 shape.

Requires: boto3, and IAM permissions for dynamodb:Scan/PutItem/DeleteItem on both
tables plus bedrock-runtime:Converse (for the one enrichment call per question).
Run in small batches if going through a tool-call-limited execution environment
(each question costs one Converse + one PutItem call).
"""

import json
import re
import time

import boto3

GENERAL_TABLE = "study-data"
QUESTIONS_TABLE = "study-questions"
REGION = "us-east-1"
ENRICHMENT_MODEL_ID = "amazon.nova-lite-v1:0"

# --- Parser: mirrors frontend/src/app/core/utils/question-parse.util.ts ------
# Sections are located by POSITION (the last four `#`-headings in the document
# — question / alternatives / correct / incorrect, in that order), not by
# matching specific heading text, so this tolerates the heading wording/level
# (### vs ####) and language (English vs the older Portuguese prompt output)
# changing across prompt versions. A leading heading before those four, when
# present, is treated as the "key concepts" / topics section.

ANY_HEADING = re.compile(r"^#{1,6}\s+.+$")
OPTION_LINE = re.compile(r"^\*([A-Za-z])\.\s*(.+?)\*$")
ANNOTATION_LINE = re.compile(r"^\*[^*:]{2,24}:\s*.+\*$")
SOURCES_APPENDIX_START = re.compile(r"^(-{3,}|Sources\s*:?|Fontes\s*:?|Refer[eê]ncias\s*:?)$", re.IGNORECASE)
BULLET_LINE = re.compile(r"^[-*]\s+(.+)$")


def heading_indices(lines):
    return [i for i, line in enumerate(lines) if ANY_HEADING.match(line.strip())]


def section_after(lines, start, all_headings):
    next_heading = next((h for h in all_headings if h > start), None)
    end = next_heading if next_heading is not None else len(lines)
    return lines[start + 1 : end]


def strip_trailing_appendix(lines):
    for i, line in enumerate(lines):
        if SOURCES_APPENDIX_START.match(line.strip()):
            return lines[:i]
    return lines


def extract_letter_comments(lines):
    """Ordered letter -> comment map from a section that restates each option's
    letter+text (`*B. text*`) followed by prose explaining it."""
    result = {}
    current_letter = None
    current_comment = []

    def flush():
        if current_letter:
            result[current_letter] = "\n".join(current_comment).strip()

    for raw in strip_trailing_appendix(lines):
        line = raw.strip()
        if not line or ANNOTATION_LINE.match(line):
            continue
        m = OPTION_LINE.match(line)
        if m:
            flush()
            current_letter = m.group(1).upper()
            current_comment = []
        elif current_letter:
            current_comment.append(line)
    flush()
    return result


def parse_question_review(review):
    """Returns {stem, alternatives: [{letter, text, isCorrect, comment}], topics}
    or None when the review doesn't have the expected 4-section tail at all —
    known real-world case: an even older format using unlettered `* **bold**`
    bullets for alternatives, matched by TEXT rather than letter. That format
    is NOT handled here; those items were left in the general table for manual
    follow-up (see the migration run's "failed" list)."""
    lines = review.replace("\r\n", "\n").split("\n")
    headings = heading_indices(lines)
    if len(headings) < 4:
        return None

    question_h, alternatives_h, correct_h, incorrect_h = headings[-4:]
    question_lines = section_after(lines, question_h, headings)
    alternatives_lines = section_after(lines, alternatives_h, headings)
    correct_lines = section_after(lines, correct_h, headings)
    incorrect_lines = section_after(lines, incorrect_h, headings)

    stem = "\n".join(l for l in question_lines if not ANNOTATION_LINE.match(l.strip())).strip()
    if not stem:
        return None

    options = []
    for raw in alternatives_lines:
        m = OPTION_LINE.match(raw.strip())
        if m:
            options.append({"letter": m.group(1).upper(), "text": m.group(2).strip()})
    if len(options) < 2:
        return None

    correct_comments = extract_letter_comments(correct_lines)
    incorrect_comments = extract_letter_comments(incorrect_lines)
    if not correct_comments:
        return None

    option_letters = {o["letter"] for o in options}
    if not all(l in option_letters for l in correct_comments.keys()):
        return None

    alternatives = []
    for o in options:
        is_correct = o["letter"] in correct_comments
        comment = correct_comments.get(o["letter"]) if is_correct else incorrect_comments.get(o["letter"], "")
        alternatives.append({"letter": o["letter"], "text": o["text"], "isCorrect": is_correct, "comment": comment or ""})

    leading = headings[: len(headings) - 4]
    topics = []
    if leading:
        concept_lines = section_after(lines, leading[0], headings)
        for line in concept_lines:
            m = BULLET_LINE.match(line.strip())
            if m:
                topics.append(m.group(1).replace("**", "").strip())

    return {"stem": stem, "alternatives": alternatives, "topics": topics}


# --- Enrichment: mirrors frontend/src/app/core/utils/enrichment-prompt.util.ts

RELATED_SERVICES_SYSTEM_PROMPT = """You extract the specific named services or products a certification exam question is about.

Read the question and its alternatives. Output ONLY a JSON array of strings — the exact names of vendor
services/products referenced or clearly implied (e.g. "Amazon S3", "AWS Lambda", "Azure Functions",
"Claude", "Kubernetes"). Do not include generic concepts (e.g. "object storage", "high availability") —
only concrete named services/products.

STRICT OUTPUT RULES:
- Output ONLY the JSON array, nothing else. No markdown code fences, no explanation.
- If no specific named service/product is referenced, output [].
- Deduplicate. Use the vendor's official product name/casing (e.g. "Amazon EC2", not "ec2").
- Maximum 8 items."""


def extract_related_services(bedrock_runtime, stem, alternatives):
    options_text = "\n".join(f"{a['letter']}. {a['text']}" for a in alternatives)
    user_message = f"Question:\n{stem}\n\nAlternatives:\n{options_text}"
    try:
        resp = bedrock_runtime.converse(
            modelId=ENRICHMENT_MODEL_ID,
            system=[{"text": RELATED_SERVICES_SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": [{"text": user_message}]}],
        )
        text = resp["output"]["message"]["content"][0]["text"]
        parsed = json.loads(text.strip())
        return [s for s in parsed if isinstance(s, str)] if isinstance(parsed, list) else []
    except Exception:
        return []


def main():
    dynamodb = boto3.client("dynamodb", region_name=REGION)
    bedrock_runtime = boto3.client("bedrock-runtime", region_name=REGION)

    items = []
    kwargs = {
        "TableName": GENERAL_TABLE,
        "FilterExpression": "begins_with(sk, :p)",
        "ExpressionAttributeValues": {":p": {"S": "QUESTION#"}},
    }
    while True:
        resp = dynamodb.scan(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek

    migrated, failed = [], []
    for item in items:
        pk = item["pk"]["S"]
        data = json.loads(item["data"]["S"])
        parsed = parse_question_review(data.get("review", ""))
        if not parsed:
            failed.append({"id": data.get("id"), "title": data.get("title")})
            continue

        related_services = extract_related_services(bedrock_runtime, parsed["stem"], parsed["alternatives"])
        now_ms = int(time.time() * 1000)
        v2 = {
            "id": data["id"],
            "packId": data["packId"],
            "title": data.get("title", ""),
            "domain": data.get("domain", ""),
            "stem": parsed["stem"],
            "alternatives": parsed["alternatives"],
            "metadata": {"topics": parsed["topics"], "relatedServices": related_services},
            "createdAt": data.get("createdAt", now_ms),
            "updatedAt": now_ms,
        }
        dynamodb.put_item(
            TableName=QUESTIONS_TABLE,
            Item={"pk": {"S": pk}, "sk": {"S": f"QUESTION#{data['id']}"}, "data": {"S": json.dumps(v2, ensure_ascii=False)}},
        )
        migrated.append((pk, data["id"]))

    print(f"Migrated: {len(migrated)}, failed (left in place): {len(failed)}")
    for f in failed:
        print(f"  SKIPPED: {f['id']} — {f['title']}")

    # Only delete the v1 item once the v2 write above succeeded.
    for pk, question_id in migrated:
        dynamodb.delete_item(TableName=GENERAL_TABLE, Key={"pk": {"S": pk}, "sk": {"S": f"QUESTION#{question_id}"}})


if __name__ == "__main__":
    main()
