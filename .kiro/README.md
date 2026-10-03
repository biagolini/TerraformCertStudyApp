# .kiro/ — Kiro CLI Configuration for This Project

This folder contains the local [Kiro CLI](https://kiro.dev) configuration. These settings are **project-specific** and let Kiro understand how work should be done in this repository.

## Structure

```
.kiro/
├── README.md                    ← this file
├── agents/
│   └── local-agent.json         ← agent identity, tools, resources, hooks
├── settings/
│   └── mcp.json                 ← project MCP servers
└── steering/                    ← persistent RULES loaded into context every turn
    ├── workflow.md              ← how work should be done (verification, secrets, git, docs index)
    ├── product.md               ← product context that should drive decisions
    ├── tech.md                  ← stack defaults (versions, runtimes, packaging)
    ├── terraform.md             ← Terraform conventions
    └── structure.md             ← where things live
```

## Steering vs. Documentation (an intentional split)

Steering files are loaded into the agent's context on **every turn**, so they are treated strictly as **rules and conventions**: how to verify a change, what must never be committed, naming and style conventions, and the principles behind product decisions.

Project **documentation** deliberately does NOT live here. It lives in [`docs/`](../docs/) and [`README.md`](../README.md), and the agent reads those files on demand. Putting design detail in steering would burn context on every turn and duplicate what `docs/` already maintains for humans. `steering/workflow.md` carries only a short index of which doc covers what, so the agent knows where to look.

Practical rule when adding content: if it tells the agent *how to behave*, it belongs in `steering/`. If it describes *how the system works*, it belongs in `docs/`.

## What Each File Does

### `agents/local-agent.json`

| Field | Purpose |
|---|---|
| `prompt` | Agent identity and working style. Kept deliberately thin, since conventions live in steering rather than being duplicated here |
| `tools` | Available tools (read/write files, run commands, AWS access, MCP tools) |
| `toolsSettings` | Per-tool settings; read-only AWS and shell operations are auto-approved |
| `resources` | Files always loaded into context: the steering rules |
| `hooks` | `agentSpawn` runs `terraform version` and `node --version` to confirm both toolchains are present |

Note: custom agents do not load steering automatically, which is why `resources` declares `file://.kiro/steering/**/*.md` explicitly.

### `settings/mcp.json`

| Server | Type | Why it is here |
|---|---|---|
| `awslabs.aws-documentation-mcp-server` | Local (stdio, `uvx`) | Official AWS documentation lookup |
| `aws-knowledge-mcp-server` | Remote (AWS-managed) | Broader AWS content: docs, API references, regional availability, guidance |
| `terraform` | Local (Docker) | Terraform registry: provider schemas and module docs, which AWS documentation does not cover. Useful because the AWS provider is pinned `~> 6.0` |
| `awslabs.amazon-bedrock-agentcore-mcp-server` | Local (stdio, `uvx`) | The review agent runs on Bedrock AgentCore, which has no native Terraform resource. Restricted to the `runtime` and `gateway` tool sets via `AGENTCORE_ENABLE_TOOLS` to keep the tool surface small |
| `awslabs.cloudwatch-mcp-server` | Local (stdio, `uvx`) | Debugging the Lambdas, Step Functions executions, and AgentCore runtime logs. Reads the profile from the `AWS_PROFILE` environment variable, so no real profile name is committed |

## Prerequisites

- [Kiro CLI](https://kiro.dev)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) — provides `uvx`, used by the AWS MCP servers
- [Docker](https://www.docker.com/) — required only by the Terraform MCP server
- An AWS profile exported as `AWS_PROFILE` for the CloudWatch MCP server

## Usage

```bash
kiro-cli chat --agent local-agent
```

Kiro will detect the local agent, load the MCP servers, load the steering rules into context, and run the version hooks.

## Local vs Global

| Level | Path | Scope |
|---|---|---|
| **Local** (this project) | `.kiro/agents/`, `.kiro/settings/`, `.kiro/steering/` | This repository only |
| **Global** (user-wide) | `~/.kiro/agents/`, `~/.kiro/settings/`, `~/.kiro/steering/` | All projects |

Local configuration takes precedence over global for same-named entries.

## References

- [Kiro CLI documentation](https://kiro.dev/docs)
- [MCP Servers for AWS — awslabs/mcp](https://github.com/awslabs/mcp)
- [HashiCorp Terraform MCP Server](https://github.com/hashicorp/terraform-mcp-server)
- [Model Context Protocol specification](https://modelcontextprotocol.io)
