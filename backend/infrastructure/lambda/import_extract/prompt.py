"""System prompt + forced tool schema for the bulk-import STRUCTURE extraction
call only (stem, alternatives, which is correct, domain, images, and any
explanation the SOURCE material already provides).

The final `comment`/`generalComment`/`topics`/`relatedServices` a Question
actually ships with are still generated fresh by the AgentCore Runtime review
agent (see app.py's `_generate_explanation` call, made after this extraction
succeeds), not copied verbatim from here — that produced noticeably weaker
explanations than the interactive "Generate with AI" flow when this call used
to write them itself. What THIS module extracts as `sourceComment`/
`sourceGeneralComment` is raw material FOR that agent to ground itself in
(ready-made practice-exam explanations are often already correct and save the
agent from re-deriving everything from scratch) — the agent still verifies
and rewrites it, never just relays it uncritically. Three source layouts are
common enough to name explicitly in the prompt below: (1) a per-alternative
"Explanation" box directly under each option, (2) a single "Overall
explanation"/"Explanation" block after all options, not tied to one option,
and (3) both a per-option box AND a trailing overall block in the same
question. See .temp/model1.png, model2.png, model3.png (repo-local reference
screenshots) for what each looks like.

Images are classified, not inlined: rather than asking the model to embed an
`{{IMG:n}}`-style placeholder correctly inside prose it's simultaneously
composing (previously observed to be unreliable — images silently dropped or
placed in the wrong spot), each image gets ONE simple classification in a
separate top-level `images` array: which field it belongs to (the stem, one
alternative's own text, one alternative's source explanation, the overall
source explanation, or "couldn't tell" — see ImportDraftImageTarget on the
frontend). A human reviewer can freely reassign or drop any of these on the
review screen — seeing every image with its own classification is far
easier to fix than hunting for a misplaced token buried in a paragraph.

Built per-invocation (not static) because the valid domain list depends on
the target pack — see build_system_prompt/build_tool_schema. Kept in its own
module so the prompt text can be iterated on without touching the Lambda's
control flow in app.py.
"""

BASE_SYSTEM_PROMPT = """You are extracting ONE structured multiple-choice certification exam question from raw, messy source material. The material is either page images from a browser-printed PDF quiz-results export, or scraped Markdown text (possibly with duplicated headings).

Rules:
- Extract exactly ONE question: its stem, its alternatives, which one(s) are correct, and any explanation the source material already provides for them (see "Explanations" below).
- The stem is EVERYTHING from the start of the question up to (but not including) the first answer option — copy it COMPLETE AND VERBATIM, including every scenario paragraph before the final question sentence. A real exam stem is very often 2-4 paragraphs (company/context, constraints, what's already been tried, THEN the question itself) — do not treat the earlier paragraphs as optional framing to drop or compress. Keeping only the last sentence/paragraph and discarding the scenario before it is a critical extraction failure, not an acceptable summary — the scenario details are frequently required to pick the correct answer.
- IGNORE any past-test-taker status labels near the question (e.g. "Incorreto", "Correto", "Ignorado", "Ignored", or a lone "Correct"/"Incorrect" placeholder line sitting next to an option with no other content) — these describe what some OTHER person answered before on this exam attempt, NOT the true correct answer. This noise is NOT limited to standalone lines — it very often sits GLUED directly in front of the real scenario text with no line break at all, as one run-on chunk, e.g. "Pergunta 3 Ignorado Explique melhor A global financial services company manages..." or "Question 7 Correct Explain better As a DevOps Engineer...". In that exact pattern, the true stem begins ONLY at "A global financial..."/"As a DevOps Engineer..." — the leading "Pergunta N"/"Question N" heading number, the status word ("Ignorado"/"Correto"/"Incorreto"/"Correct"/"Incorrect"), and the "Explique melhor"/"Explain better" link text are ALL UI chrome from the source export and must never appear anywhere in the extracted stem, not even as its first few words. Read past all of it to find where the actual scenario sentence starts.
- The true correct answer is identified ONLY by: (a) explicit prose such as "Hence, the correct answer is: ..." / "Correct option: ..." / "Resposta correta e explicação geral", or (b) a visually distinguished box/label such as "Resposta correta" / "Correct answer" with a different border color from the other options.
- If the question requires selecting more than one option (e.g. "Select TWO"), mark ALL of the truly correct alternatives with isCorrect: true.
- IGNORE any unrelated supplementary/tutorial/reference content that appears in the supplied material (e.g. a full page of an unrelated linked blog/doc article with its own diagrams) — extract ONLY the actual question, its alternatives, and their explanations.
- IGNORE trailing "References:" / "Check out these Cheat Sheets:" link blocks.
- Write a short, descriptive title.
- Formatting: wrap any technical identifier in backticks — a parameter/field/property name (e.g. `runOrder`, `MaxConcurrency`), a CLI flag, a file or path name, an API/service action name, an environment variable, or a literal code value — exactly as a technical reader expects to see it typeset, e.g. "Change the `runOrder` of your actions". Apply this consistently in the stem, every alternative's text, AND any explanation text you extract — not just where the source material itself already used special formatting, since the source is often plain, unstyled text and you still need to add this. Use **bold** only for genuine emphasis, never as a substitute for backticks on a technical term.
- Never write image Markdown syntax (`![...](...)`) or any `{{...}}` placeholder token yourself, anywhere in stem/alternative/explanation text — images are classified separately, see "Images" below. Text fields are plain prose only.

Explanations — practice-exam sources almost always ship one of these layouts, sometimes both at once:
1. A per-alternative box directly under EACH option (often literally headed "Explanation"), giving a reason specific to that one option — correct or not.
2. A single "Overall explanation" / "Explanation" block AFTER all the options, not tied to any one specific option — usually restates the correct answer and explains the reasoning for the question as a whole.
Extract whatever is actually present, verbatim/lightly cleaned (still strip the same status-label noise as the stem — never invent an explanation that isn't in the source):
- If you can tell which option a piece of explanation text belongs to, put it in that alternative's "sourceComment".
- If a piece of explanation clearly applies to the whole question rather than one option (or you cannot confidently attribute it to a single option), put it in the top-level "generalComment" instead of guessing which option it belongs to.
- It is normal and expected for many questions to have NO explanation at all in the source — leave "sourceComment"/"generalComment" absent (do not fabricate one) rather than inventing reasoning; that is a separate, later step performed by a different system.

Images — you were given zero or more images alongside this question, in a fixed order (image 0, image 1, ...). For EVERY image you were given, add exactly one entry to the top-level "images" array classifying where it belongs:
- "stem" — examining the image is MANDATORY to answer the question itself (the stem explicitly depends on it, e.g. "as shown below", "based on the following diagram", "given the configuration above") and the question cannot be correctly answered from the text alone.
- "alternativeText" (with "alternativeLetter" set) — examining the image is MANDATORY to evaluate that ONE specific alternative (rare — most alternatives are plain text).
- "alternativeComment" (with "alternativeLetter" set) — the image illustrates that one alternative's OWN explanation (e.g. a diagram inside its "Explanation" box), rather than the question or alternative itself.
- "generalComment" — the image illustrates the OVERALL explanation (e.g. an architecture diagram inside an "Overall explanation" block after all options), not the question itself.
- "unplaced" — decorative (e.g. a repeated page header/logo), purely illustrative with no clear single home, or you genuinely cannot tell where it belongs. Use this rather than guessing.
When in doubt between the stem/an alternative's own text vs. an explanation field, prefer the explanation field — most images support an explanation rather than being mandatory to answer the question itself.

Examples of images that ARE mandatory (target: "stem"):
1. "A company has the VPC architecture shown in the diagram below. Which change would allow the private subnet to reach the internet?" — the answer depends on details (subnet layout, route tables, NAT/IGW placement) only visible in that image.
2. "The following EventBridge rule has a custom event pattern, as shown below. Which change would make this rule match S3 object-created events for the given bucket?" — the actual event-pattern JSON is only visible in the image.
3. "Based on the CloudWatch metrics graph below, showing CPUUtilization over the last hour, what Auto Scaling adjustment is most appropriate?" — the stem asks you to interpret a specific shape/value in the graph.
Example of target: "generalComment" — the question itself is fully answerable from text alone, but the source's "Overall explanation" block includes a diagram illustrating why the correct answer works (e.g. a cost-optimization workflow diagram).
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
                "Emit one structured multiple-choice exam question extracted "
                "from the supplied source material — stem, alternatives, which "
                "is correct, any explanation the source material already "
                "provides for them, and where each supplied image belongs. "
                "The FINAL explanation a student sees is still generated "
                "separately by the review agent — what's captured here is "
                "reference material for that agent, not the final text."
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
                                "The COMPLETE question text, copied verbatim — every scenario "
                                "paragraph plus the final question sentence, not just the last "
                                "paragraph. Never summarize or shorten it. Plain prose only — "
                                "never include image Markdown or a placeholder token; classify "
                                "images separately in the top-level \"images\" array instead. "
                                "Wrap every technical identifier (parameter/field name, CLI "
                                "flag, file/path name, API action, env var, literal code value) "
                                "in backticks, e.g. 'the `runOrder` value' — the source text is "
                                "plain and will not already have these, you must add them "
                                "yourself."
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
                                            "The alternative's own text. Plain prose only — "
                                            "never include image Markdown or a placeholder "
                                            "token; classify images separately in the top-level "
                                            "\"images\" array instead. Wrap every technical "
                                            "identifier (parameter/field name, CLI flag, "
                                            "file/path name, API action, env var, literal code "
                                            "value) in backticks, e.g. 'Change the `runOrder`' — "
                                            "the source text is plain and will not already have "
                                            "these, you must add them yourself."
                                        ),
                                    },
                                    "isCorrect": {"type": "boolean"},
                                    "sourceComment": {
                                        "type": "string",
                                        "description": (
                                            "OPTIONAL — this option's own explanation, if the "
                                            "source material has one directly attributable to it "
                                            "(e.g. an 'Explanation' box right under this option). "
                                            "Omit entirely if the source has no such text for this "
                                            "option, or if you can't confidently attribute the "
                                            "explanation you see to this specific option — put it "
                                            "in the top-level generalComment instead in that case. "
                                            "Never invent one. Plain prose only — never include "
                                            "image Markdown or a placeholder token."
                                        ),
                                    },
                                },
                                "required": ["letter", "text", "isCorrect"],
                            },
                        },
                        "generalComment": {
                            "type": "string",
                            "description": (
                                "OPTIONAL — an overall explanation for the question as a whole "
                                "from the source material (e.g. an 'Overall explanation' block "
                                "after all the options), used when the source's explanation isn't "
                                "attributable to one specific option, or when you can't tell which "
                                "option a piece of explanation belongs to. Omit entirely if the "
                                "source has no such text. Never invent one. Plain prose only — "
                                "never include image Markdown or a placeholder token."
                            ),
                        },
                        "images": {
                            "type": "array",
                            "description": (
                                "EXACTLY one entry per image you were given (same order: entry "
                                "0 describes image 0, etc.) — see the \"Images\" rule above."
                            ),
                            "items": {
                                "type": "object",
                                "properties": {
                                    "index": {
                                        "type": "integer",
                                        "description": "0-based index of the image this entry describes.",
                                    },
                                    "target": {
                                        "type": "string",
                                        "enum": [
                                            "stem",
                                            "alternativeText",
                                            "alternativeComment",
                                            "generalComment",
                                            "unplaced",
                                        ],
                                    },
                                    "alternativeLetter": {
                                        "type": "string",
                                        "description": (
                                            "REQUIRED when target is 'alternativeText' or "
                                            "'alternativeComment' — which alternative's letter "
                                            "this image belongs to. Omit otherwise."
                                        ),
                                    },
                                },
                                "required": ["index", "target"],
                            },
                        },
                    },
                    "required": ["title", "domain", "stem", "alternatives"],
                }
            },
        }
    }
