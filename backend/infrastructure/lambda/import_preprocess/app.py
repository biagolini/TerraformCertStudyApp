"""Bulk exam import — Step Functions Task #1.

Reads the raw uploaded file (PDF, Markdown, HTML, or a ZIP of Markdown/HTML
plus an images folder) and splits it into per-question chunks for the
extraction fan-out (Task #2, one Bedrock call per chunk via a Map state).
Chunking here is deliberately dumb boundary-detection only — deciding
what's actually the question vs. surrounding noise (past-answer status
labels, unrelated reference pages) is left to the extraction model, since a
plain-text heuristic can't see the visual cues (e.g. a colored border
marking the correct option) that some source formats rely on.
"""

import html as html_module
import json
import os
import re
import zipfile
from io import BytesIO
from urllib.parse import unquote

import boto3
from aws_xray_sdk.core import patch_all

patch_all()

TABLE_NAME = os.environ["TABLE_NAME"]
ASSETS_BUCKET_NAME = os.environ["ASSETS_BUCKET_NAME"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
s3 = boto3.client("s3")

# Matches a numbered Markdown heading like "#### 1. Question" (any heading
# depth). The ground-truth export repeats this heading 3x per question —
# handled by _split_markdown_questions collapsing consecutive duplicates.
QUESTION_HEADING_RE = re.compile(r"^#{1,6}\s*(\d+)\.\s")
# Matches "Pergunta N" / "Question N" — the only reliable per-page anchor in
# a browser-printed PDF export; everything up to the NEXT anchor (including
# any interleaved unrelated reference pages) becomes that question's range.
PDF_QUESTION_RE = re.compile(r"^\s*(Pergunta|Question)\s+(\d+)", re.MULTILINE)
# Same anchor text as the PDF case, but as a browser-saved quiz-results page
# renders it: a plain <span>Pergunta N</span> / <span>Question N</span> right
# next to that question's own past-attempt status badge ("Incorreto" etc).
HTML_QUESTION_RE = re.compile(r"<span>\s*(Pergunta|Question)\s+(\d+)\s*</span>")
HTML_SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
HTML_IMG_TAG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>', re.IGNORECASE)
# Each alternative/paragraph is its own <p>/<div> block with no whitespace
# between them in the raw markup — without turning these into line breaks
# first, stripping tags would run adjacent alternatives together into one
# undifferentiated wall of text.
HTML_BLOCK_BREAK_RE = re.compile(r"</(p|div|li|h[1-6]|tr)>|<br\s*/?>", re.IGNORECASE)
HTML_TAG_RE = re.compile(r"<[^>]+>")
IMAGE_REF_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp")
# A best-effort secondary defense against trailing link blocks — the
# extraction prompt is also told to ignore these, so a miss here isn't fatal.
REFERENCES_CUTOFF_RE = re.compile(
    r"^\*{0,2}(References|Refer[eê]ncias|Check out (this|these).*Cheat Sheets?)\s*:?\*{0,2}$",
    re.IGNORECASE,
)


def handler(event, context):
    bucket = event["detail"]["bucket"]["name"]
    key = event["detail"]["object"]["key"]

    # uploads/{sub}/{jobId}/{filename}
    parts = key.split("/")
    if len(parts) != 4 or parts[0] != "uploads":
        raise ValueError(f"Unexpected upload key shape: {key}")
    _, sub, job_id, filename = parts
    pk = f"USER#{sub}"

    job_item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{job_id}"}).get("Item")
    if not job_item:
        raise ValueError(f"Import job not found: {job_id}")
    job = json.loads(job_item["data"]) if isinstance(job_item.get("data"), str) else job_item["data"]
    pack_id = job["packId"]
    model_id = job.get("modelId")

    try:
        raw_bytes = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        ext = os.path.splitext(filename)[1].lower()
        if ext == ".zip":
            chunks = _chunk_zip(raw_bytes, job_id)
        elif ext == ".md":
            chunks = _chunk_markdown(raw_bytes.decode("utf-8", errors="replace"), job_id, {})
        elif ext in (".html", ".htm"):
            chunks = _chunk_html(raw_bytes.decode("utf-8", errors="replace"), job_id, {})
        elif ext == ".pdf":
            chunks = _chunk_pdf(raw_bytes, job_id)
        else:
            raise ValueError(f"Unsupported file extension: {ext}")

        if not chunks:
            raise ValueError("No questions were detected in the uploaded file")

        _update_job(pk, job_id, status="EXTRACTING", totalQuestions=len(chunks))
    except Exception as e:
        _update_job(pk, job_id, status="FAILED", error=str(e))
        raise

    return {"jobId": job_id, "sub": sub, "packId": pack_id, "modelId": model_id, "chunks": chunks}


def _update_job(pk, job_id, **fields):
    """Read-modify-write on the `data` blob only — safe here because this
    Lambda always runs BEFORE the concurrent extraction fan-out starts, so
    there's no other writer racing on this item yet. Native processedCount/
    failedCount attributes are carried over untouched (see lambda/data/app.py
    for why they live outside the JSON blob)."""
    item = table.get_item(Key={"pk": pk, "sk": f"IMPORTJOB#{job_id}"}).get("Item") or {}
    data = json.loads(item["data"]) if isinstance(item.get("data"), str) else item.get("data", {})
    data.update(fields)
    table.put_item(Item={
        "pk": pk,
        "sk": f"IMPORTJOB#{job_id}",
        "data": json.dumps(data),
        "processedCount": item.get("processedCount", 0),
        "failedCount": item.get("failedCount", 0),
    })


def _strip_references(text):
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if REFERENCES_CUTOFF_RE.match(line.strip()):
            return "\n".join(lines[:i]).strip()
    return text.strip()


def _split_markdown_questions(markdown_text):
    lines = markdown_text.split("\n")
    boundaries = []
    last_num = None
    for i, line in enumerate(lines):
        m = QUESTION_HEADING_RE.match(line.strip())
        if not m:
            continue
        num = m.group(1)
        if num != last_num:
            boundaries.append(i)
        last_num = num

    if not boundaries:
        return [markdown_text]

    chunks_text = []
    for idx, start in enumerate(boundaries):
        end = boundaries[idx + 1] if idx + 1 < len(boundaries) else len(lines)
        chunks_text.append("\n".join(lines[start:end]))
    return chunks_text


def _chunk_markdown(markdown_text, job_id, image_keys_by_basename):
    raw_chunks = [_strip_references(c) for c in _split_markdown_questions(markdown_text)]
    return _finalize_text_chunks(raw_chunks, job_id, image_keys_by_basename)


def _split_html_questions(html_text):
    """Same idea as _split_markdown_questions, but for a browser-saved quiz
    results page: <script>/<style> blocks (webpack bundles, CSS) are stripped
    first since they dwarf the actual content, then each <span>Pergunta
    N</span> / <span>Question N</span> marker (the question's own status
    header) becomes a boundary, exactly like the PDF's per-page anchor."""
    cleaned = HTML_SCRIPT_STYLE_RE.sub(" ", html_text)
    boundaries = [m.start() for m in HTML_QUESTION_RE.finditer(cleaned)]
    if not boundaries:
        return []
    return [
        cleaned[start : boundaries[idx + 1] if idx + 1 < len(boundaries) else len(cleaned)]
        for idx, start in enumerate(boundaries)
    ]


def _html_fragment_to_text(fragment):
    """Converts one question's raw HTML slice into the same plain-text-with-
    Markdown-image-syntax shape _chunk_markdown already produces, so both
    paths can share one extraction prompt/tool schema downstream — an <img>
    tag becomes a `![](basename)` reference (matched by the same
    IMAGE_REF_RE used for the Markdown/ZIP path), then all remaining tags
    are stripped and HTML entities decoded."""
    fragment = HTML_IMG_TAG_RE.sub(
        lambda m: f"![]({os.path.basename(unquote(m.group(1)))})", fragment
    )
    fragment = HTML_BLOCK_BREAK_RE.sub("\n", fragment)
    text = html_module.unescape(HTML_TAG_RE.sub(" ", fragment))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def _chunk_html(html_text, job_id, image_keys_by_basename):
    raw_chunks = _split_html_questions(html_text)
    if not raw_chunks:
        raise ValueError("No 'Pergunta N' / 'Question N' markers found in the HTML")
    texts = [_html_fragment_to_text(c) for c in raw_chunks]
    return _finalize_text_chunks(texts, job_id, image_keys_by_basename)


def _finalize_text_chunks(texts, job_id, image_keys_by_basename):
    """Shared tail for the Markdown and HTML paths: resolve each chunk's
    image references against the ZIP's uploaded images, write the chunk
    text to scratch/, and return only its S3 key — Step Functions caps
    state input/output at 256KB, and a raw chunk embedded inline (as this
    used to do) blew well past that for a real ~75-question exam. Chunk
    text is fetched back from S3 by import-extract, mirroring how PDF page
    images already work."""
    chunks = []
    for i, text in enumerate(texts):
        image_keys = []
        for ref in IMAGE_REF_RE.findall(text):
            basename = os.path.basename(unquote(ref))
            scratch_key = image_keys_by_basename.get(basename)
            # A source page can reference the same image twice (e.g. a
            # thumbnail plus its own full-size viewer) — dedupe so it isn't
            # sent to the model twice as separate vision inputs.
            if scratch_key and scratch_key not in image_keys:
                image_keys.append(scratch_key)
        text_key = f"scratch/{job_id}/chunks/{i:04d}.md"
        s3.put_object(Bucket=ASSETS_BUCKET_NAME, Key=text_key, Body=text.encode("utf-8"))
        chunks.append({"index": i, "kind": "markdown", "textKey": text_key, "imageKeys": image_keys})
    return chunks


def _chunk_zip(zip_bytes, job_id):
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        md_name = next(
            (n for n in zf.namelist() if n.lower().endswith(".md") and "__MACOSX" not in n), None
        )
        html_name = None
        if not md_name:
            html_name = next(
                (
                    n
                    for n in zf.namelist()
                    if n.lower().endswith((".html", ".htm")) and "__MACOSX" not in n
                ),
                None,
            )
        if not md_name and not html_name:
            raise ValueError("No .md or .html file found inside the uploaded ZIP")

        image_keys_by_basename = {}
        for name in zf.namelist():
            if "__MACOSX" in name or name.endswith("/"):
                continue
            if os.path.splitext(name)[1].lower() not in IMAGE_EXTENSIONS:
                continue
            basename = os.path.basename(name)
            scratch_key = f"scratch/{job_id}/raw/img/{basename}"
            s3.put_object(Bucket=ASSETS_BUCKET_NAME, Key=scratch_key, Body=zf.read(name))
            image_keys_by_basename[basename] = scratch_key

        if md_name:
            text = zf.read(md_name).decode("utf-8", errors="replace")
            return _chunk_markdown(text, job_id, image_keys_by_basename)
        text = zf.read(html_name).decode("utf-8", errors="replace")
        return _chunk_html(text, job_id, image_keys_by_basename)


def _chunk_pdf(pdf_bytes, job_id):
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    starts = []
    for i in range(doc.page_count):
        m = PDF_QUESTION_RE.search(doc[i].get_text())
        if m:
            starts.append(i)

    if not starts:
        raise ValueError("No 'Pergunta N' / 'Question N' markers found in the PDF")

    chunks = []
    for idx, page_start in enumerate(starts):
        page_end = starts[idx + 1] - 1 if idx + 1 < len(starts) else doc.page_count - 1
        page_keys = []
        for page_num in range(page_start, page_end + 1):
            pix = doc[page_num].get_pixmap(dpi=150)
            scratch_key = f"scratch/{job_id}/pages/{page_num:04d}.png"
            s3.put_object(Bucket=ASSETS_BUCKET_NAME, Key=scratch_key, Body=pix.tobytes("png"))
            page_keys.append(scratch_key)
        chunks.append({"index": idx, "kind": "pdf", "pageKeys": page_keys})
    return chunks
