"""System prompt + forced tool schema for the bulk-import extraction call.

Both are built per-invocation (not static) because the valid domain list
depends on the target pack — see build_system_prompt/build_tool_schema.
Kept in its own module so the prompt text can be iterated on without
touching the Lambda's control flow in app.py.
"""

BASE_SYSTEM_PROMPT = """You are extracting ONE structured multiple-choice certification exam question from raw, messy source material. The material is either page images from a browser-printed PDF quiz-results export, or scraped Markdown text (possibly with duplicated headings).

Rules:
- Extract exactly ONE question: its stem, its alternatives, and which one(s) are correct.
- IGNORE any past-test-taker status labels near the question (e.g. "Incorreto", "Correto", "Ignorado", "Ignored", or a lone "Correct"/"Incorrect" placeholder line sitting next to an option with no other content) — these describe what some OTHER person answered before on this exam attempt, NOT the true correct answer.
- The true correct answer is identified ONLY by: (a) explicit prose such as "Hence, the correct answer is: ..." / "Correct option: ..." / "Resposta correta e explicação geral", or (b) a visually distinguished box/label such as "Resposta correta" / "Correct answer" with a different border color from the other options.
- If the question requires selecting more than one option (e.g. "Select TWO"), mark ALL of the truly correct alternatives with isCorrect: true, each with its own comment.
- IGNORE any unrelated supplementary/tutorial/reference content that appears in the supplied material (e.g. a full page of an unrelated linked blog/doc article with its own diagrams) — extract ONLY the actual question, alternatives, and their explanations.
- IGNORE trailing "References:" / "Check out these Cheat Sheets:" link blocks.
- Write a short, descriptive title.
- List 3-6 key concepts/technologies tested in "topics", and any AWS service names mentioned in "relatedServices".
- For each alternative's "comment": summarize why it's correct or incorrect, reusing the source material's own explanation where present rather than inventing new reasoning. IMPORTANT: summarizing/shortening the prose is NOT a reason to drop an image reference that was in the part you're summarizing — see the Images rule below, which still applies even inside a shortened comment.
- Images: every image you were given was extracted from material belonging to THIS specific question (not a random unrelated page), so assume an image is relevant unless it's obviously decorative or clearly about something else. If an image illustrates the stem, a specific alternative, or the reasoning in a comment (e.g. an architecture diagram the explanation depends on), you MUST reference it inline with a `{{IMG:n}}` placeholder (n = 0-based index among the images you were given, in the order given) exactly where it belongs in that field's text — do this even when you're summarizing or shortening the surrounding explanation for a comment; keeping the `{{IMG:n}}` marker takes priority over trimming length. Never write literal `![...](...)` Markdown image syntax yourself — always use `{{IMG:n}}` for any image you were given, even if the source text already contained its own image syntax at that spot.
- You MUST call the emit_question tool exactly once with your extraction. Do not respond with plain text.
"""


def build_system_prompt(domain_names):
    if not domain_names:
        return BASE_SYSTEM_PROMPT
    domain_list = "\n".join(f"- {d}" for d in domain_names)
    return (
        BASE_SYSTEM_PROMPT
        + "\n\nThe \"domain\" field MUST be exactly one of the following values — pick "
        "the single closest match to this question's content, or to its source "
        "category text if given. Never invent a new domain name:\n" + domain_list
    )


def build_tool_schema(domain_names):
    domain_property = {
        "type": "string",
        "description": "Exam domain/category this question belongs to.",
    }
    if domain_names:
        domain_property["enum"] = domain_names

    return {
        "toolSpec": {
            "name": "emit_question",
            "description": (
                "Emit one fully structured multiple-choice exam question extracted "
                "from the supplied source material."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Short, descriptive title for this question.",
                        },
                        "domain": domain_property,
                        "stem": {
                            "type": "string",
                            "description": (
                                "The full question text (scenario + question). If one of the "
                                "supplied images illustrates the scenario, include its "
                                "{{IMG:n}} placeholder here."
                            ),
                        },
                        "alternatives": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "letter": {"type": "string"},
                                    "text": {"type": "string"},
                                    "isCorrect": {"type": "boolean"},
                                    "comment": {
                                        "type": "string",
                                        "description": (
                                            "Summary of why this alternative is correct or "
                                            "incorrect. If the source explanation you are "
                                            "summarizing was accompanied by one of the supplied "
                                            "images, you MUST still include that image's "
                                            "{{IMG:n}} placeholder in this summary — shortening "
                                            "the text is not a reason to drop the image."
                                        ),
                                    },
                                },
                                "required": ["letter", "text", "isCorrect", "comment"],
                            },
                        },
                        "topics": {"type": "array", "items": {"type": "string"}},
                        "relatedServices": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["title", "domain", "stem", "alternatives"],
                }
            },
        }
    }
