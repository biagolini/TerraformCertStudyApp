# .kiro/ — Kiro CLI Configuration for This Project

This folder contains the local [Kiro CLI](https://kiro.dev) configuration — an AI-powered development assistant that runs directly in your terminal. These settings are **project-specific** and allow Kiro to automatically understand the repository context.

## Structure

```
.kiro/
├── README.md                              ← this file
├── agents/
│   └── local-agent.json                   ← local agent configuration
└── settings/
    └── mcp.json                           ← project MCP servers
```

## What Does Each File Do?

### `agents/local-agent.json` — Local Agent

Defines **how Kiro behaves** when working on this project:

| Field | Purpose |
|---|---|
| `prompt` | System instruction — tells Kiro it is a Terraform/AWS expert and must follow the project's coding conventions |
| `tools` | Available tools (read/write files, execute commands, interact with AWS) |
| `allowedTools` | Auto-approved tools (no confirmation prompt on each use) |
| `toolsSettings` | Per-tool settings — here, read-only AWS and bash operations are auto-approved |
| `resources` | Files automatically loaded into Kiro's context (README.md, all .tf files) |
| `hooks` | Commands executed on triggers — `agentSpawn` runs `terraform version` when a session starts |

**Why does this matter?** Without this configuration, Kiro has no knowledge of the project's conventions. With it, Kiro already knows the naming patterns, file structure, and best practices defined in the project.

### `settings/mcp.json` — MCP Servers

Defines **which MCP (Model Context Protocol) servers** are available to Kiro in this project. MCP servers are external services that give Kiro access to specialized knowledge and tools.

| Server | Type | Purpose |
|---|---|---|
| `awslabs.aws-documentation-mcp-server` | Local (stdio) | Real-time access to official AWS documentation |
| `aws-knowledge-mcp-server` | Remote (HTTP) | AWS-managed server with docs, API references, blog posts, and Well-Architected guidance |
| `terraform` | Local (Docker) | HashiCorp's official server for Terraform providers, modules, and registry lookups |

## Prerequisites

To use these configurations, you need:

- [Kiro CLI](https://kiro.dev) — the AI assistant
- [uv](https://docs.astral.sh/uv/getting-started/installation/) — Python package manager (used by AWS MCP servers)
- [Docker](https://www.docker.com/) — required for the HashiCorp Terraform MCP server

## Usage

1. Install Kiro CLI following the [official documentation](https://kiro.dev)
2. Navigate to the root of this project
3. Start a session:

```bash
kiro-cli chat --agent local-agent
```

Kiro will automatically:
- Detect the local agent in `.kiro/agents/local-agent.json`
- Load MCP servers from `.kiro/settings/mcp.json`
- Run `terraform version` to confirm the environment is ready
- Load the project context (README.md, .tf files)

## Local vs Global

Kiro supports configuration at two levels:

| Level | Path | Scope |
|---|---|---|
| **Local** (this project) | `.kiro/agents/` and `.kiro/settings/` | This repository only |
| **Global** (user-wide) | `~/.kiro/agents/` and `~/.kiro/settings/` | All projects |

Local configurations take **precedence** over global ones. This allows each project to have its own specialized agent.

## References

- [Kiro CLI — Documentation](https://kiro.dev/docs)
- [Agent Configuration — Full format reference](https://kiro.dev/docs/cli/agents/)
- [MCP Servers for AWS — awslabs/mcp](https://github.com/awslabs/mcp)
- [HashiCorp Terraform MCP Server](https://github.com/hashicorp/terraform-mcp-server)
- [Model Context Protocol — Specification](https://modelcontextprotocol.io)
