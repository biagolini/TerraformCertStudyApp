# Frontend

Angular 21 standalone SPA (Signals, no NgModules), TypeScript with SCSS, plus Angular Material for a few dialogs and spinners. It is a purely static build: `ng build` emits static assets uploaded to S3 and served through CloudFront. There is no SSR and no backend logic in the frontend, so every dynamic operation is an authenticated call to API Gateway.

## Bootstrap and Shell

`src/main.ts` bootstraps `AppShellComponent` with `appConfig`. The shell is deliberately thin: `<router-outlet />` plus a blocking "Refreshing session" overlay driven by `AuthService.reauthenticating()`.

`src/app/app.config.ts` provides the router with `withComponentInputBinding()` (route params bind straight into component inputs), global browser error listeners, and async animations.

The authenticated layout lives in `AppComponent`: a sticky header (brand linking to Home, a breadcrumb to the open certification, import/sync pills, Profile, theme, Settings, sign out) and a nested `<router-outlet />`. There are no overlay drawers any more: Settings is a route, and switching certification happens from Home or the workspace header. The shell also hosts the app-wide image lightbox (`LightboxComponent`, driven by `LightboxService`), which every rendered Markdown image opens on click.

## Routing

Routes live in `src/app/app.routes.ts`. Every page is lazy-loaded with `loadComponent`.

| Path | Component |
|------|-----------|
| `/login` | `LoginComponent` (`loginGuard`) |
| `/` | `HomePageComponent`: my certifications, catalog, add/edit certification, starter kit |
| `/profile` | `ProfilePageComponent` |
| `/settings` | `SettingsPageComponent` (wraps `SettingsComponent`) |
| `/costs` | `CostsPageComponent` |
| `/exam/:packId` | `ExamWorkspaceComponent`, the certification workspace; children below |
| `…/banks` | `BanksPageComponent` (banks grouped by author) |
| `…/banks/:bankId[/:questionId]` | `QuestionsPageComponent` (`bankId` = `all` for every bank) |
| `…/import[?bank=]` and `…/import/:jobId` | `ImportExamPageComponent`, `ImportReviewPageComponent` |
| `…/quiz` | `QuizComponent` (setup, runner, results, history) |
| `…/performance` | `PerformancePageComponent` |
| `…/notes[/:noteId]` | `NotesPageComponent` / `NoteEditorComponent` |
| `…/transcripts[/:scriptId]`, `…/chat[/:chatId]`, `…/export` | transcripts, tutor chat, export, all scoped to the certification |

The `/exam/:packId` route runs `packIdResolver`, which waits for the first pack load and then makes the URL's pack the active one (`SettingsService.activePackId`) before any child renders, so every pack-scoped service (questions, banks, notes, chats, scripts, quiz) already points at it. An unknown id redirects to Home. The router uses `paramsInheritanceStrategy: 'always'`, so child pages receive `packId` as a component input. `core/utils/routes.util.ts` builds these URLs.

The workspace tab bar is user-configurable: `SettingsService.orderedNavItems()` drives which tabs show and in what order (`NAV_ITEMS` in `core/models/nav-item.model.ts`: `banks`, `quiz`, `performance`, `notes`, `transcripts`, `chat`, `export`).

The quiz question toolbar is configurable the same way, through `QUIZ_TOOLS` in `core/models/quiz-tool.model.ts` plus `hiddenQuizTools` / `quizToolOrder` / `quizToolbarRows` in `AppSettings`: Settings picks which buttons show, their order, and how many rows (up to 3) they are split over on phone-width viewports (desktop always renders one row), and `splitQuizToolRows` only materializes a row when there is at least one button for it. Two of the tools (`checkAnswer`, `nextQuestion`) are flagged `compactOnly` and render only while the toolbar is pinned to the top of a phone-width viewport, where the question's own bottom action row has scrolled out of reach; `checkAnswer` additionally only applies in instant-feedback mode.

`authGuard` does two things: `AuthService.ensureTokenValid()` and then waits (up to 10s) for `StorageService.ready()`, so a page never renders against a half-loaded local store.

## Data Hierarchy

**Certification (`Pack`) → Question banks (`QuestionBank`) → Questions.** A bank is one practice exam of the certification, identified by `author` (instructor, vendor or the user) and `version`, with an optional source link and notes; there is no separate bank name, the UI label is "author · version" (`bankLabel`). The certification is never typed by the user: it comes from the workspace URL. Notes, transcripts, chats, import jobs and mock-exam attempts also belong to a certification through `packId`. Adding a question or importing a file always targets a bank; if a certification has none yet, `BanksService.ensureDefault` creates one. Mock exams draw from the selected banks (none selected = all). `QuestionsService.visible` is what the question browser lists: the active certification narrowed by `bankFilter` and `domainFilter`.

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
├── features/                 # home, workspace, banks, questions, question-input, question-list,
│                             # review-viewer, quiz, tutor, performance, notes, profile,
│                             # chat, transcripts, import-exam, import-review, export, settings,
│                             # packs (certification editor), costs, login
└── shared/                   # reusable components (dialogs, badges, pills) + pipes
```

Convention: a feature folder owns its page component plus the components only it uses; anything reused by two or more features moves to `shared/`. Components are standalone, use `ChangeDetectionStrategy.OnPush`, and keep template and styles inline in the `.ts` file.

## Key Services

All services live in `core/services/` and are `{ providedIn: 'root' }` singletons holding state in Signals.

| Service | Purpose |
|---------|---------|
| `AuthService` | Cognito SRP login, token refresh, session restore, offline retry |
| `BedrockService` | Streams reviews/refinements, chat, the mock-exam tutor and the note copilot via `POST /converse`, plus `/review` and translation (translations cached per content and target language for the session) |
| `StorageService` | DynamoDB sync layer: local copy of packs/banks/questions/notes/scripts/chats/settings/profile, debounced per-item pushes to `/data/*`, `apiFetch` for other authenticated calls |
| `ModelsService` | Fetches available models from `GET /data/models` with static fallback |
| `QuestionsService` | Local state for questions (CRUD, selection, domain breakdown) |
| `PacksService` | Certification (pack) CRUD, active certification, `lastStudiedAt`; deleting purges the local copy of everything it owns (the API cascades) |
| `BanksService` | Question bank CRUD, grouping by author, default bank on demand |
| `CatalogService` | Reads `public/examples/index.json` and turns a catalog entry into a certification draft |
| `NotesService` | Note metadata (synced) plus body load/save and image upload through `/data/notes/*` |
| `ProfileService` | Student profile and per-certification track status |
| `StarterKitService` | One-click sample certification, bank, questions and welcome note |
| `BackupService` | Full JSON export of the account |
| `LightboxService` | App-wide image viewer state |

Icons: every icon is `<app-icon name="…">` (`shared/components/icon.component.ts`, outline SVGs); emojis and Unicode pictographs are not used (`scripts/check-no-emoji.mjs`, see `.kiro/steering/ui-icons.md`).
| `QuizService` / `QuizAttemptsService` | Quiz run state (bank selection, clock, answers, annotations, flags, tutor Q&A, pass mark) and persisted attempts; up to 5 in-progress attempts can be open and switched between via "Save and exit". A session left open in one certification is parked when another certification's mock-exam tab opens |
| `ChatService` | Chat session CRUD, message append/streaming, summary management |
| `ScriptsService` | Transcript CRUD |
| `SettingsService` | User preferences (interface language, nav order, quiz toolbar layout, translation target) |
| `UsageService` | Token usage / cost records for the Costs page |
| `ImportExamService` / `ImportReviewService` | Bulk import upload, job polling, draft review |
| `ExportService` | Build Markdown content, download files, ZIP for multi-file exports |
| `ImageAssetService` | Presigned GET URLs for question images |
| `QuestionEnrichmentService` | On-demand enrichment of an existing question |
| `ThemeService` / `ViewportService` | UI concerns (theme toggle, viewport queries) |

## Internationalization

`I18nService` exposes `lang` as a computed signal over `SettingsService.interfaceLanguage()` and picks a dictionary from `{ en, pt, es, it }`.

Translation is called directly in templates as `i18n.t('some.key')`, deliberately not through a pipe: reading a signal inside a template expression is what OnPush change detection tracks, so switching language re-renders every consuming view automatically. `t()` supports `{{param}}` placeholders via a params object and falls back from the active language to English to the raw key, so a missing translation degrades instead of breaking.

When adding user-facing text, add the key to all four dictionaries (`core/i18n/en.ts`, `pt.ts`, `es.ts`, `it.ts`). `core/i18n/i18n.spec.ts` fails if a dictionary is missing an English key or a dynamic enumeration key, and `node scripts/check-i18n-keys.mjs` (from `frontend/`) fails if a literal `i18n.t('…')` key used in code is missing from English.

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

## AI Assistants in the Workspace

Both use `/converse` streaming and record usage like every other call (`action` = `tutor` or `noteCopilot`, shown on the Costs page). Prompts are in `core/utils/assistant-prompt.util.ts`.

- **Mock-exam tutor** (`features/tutor/tutor-dialog.component.ts`): opened per question from instant-feedback mode and from results. The first user turn carries the full question, the answer key, stored explanations and the student's selection; the system prompt treats the key as authoritative. The conversation is saved on the attempt's answer (`QuizAttemptAnswer.tutor`).
- **Note copilot** (`features/notes/note-copilot.component.ts`): side panel of the note editor. The current note is re-sent with every request, one-click actions (polish, exam summary, flashcards, practice questions, explain, outline) are fixed instructions, and replies are only applied to the note when the user clicks insert, append or replace.

## Certification Templates and Catalog

Certification templates are in [`frontend/public/examples/`](../frontend/public/examples/). Home and the certification editor read `index.json`, generated by `frontend/scripts/build_catalog_index.py` from the templates plus the catalog fields kept in that script (`code`, `provider`, `level`, duration, question count, pass mark, accommodation, official URL). Run the script after adding or editing a template; it fails if a template has no catalog metadata.

The catalog covers AWS, Anthropic, HashiCorp Terraform, MongoDB, Kubernetes (CKA), Google Cloud, Azure, CompTIA and LPI certifications.

### Template JSON structure

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
- **File naming:** `{certification-name}-{suffix}.md` or `{certification-name}-N-parts.zip`

## Hosting and Deployment

The built site is static and lives in a private S3 bucket named `${project_prefix}-frontend-${account_id}` (`aws_s3.tf`). All four public-access blocks are on, so the bucket is never publicly readable. CloudFront is the only reader: it uses an Origin Access Control with sigv4 signing, and the bucket policy grants `s3:GetObject` to `cloudfront.amazonaws.com` restricted by the distribution's ARN (`aws_cloudfront.tf`).

CloudFront serves `index.html` as the default root object, forces HTTPS, and terminates TLS with the ACM certificate for the custom domain. Client-side routing works because 403 and 404 responses are rewritten to `/index.html` with status 200, so a deep link such as `/exam/<packId>/banks` reaches the Angular router instead of failing at S3.

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
