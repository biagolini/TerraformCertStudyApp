# Cert Study Assistant — project instructions

AI-powered study app for IT certification exams (AWS, Anthropic CCAF, and
others). Paste an exam question, get a structured Markdown review via Amazon
Bedrock (streamed token-by-token); paste a lesson transcript, get a layered
summary; or hold an open tutor chat. Angular 21 SPA on CloudFront/S3, Cognito
auth, Python Lambdas behind API Gateway (chat/review streaming, data CRUD,
plus a Step Functions pipeline and a review agent for AI exam import),
single-table DynamoDB — all provisioned with Terraform. See `README.md` and
`docs/architecture.md` for the full picture.

Previously scaffolded with Kiro. As of 2026-08 this project is worked on
with Claude Code — this file is what future sessions read. `.kiro/steering/`
carries the same rules in Kiro's format, so the project stays portable
between the two tools: when you add or change a rule here, update the
matching steering file too (and keep both 100% in English). If they ever
disagree, this file wins. It also inherits the shared conventions in the root
`/Users/biagolini/DevEnv/Terraform/CLAUDE.md` (state bucket, account
profiles, project layout) — this file only covers what's specific to this
project.

## What this project is (and is not)

A free, independent study tool. It is **not affiliated with, endorsed by, or
built for any course provider, training company, practice-exam vendor, or
instructor**, and it must never recommend, cite, or name one — not in code,
comments, tests, i18n strings, docs, examples, design-system files, or commit
messages. The author names users give their own question banks are user
data: when real screens or user examples end up in the repo (design-system
captures, fixtures, test values), replace them with generic placeholders
("Instructor A", "my-export"). The same goes for the certification a user
happens to be studying: use neutral examples, never one taken from their
data. The repo is public.

The goal is an open study companion with several features: writing study
notes, building and taking mock exams from your own questions, and
creating, importing, and sharing those questions.

**Self-hosted, self-managed.** Each student deploys it to their own AWS
account and owns everything in it — their notes, questions, attempts, and
the infrastructure itself. That makes keeping the environment secure,
updated, backed up, and within budget the student's own responsibility.
The project's maintainers provide the code as is and take no responsibility
for failures, bugs, data loss, or costs arising from it.

**Vibe-coded, so expect inconsistencies.** The code was generated with more
than one AI coding tool and models from many different vendors, so
conventions, patterns, and quality vary across the codebase. Whenever you
(the AI working here) notice an inconsistency, a bug, or a risky pattern —
even outside the task at hand — tell the user: explain what the problem is,
why it matters, and what you recommend, then suggest going ahead with the
improvement. Don't fix unrelated things silently, and don't stay silent
about them either.

## Never commit a real domain

`docs/architecture.md`, `README.md`, and `variables.tf` descriptions use a
masked placeholder (`cert.yourdomain.com` / `yourdomain.com`) for the
CloudFront custom domain — never the actual production hostname. The real
value lives only in `terraform.tfvars` (gitignored). If you ever need to
reference the live domain in a commit, doc, or design-system file, mask it
first.

## Layout

```
backend/
  infrastructure/        Reusable Terraform module — one aws_<service>.tf per service
    lambda/converse/      Flask + Lambda Web Adapter, Bedrock converse_stream, NDJSON
    lambda/data/           Flask + Lambda Web Adapter, DynamoDB CRUD + model discovery
    lambda/review/         Streams /review (generate/refine) from the AgentCore review agent
    lambda/import_*/       AI exam import pipeline steps (preprocess, extract, explain,
                            finalize), orchestrated by Step Functions — see
                            docs/question-import-pipeline.md
    lambda/mcp_aws_docs/   AWS documentation lookup used by the review agent
    agent/review_agent/    AgentCore Runtime review agent (uses lambda/mcp_aws_docs)
    scripts/deploy_frontend.sh
  environments/production/  Module instantiation + backend config
frontend/                 Angular 21 SPA
  src/app/core/            Models, services (auth/storage/bedrock/etc.), guards, utils
  src/app/features/        Global pages: home, profile, settings, costs, backup, login.
                            Certification workspace (/exam/:packId, workspace/)
                            tabs: banks, questions, import-exam, import-review,
                            quiz, performance, notes, transcripts, chat, export.
                            Shared pieces: question-input, question-list,
                            review-viewer, packs (certification dialog), tutor
  src/app/shared/           Reusable components (theme-toggle, sync-status, domain-badge…) + pipes
  src/styles/_variables.scss  The single source of truth for all design tokens
  public/examples/          Pack template JSONs (13 certifications), served by the app
design-system/            HTML mirrors of the tokens, components and screens above,
                           published to claude.ai/design — see "Design system" below
docs/                      architecture.md, backend.md, frontend.md, dynamodb-schema.md,
                           question-import-pipeline.md and other topic notes
```

## Commands

```bash
# Frontend
cd frontend
npm start                 # ng serve on :4200
npm run build
npm test

# Deploy (builds Angular, syncs to S3, invalidates CloudFront when
# frontend_deploy_enabled = true in terraform.tfvars)
cd backend/environments/production
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

## Terraform conventions

Same as the root CLAUDE.md: `required_providers` pins `hashicorp/aws` to
`~> 6.0` in `environments/production/config.tf`; the module itself declares
no version. `backend "s3" {}` is empty — real values are in `backend.hcl`
(gitignored). Never commit `backend.hcl` or `terraform.tfvars`, only their
`.example` counterparts.

Lambdas: Python 3.13, arm64, Flask behind the AWS Lambda Web Adapter layer —
not a container image, not API Gateway proxy integration directly to a
handler function. Both `converse` and `data` follow the same shape; add a new
one the same way (own `aws_lambda_*.tf`, own `lambda/<name>/app.py`).

## Frontend conventions

Angular 21, standalone components, Signals, `OnPush` everywhere, plain SCSS
(no Tailwind). New control flow only — `@if` / `@for`, never `*ngIf`/`*ngFor`.

- **Theming**: every color/spacing/radius value is a CSS custom property from
  `styles/_variables.scss`, switched by an `html.theme-light` /
  `html.theme-dark` class (`ThemeService`). Never hardcode a hex color or a
  raw pixel value in a component's `styles` — use the existing `--bg-*`,
  `--text-*`, `--color-*`, `--space-*`, `--radius-*` tokens. `LoginComponent`
  used to be the one known holdout on this — it's now on tokens too, so there
  are no remaining exceptions.
- **i18n**: the interface ships in English, Portuguese, Spanish, and Italian.
  `core/i18n/i18n.service.ts` (`I18nService`) exposes `lang` (a signal
  derived from `SettingsService.interfaceLanguage`) and `t(key, params?)`;
  every component that renders user-facing text injects it and calls
  `i18n.t('some.key')` directly in the template — never a pipe, since a
  signal read inside a template expression is what Angular's OnPush change
  detection tracks, so a language switch re-renders every consuming view
  automatically. String tables live in `core/i18n/{en,pt,es,it}.ts`, one flat
  `Record<string, string>` per language keyed by dot-path
  (`'settings.title'`, `'questionInput.generateReview'`, …); `en.ts` is the
  authoritative key list — `I18nService.t()` falls back to it for any key
  missing from the active language, and every key added there must be added
  to the other three too (nothing enforces that at build time yet). The
  `Settings` drawer's "Interface language" control is a separate setting
  from the pre-existing "Output language" one — the first controls the
  app's own chrome, the second only controls AI-generated text (reviews,
  explanations, chat replies) and is unaffected by this. Backend/SDK error
  strings (Cognito auth errors, uncaught exceptions surfaced verbatim from
  `/data` calls) are intentionally NOT translated — translating only the
  fallback case while the common case still comes back in English from AWS
  would be more confusing than leaving both in English.
- **Sync architecture** (`StorageService`): `saveQuestions`/`savePacks`/
  `saveScripts`/`saveChats` diff the incoming array against the previous
  in-memory snapshot (`diffAndSync`) and debounce-PUT (500ms) only the items
  that actually changed, one `PUT /data/<kind>/<id>` per item — not the old
  whole-dataset `PUT /data`. This is what closes the race where an unrelated
  edit on device B re-sent B's stale local copy of an item device A had just
  changed, clobbering it: B now only ever touches the item it actually
  edited. `flushPendingSync()` immediately fires every pending per-item
  write (used before a reorder-triggered save and before `refresh()` pulls
  remote data, so a pull never discards an unsaved edit); bulk `PUT /data`
  still exists (`pushAll`) but is now only used for the one-time
  localStorage→cloud migration on first login. Concurrent edits to the exact
  same item are still last-write-wins — that's a harder problem (needs
  versioning/optimistic-concurrency) this pass didn't attempt. A
  `visibilitychange` listener re-pulls `/data` when the tab regains focus
  (throttled to once per 20s) so switching devices doesn't require a full
  reload; `syncStatus` / `lastError` / `lastSyncedAt` signals drive the
  header's `SyncStatusComponent` and the Settings drawer's sync row.

## Design system

`design-system/` mirrors `frontend/src/styles/_variables.scss` and the real
component CSS 1:1 (not generated from a compiled component library — this is
Angular, not React). `foundations/`, `components/` (except `app-shell.html`)
and `screens/login.html` are hand-authored; `app-shell.html` and the other
`screens/` are captured from the running app
(rendered DOM plus the CSS rules that apply to it) with real account data
replaced by neutral samples — `design-system/README.md` explains how, and a
changed screen is recaptured rather than hand-edited. It is published to a
claude.ai/design project named **"Cert Study Assistant"** via
the `DesignSync` tool, kept in sync **by hand** — same approach as
`TerraformNinho/design-system`.

**This repo is public — never commit the project's URL or id.** Look it up
each time with `DesignSync` → `list_projects` (match by name) rather than
hardcoding it here.

To update: edit files under `design-system/`, then re-run the sync
(`DesignSync` → `list_projects` to find this project → `finalize_plan` with
the changed paths → `write_files`). Each preview file's first line is an
`<!-- @dsCard group="…" -->` marker that builds the Design System pane's
card index — keep it as line 1.

For one-off full-screen mockups (not token-level, not kept in sync
automatically), use the `/design` skill instead — it publishes a separate,
disposable Claude Artifact rather than updating this project.

## File naming

README files are always named `README.md`, in capitals, never `readme.md`
or `Readme.md`, in every folder.

## Git workflow

`main` is protected by a GitHub ruleset: no direct pushes, no force pushes,
no deletion. Changes reach `main` only through a pull request, merged with
squash, so each PR lands as a single commit.

- **One branch per change**, created from an up-to-date `main` and named
  after the commit type: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`,
  `refactor/<topic>`, `chore/<topic>`, `test/<topic>` (kebab-case, short).
  Never commit on `main`.
- **Commit locally as often as useful.** Small checkpoint commits are fine
  (they make mistakes easy to undo); they are squashed when the PR is
  merged. Do not rewrite history that was already pushed.
- **Never push and never merge.** Pushing is done by the user with their
  own credentials (hardware-key MFA). Do not push through the `gh` token, a
  credential helper, or any other route, and do not run `gh pr merge`.
- **Consolidating:** when the user asks for it, make sure the branch is
  verified and the working tree clean, propose the PR title (it becomes the
  squashed commit on `main`, so it follows the commit-message rules below)
  and a short description, and ask the user to push the branch. Once it is
  on GitHub, open the PR with `gh pr create` if the user asks; the user
  reviews and merges it.

### Commit messages

These rules apply to commit messages and to PR titles alike. The convention
lives in `.vscode/settings.json`
(`github.copilot.chat.commitMessageGeneration.instructions`) — this is the
same rule; if one changes, update the other.

- One subject line, imperative mood, **max 72 characters**, no body, no
  bullets, no `Co-Authored-By` or other trailer. Add a short body only when
  the change is genuinely too complex for the subject alone.
- Conventional Commits prefix: `feat`, `fix`, `docs`, `style`, `refactor`,
  `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Optional scope = the top-level area that changed: `frontend`, `backend`
  (Terraform and Lambda code — never `infra`/`terraform`), `design-system`,
  `docs`. Several areas join with `+`: `feat(frontend+backend): …`.
- Summarize the essence; split unrelated changes into separate commits
  rather than listing them in one subject.

Examples: `feat(frontend): add backup page with one JSON per table`,
`fix(frontend+design-system): show the active certification in the switcher`.
