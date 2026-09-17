#!/usr/bin/env python3
"""Idempotent create-or-update for the AgentCore Gateway (+ its Lambda
target) and the AgentCore Runtime (+ its DEFAULT endpoint).

Terraform has no native aws_bedrockagentcore_* resources mature enough to
rely on yet (see the "AgentCore deployment is CLI/boto3-first today" note in
aws_agentcore.tf), so this script is the bridge, invoked as a Terraform
`external` data source: reads a JSON object on stdin (the data source's
`query`), does the boto3 create-or-update via `bedrock-agentcore-control`,
and prints a flat string->string JSON object on stdout for Terraform to
consume as `data.external.<name>.result`.

Usage: stdin must contain {"action": "gateway"|"runtime", ...action-specific
fields, all string-valued per the `external` data source contract}.
"""

import json
import sys
import time

import boto3

READY_STATUSES = {"READY"}
FAILED_STATUSES = {"CREATE_FAILED", "UPDATE_FAILED", "FAILED", "UPDATE_UNSUCCESSFUL"}
POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 600


def _wait_until_ready(get_status, label):
    deadline = time.time() + POLL_TIMEOUT_SECONDS
    while time.time() < deadline:
        status = get_status()
        if status in READY_STATUSES:
            return
        if status in FAILED_STATUSES:
            raise RuntimeError(f"{label} reached failed status: {status}")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError(f"{label} did not become READY within {POLL_TIMEOUT_SECONDS}s")


def _docs_tool_schema():
    return [
        {
            "name": "search_documentation",
            "description": (
                "Search official AWS documentation for a phrase and return "
                "matching pages with titles, URLs, and short excerpts."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "search_phrase": {"type": "string", "description": "Search phrase"},
                    "limit": {"type": "integer", "description": "Max results (default 5)"},
                },
                "required": ["search_phrase"],
            },
        },
        {
            "name": "read_documentation",
            "description": (
                "Fetch an AWS documentation page (docs.aws.amazon.com) and "
                "return its readable text content."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "docs.aws.amazon.com page URL"},
                    "max_length": {"type": "integer", "description": "Max characters to return (default 8000)"},
                },
                "required": ["url"],
            },
        },
    ]


def _client(q):
    """Uses the same AWS profile Terraform itself runs under — the
    environment's default credentials can silently resolve to a different
    account (observed once: an unrelated SSO session), so this must not
    rely on ambient boto3 credential-chain fallback."""
    session = boto3.Session(profile_name=q["profile"]) if q.get("profile") else boto3.Session()
    return session.client("bedrock-agentcore-control", region_name=q["region"])


def deploy_gateway(q):
    client = _client(q)
    name = q["name"]

    existing = next(
        (g for g in client.list_gateways().get("items", []) if g["name"] == name), None
    )
    if existing is None:
        created = client.create_gateway(
            name=name,
            roleArn=q["role_arn"],
            protocolType="MCP",
            authorizerType="AWS_IAM",
        )
        gateway_id = created["gatewayId"]
    else:
        gateway_id = existing["gatewayId"]

    _wait_until_ready(
        lambda: client.get_gateway(gatewayIdentifier=gateway_id)["status"], "Gateway"
    )

    target_config = {
        "mcp": {
            "lambda": {
                "lambdaArn": q["docs_lambda_arn"],
                "toolSchema": {"inlinePayload": _docs_tool_schema()},
            }
        }
    }
    credential_config = [{"credentialProviderType": "GATEWAY_IAM_ROLE"}]

    existing_target = next(
        (
            t
            for t in client.list_gateway_targets(gatewayIdentifier=gateway_id).get("items", [])
            if t["name"] == "aws-docs-tool"
        ),
        None,
    )
    if existing_target is None:
        client.create_gateway_target(
            gatewayIdentifier=gateway_id,
            name="aws-docs-tool",
            targetConfiguration=target_config,
            credentialProviderConfigurations=credential_config,
        )
        target_id = None
    else:
        target_id = existing_target["targetId"]
        client.update_gateway_target(
            gatewayIdentifier=gateway_id,
            targetId=target_id,
            name="aws-docs-tool",
            targetConfiguration=target_config,
            credentialProviderConfigurations=credential_config,
        )

    _wait_until_ready(
        lambda: client.get_gateway_target(
            gatewayIdentifier=gateway_id,
            targetId=target_id
            or next(
                t["targetId"]
                for t in client.list_gateway_targets(gatewayIdentifier=gateway_id)["items"]
                if t["name"] == "aws-docs-tool"
            ),
        )["status"],
        "Gateway target",
    )

    gateway = client.get_gateway(gatewayIdentifier=gateway_id)
    return {"gateway_id": gateway_id, "gateway_url": gateway["gatewayUrl"]}


def deploy_runtime(q):
    client = _client(q)
    name = q["name"]

    env_vars = {"GATEWAY_URL": q["gateway_url"], "BEDROCK_MODEL_ID": q["bedrock_model_id"]}
    artifact = {"containerConfiguration": {"containerUri": q["image_uri"]}}

    existing = next(
        (
            r
            for r in client.list_agent_runtimes().get("agentRuntimes", [])
            if r["agentRuntimeName"] == name
        ),
        None,
    )
    if existing is None:
        created = client.create_agent_runtime(
            agentRuntimeName=name,
            agentRuntimeArtifact=artifact,
            roleArn=q["role_arn"],
            networkConfiguration={"networkMode": "PUBLIC"},
            protocolConfiguration={"serverProtocol": "HTTP"},
            environmentVariables=env_vars,
        )
        runtime_id = created["agentRuntimeId"]
    else:
        runtime_id = existing["agentRuntimeId"]
        client.update_agent_runtime(
            agentRuntimeId=runtime_id,
            agentRuntimeArtifact=artifact,
            roleArn=q["role_arn"],
            networkConfiguration={"networkMode": "PUBLIC"},
            protocolConfiguration={"serverProtocol": "HTTP"},
            environmentVariables=env_vars,
        )

    _wait_until_ready(
        lambda: client.get_agent_runtime(agentRuntimeId=runtime_id)["status"], "Agent runtime"
    )

    # The DEFAULT endpoint is auto-managed by create/update_agent_runtime
    # itself — CreateAgentRuntimeEndpoint/UpdateAgentRuntimeEndpoint reject
    # "DEFAULT" explicitly ("managed through agent updates"). Just wait for
    # it to reflect the update above.
    _wait_until_ready(
        lambda: client.get_agent_runtime_endpoint(
            agentRuntimeId=runtime_id, endpointName="DEFAULT"
        )["status"],
        "Agent runtime endpoint",
    )

    runtime = client.get_agent_runtime(agentRuntimeId=runtime_id)
    return {"runtime_id": runtime_id, "runtime_arn": runtime["agentRuntimeArn"]}


def main():
    query = json.load(sys.stdin)
    action = query["action"]
    if action == "gateway":
        result = deploy_gateway(query)
    elif action == "runtime":
        result = deploy_runtime(query)
    else:
        raise ValueError(f"Unknown action: {action}")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
