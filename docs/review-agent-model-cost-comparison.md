# Review agent model choice: Bedrock access blockers and Nova vs Claude pricing

**Review date: 2026-09-17.** A point-in-time investigation done while migrating question-review generation to the AgentCore Runtime review agent (see `question-ingestion.md` and `question-import-pipeline.md`) — kept here so the reasoning behind `review_agent_model_id` (in `backend/environments/production/terraform.tfvars`, default in `backend/infrastructure/variables.tf`) doesn't have to be rediscovered later. Bedrock model access and pricing both change over time; re-verify before trusting these numbers again.

## Why this came up

The migration's mission explicitly asked for a Claude model ("quality over speed" for explanation writing), so the agent (`backend/infrastructure/agent/review_agent/app.py`) defaulted to `us.anthropic.claude-sonnet-4-6`. Direct end-to-end testing against the deployed AgentCore Runtime (in the project's AWS account, region `us-east-1`) hit account-level Bedrock access problems that had nothing to do with the agent code itself.

## What actually failed, in order

1. `us.anthropic.claude-sonnet-5` — `AccessDeniedException: ... is not available for this account.`
2. `us.anthropic.claude-sonnet-4-6` (moments after a direct CLI `converse` call to the *same* model succeeded) — `ResourceNotFoundException: Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model.`
3. After the "use case" form was submitted — a different, more specific error:
   ```
   AccessDeniedException: Model access is denied due to INVALID_PAYMENT_INSTRUMENT:
   A valid payment instrument must be provided.. Your AWS Marketplace subscription
   for this model cannot be completed at this time.
   ```
   Third-party models on Bedrock (Anthropic, Meta, Mistral, etc.) are provisioned through an AWS Marketplace subscription behind the scenes, separate from the account's regular AWS billing. This error means the account's AWS Marketplace payment method isn't set up — a Billing and Cost Management console fix, not something Terraform, IAM, or the agent code can resolve. It also explains why the AWS Bedrock **console Playground** could successfully call `claude-sonnet-4-6` (confirmed directly by the project owner) while the API path could not: the Playground doesn't force the same Marketplace subscription completion the `Converse`/`ConverseStream` API call does.

## What was confirmed working in this account (same day)

Tested directly via `bedrock-runtime converse` with the project's AWS profile:

| Model ID | Result |
|---|---|
| `us.amazon.nova-2-lite-v1:0` | Works |
| `us.amazon.nova-pro-v1:0` | Works (already used by `import_extract`'s structure-extraction call) |
| `us.amazon.nova-premier-v1:0` | Fails — AWS marks it legacy/inactive, unrelated to billing |
| `us.anthropic.claude-sonnet-4-6` | Blocked on the Marketplace payment-instrument issue above |
| `us.anthropic.claude-sonnet-5` | Not available for this account at all |

Only `amazon.nova-2-lite-v1:0` and `amazon.nova-pro-v1:0` (no Nova 2 Pro/Premier variant exists yet — confirmed via `bedrock list-foundation-models --by-provider Amazon`) are viable text-generation candidates for the review agent today.

## Nova pricing (on-demand, per 1,000 tokens, USD)

AWS's own pricing pages (`aws.amazon.com/nova/pricing/`, `aws.amazon.com/bedrock/pricing/`) render their tables client-side, so they couldn't be scraped directly — these figures come from two independent secondary sources that agreed with each other (see Sources below); treat as a snapshot, not a guarantee, and re-check the official pages before relying on this for a cost-sensitive decision.

| Model | Input $/1K tokens | Output $/1K tokens |
|---|---|---|
| Nova Micro | $0.000035 | $0.00014 |
| Nova Lite | $0.00006 | $0.00024 |
| Nova Pro | $0.0008 | $0.0032 |
| **Nova 2 Lite** | $0.0003 | $0.0025 |

Notable: Nova 2 Lite is cheaper than Nova Pro on **both** input and output, despite being the newer generation with reasoning support.

## Recommendation

`review_agent_model_id` currently defaults to `us.anthropic.claude-sonnet-4-6` per the original mission requirement, still blocked on the Marketplace payment-instrument issue above. Recommended interim default, pending the project owner's decision: `us.amazon.nova-2-lite-v1:0` with reasoning enabled (the app already has a working reasoning code path for `nova-2*` models — see `REASONING_MODEL_PATTERNS` in `backend/infrastructure/lambda/converse/app.py`):

- Already confirmed working in this account, with reasoning, independent of the Anthropic Marketplace billing fix.
- Cheaper than Nova Pro (the model `import_extract` already uses) on both axes.
- Reasoning is a genuine fit for the agent's own research-then-write pattern (look up AWS documentation via the Gateway/MCP tool, then draft the explanation — see the `aws-doc-grounding` skill).
- Trivial to switch back to Claude later — a single Terraform variable, no other code changes — once the AWS Marketplace payment method is fixed.

## Sources

- [Amazon Nova pricing – AWS](https://aws.amazon.com/nova/pricing/)
- [Amazon Bedrock Pricing – AWS](https://aws.amazon.com/bedrock/pricing/)
- [Nova 2 Lite API Pricing 2026 — pricepertoken.com](https://pricepertoken.com/pricing-page/model/amazon-nova-2-lite-v1)
