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
| `USER#{sub}` | `SETTINGS` | `AppSettings` (theme, defaultModel, activePackId, activeMethod, outputLanguage, defaultReviewMode) |
| `USER#{sub}` | `PACK#{id}` | `Pack` (name, description, version, domains, color, export intros) — see `frontend/src/app/core/models/pack.model.ts` |
| `USER#{sub}` | `SCRIPT#{id}` | `Script` (transcript-summary session) — see `frontend/src/app/core/models/script.model.ts` |
| `USER#{sub}` | `CHAT#{id}` | `ChatSession` (messages + summary) — see `frontend/src/app/core/models/chat.model.ts` |

Billing: `PAY_PER_REQUEST`. Keys: `pk` (S, hash), `sk` (S, range).

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
  text: string;          // alternative statement (inline markdown: **bold**/*italic* only)
  isCorrect: boolean;
  comment: string;       // rationale for THIS alternative, correct or not — always present
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
  stem: string;                     // scenario + question text (inline markdown)
  alternatives: QuestionAlternative[];
  metadata: QuestionMetadata;
  createdAt: number;
  updatedAt: number;
}
```

Whether a question is single- or multiple-answer is never stored as a flag
— it's always derived from `alternatives.filter(a => a.isCorrect).length`.

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

- [Question ingestion pipeline](./question-ingestion.md) — how `stem`/`alternatives`/`metadata` get produced
- [Backend documentation](./backend.md)
- [Architecture overview](./architecture.md)
