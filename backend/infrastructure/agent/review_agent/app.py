"""Cert Study Assistant — question-review agent, hosted on Bedrock AgentCore Runtime.

Replaces the old client-built-prompt + raw Bedrock converse_stream pipeline
(see backend/infrastructure/lambda/converse/app.py, which still handles chat/
transcripts, untouched) with a Strands Agent that has:
  - a dedicated "skill" (skills/cert-question-review) encoding the same
    pedagogical Markdown template the old client prompt used, so the
    frontend's existing positional-heading parser needs no changes;
  - a second skill (skills/aws-doc-grounding) instructing it to verify
    technical claims via the AWS-documentation tool before drafting;
  - that AWS-documentation tool wired in as an MCP tool, discovered from the
    AgentCore Gateway's MCP endpoint (SigV4-authenticated, IAM authorizer).

Two callers, one agent:
  - the interactive "review" Lambda (streaming Markdown, free-form text —
    mode=from_scratch/refine; kept as Markdown because live token-by-token
    streaming and a forced-schema tool call don't mix, and the frontend's
    existing positional-heading parser already handles this format)
  - the bulk-import "import_extract" Lambda (non-streaming,
    mode=explain_structured — structure was already extracted by that
    Lambda's own vision call; this call supplies only the explanation, as
    schema-validated structured output — see ReviewExplanation below. Free-
    form Markdown here was observed skipping required sections/going empty
    under real traffic; forced structured output can't omit a required
    field the way free text can silently omit a heading).
"""

import json
import logging
import os
import uuid

import boto3
import httpx
from bedrock_agentcore import BedrockAgentCoreApp
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from mcp.client.streamable_http import streamable_http_client
from pydantic import BaseModel, Field
from strands import Agent, AgentSkills
from strands.models.bedrock import BedrockModel
from strands.tools.mcp.mcp_client import MCPClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("review_agent")

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-2-lite-v1:0")
SKILLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skills")

# Model ids known to support the Converse reasoning capability
# (additionalModelRequestFields.reasoningConfig) — kept in sync with the
# same pattern in lambda/converse/app.py's REASONING_MODEL_PATTERNS.
REASONING_MODEL_PATTERNS = ("nova-2",)


def _supports_reasoning(model_id: str) -> bool:
    return any(pattern in model_id for pattern in REASONING_MODEL_PATTERNS)


def _build_model():
    # Explicit max_tokens, generous: reasoning content (when enabled) and
    # tool-use round-trips (Gateway doc lookups) both count against the same
    # per-call budget as the final answer text — observed directly: with
    # 8192, a call that involved a real tool call came back with
    # reviewMarkdown == "" (stop_reason likely max_tokens, cut off before
    # the post-tool-result synthesis produced any text). Nova 2 models
    # support up to 65536 output tokens; 24576 leaves real headroom for
    # reasoning + one or two tool round-trips + the full review.
    config = {"model_id": BEDROCK_MODEL_ID, "region_name": AWS_REGION, "max_tokens": 24576}
    if _supports_reasoning(BEDROCK_MODEL_ID):
        # "medium" effort: this task now explicitly requires working out a
        # concrete "what would make this option correct" condition per
        # incorrect alternative, not just a one-line label — worth the
        # extra reasoning budget over "low". ("high" would forbid
        # temperature, which we still want available.)
        config["additional_request_fields"] = {
            "reasoningConfig": {"type": "enabled", "maxReasoningEffort": "medium"}
        }
    return BedrockModel(**config)

app = BedrockAgentCoreApp()


class SigV4HttpxAuth(httpx.Auth):
    """SigV4-signs outgoing httpx requests using the container's own AWS
    credentials (injected by AgentCore Runtime) — the Gateway's MCP endpoint
    uses AWS_IAM authorization, so every request must be signed the same way
    a boto3 call would be, not just carry a bearer token."""

    # On the async client this MCP transport uses, request.content is empty
    # for a not-yet-read streaming body unless httpx is told to await-read
    # it first — signing an empty body while a non-empty one is actually
    # sent produces a signature mismatch that the Gateway reports as a
    # generic "Authentication error - Invalid credentials", not a signature
    # error. This flag makes httpx's default async_auth_flow do that read
    # before calling auth_flow() below (see httpx.Auth.async_auth_flow).
    requires_request_body = True

    def __init__(self, service: str, region: str):
        self._service = service
        self._region = region
        self._credentials = boto3.Session().get_credentials()

    def auth_flow(self, request):
        aws_request = AWSRequest(
            method=request.method,
            url=str(request.url),
            data=request.content,
            headers=dict(request.headers),
        )
        SigV4Auth(self._credentials, self._service, self._region).add_auth(aws_request)
        request.headers.update(dict(aws_request.headers))
        yield request


def _make_mcp_tools():
    """Best-effort: connect to the Gateway's MCP endpoint and return
    (tools, client). Returns ([], None) — not a raised error — if the
    Gateway isn't reachable; a review that skips documentation grounding is
    far better than an agent that can't start at all.

    Called fresh on every `invoke()` (see `_build_agent()`), never cached
    at module scope. MCPClient.start() spins up its own background thread
    holding ONE stateful session — BedrockAgentCoreApp (bedrock_agentcore.
    runtime.app) serves every request through a single shared asyncio event
    loop, and the Step Functions Map driving bulk import runs up to 4
    questions concurrently (see import_workflow.asl.json.tpl's
    MaxConcurrency), so a single module-level client was being used by
    several concurrent Agent runs at once. Confirmed as the cause of a real
    75-question bulk import where 20 questions failed: 16 with
    `agent.invoke_async(...).structured_output` silently coming back None
    (the forced structured-output tool call landing on the wrong in-flight
    session) and 4 with a bare `Read timeout on endpoint URL: "None"` (the
    shared client's connection state corrupted mid-request). One MCP
    handshake per call is a small latency cost against that.

    Passes `url=` (not a custom `transport_callable`) — Strands' MCPClient
    only accepts `auth`/`auth_provider`/`headers` alongside `url`; combining
    them with a `transport_callable` raises "require 'url' (not compatible
    with 'transport_callable')" at construction time (found via a real
    failed Gateway connection in AgentCore Runtime's CloudWatch logs)."""
    if not GATEWAY_URL:
        logger.warning("GATEWAY_URL not set — starting without MCP doc-lookup tools")
        return [], None
    try:
        auth = SigV4HttpxAuth(service="bedrock-agentcore", region=AWS_REGION)
        client = MCPClient(url=GATEWAY_URL, auth_provider=auth)
        client.start()
        return client.list_tools_sync(), client
    except Exception:  # noqa: BLE001 — degrade gracefully, never block startup
        logger.exception("Failed to connect to AgentCore Gateway MCP endpoint")
        return [], None


def _load_skill_body(skill_name: str) -> str:
    """Strips a SKILL.md's YAML frontmatter, returning just its instruction
    body. Used to inline cert-question-review directly into the system
    prompt rather than relying on AgentSkills' tool-triggered progressive
    disclosure — that mechanism needs the model to proactively decide to
    load it, and Nova 2 Lite was observed skipping it on some calls,
    producing a review that doesn't match the required Markdown template
    (the frontend/import_extract parsers need that exact template — this
    isn't optional formatting). AgentSkills stays wired in for
    aws-doc-grounding, where occasionally-skipped tool research only
    reduces grounding depth rather than breaking parsing."""
    path = os.path.join(SKILLS_DIR, skill_name, "SKILL.md")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if content.startswith("---"):
        end = content.find("\n---", 3)
        if end != -1:
            content = content[end + 4 :]
    return content.strip()


CERT_QUESTION_REVIEW_SKILL = _load_skill_body("cert-question-review")
AWS_DOC_GROUNDING_SKILL = _load_skill_body("aws-doc-grounding")


def _build_agent():
    """Returns (agent, mcp_client). mcp_client is None if the Gateway
    wasn't reachable — the caller (`invoke()`) is responsible for calling
    `mcp_client.stop(None, None, None)` once done with the agent (see
    `_make_mcp_tools()` for why this can't be a shared module-level
    singleton)."""
    # Both skills are inlined directly into the system prompt rather than
    # left to AgentSkills' tool-triggered progressive disclosure — that
    # mechanism needs the model to proactively decide to load each skill,
    # and Nova 2 Lite was observed (a) skipping cert-question-review
    # entirely on some calls, breaking the required output format, and (b)
    # never calling the doc-lookup tool at all even when it was available,
    # leaving the Gateway/MCP wiring present but unused. Both skills apply
    # to every single call here — there's no context-budget reason to gate
    # them behind discovery. AgentSkills stays registered anyway so the
    # SKILL.md files remain real Strands Skills, usable by a model that
    # follows the activation convention reliably.
    mcp_tools, mcp_client = _make_mcp_tools()
    doc_tool_note = (
        (
            "\n\nYou have a documentation-lookup tool available "
            "(search_documentation / read_documentation) — the instructions "
            "above (aws-doc-grounding) require using it before drafting, "
            "not just when convenient."
        )
        if mcp_tools
        else ""
    )
    agent = Agent(
        model=_build_model(),
        tools=mcp_tools,
        plugins=[AgentSkills(skills=SKILLS_DIR)],
        callback_handler=None,
        system_prompt=(
            "You write certification exam question reviews. Follow the "
            "instructions below EXACTLY — they define your required output "
            "format; deviating from it breaks the application that "
            "consumes your response.\n\n"
            f"{CERT_QUESTION_REVIEW_SKILL}\n\n"
            f"{AWS_DOC_GROUNDING_SKILL}"
            f"{doc_tool_note}"
        ),
    )
    return agent, mcp_client


def _pack_context_block(pack: dict, include_classification: bool = True) -> str:
    name = (pack or {}).get("name") or ""
    description = (pack or {}).get("description") or ""
    domains = (pack or {}).get("domains") or []

    cert_line = (
        f"The user is studying for the **{name}** certification."
        if name
        else "The user is studying for an IT certification exam."
    )
    desc_block = f"\nCertification overview:\n{description}" if description else ""

    if not include_classification:
        # explain_structured callers (import_extract) already know the
        # domain from their own vision extraction — asking for it again
        # here would just leak an unused INFERRED_TITLE/INFERRED_DOMAIN
        # trailer into the visible "General comment" section.
        return f"{cert_line}{desc_block}"

    if domains:
        domain_lines = "\n".join(
            f"{i + 1}. {d.get('name', '')}" + (f"\n   {d['description']}" if d.get("description") else "")
            for i, d in enumerate(domains)
        )
        domain_block = (
            "The following knowledge domains have been defined for this "
            f"certification:\n{domain_lines}\n\nClassify this question into "
            "one of these domains. At the very end of your response, AFTER "
            "all other content, output these two lines exactly, as PLAIN "
            "TEXT — do NOT prefix them with #### or any other heading "
            "marker, do NOT make them a section of the review:\n"
            'INFERRED_TITLE: [short 4-8 word descriptive title, no prefixes like '
            '"Scenario:" or "Question:", no quotes]\n'
            "INFERRED_DOMAIN: [exact domain name from the list above]"
        )
    else:
        domain_block = (
            "No specific domains have been defined. Classify this question "
            "under the domain name: General\n\nAt the very end of your "
            "response, AFTER all other content, output these two lines "
            "exactly, as PLAIN TEXT — do NOT prefix them with #### or any "
            "other heading marker, do NOT make them a section of the "
            "review:\nINFERRED_TITLE: [short 4-8 word descriptive title, no "
            'prefixes like "Scenario:" or "Question:", no quotes]\n'
            "INFERRED_DOMAIN: General"
        )

    return f"{cert_line}{desc_block}\n\n{domain_block}"


def _language_block(output_language: str) -> str:
    if not output_language:
        return (
            "\nOUTPUT LANGUAGE: Write the entire response in the same "
            "language as the input question. Do not add translation lines."
        )
    return (
        f"\nOUTPUT LANGUAGE: The student selected output language code "
        f"'{output_language}'. In \"Question\" and \"Alternatives\": keep "
        "the original text intact, then add a *Translation:* line in that "
        "language after each item. In the Correct/Incorrect sections: "
        "restate each option's letter and exact original text (no "
        "*Translation:* line there), and write the explanation prose ONLY "
        "in that language, exactly once."
    )


# --- Structured output schema for mode=explain_structured (bulk import) ---
# Field descriptions double as the per-field instructions the model sees —
# they mirror the cert-question-review skill's bullet structure exactly, so
# the skill's pedagogical guidance (ground in docs, name the mechanism, work
# out the "trap" condition) still applies even though delivery is schema-
# validated tool output rather than free Markdown prose. Letters are the
# only reference back to the input — text is never restated (see the
# explain_structured prompt branch above) to eliminate the transcription-
# error class of bug entirely for this path.


class CorrectAnswerExplanation(BaseModel):
    letter: str = Field(description="The option's letter, exactly as given in the input (e.g. 'B')")
    why_correct: str = Field(
        description=(
            "The underlying mechanism, service behavior, or best practice that makes this "
            "true — name the specific feature/setting/API involved and what it actually "
            "does. Never just restate the option text."
        )
    )
    how_it_satisfies_scenario: str = Field(
        description=(
            "Ties this option explicitly back to the concrete requirement(s) stated in "
            "THIS question's stem — name the specific requirement it meets and how. "
            "Never a generic 'it meets the requirements.'"
        )
    )
    worth_knowing: str | None = Field(
        default=None,
        description="Optional — a cost trade-off, operational limit, or related feature worth knowing alongside this answer.",
    )


class IncorrectAnswerExplanation(BaseModel):
    letter: str = Field(description="The option's letter, exactly as given in the input (e.g. 'A')")
    why_incorrect: str = Field(
        description=(
            "The specific technical/conceptual error — name the mechanism that actually "
            "fails or the requirement it actually misses, not a vague 'not the best fit.'"
        )
    )
    additional_problem: str | None = Field(
        default=None,
        description="Optional operational risk, anti-pattern, cost, or production consequence of picking this option.",
    )
    trap: str = Field(
        description=(
            "The SPECIFIC change to this scenario — a different constraint, scale, or "
            "requirement dropped/added — that would flip this option from wrong to "
            "correct. If no realistic variation of this scenario would make it correct, "
            "say so explicitly and explain why, rather than leaving this vague."
        )
    )


class ReviewExplanation(BaseModel):
    topics: list[str] = Field(description="3-6 core concepts/technologies tested by this question.")
    correct_answers: list[CorrectAnswerExplanation] = Field(
        description="One entry per option marked [CORRECT] in the input, in the same letters."
    )
    incorrect_answers: list[IncorrectAnswerExplanation] = Field(
        description="One entry per option NOT marked [CORRECT] in the input, in the same letters."
    )
    general_comment: str | None = Field(
        default=None,
        description=(
            "OPTIONAL overall insight applying to the question as a whole that doesn't "
            "belong to any single option — a unifying concept or a trap spanning multiple "
            "options. Null if there's nothing beyond the per-option explanations."
        ),
    )


def _render_answer_bullets(item: "CorrectAnswerExplanation | IncorrectAnswerExplanation") -> str:
    """Renders one structured-output entry into the same bulleted-text shape
    the Markdown path produces, so review-viewer.component.ts (which
    displays `alternative.comment` as-is) needs no changes regardless of
    which path generated it."""
    if isinstance(item, CorrectAnswerExplanation):
        lines = [
            f"- **Why it is correct**: {item.why_correct}",
            f"- **How it satisfies this scenario**: {item.how_it_satisfies_scenario}",
        ]
        if item.worth_knowing:
            lines.append(f"- **Worth knowing**: {item.worth_knowing}")
    else:
        lines = [f"- **Why it is incorrect**: {item.why_incorrect}"]
        if item.additional_problem:
            lines.append(f"- **Additional problem**: {item.additional_problem}")
        lines.append(f"- **When it would be valid — the trap**: {item.trap}")
    return "\n".join(lines)


def _source_material_block(alternatives: list, source_general_comment: str | None) -> str:
    """Renders whatever explanation the ORIGINAL exam source already
    provided (captured during Phase 1 extraction — see
    lambda/import_extract/prompt.py) as a clearly-labeled, explicitly
    untrusted reference block appended to the explain_structured prompt.
    Empty string (no block at all) when the source had no explanation to
    offer — most questions won't, and that's normal, not a gap to flag."""
    per_alt = [
        f"{a.get('letter')}: {a['sourceComment']}"
        for a in alternatives
        if a.get("sourceComment")
    ]
    if not per_alt and not source_general_comment:
        return ""
    lines = [
        "\n\nSOURCE MATERIAL (reference only, NOT verified — the original "
        "exam file already included this explanation text for this "
        "question). Use it as a starting point and cross-check it, exactly "
        "like any other unverified claim per the skill above — the source "
        "can be incomplete, superficial, or simply wrong. Do not copy it "
        "verbatim; your own explanation must still meet the skill's depth "
        "and grounding bar on its own.",
    ]
    if per_alt:
        lines.append("Per-option source explanation:\n" + "\n".join(per_alt))
    if source_general_comment:
        lines.append(f"Overall source explanation:\n{source_general_comment}")
    return "\n\n".join(lines)


def _build_prompt(payload: dict) -> tuple[str, bool]:
    """Returns (prompt_text, wants_related_services)."""
    mode = payload.get("mode", "from_scratch")
    pack_block = _pack_context_block(payload.get("pack"), include_classification=mode != "explain_structured")
    language_block = _language_block(payload.get("outputLanguage", ""))

    if mode == "refine":
        current_review = payload.get("currentReview", "")
        feedback = payload.get("feedback", "")
        return (
            f"{pack_block}{language_block}\n\n"
            "Refine the following existing review per the skill's own "
            "refinement rules, applying this feedback:\n\n"
            f"FEEDBACK:\n{feedback}\n\nEXISTING REVIEW:\n{current_review}"
        ), False

    if mode == "explain_structured":
        stem = payload.get("stem", "")
        alternatives = payload.get("alternatives") or []
        alt_lines = "\n".join(
            f"{a.get('letter')}. {'[CORRECT] ' if a.get('isCorrect') else ''}{a.get('text', '')}"
            for a in alternatives
        )
        source_material = _source_material_block(alternatives, payload.get("sourceGeneralComment"))
        return (
            f"{pack_block}{language_block}\n\n"
            "The structure below was already extracted correctly by another "
            "system — do not re-derive it, do not change which option(s) "
            "are marked [CORRECT], and do not restate the stem or option "
            "text anywhere in your output (the caller already has it "
            "verbatim — retyping it only risks transcription errors). "
            "Your response is captured through a structured output tool, "
            "not free-form Markdown — populate its fields following the "
            "same depth and 'trap' reasoning the skill above "
            "describes.\n\nQUESTION:\n{stem}\n\nALTERNATIVES:\n{alts}{source}".format(
                stem=stem, alts=alt_lines, source=source_material
            )
        ), True

    # from_scratch — raw pasted text, agent parses structure itself per skill.
    question_text = payload.get("questionText", "")
    return f"{pack_block}{language_block}\n\nRaw pasted question text:\n\n{question_text}", False


_RELATED_SERVICES_SYSTEM_PROMPT = """You extract the specific named services or products a certification exam question is about.

Read the question and its alternatives. Output ONLY a JSON array of strings — the exact names of vendor
services/products referenced or clearly implied (e.g. "Amazon S3", "AWS Lambda", "Azure Functions",
"Claude", "Kubernetes"). Do not include generic concepts (e.g. "object storage", "high availability") —
only concrete named services/products.

STRICT OUTPUT RULES:
- Output ONLY the JSON array, nothing else. No markdown code fences, no explanation.
- If no specific named service/product is referenced, output [].
- Deduplicate. Use the vendor's official product name/casing (e.g. "Amazon EC2", not "ec2").
- Maximum 8 items."""


# Deliberately not BEDROCK_MODEL_ID: tested Nova 2 Lite directly against
# this exact prompt (with and without reasoning) and it consistently
# returned "[]" for questions that plainly reference AWS Elastic
# Beanstalk/RDS/Flyway — Nova Pro (already used by import_extract for a
# similarly narrow classification task) got it right immediately. A small,
# infrequent, non-agentic call, so the extra cost is negligible.
RELATED_SERVICES_MODEL_ID = "us.amazon.nova-pro-v1:0"


def _extract_related_services(stem: str, alternatives: list) -> list:
    """Small, separate, non-agentic call — mirrors
    frontend/src/app/core/utils/enrichment-prompt.util.ts. Kept out of the
    main Strands agent loop since it's a narrow classification task, not
    part of the review-writing skill."""
    bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    options_text = "\n".join(f"{a.get('letter')}. {a.get('text', '')}" for a in alternatives)
    user_text = f"Question:\n{stem}\n\nAlternatives:\n{options_text}"
    try:
        response = bedrock.converse(
            modelId=RELATED_SERVICES_MODEL_ID,
            system=[{"text": _RELATED_SERVICES_SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": [{"text": user_text}]}],
            inferenceConfig={"maxTokens": 512},
        )
        text = response["output"]["message"]["content"][0]["text"].strip()
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else []
    except Exception:  # noqa: BLE001 — related services are optional metadata
        logger.exception("relatedServices extraction failed")
        return []


async def _explain_structured(agent, prompt: str, call_id: str, wants_related_services: bool, payload: dict) -> dict:
    """Schema-validated structured output (Strands' structured_output_model
    — forced tool-use under the hood, the same mechanism Nova models use for
    "constrained decoding") instead of free-form Markdown for this path
    specifically. Free text here was observed both skipping required
    sections and, once, returning entirely empty after a tool-use
    round-trip — a required Pydantic field can't be silently omitted the way
    a Markdown heading can.

    Retries once, with an explicit nudge appended to the same conversation,
    if `result.structured_output` comes back None despite the call itself
    not raising — Strands' own forced-retry can still land on an
    `end_turn` the model produced without ever calling the tool at all
    (distinct from the concurrent-MCP-client corruption `_make_mcp_tools`
    now avoids — that surfaced as this same symptom, but a single flaky
    generation can too, independent of concurrency). Only one retry: this
    already runs inside the per-question Step Functions Map's own retry
    envelope, so a second local failure should surface, not loop silently.
    """
    for attempt in range(2):
        result = await agent.invoke_async(prompt, structured_output_model=ReviewExplanation)
        explanation: ReviewExplanation | None = result.structured_output
        if explanation is not None:
            response = {
                "topics": explanation.topics,
                "generalComment": explanation.general_comment,
                "comments": {
                    item.letter.upper(): _render_answer_bullets(item)
                    for item in [*explanation.correct_answers, *explanation.incorrect_answers]
                },
            }
            if wants_related_services:
                response["relatedServices"] = _extract_related_services(
                    payload.get("stem", ""), payload.get("alternatives") or []
                )
            logger.info(json.dumps({
                "event": "review_call_end", "callId": call_id, "ok": True,
                "stopReason": result.stop_reason, "attempt": attempt,
                "structuredOutput": explanation.model_dump(),
                "relatedServices": response.get("relatedServices"),
            }))
            return response

        logger.warning(json.dumps({
            "event": "structured_output_empty", "callId": call_id,
            "attempt": attempt, "stopReason": result.stop_reason,
        }))
        prompt = (
            "Your previous response did not produce a valid ReviewExplanation "
            "structured output — no tool call was captured. You MUST call the "
            "structured output tool now, with complete, valid arguments for "
            "every required field (topics, correct_answers, incorrect_answers), "
            "covering the SAME question as above. Do not respond in plain text."
        )

    raise ValueError("Review agent failed to produce structured output after retry")


@app.entrypoint
async def invoke(payload: dict):
    agent, mcp_client = _build_agent()
    prompt, wants_related_services = _build_prompt(payload)
    stream = bool(payload.get("stream", True))

    # Every review call, logged in full (system prompt + the per-call user
    # prompt below) to CloudWatch — the Runtime's own log group, retention
    # managed by Terraform (see aws_agentcore.tf). Lets the actual prompt a
    # given review was generated from be inspected after the fact, not just
    # guessed at by reading the skill file in isolation.
    call_id = uuid.uuid4().hex
    logger.info(json.dumps({
        "event": "review_call_start",
        "callId": call_id,
        "mode": payload.get("mode"),
        "stream": stream,
        "packName": (payload.get("pack") or {}).get("name"),
        "outputLanguage": payload.get("outputLanguage"),
        "systemPrompt": agent.system_prompt,
        "userPrompt": prompt,
    }))

    try:
        if not stream and payload.get("mode") == "explain_structured":
            try:
                response = await _explain_structured(agent, prompt, call_id, wants_related_services, payload)
                yield response
            except Exception as e:  # noqa: BLE001
                logger.exception("Structured review generation failed")
                logger.info(json.dumps({"event": "review_call_end", "callId": call_id, "ok": False, "error": str(e)}))
                yield {"error": str(e)}
            return

        if not stream:
            try:
                result = await agent.invoke_async(prompt)
                markdown = str(result)
                response = {"reviewMarkdown": markdown}
                if wants_related_services:
                    response["relatedServices"] = _extract_related_services(
                        payload.get("stem", ""), payload.get("alternatives") or []
                    )
                logger.info(json.dumps({
                    "event": "review_call_end", "callId": call_id, "ok": True,
                    "stopReason": result.stop_reason, "reviewMarkdown": markdown,
                    "relatedServices": response.get("relatedServices"),
                }))
                yield response
            except Exception as e:  # noqa: BLE001
                logger.exception("Non-streaming review generation failed")
                logger.info(json.dumps({"event": "review_call_end", "callId": call_id, "ok": False, "error": str(e)}))
                yield {"error": str(e)}
            return

        accumulated = ""
        try:
            async for event in agent.stream_async(prompt):
                text = event.get("data") if isinstance(event, dict) else None
                if text:
                    accumulated += text
                    yield {"type": "TOKEN", "text": text}
            logger.info(json.dumps({
                "event": "review_call_end", "callId": call_id, "ok": True, "reviewMarkdown": accumulated,
            }))
            yield {"type": "END"}
        except Exception as e:  # noqa: BLE001
            logger.exception("Streaming review generation failed")
            logger.info(json.dumps({"event": "review_call_end", "callId": call_id, "ok": False, "error": str(e)}))
            yield {"type": "ERROR", "message": str(e)}
    finally:
        if mcp_client:
            try:
                mcp_client.stop(None, None, None)
            except Exception:  # noqa: BLE001 — best-effort cleanup, never mask the real result
                logger.exception("Failed to stop MCP client")


if __name__ == "__main__":
    app.run(port=8080)
