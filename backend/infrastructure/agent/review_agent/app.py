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
  - the interactive "review" Lambda (streaming, mode=from_scratch/refine)
  - the bulk-import "import_extract" Lambda (non-streaming,
    mode=explain_structured — structure was already extracted by that
    Lambda's own vision call; this call supplies only the explanation).
"""

import json
import logging
import os

import boto3
import httpx
from bedrock_agentcore import BedrockAgentCoreApp
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from mcp.client.streamable_http import streamable_http_client
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
    if not _supports_reasoning(BEDROCK_MODEL_ID):
        return BEDROCK_MODEL_ID
    # "low" effort suits this task's structured-writing-with-tool-lookups
    # profile and keeps temperature usable (only "high" forbids it).
    return BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=AWS_REGION,
        additional_request_fields={
            "reasoningConfig": {"type": "enabled", "maxReasoningEffort": "low"}
        },
    )

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
    """Best-effort: connect to the Gateway's MCP endpoint and return its
    tools. Returns [] (not a raised error) if the Gateway isn't reachable —
    a review that skips documentation grounding is far better than an agent
    that can't start at all.

    Passes `url=` (not a custom `transport_callable`) — Strands' MCPClient
    only accepts `auth`/`auth_provider`/`headers` alongside `url`; combining
    them with a `transport_callable` raises "require 'url' (not compatible
    with 'transport_callable')" at construction time (found via a real
    failed Gateway connection in AgentCore Runtime's CloudWatch logs)."""
    if not GATEWAY_URL:
        logger.warning("GATEWAY_URL not set — starting without MCP doc-lookup tools")
        return []
    try:
        auth = SigV4HttpxAuth(service="bedrock-agentcore", region=AWS_REGION)
        client = MCPClient(url=GATEWAY_URL, auth_provider=auth)
        client.start()
        return client.list_tools_sync()
    except Exception:  # noqa: BLE001 — degrade gracefully, never block startup
        logger.exception("Failed to connect to AgentCore Gateway MCP endpoint")
        return []


MCP_TOOLS = _make_mcp_tools()


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
    doc_tool_note = (
        (
            "\n\nYou have a documentation-lookup tool available "
            "(search_documentation / read_documentation) — the instructions "
            "above (aws-doc-grounding) require using it before drafting, "
            "not just when convenient."
        )
        if MCP_TOOLS
        else ""
    )
    return Agent(
        model=_build_model(),
        tools=MCP_TOOLS,
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


def _pack_context_block(pack: dict) -> str:
    name = (pack or {}).get("name") or ""
    description = (pack or {}).get("description") or ""
    domains = (pack or {}).get("domains") or []

    cert_line = (
        f"The user is studying for the **{name}** certification."
        if name
        else "The user is studying for an IT certification exam."
    )
    desc_block = f"\nCertification overview:\n{description}" if description else ""

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


def _build_prompt(payload: dict) -> tuple[str, bool]:
    """Returns (prompt_text, wants_related_services)."""
    mode = payload.get("mode", "from_scratch")
    pack_block = _pack_context_block(payload.get("pack"))
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
        return (
            f"{pack_block}{language_block}\n\n"
            "The structure below was already extracted correctly by another "
            "system — do not re-derive it, do not change which option(s) "
            "are marked [CORRECT]. Write the review using exactly this "
            "structure.\n\nQUESTION:\n{stem}\n\nALTERNATIVES:\n{alts}".format(
                stem=stem, alts=alt_lines
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


@app.entrypoint
async def invoke(payload: dict):
    agent = _build_agent()
    prompt, wants_related_services = _build_prompt(payload)
    stream = bool(payload.get("stream", True))

    if not stream:
        try:
            result = await agent.invoke_async(prompt)
            markdown = str(result)
            response = {"reviewMarkdown": markdown}
            if wants_related_services:
                response["relatedServices"] = _extract_related_services(
                    payload.get("stem", ""), payload.get("alternatives") or []
                )
            yield response
        except Exception as e:  # noqa: BLE001
            logger.exception("Non-streaming review generation failed")
            yield {"error": str(e)}
        return

    try:
        async for event in agent.stream_async(prompt):
            text = event.get("data") if isinstance(event, dict) else None
            if text:
                yield {"type": "TOKEN", "text": text}
        yield {"type": "END"}
    except Exception as e:  # noqa: BLE001
        logger.exception("Streaming review generation failed")
        yield {"type": "ERROR", "message": str(e)}


if __name__ == "__main__":
    app.run(port=8080)
