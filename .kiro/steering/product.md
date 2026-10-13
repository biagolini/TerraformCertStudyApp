---
inclusion: always
---

# Product Context

Cert Study Assistant is a deployed AI study app for IT certification exams: an Angular 21 SPA plus a Terraform-managed AWS serverless backend. Users add exam questions (by hand, pasted ready-made, or bulk-imported from an exam file), get structured Markdown reviews generated via Amazon Bedrock, organize everything by certification (`Pack` in code), take timed mock exams, write study notes with an AI copilot, and export as Markdown. Data is partitioned per Cognito user (`USER#{sub}`).

This file only carries context that should influence decisions. Feature and architecture detail lives in `README.md` and `docs/` (see `workflow.md` for the index).

## What This Project Is (and Is Not)

- **Independent.** A free, open study tool, not affiliated with, endorsed by, or built for any course provider, training company, practice-exam vendor, or instructor. Never recommend, cite, or name one anywhere: code, comments, tests, i18n strings, docs, examples, design-system files, or commit messages. Describe sources generically ("a practice-exam HTML export", "some Markdown exports").
- **The repo is public.** User data that ends up in the repo (design-system captures, fixtures, test values) is replaced with generic placeholders: bank authors become "Instructor A/B" with example.com links, file names become "my-export", emails are masked. The certification a user happens to be studying is user data too: use neutral examples, never one taken from their data.
- **Self-hosted, self-managed.** Each student deploys the app to their own AWS account and owns everything in it (notes, questions, attempts, and the infrastructure). Keeping it secure, updated, backed up, and within budget is the student's responsibility; the maintainers provide the code as is, with no responsibility for failures, bugs, data loss, or costs.
- **Goal.** An open study companion: writing study notes, building and taking mock exams from your own questions, and creating, importing, and sharing those questions.

## Decisions This Context Should Drive

- **Quality of AI output over speed or cost.** The review and extraction prompts are the product. Prefer the model and settings that yield accurate, well-structured reviews, even when slower or costlier.
- **Human-in-the-loop for imports.** Bulk-extracted questions are drafts a person reviews before promotion. Do not add automation that promotes them silently.
- **Cost awareness is a feature, not an afterthought.** A single bulk import can issue dozens of model calls. Every AI call records token usage, and an optional monthly budget blocks further spend once reached. Keep that accounting intact when touching an AI call path.
- **Multilingual by default.** The UI ships in English, Portuguese, Spanish, and Italian, and individual questions can be translated on demand. Any new user-facing string needs all four dictionaries.
- **Security posture.** Cognito-gated API, least-privilege IAM, private asset bucket reachable only through presigned URLs. Do not introduce an unauthenticated endpoint or a public bucket.
