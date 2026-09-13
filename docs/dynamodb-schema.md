# DynamoDB schema

Two single-table-design tables, both partitioned per Cognito user
(`pk = USER#{sub}`). Every item stores its payload as a single JSON string
under a `data` attribute — the Lambda (`lambda/data/app.py`) never inspects
or validates that JSON, it only routes by `sk` prefix. The frontend owns the
`data` shape; this doc is the source of truth for it.

## Why two tables

Questions are the largest, most structured, and most actively-evolving
entity (they carry the app's entire quiz/study content and may need
independent scaling or GSIs later, e.g. querying by topic). Packs, scripts,
chats, and settings are small, low-churn configuration that changes
together and has no reason to scale independently. Splitting them keeps the
config table simple and lets the questions table evolve without touching
anything else.

## Table: `${project_prefix}-data` (general/config)

| pk | sk | `data` payload |
|----|----|-----------------|
| `USER#{sub}` | `SETTINGS` | `AppSettings` (theme, defaultModel, importExtractionModel, activePackId, activeMethod, outputLanguage, defaultReviewMode) |
| `USER#{sub}` | `PACK#{id}` | `Pack` (name, description, version, domains, color, export intros) — see `frontend/src/app/core/models/pack.model.ts` |
| `USER#{sub}` | `SCRIPT#{id}` | `Script` (transcript-summary session) — see `frontend/src/app/core/models/script.model.ts` |
| `USER#{sub}` | `CHAT#{id}` | `ChatSession` (messages + summary) — see `frontend/src/app/core/models/chat.model.ts` |
| `USER#{sub}` | `IMPORTJOB#{id}` | Bulk exam-import job status (below) |

Billing: `PAY_PER_REQUEST`. Keys: `pk` (S, hash), `sk` (S, range).

### `IMPORTJOB#{id}` shape

Tracks a [bulk exam import](./question-import-pipeline.md) from upload
through Step Functions completion. Unlike every other item in this table,
**`processedCount`/`failedCount` are native top-level DynamoDB attributes,
not fields inside the `data` JSON blob** — the extraction Lambda's
concurrent Map iterations increment them with a genuinely atomic
`UpdateItem ADD`, which isn't possible on a value trapped inside an opaque
JSON string. `GET /data/imports*` merges them back into a flat object
before returning it to the frontend.

```ts
// `data` blob:
{
  id: string;
  packId: string;
  filename: string;
  status: 'AWAITING_UPLOAD' | 'UPLOADED' | 'PROCESSING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  totalQuestions: number | null;   // null until import-preprocess finishes chunking
  createdAt: number;
  completedAt: number | null;
  error: string | null;
  modelId?: string;    // Bedrock model used for extraction — set on "Process",
                        // from the frontend's "Exam import model" setting
                        // (default us.amazon.nova-pro-v1:0); import-extract
                        // falls back to its own env var default if absent
  failures?: Array<{ index: number | null; error: string; preview: string | null }>;
                        // set by import-finalize — one entry per failed chunk,
                        // `preview` is a short snippet of the source text so the
                        // user can locate the question in their original file
}
// native top-level attributes (sibling to pk/sk/data):
processedCount: number; // atomic ADD from import-extract
failedCount: number;    // atomic ADD from import-extract
```

`UPLOADED` sits between `AWAITING_UPLOAD` and `PROCESSING`: set by
`POST /data/imports/{id}/confirm-upload` once the browser's presigned PUT
resolves, and left alone until the user explicitly picks the file to
process — see the [import pipeline doc](./question-import-pipeline.md)'s
"Upload and processing are two separate, explicit steps".

## Table: `${project_prefix}-questions`

| pk | sk | `data` payload |
|----|----|-----------------|
| `USER#{sub}` | `QUESTION#{id}` | `Question` v2 (below) |

Billing: `PAY_PER_REQUEST`. Keys: `pk` (S, hash), `sk` (S, range). Same
partitioning as the general table (still one `Query` per user on login),
just a separate table.

### `Question` v2 shape

Replaces the v1 shape (a single free-text `review: string` Markdown blob).
v2 is fully structured — no question content lives in an unparsed blob
anymore, and there is no v1 fallback kept in the app.

```ts
export interface QuestionAlternative {
  letter: string;        // 'A', 'B', 'C'... — stable, matches how it reads in the UI
  text: string;          // alternative statement (inline markdown: **bold**/*italic*/![alt](key))
  isCorrect: boolean;
  comment: string;       // rationale for THIS alternative, correct or not — always present
                          // (inline markdown, same subset as `text`)
}

export interface QuestionMetadata {
  topics: string[];          // key concepts/themes this question tests
  relatedServices: string[]; // AWS/vendor services or products referenced (generic name — not AWS-only, other certs use this too)
}

export interface Question {
  id: string;
  packId: string;
  title: string;
  domain: string;
  stem: string;                     // scenario + question text (inline markdown: **bold**/*italic*/![alt](key))
  alternatives: QuestionAlternative[];
  metadata: QuestionMetadata;
  createdAt: number;
  updatedAt: number;
  starred?: boolean;   // persistent "revisit this later" flag — independent of
                        // any per-attempt quiz state; optional/absent = false
  generalComment?: string; // overall explanation for the question as a whole,
                        // distinct from any one alternative's own comment;
                        // shown alongside the alternatives' comments (review
                        // viewer) or gated behind the same reveal-after-
                        // answering state (quiz runner) — never before them
}
```

Whether a question is single- or multiple-answer is never stored as a flag
— it's always derived from `alternatives.filter(a => a.isCorrect).length`.

**Image references.** `![alt](key)` in `stem`/`text`/`comment` is a relative
S3 key, always `{jobId}/{questionId}/{filename}` (3 segments — validated
server-side on every read), resolved to a presigned GET URL at render time.
`jobId` is the actual import job for bulk-imported images, or a freshly
minted id standing in for both segments for a manually-attached image (see
[import pipeline doc](./question-import-pipeline.md)) — the app never
distinguishes the two once the reference is written into a question.

Example item (`data` attribute, pretty-printed):

```json
{
  "id": "0224d231-a07f-480e-b6fe-713ea2f46591",
  "packId": "4afdbcac-4f45-4eba-8652-a702cb8b17f1",
  "title": "Trusted Identity Propagation with IAM Identity Center",
  "domain": "AI Safety, Security, and Governance",
  "stem": "A developer is building a custom web application that calls Amazon Q Business on behalf of authenticated enterprise users...",
  "alternatives": [
    { "letter": "A", "text": "Federate directly with AssumeRoleWithSAML...", "isCorrect": false, "comment": "Produces a plain IAM role session with no sts:identity_context claim, so Amazon Q Business can't enforce per-user ACLs and CloudTrail only logs the shared role." },
    { "letter": "B", "text": "Exchange the JWT for an IAM Identity Center token via CreateTokenWithIAM, then AssumeRole with sts:identity_context...", "isCorrect": true, "comment": "This is trusted identity propagation end to end: the identity-enhanced role session lets Amazon Q Business apply per-user ACLs and CloudTrail auto-populates OnBehalfOf." }
  ],
  "metadata": {
    "topics": ["IAM Identity Center trusted token issuer", "Trusted Identity Propagation", "CreateTokenWithIAM"],
    "relatedServices": ["Amazon Q Business", "AWS IAM Identity Center", "AWS CloudTrail", "AWS STS"]
  },
  "createdAt": 1787956104368,
  "updatedAt": 1787956104368
}
```

### Where each field comes from

- `stem`, `alternatives[].text`, `alternatives[].isCorrect`,
  `alternatives[].comment`, `metadata.topics`: parsed deterministically from
  the Markdown a model streams back (or a manually pasted "ready-made"
  review) — see `frontend/src/app/core/utils/question-parse.util.ts`. The
  parser locates the four content sections (question / alternatives /
  correct / incorrect) **by position** (the last four `#`-headings in the
  document, in that order), not by matching specific heading text — this is
  what makes it tolerant of prompt/heading wording changing over time.
- `metadata.relatedServices`: a small, non-streaming Bedrock call over the
  parsed stem + alternatives (`question-enrichment.service.ts`,
  `extractRelatedServices`) — the same code path used both live (every new
  question) and by the one-time migration script.

## Related docs

- [Question ingestion pipeline](./question-ingestion.md) — how `stem`/`alternatives`/`metadata` get produced for a single pasted question
- [Bulk exam import pipeline](./question-import-pipeline.md) — how the same `Question` shape gets produced in bulk from an uploaded exam file, and the `IMPORTJOB#` lifecycle
- [Backend documentation](./backend.md)
- [Architecture overview](./architecture.md)
