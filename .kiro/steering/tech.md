---
inclusion: always
---

# Tech Choices

Defaults to follow when adding or changing anything in the stack. Rationale and per-service detail live in `docs/` (see `workflow.md`).

## Infrastructure as Code

- Terraform `>= 1.10`, HCL only.
- AWS provider pinned `~> 6.0`. Do not silently bump the major.
- Extra providers only when actually used: `random` (already used), `null` (Lambda builds via `local-exec`), `archive` (plain zip packaging).

## Runtime

- Lambda functions are Python `3.13`, standard library plus `boto3`. Add a dependency only with a reason.
- Functions that serve HTTP (`converse`, `data`, `review`) run Flask behind the Lambda Web Adapter layer with `handler = "run.sh"`; streaming ones set `AWS_LWA_INVOKE_MODE`.
- Lambda packaging: `null_resource` + `local-exec` running `pip install --platform manylinux2014_aarch64 ... --only-binary=:all:` then `zip`, keyed off a `filesha256` trigger so a build re-runs only when its source changes. Artifacts land in the gitignored `.build/`.
- The AgentCore review agent ships as a container image through ECR, built by a script (no native Terraform resource exists for AgentCore).

## Frontend

- Angular 21 standalone SPA with Signals; Angular Material only for a few dialogs/spinners.
- Vitest with jsdom for unit tests, specs colocated as `*.spec.ts`.
- The build is static and served from S3 behind CloudFront. Never assume a server-side runtime in the frontend.

## AI

- Amazon Bedrock only. Interactive flows use `converse_stream`; bulk extraction uses `converse` with vision plus forced tool-use.
- The model list is discovered at runtime (`ListFoundationModels` / `ListInferenceProfiles`), not hardcoded; keep the static fallback working.

## State

Remote Terraform state lives in S3, configured through `backend.hcl` at `terraform init` time. That file is gitignored and only the `.example` is committed, so no bucket, profile, or key names belong in code, docs, or steering. Setup steps are in `backend/README.md`.
