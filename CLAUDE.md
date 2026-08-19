# Cert Study Assistant — project instructions

AI-powered study app for IT certification exams (AWS, Anthropic CCAF, and
others). Paste an exam question, get a structured Markdown review via Amazon
Bedrock (streamed token-by-token); paste a lesson transcript, get a layered
summary; or hold an open tutor chat. Angular 21 SPA on CloudFront/S3, Cognito
auth, two Python Lambdas behind API Gateway, single-table DynamoDB — all
provisioned with Terraform. See `README.md` and `docs/architecture.md` for
the full picture.

Previously scaffolded with Kiro (`.kiro/` kept for reference only). As of
2026-08 this project is worked on with Claude Code — this file is what future
sessions read; if `.kiro/steering/*` and this file ever disagree, this file
wins. It also inherits the shared conventions in the root
`/Users/biagolini/DevEnv/Terraform/CLAUDE.md` (state bucket, account
profiles, project layout) — this file only covers what's specific to this
project.

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
    scripts/deploy_frontend.sh
  environments/production/  Module instantiation + backend config
frontend/                 Angular 21 SPA
  src/app/core/            Models, services (auth/storage/bedrock/etc.), guards, utils
  src/app/features/        login, question-input, question-list, review-viewer,
                            transcripts, chat, packs, export, settings, methods
  src/app/shared/           Reusable components (theme-toggle, sync-status, domain-badge…) + pipes
  src/styles/_variables.scss  The single source of truth for all design tokens
  public/examples/          Pack template JSONs (13 certifications), served by the app
design-system/            Hand-authored HTML mirroring the tokens/components above,
                           published to claude.ai/design — see "Design system" below
docs/                      architecture.md, backend.md, frontend.md
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
  is the one known holdout still using hardcoded colors — fixing that is a
  tracked, not-yet-done change (see the design canvas below).
- **i18n**: the interface is English-only today. A 4-language design
  (English default, Portuguese, Spanish, Italian) — including a new
  "Interface language" setting distinct from the existing AI-output-language
  setting — has been designed but **not yet implemented in code**. Don't
  assume translated strings exist; check `settings.model.ts` /
  `settings.component.ts` before relying on an interface-language setting.
- **Sync architecture** (`StorageService`): writes debounce 500ms then
  `PUT /data` with the *entire* dataset (not a per-item merge, even though
  the backend exposes per-item endpoints — see `docs/backend.md`). A
  `visibilitychange` listener re-pulls `/data` when the tab regains focus
  (throttled to once per 20s) so switching devices doesn't require a full
  reload; `syncStatus` / `lastError` / `lastSyncedAt` signals drive the
  header's `SyncStatusComponent` and the Settings drawer's sync row. Known
  limitation, intentionally not fixed: a stale local snapshot pushing at the
  wrong moment can still clobber a concurrent change from another device.

## Design system

`design-system/` is hand-authored HTML (not generated from a compiled
component library — this is Angular, not React) that mirrors
`frontend/src/styles/_variables.scss` and the real component CSS 1:1. It is
published to a claude.ai/design project named **"Cert Study Assistant"** via
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

## Git workflow

Commit directly to `main` and push — solo-maintained repo, no feature
branches or PRs unless asked.
