"""Parses the review agent's Markdown output into topics/generalComment/
per-letter comments — a small Python port of the algorithm documented in
docs/question-ingestion.md and implemented in
frontend/src/app/core/utils/question-parse.util.ts.

Simplified relative to the frontend parser: the caller (app.py) already
knows this question's structure (stem/alternatives/correct letter) from its
own vision extraction, so this only needs to harvest explanation content by
section name — it doesn't re-derive or validate structure.
"""

import re

_HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$")
_OPTION_LINE_RE = re.compile(r"^\*([A-Za-z])\.\s*(.+?)\*$")
_ANNOTATION_LINE_RE = re.compile(r"^\*[^*:]{2,24}:\s*.+\*$")
_GENERAL_COMMENT_HEADING_RE = re.compile(r"^(General comment|General explanation)\s*:?$", re.IGNORECASE)
_KEY_CONCEPTS_HEADING_RE = re.compile(r"^Key concepts", re.IGNORECASE)
_BULLET_RE = re.compile(r"^[-*]\s+(.+)$")


def _sections(lines):
    """Yields (heading_text, content_lines) for each `#`-heading block."""
    heading_idxs = [i for i, line in enumerate(lines) if _HEADING_RE.match(line.strip())]
    for pos, idx in enumerate(heading_idxs):
        end = heading_idxs[pos + 1] if pos + 1 < len(heading_idxs) else len(lines)
        heading_text = _HEADING_RE.match(lines[idx].strip()).group(1).strip()
        yield heading_text, lines[idx + 1 : end]


def _extract_letter_comments(lines):
    """An ordered letter -> comment map from a section that restates each
    option's letter+text (`*B. text*`) followed by prose explaining it."""
    comments = {}
    current_letter = None
    current_lines = []

    def flush():
        if current_letter:
            comments[current_letter] = "\n".join(current_lines).strip()

    for raw in lines:
        line = raw.strip()
        if not line or _ANNOTATION_LINE_RE.match(line):
            continue
        match = _OPTION_LINE_RE.match(line)
        if match:
            flush()
            current_letter = match.group(1).upper()
            current_lines = []
        elif current_letter:
            current_lines.append(line)
    flush()
    return comments


def parse_review_markdown(markdown: str) -> dict:
    """Returns {"topics": [...], "generalComment": str|None, "comments": {letter: text}}."""
    lines = markdown.replace("\r\n", "\n").split("\n")
    topics = []
    general_comment = None
    correct_comments = {}
    incorrect_comments = {}

    for heading, content in _sections(lines):
        if _KEY_CONCEPTS_HEADING_RE.match(heading):
            topics = [
                bullet.group(1).replace("**", "").strip()
                for bullet in (_BULLET_RE.match(line.strip()) for line in content)
                if bullet
            ]
        elif _GENERAL_COMMENT_HEADING_RE.match(heading):
            text = "\n".join(content).strip()
            general_comment = text or None
        elif heading.lower().startswith("correct answer"):
            correct_comments = _extract_letter_comments(content)
        elif heading.lower().startswith("incorrect answer"):
            incorrect_comments = _extract_letter_comments(content)

    return {
        "topics": topics,
        "generalComment": general_comment,
        "comments": {**incorrect_comments, **correct_comments},
    }
