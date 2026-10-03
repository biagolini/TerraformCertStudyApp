---
inclusion: always
---

# How to Work on This Project

Rules for how I want work done here. Project documentation is NOT here: it lives in `docs/` (see the index below) and should be read on demand, not carried in context.

## Verification (do not skip)

- Frontend changes: run `npx ng test --no-watch` and `npx ng build` from `frontend/`.
- Lambda changes: at minimum byte-compile the module (`python3 -m py_compile <file>`), and clean up `__pycache__` afterwards.
- Terraform changes: run `terraform validate` / `terraform plan` from `backend/environments/production` (never apply without asking).
- Never present a change as done without running what can be run. State explicitly what was verified and what could not be.
- Delete temporary scripts/tests created only for verification.

## Secrets and Sensitive Values

- Never commit secrets. `backend.hcl`, `terraform.tfvars`, and `frontend/src/environments/environment.ts` are gitignored and hold real identifiers; only the `.example` files are committed.
- Never echo real bucket names, AWS profiles, account ids, user pool ids, API URLs, or domains into docs, steering, comments, or commit messages. Use placeholders.
- Deployment and backend-state setup is documented in `backend/README.md`; do not restate real values anywhere else.

## Copyright

Never name third-party practice-exam sources (platforms, instructors, course providers) anywhere in code, comments, docs, or steering. Describe them generically, for example "a practice-exam HTML export" or "some Markdown exports".

## AI Prompts Are Product Surface

Prompts under `backend/infrastructure/lambda/import_extract/` and the review prompt in `bedrock.service.ts` are product, not incidental strings.

- Quality of output beats speed or cost when choosing a model or setting.
- Never trust the model to obey an instruction that matters. Back it up with a deterministic safety net in code (the model is told to drop source-export UI chrome from a stem, and `_strip_chrome_prefix` strips it anyway).
- Bulk-imported questions are drafts for human review before promotion. Keep that human-in-the-loop step intact.

## Code Style

- Comments explain the "why", especially around AI behavior and known failure modes. Skip comments that restate the code.
- Frontend: standalone components, Signals, `ChangeDetectionStrategy.OnPush`, template and styles inline in the `.ts`. User-facing text goes through `i18n.t()` and must be added to all four dictionaries (`en`, `pt`, `es`, `it`).
- Terraform: see `terraform.md`.
- Python: standard library plus boto3; no new dependency without a reason.

## Git

**Committing is the user's call, never the assistant's.** Do not run `git commit` unless the user explicitly asks for it in that message. Finishing a change, passing tests, or reaching a good stopping point is NOT an invitation to commit. Leave the work in the working tree and let the user review and commit when they want to. Do not stage files "to be helpful" either, and do not suggest committing at the end of every task.

When a commit IS explicitly requested:

- Stage only the specific files that belong to the change, never `git add .`.
- Flag any file that may contain secrets before including it.
- Prefer a new commit over `--amend`.

Also:

- Do not push to `main` unless explicitly asked, and never use destructive git commands (`reset --hard`, `push --force`, `clean -f`, `branch -D`) without explicit approval.
- Leave git config and hooks untouched (no `--no-verify` unless asked).

## Where the Documentation Lives

Read these on demand instead of assuming; they are the source of truth for design detail:

| File | Contents |
|------|----------|
| `README.md` | Product overview, features, quick start, local dev |
| `docs/architecture.md` | System diagrams, components, auth and streaming flows, deploy |
| `docs/aws-services.md` | Every AWS service in the stack and its purpose |
| `docs/backend.md` | Lambdas, API surface, import pipeline, IAM |
| `docs/frontend.md` | Angular SPA: routing, services, i18n, Cognito, API integration, deploy |
| `docs/dynamodb-schema.md` | Table and key design |
| `docs/question-import-pipeline.md` | Bulk import pipeline in depth |
| `docs/question-ingestion.md` | How a review becomes a structured `Question` |
| `docs/question-markdown-format.md` | Target Markdown shape for ready-made questions |
| `docs/mobile-safari-touch-click-pitfall.md` | WebKit touch/click gotcha hit by the quiz toolbar |
| `docs/review-agent-model-cost-comparison.md` | Model choice rationale for the review agent |
| `backend/README.md` | Backend state/config setup |

When a change makes one of these wrong, update it in the same pass.
