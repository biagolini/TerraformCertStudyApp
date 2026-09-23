# Frontend

Angular 21 standalone SPA (Signals, no NgModules), TypeScript with SCSS, plus Angular Material for a few dialogs and spinners. It is a purely static build: `ng build` emits static assets uploaded to S3 and served through CloudFront. There is no SSR and no backend logic in the frontend, so every dynamic operation is an authenticated call to API Gateway.

## Bootstrap and Shell

`src/main.ts` bootstraps `AppShellComponent` with `appConfig`. The shell is deliberately thin: `<router-outlet />` plus a blocking "Refreshing session" overlay driven by `AuthService.reauthenticating()`.

`src/app/app.config.ts` provides the router with `withComponentInputBinding()` (route params bind straight into component inputs), global browser error listeners, and async animations.

The real layout lives in `AppComponent`, loaded as the parent of all authenticated routes. It renders the sticky header, the bottom tab bar, a nested `<router-outlet />`, and two overlay panels: the packs drawer and Settings. Those two are NOT routes, they are local signals (`packsOpen`, `settingsOpen`) toggled from the header.

## Routing

Routes live in `src/app/app.routes.ts`. Every feature page is lazy-loaded with `loadComponent: () => import(...)`, so each becomes its own bundle chunk.

Two top-level branches:

- `/login` renders `LoginComponent`, protected by `loginGuard`, which bounces an already-authenticated visitor back to `/`.
- `''` renders `AppComponent` (the layout), protected by `authGuard`. All feature pages are its children.

| Path | Component |
|------|-----------|
| `questions/:packId` and `questions/:packId/:questionId` | `QuestionsPageComponent` |
| `questions/:packId/import/:jobId` | `ImportReviewPageComponent` |
| `import/:packId` | `ImportExamPageComponent` |
| `quiz` | `QuizComponent` |
| `transcripts` and `transcripts/:scriptId` | `TranscriptsPageComponent` |
| `chat` and `chat/:chatId` | `ChatPageComponent` |
| `export` | `ExportComponent` |
| `costs` | `CostsPageComponent` |

Pack-scoped sections (`questions`, `import`) never render without a pack in the URL: the bare path redirects through `resolveActivePackIdForRedirect(PacksService)` to `/<section>/<activePackId>`, and the `:packId` routes run `packIdResolver` so the page always receives a validated pack. Unknown paths fall back to `questions`.

The tab bar is user-configurable: `SettingsService.orderedNavItems()` drives which items show and in what order, and the item ids (`questions`, `import`, `quiz`, `transcripts`, `chat`, `export`, `costs`) match the route paths.

`authGuard` does two things: `AuthService.ensureTokenValid()` and then waits (up to 10s) for `StorageService.ready()`, so a page never renders against a half-loaded local store.

## Project Structure

```
frontend/src/app/
├── app-shell.component.ts    # bootstrapped root: router-outlet + reauth overlay
├── app.component.ts          # authenticated layout: header, tabbar, overlays
├── app.routes.ts / app.config.ts
├── core/
│   ├── services/             # injectable state + API access (see below)
│   ├── models/               # question, pack, quiz-attempt, import-draft, settings, ...
│   ├── utils/                # prompt builders, question parsing, text-range (annotations)
│   ├── i18n/                 # en/pt/es/it dictionaries + i18n.service
│   ├── guards/               # authGuard, loginGuard
│   └── resolvers/            # packIdResolver
├── features/                 # login, questions, question-input, question-list, review-viewer,
│                             # quiz, chat, transcripts, import-exam, import-review, export,
│                             # settings, packs, costs
└── shared/                   # reusable components (dialogs, badges, pills) + pipes
```

Convention: a feature folder owns its page component plus the components only it uses; anything reused by two or more features moves to `shared/`. Components are standalone, use `ChangeDetectionStrategy.OnPush`, and keep template and styles inline in the `.ts` file.

## Key Services

All services live in `core/services/` and are `{ providedIn: 'root' }` singletons holding state in Signals.

| Service | Purpose |
|---------|---------|
| `AuthService` | Cognito SRP login, token refresh, session restore, offline retry |
| `BedrockService` | Streams reviews/refinements via `POST /converse`, plus `/review` and translation |
| `StorageService` | DynamoDB sync layer: local copy of packs/questions/scripts/chats/settings, pushes to `/data/*` |
| `ModelsService` | Fetches available models from `GET /data/models` with static fallback |
| `QuestionsService` | Local state for questions (CRUD, selection, domain breakdown) |
| `PacksService` | Pack CRUD, active pack management |
| `QuizService` / `QuizAttemptsService` | Quiz run state (clock, answers, annotations, flags) and persisted attempts |
| `ChatService` | Chat session CRUD, message append/streaming, summary management |
| `ScriptsService` | Transcript CRUD |
| `SettingsService` | User preferences (interface language, nav order, translation target) |
| `UsageService` | Token usage / cost records for the Costs page |
| `ImportExamService` / `ImportReviewService` | Bulk import upload, job polling, draft review |
| `ExportService` | Build Markdown content, download files, ZIP for multi-file exports |
| `ImageAssetService` | Presigned GET URLs for question images |
| `QuestionEnrichmentService` | On-demand enrichment of an existing question |
| `ThemeService` / `ViewportService` | UI concerns (theme toggle, viewport queries) |

## Internationalization

`I18nService` exposes `lang` as a computed signal over `SettingsService.interfaceLanguage()` and picks a dictionary from `{ en, pt, es, it }`.

Translation is called directly in templates as `i18n.t('some.key')`, deliberately not through a pipe: reading a signal inside a template expression is what OnPush change detection tracks, so switching language re-renders every consuming view automatically. `t()` supports `{{param}}` placeholders via a params object and falls back from the active language to English to the raw key, so a missing translation degrades instead of breaking.

When adding user-facing text, add the key to all four dictionaries (`core/i18n/en.ts`, `pt.ts`, `es.ts`, `it.ts`).

## Cognito Authentication

Auth uses `amazon-cognito-identity-js` directly against the User Pool, with no hosted UI in the normal flow. `AuthService` builds a `CognitoUserPool` from `environment.cognito.userPoolId` and `clientId`, and `login(email, password)` runs the SRP flow via `authenticateUser`. A first-login `newPasswordRequired` challenge is surfaced so the UI can call `completeNewPassword`.

`getValidToken()` is the single entry point for a usable JWT. It calls `user.getSession()`, which transparently refreshes the id token with the refresh token when needed. State is exposed as signals: `isAuthenticated`, `ready`, `reauthenticating`, `offline`, `nextRetryAt`, `currentUserEmail`.

Offline handling matters here: a failure to reach Cognito is distinguished from a genuine auth rejection (the library throws a literal `Network error`, or `navigator.onLine` is false). On a network failure the app stays on the current screen, flips `offline`, and retries silently every 30 minutes or immediately on the browser `online` event. Only a genuinely invalid session redirects to `/login`.

`AuthService` also registers a token provider into `StorageService` (`setTokenProvider(() => this.getValidToken())`), so background sync always fetches a fresh token instead of reusing a cached one that may have expired.

## API Gateway Integration

`environment.apiUrl` is the API Gateway stage URL. Every authenticated request is a `fetch` carrying the Cognito **id token** as `Authorization: Bearer <idToken>`; there are no API keys in the client.

On the infrastructure side, API Gateway declares a `COGNITO_USER_POOLS` authorizer bound to the pool's ARN, and protected methods set `authorization = "COGNITO_USER_POOLS"` with that authorizer id (CORS preflight methods stay `NONE`). The token is therefore verified by API Gateway before any Lambda runs, which is why the frontend never validates signatures itself: `decodePayload()` is used only to display the logged-in email.

Endpoints consumed: `/converse` (streaming NDJSON, read incrementally), `/review`, and `/data/*` for CRUD plus imports, presigned upload/download URLs, model discovery, usage, and budget.

## Environment Configuration

`src/environments/environment.ts` holds `apiUrl` and the `cognito` block. It is **gitignored** because it contains real deployed identifiers; `environment.example.ts` is committed with placeholders. For local development, copy the example and fill it in. During deploy the file is generated automatically, so never hand-edit it expecting the value to survive an apply.

## Local Development

```bash
cd frontend
npm install --legacy-peer-deps   # see README for the ERESOLVE reason
npm start                        # ng serve on http://localhost:4200
npm run build                    # production build
npm test                         # vitest unit tests
```

Tests run on Vitest with jsdom (`ng test`, builder `@angular/build:unit-test`), with specs colocated as `*.spec.ts`.

## Review Prompt Engineering

The review system prompt is built in [`core/services/bedrock.service.ts`](../frontend/src/app/core/services/bedrock.service.ts) for the interactive "Generate with AI" flow. Bulk-import extraction uses a separate, server-side prompt (see [`backend/infrastructure/lambda/import_extract/prompt.py`](../backend/infrastructure/lambda/import_extract/prompt.py)), and the final explanations are written by the AgentCore review agent. Key characteristics of the interactive prompt:

- **Input parsing instructions:** a structured approach teaching the model to identify question text, options (in original order), and correct answers from raw pasted practice exam text
- **Status marker handling:** explains source-export artifacts (past-attempt status labels) that must be ignored
- **Output format:** fixed Markdown template with Key Concepts, Question, Alternatives, Correct answer, Incorrect answers
- **Language support:** translations in "Question" and "Alternatives" sections; explanations only in the selected language
- **Ordering rules:** alternatives in original order, correct/incorrect in ascending letter order

## Pack Templates

Pre-configured study packs for certification exams are in [`frontend/public/examples/`](../frontend/public/examples/). These JSON files are served by the app and loaded when users select a template in the Pack Editor.

### Available packs

| File | Certification |
|------|---------------|
| [`aws-clf-c02-pack.json`](../frontend/public/examples/aws-clf-c02-pack.json) | AWS Cloud Practitioner (CLF-C02) |
| [`aws-aif-c01-pack.json`](../frontend/public/examples/aws-aif-c01-pack.json) | AWS AI Practitioner (AIF-C01) |
| [`aws-saa-c03-pack.json`](../frontend/public/examples/aws-saa-c03-pack.json) | AWS Solutions Architect Associate (SAA-C03) |
| [`aws-dva-c02-pack.json`](../frontend/public/examples/aws-dva-c02-pack.json) | AWS Developer Associate (DVA-C02) |
| [`aws-soa-c03-pack.json`](../frontend/public/examples/aws-soa-c03-pack.json) | AWS CloudOps Engineer Associate (SOA-C03) |
| [`aws-dea-c01-pack.json`](../frontend/public/examples/aws-dea-c01-pack.json) | AWS Data Engineer Associate (DEA-C01) |
| [`aws-mla-c01-pack.json`](../frontend/public/examples/aws-mla-c01-pack.json) | AWS ML Engineer Associate (MLA-C01) |
| [`aws-sap-c02-pack.json`](../frontend/public/examples/aws-sap-c02-pack.json) | AWS Solutions Architect Professional (SAP-C02) |
| [`aws-dop-c02-pack.json`](../frontend/public/examples/aws-dop-c02-pack.json) | AWS DevOps Engineer Professional (DOP-C02) |
| [`aws-aip-c01-pack.json`](../frontend/public/examples/aws-aip-c01-pack.json) | AWS GenAI Developer Professional (AIP-C01) |
| [`aws-scs-c03-pack.json`](../frontend/public/examples/aws-scs-c03-pack.json) | AWS Security Specialty (SCS-C03) |
| [`aws-ans-c01-pack.json`](../frontend/public/examples/aws-ans-c01-pack.json) | AWS Advanced Networking Specialty (ANS-C01) |
| [`ccaf-pack.json`](../frontend/public/examples/ccaf-pack.json) | Claude Certified Architect Foundations (CCAF) |

### Pack JSON structure

```json
{
  "name": "Certification full name",
  "description": "Short description (used in AI prompt for classification)",
  "version": "Optional label",
  "color": "#hex",
  "domains": [
    { "name": "Domain Name", "description": "...", "order": 1 }
  ],
  "exportIntroQuestions": "Markdown intro for exported question files",
  "exportIntroTranscripts": "Markdown intro for exported transcript files",
  "exportIntroChat": "Markdown intro for exported chat files"
}
```

## Export System

- **Single file:** downloads a `.md` with title + `exportIntroQuestions` + questions grouped by domain
- **Split mode:** toggle "Split into multiple files" → generates a `.zip` containing balanced `.md` parts (each with full title + intro)
- **By domain:** download all questions from selected domains
- **File naming:** `{pack-name}-{suffix}.md` or `{pack-name}-N-parts.zip`

## Hosting and Deployment

The built site is static and lives in a private S3 bucket named `${project_prefix}-frontend-${account_id}` (`aws_s3.tf`). All four public-access blocks are on, so the bucket is never publicly readable. CloudFront is the only reader: it uses an Origin Access Control with sigv4 signing, and the bucket policy grants `s3:GetObject` to `cloudfront.amazonaws.com` restricted by the distribution's ARN (`aws_cloudfront.tf`).

CloudFront serves `index.html` as the default root object, forces HTTPS, and terminates TLS with the ACM certificate for the custom domain. Client-side routing works because 403 and 404 responses are rewritten to `/index.html` with status 200, so a deep link such as `/questions/<packId>` reaches the Angular router instead of failing at S3.

Deployment is part of the Terraform run. `frontend_deploy.tf` gates it behind `frontend_deploy_enabled` (default `false`, set to `true` in the production environment). When enabled, running `terraform apply` from `backend/environments/production` also updates the site: a `null_resource` whose trigger is `timestamp()` (so it runs on every apply) invokes `scripts/deploy_frontend.sh`, then a second `null_resource` issues a CloudFront invalidation for `/*`.

`deploy_frontend.sh` does three things:

1. Generates `src/environments/environment.ts` from Terraform outputs passed as env vars (API stage URL, Cognito user pool id, client id, Cognito domain, frontend domain).
2. Runs `npm install --legacy-peer-deps` and `npx ng build --configuration=production --base-href="/"`.
3. Syncs `dist/` to the S3 bucket with `--delete`, giving hashed assets a one-year immutable `Cache-Control`, then uploads `index.html` separately with `no-cache, no-store, must-revalidate` so a new release is picked up immediately.

In short: `terraform apply` provisions infrastructure and, with `frontend_deploy_enabled = true`, rebuilds the SPA, replaces the S3 contents, and invalidates the CDN cache in the same run.

## Related docs

- [Question ingestion pipeline](./question-ingestion.md) — how a pasted or generated review becomes a structured `Question`
- [AWS services inventory](./aws-services.md)
- [DynamoDB schema](./dynamodb-schema.md)
- [Architecture overview](./architecture.md)
- [Backend documentation](./backend.md)
- [Mobile Safari touch/click pitfall](./mobile-safari-touch-click-pitfall.md)
