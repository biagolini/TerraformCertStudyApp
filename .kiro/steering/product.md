---
inclusion: always
---

# Product Context

Cert Study Assistant is a deployed AI study app for IT certification exams: an Angular 21 SPA plus a Terraform-managed AWS serverless backend. Users add exam questions (by hand, pasted ready-made, or bulk-imported from an exam file), get structured Markdown reviews generated via Amazon Bedrock, organize them by certification "pack", practice in a timed exam simulator, and export as Markdown. Data is partitioned per Cognito user (`USER#{sub}`).

This file only carries context that should influence decisions. Feature and architecture detail lives in `README.md` and `docs/` (see `workflow.md` for the index).

## Decisions This Context Should Drive

- **Quality of AI output over speed or cost.** The review and extraction prompts are the product. Prefer the model and settings that yield accurate, well-structured reviews, even when slower or costlier.
- **Human-in-the-loop for imports.** Bulk-extracted questions are drafts a person reviews before promotion. Do not add automation that promotes them silently.
- **Cost awareness is a feature, not an afterthought.** A single bulk import can issue dozens of model calls. Every AI call records token usage, and an optional monthly budget blocks further spend once reached. Keep that accounting intact when touching an AI call path.
- **Multilingual by default.** The UI ships in English, Portuguese, Spanish, and Italian, and individual questions can be translated on demand. Any new user-facing string needs all four dictionaries.
- **Security posture.** Cognito-gated API, least-privilege IAM, private asset bucket reachable only through presigned URLs. Do not introduce an unauthenticated endpoint or a public bucket.
