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
- "generalComment": an OPTIONAL overall explanation for the question as a whole, distinct from any single alternative's own comment — use it for a unifying insight, a concept that spans multiple options, or an explanation the source material presented separately from any one option (e.g. under its own "Explicação geral"/"General explanation" heading). Leave it empty if there is nothing like that beyond what the per-alternative comments already cover — do NOT repeat or summarize those comments here.
- Images — placement rule: place an image's `{{IMG:n}}` placeholder (n = 0-based index among the images you were given, in the order given) in the QUESTION STEM or in an ALTERNATIVE'S "text" field ONLY IF examining that image is MANDATORY to answer the question — meaning the stem itself explicitly depends on it (e.g. it says "as shown below", "based on the following diagram", "given the configuration above", "in the screenshot below") and the question cannot be correctly answered from the text alone. If an image is merely explanatory or illustrative — for example, it only supports the correct answer's rationale, or decorates a topic mentioned in passing, but the question itself can be understood and answered without looking at it — it must NOT go in the stem or any alternative's "text". Instead, place it in the relevant alternative's "comment", or in "generalComment" if it doesn't belong to one specific alternative. Never write literal `![...](...)` Markdown image syntax yourself — always use `{{IMG:n}}` for any image you were given, even if the source text already contained its own image syntax at that spot. When in doubt whether the stem truly requires the image, prefer placing it in a comment instead of the stem.

Examples of images that ARE mandatory in the stem (the question cannot be answered without them):
1. "A company has the VPC architecture shown in the diagram below. Which change would allow the private subnet to reach the internet?" — the stem explicitly references "the diagram below" and the answer depends on details (subnet layout, route tables, NAT/IGW placement) only visible in that image. Correct: `{{IMG:0}}` placed in the stem.
2. "The following EventBridge rule has a custom event pattern, as shown below. Which change would make this rule match S3 object-created events for the given bucket?" — the actual event-pattern JSON is only visible in the image; you cannot judge whether the pattern is correct without reading it. Correct: `{{IMG:0}}` placed in the stem.
3. "Based on the CloudWatch metrics graph below, showing CPUUtilization over the last hour, what Auto Scaling adjustment is most appropriate?" — the stem asks you to interpret a specific shape/value in the graph. Correct: `{{IMG:0}}` placed in the stem.
4. "A developer sees the following error in the console when deploying the Lambda function, as captured in the screenshot. What is the most likely cause?" — the exact error text/UI state is only visible in the screenshot and is the entire subject of the question. Correct: `{{IMG:0}}` placed in the stem.

Example of an image that is NOT mandatory (must go in a comment instead): the stem asks "Which service should the team use to run a fully managed relational database with automatic failover?" without referencing any image, and the only available image is a diagram attached to the correct answer's explanation illustrating a Multi-AZ RDS failover. The question is fully answerable from the text alone — do NOT place `{{IMG:n}}` in the stem or in any alternative's "text"; instead place it in that alternative's "comment" (or "generalComment"), since it only supports the rationale, not the question itself.
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
                                "The full question text (scenario + question). Only include a "
                                "supplied image's {{IMG:n}} placeholder here if examining that "
                                "image is MANDATORY to answer the question (the stem explicitly "
                                "depends on it, e.g. 'as shown below'). If the image is merely "
                                "explanatory, put it in a comment field instead, not here."
                            ),
                        },
                        "alternatives": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "letter": {"type": "string"},
                                    "text": {
                                        "type": "string",
                                        "description": (
                                            "The alternative's own text. Only include a supplied "
                                            "image's {{IMG:n}} placeholder here if examining that "
                                            "image is MANDATORY to answer the question — not "
                                            "merely explanatory. See the Images rule."
                                        ),
                                    },
                                    "isCorrect": {"type": "boolean"},
                                    "comment": {
                                        "type": "string",
                                        "description": (
                                            "Summary of why this alternative is correct or "
                                            "incorrect. If the source explanation you are "
                                            "summarizing was accompanied by one of the supplied "
                                            "images, you MUST still include that image's "
                                            "{{IMG:n}} placeholder in this summary — shortening "
                                            "the text is not a reason to drop the image. This is "
                                            "also where a merely-explanatory image (not mandatory "
                                            "to answer the question) belongs, never in the stem "
                                            "or in this alternative's own \"text\" field."
                                        ),
                                    },
                                },
                                "required": ["letter", "text", "isCorrect", "comment"],
                            },
                        },
                        "topics": {"type": "array", "items": {"type": "string"}},
                        "relatedServices": {"type": "array", "items": {"type": "string"}},
                        "generalComment": {
                            "type": "string",
                            "description": (
                                "OPTIONAL overall explanation for the question as a whole, "
                                "distinct from any single alternative's own comment — e.g. a "
                                "unifying insight, or the source's own separate 'Explicação "
                                "geral'/'General explanation' section if present. Leave empty "
                                "if there's nothing beyond what the per-alternative comments "
                                "already cover. Also where a merely-explanatory image not tied "
                                "to one specific alternative belongs."
                            ),
                        },
                    },
                    "required": ["title", "domain", "stem", "alternatives"],
                }
            },
        }
    }
