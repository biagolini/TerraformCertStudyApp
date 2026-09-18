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

An image's association with the stem, one specific alternative, its
per-alternative source comment, or the general source comment is captured
implicitly by WHICH text field its `{{IMG:n}}` placeholder ends up in — the
same single mechanism `_rewrite_images` (app.py) already resolves for the
stem/alternative text, now just extended to two more fields, rather than a
second parallel "image location" scheme.

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

Explanations — practice-exam sources almost always ship one of these layouts, sometimes both at once:
1. A per-alternative box directly under EACH option (often literally headed "Explanation"), giving a reason specific to that one option — correct or not.
2. A single "Overall explanation" / "Explanation" block AFTER all the options, not tied to any one specific option — usually restates the correct answer and explains the reasoning for the question as a whole.
Extract whatever is actually present, verbatim/lightly cleaned (still strip the same status-label noise as the stem — never invent an explanation that isn't in the source):
- If you can tell which option a piece of explanation text belongs to, put it in that alternative's "sourceComment".
- If a piece of explanation clearly applies to the whole question rather than one option (or you cannot confidently attribute it to a single option), put it in the top-level "generalComment" instead of guessing which option it belongs to.
- It is normal and expected for many questions to have NO explanation at all in the source — leave "sourceComment"/"generalComment" absent (do not fabricate one) rather than inventing reasoning; that is a separate, later step performed by a different system.

Images — placement rule: place an image's `{{IMG:n}}` placeholder (n = 0-based index among the images you were given, in the order given) in whichever field it actually belongs to:
- The QUESTION STEM or an ALTERNATIVE'S "text" — ONLY IF examining that image is MANDATORY to answer the question (the stem explicitly depends on it, e.g. "as shown below", "based on the following diagram", "given the configuration above", "in the screenshot below") and the question cannot be correctly answered from the text alone.
- An alternative's "sourceComment" or the top-level "generalComment" — if the image instead illustrates an EXPLANATION (e.g. an architecture diagram inside the "Overall explanation" box, a screenshot embedded in one option's own explanation) rather than the question itself.
Only omit an image entirely if it's decorative and belongs to none of the above (e.g. a repeated page header/logo). Never write literal `![...](...)` Markdown image syntax yourself — always use `{{IMG:n}}` for any image you place, even if the source text already contained its own image syntax at that spot. When in doubt whether the stem/alternative text truly requires the image (as opposed to it only supporting an explanation), prefer placing it in the relevant "sourceComment"/"generalComment" over the stem/alternative text.

Examples of images that ARE mandatory in the stem (the question cannot be answered without them):
1. "A company has the VPC architecture shown in the diagram below. Which change would allow the private subnet to reach the internet?" — the stem explicitly references "the diagram below" and the answer depends on details (subnet layout, route tables, NAT/IGW placement) only visible in that image. Correct: `{{IMG:0}}` placed in the stem.
2. "The following EventBridge rule has a custom event pattern, as shown below. Which change would make this rule match S3 object-created events for the given bucket?" — the actual event-pattern JSON is only visible in the image; you cannot judge whether the pattern is correct without reading it. Correct: `{{IMG:0}}` placed in the stem.
3. "Based on the CloudWatch metrics graph below, showing CPUUtilization over the last hour, what Auto Scaling adjustment is most appropriate?" — the stem asks you to interpret a specific shape/value in the graph. Correct: `{{IMG:0}}` placed in the stem.
4. "A developer sees the following error in the console when deploying the Lambda function, as captured in the screenshot. What is the most likely cause?" — the exact error text/UI state is only visible in the screenshot and is the entire subject of the question. Correct: `{{IMG:0}}` placed in the stem.
Example of an image that belongs in an explanation instead: the question itself is fully answerable from text alone, but the "Overall explanation" box below the options includes a diagram illustrating why the correct answer works (e.g. a cost-optimization workflow diagram). Correct: `{{IMG:0}}` placed inside "generalComment", not the stem.
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
                "is correct, and any explanation the source material already "
                "provides for them. The FINAL explanation a student sees is "
                "still generated separately by the review agent — what's "
                "captured here is reference material for that agent, not the "
                "final text."
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
                                "paragraph. Never summarize or shorten it. Only include a "
                                "supplied image's {{IMG:n}} placeholder here if examining that "
                                "image is MANDATORY to answer the question (the stem explicitly "
                                "depends on it, e.g. 'as shown below'). Wrap every technical "
                                "identifier (parameter/field name, CLI flag, file/path name, "
                                "API action, env var, literal code value) in backticks, e.g. "
                                "'the `runOrder` value' — the source text is plain and will not "
                                "already have these, you must add them yourself."
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
                                            "merely explanatory. See the Images rule. Wrap every "
                                            "technical identifier (parameter/field name, CLI flag, "
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
                                            "Never invent one. May include an {{IMG:n}} placeholder "
                                            "if an image illustrates specifically this option's "
                                            "explanation."
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
                                "source has no such text. Never invent one. May include an "
                                "{{IMG:n}} placeholder if an image illustrates this general "
                                "explanation rather than the question itself."
                            ),
                        },
                    },
                    "required": ["title", "domain", "stem", "alternatives"],
                }
            },
        }
    }
