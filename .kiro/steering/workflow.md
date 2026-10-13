---
inclusion: always
---

# How to Work on This Project

Rules for how I want work done here. These rules mirror the project's `CLAUDE.md` (used by Claude Code); if the two ever disagree, `CLAUDE.md` wins, and a rule changed in one should be changed in the other. Project documentation is NOT here: it lives in `docs/` (see the index below) and should be read on demand, not carried in context.

## Expect Inconsistencies, and Report Them

The code was generated with more than one AI coding tool and models from many vendors, so conventions, patterns, and quality vary across the codebase. Whenever you notice an inconsistency, a bug, or a risky pattern, even outside the task at hand, tell the user: explain the problem, why it matters, and what you recommend, then suggest going ahead with the improvement. Do not fix unrelated things silently, and do not stay silent about them either.

## Verification (do not skip)

- Frontend changes: run `npx ng test --no-watch`, `npx ng build`, `node scripts/check-i18n-keys.mjs` and `node scripts/check-no-emoji.mjs` from `frontend/`.
- Lambda changes: at minimum byte-compile the module (`python3 -m py_compile <file>`), and clean up `__pycache__` afterwards.
- Terraform changes: run `terraform validate` / `terraform plan` from `backend/environments/production` (never apply without asking).
- Never present a change as done without running what can be run. State explicitly what was verified and what could not be.
- Delete temporary scripts/tests created only for verification.

## Secrets and Sensitive Values

- Never commit secrets. `backend.hcl`, `terraform.tfvars`, and `frontend/src/environments/environment.ts` are gitignored and hold real identifiers; only the `.example` files are committed.
- Never echo real bucket names, AWS profiles, account ids, user pool ids, API URLs, or domains into docs, steering, comments, or commit messages. Use placeholders.
- Deployment and backend-state setup is documented in `backend/README.md`; do not restate real values anywhere else.
- The CloudFront custom domain is always the masked placeholder `cert.yourdomain.com` / `yourdomain.com` in docs, `README.md`, and `variables.tf` descriptions. The real value lives only in `terraform.tfvars`. Mask it before it appears in a commit, doc, or design-system file.

## Third-Party Names and User Data

Never name third-party practice-exam sources (platforms, instructors, course providers) anywhere, and never put a user's own data (bank authors, the certification they study, emails) in the repo. See "What This Project Is" in `product.md`.

## File Naming

README files are always named `README.md`, in capitals, never `readme.md` or `Readme.md`, in every folder.

## AI Prompts Are Product Surface

Prompts under `backend/infrastructure/lambda/import_extract/` and the review prompt in `bedrock.service.ts` are product, not incidental strings.

- Quality of output beats speed or cost when choosing a model or setting.
- Never trust the model to obey an instruction that matters. Back it up with a deterministic safety net in code (the model is told to drop source-export UI chrome from a stem, and `_strip_chrome_prefix` strips it anyway).
- Bulk-imported questions are drafts for human review before promotion. Keep that human-in-the-loop step intact.

## Code Style

- Comments explain the "why", especially around AI behavior and known failure modes. Skip comments that restate the code.
- Frontend: see `frontend.md` (Angular conventions, design tokens, i18n, sync) and `ui-icons.md`.
- Terraform: see `terraform.md`.
- Python: standard library plus boto3; no new dependency without a reason.

## Git

`main` is protected by a GitHub ruleset: no direct pushes, no force pushes, no deletion. Changes reach `main` only through a pull request, merged with squash, so each PR lands as a single commit.

- One branch per change, created from an up-to-date `main` and named after the commit type: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `refactor/<topic>`, `chore/<topic>`, `test/<topic>` (kebab-case, short). Never commit on `main`.
- Commit locally as often as useful. Small checkpoint commits are fine (they make mistakes easy to undo); they are squashed when the PR is merged. Do not rewrite history that was already pushed.
- Never push and never merge. Pushing is done by the user with their own credentials (hardware-key MFA). Do not push through the `gh` token, a credential helper, or any other route, and do not run `gh pr merge`.
- Consolidating: when the user asks for it, make sure the branch is verified and the working tree clean, propose the PR title (it becomes the squashed commit on `main`, so it follows the commit-message rules below) and a short description, and ask the user to push the branch. Once it is on GitHub, open the PR with `gh pr create` if the user asks; the user reviews and merges it.
- Stage only the files that belong to the change, never `git add .`, and flag any file that may contain secrets before including it.
- Prefer a new commit over `--amend`. Never use destructive git commands (`reset --hard`, `push --force`, `clean -f`, `branch -D`) without explicit approval.
- Leave git config and hooks untouched (no `--no-verify` unless asked).

### Commit Messages

These rules apply to commit messages and to PR titles alike. The convention also lives in `.vscode/settings.json` (`github.copilot.chat.commitMessageGeneration.instructions`); if one changes, update the other.

- One subject line in the imperative mood, at most 72 characters (a target: a character or two over is acceptable), no body, no bullets, no `Co-Authored-By` or other trailer. Add a short body only when the change is genuinely too complex for the subject alone.
- Conventional Commits prefix: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Optional scope = the top-level area that changed: `frontend`, `backend` (Terraform and Lambda code, never `infra`/`terraform`), `design-system`, `docs`. Several areas join with `+`: `feat(frontend+backend): ...`.
- Summarize the essence; split unrelated changes into separate commits rather than listing them in one subject.

Examples: `feat(frontend): add backup page with one JSON per table`, `fix(frontend+design-system): show the active certification in the switcher`.

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
| `design-system/README.md` | How the design-system mirror is built and captured |

When a change makes one of these wrong, update it in the same pass.
