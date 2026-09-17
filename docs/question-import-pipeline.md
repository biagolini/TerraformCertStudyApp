# Bulk exam import pipeline

How a whole practice exam file (PDF, Markdown, HTML, or a ZIP bundling Markdown/HTML with an image folder) becomes many structured `Question` records (see [DynamoDB schema](./dynamodb-schema.md)) without the user adding them one at a time. Unlike the single-question [ingestion pipeline](./question-ingestion.md) — which is deterministic parsing plus one small AI enrichment call — this pipeline asks a vision-capable model to do the whole structural extraction per question, because the source material is too messy and visually-coded (see "Why vision, not a parser" below) for a fixed rule to handle reliably.

## Why an async pipeline

A single exam file can contain 75+ questions spread over hundreds of pages. Extracting all of them means one Bedrock call per question, which can take minutes in total — too slow for a synchronous HTTP request, and too much work to safely fit inside one Lambda's 15-minute ceiling as files grow. The pipeline is a **Step Functions Standard workflow** (`study-import-exam`) with a **Map state** fanning out one Bedrock call per question chunk, with retries and per-item failure isolation built in.

## Upload and processing are two separate, explicit steps

A "simulado" can be more than one file (e.g. several PDFs), so uploading and processing are deliberately decoupled: uploading a file only gets it onto S3 and marks it ready — nothing is queued for extraction until the user explicitly picks which uploaded file(s) to process. This also means a page reload never has to guess whether a half-finished upload is still "active" — an early version of this feature auto-resumed polling for any non-terminal job on load, which meant a job that never got its upload confirmed (e.g. a network drop) stayed stuck forever and kept reappearing as if it were in progress.

1. **Create + upload.** Frontend calls `POST /data/imports` with `{packId, filename}`. The backend (`lambda/data/app.py`) validates the pack belongs to the caller, creates an `IMPORTJOB#{jobId}` record (`status: AWAITING_UPLOAD`) in the general `study-data` table, and returns a presigned S3 PUT URL for `uploads/{sub}/{jobId}/{filename}` in the private `study-assets-<account_id>` bucket. The frontend `PUT`s the raw file straight to S3 via `XMLHttpRequest` (tracking real upload progress), bypassing API Gateway's ~10MB payload limit entirely — large PDFs wouldn't fit through it.
2. **Confirm.** Once the PUT resolves, the frontend calls `POST /data/imports/{id}/confirm-upload`, which flips the job to `status: UPLOADED`. The file now shows up in the "Ready to process" list — nothing else happens automatically.
3. **Process.** The user selects one or more `UPLOADED` files and clicks "Process selected". The frontend calls `POST /data/imports/{id}/process` once per selected job. That handler resets the job's counters, sets `status: PROCESSING`, and calls `states:StartExecution` on `study-import-exam` directly — with an input shaped exactly like the S3 event `import-preprocess` originally expected (`{"detail": {"bucket": {"name": ...}, "object": {"key": ...}}}`), so that Lambda needed no changes when the trigger moved from an automatic S3 event to an explicit API call. Retrying a previously `FAILED`/`PARTIAL` job reuses this same endpoint.

## The three Step Functions tasks

### 1. `import-preprocess` — chunk the file (no AI)

Reads the uploaded file and splits it into one **chunk per question**, using dumb boundary detection only:

- **ZIP** — extracts the bundled `.md` or `.html`/`.htm` file plus any image files anywhere in the archive, uploads each image to `scratch/{jobId}/raw/img/{basename}`, and splits on numbered Markdown headings (`#### 1. Question`, tolerating the ground truth's 3x-repeated headings per question) or, for HTML, on each `<span>Pergunta N</span>` / `<span>Question N</span>` anchor (the same per-question status header a browser-saved quiz-results page renders — the same "Pergunta N"/"Question N" convention the PDF path already relies on). The HTML branch strips `<script>`/`<style>` first, converts `<img src>` tags to the same `![]()` syntax the Markdown path uses, and inserts line breaks at block-tag boundaries (`</p>`, `</div>`, `</li>`, `<br>`) so adjacent alternatives don't run together into one wall of text — both paths converge on the same `kind: "markdown"` chunk shape, so `import-extract` doesn't need to know which source format produced it.
- **Markdown** (no ZIP) — same splitter, no images (a bare `.md` upload has nowhere to source external image files from).
- **PDF** — opens with PyMuPDF, searches each page's text for `Pergunta N` / `Question N`, and rasterizes every page in that question's range to `scratch/{jobId}/pages/{pageNum}.png` at 150 DPI.

Chunking deliberately does **not** try to exclude unrelated content (e.g. a full page of an unrelated linked article interleaved between two questions in a browser-printed PDF export) — that's left to the extraction model in step 2, since telling "this is the question" from "this is supplementary reference content" often requires actually reading it.

Sets the job's `status` to `PROCESSING` and `totalQuestions` to the chunk count.

### 2. `import-extract` — one Bedrock call per chunk (the Map state)

For each chunk, one **non-streaming** `bedrock-runtime.converse()` call with a **forced tool call** (`toolChoice: {tool: {name: "emit_question"}}`) — the model has no choice but to return a `Question`-shaped JSON object directly. This skips the "generate Markdown, then regex-parse it" round trip the single-question flow uses; that round trip only exists there to support the interactive live-preview streaming UI, which a batch job has no need for.

**Model selection.** The model is a per-request choice, not hardcoded: the frontend Settings screen has a dedicated **"Exam import model"** picker (`AppSettings.importExtractionModel`, default `us.amazon.nova-pro-v1:0` — distinct from "Default model", which only affects the interactive Generate-with-AI flow). The chosen model id travels with the job — stored on the `IMPORTJOB#` record when the user clicks "Process", forwarded through `import-preprocess`'s output alongside `packId`, and read by `import-extract` off the event (`event.get("modelId")`, falling back to the `BEDROCK_EXTRACTION_MODEL_ID` env var only if absent). A stronger model trades cost/latency for fewer extraction failures, but isn't free of tradeoffs: Nova Pro's Bedrock quota in this account is 25 requests/minute cross-region vs. Nova Lite's 200/minute, so `_converse_with_retry` uses a longer exponential backoff with jitter (up to 5 attempts, 3s/6s/12s/20s capped) to absorb the throttling a stronger-but-slower-quota model produces under the Map's 4-way concurrency — validated live at 75/75 successes on two different real files after tuning this.

**Why vision, not a parser.** The real source formats all hide signal a deterministic parser would need:

- A browser-printed PDF marks the correct option only with a **colored border** around its box — a layout/visual cue, not extractable from text.
- All formats can include **irrelevant status labels** (`Incorreto`, `Correto`, `Ignorado` — what some earlier test-taker answered) sitting right next to the real content, which a naive parser could easily mistake for the answer key.

The system prompt (`lambda/import_extract/prompt.py`) explicitly tells the model to ignore those status labels and interleaved unrelated content, and to identify the true answer only from explicit "correct answer" prose or the bordered/labeled box.

**Images**: the model references a supplied image inline with a `{{IMG:n}}` placeholder (n = 0-based index among the images it was given, in order) — this convention is the same for every source kind (PDF page images, or the images resolved from `![alt](ref)` in a Markdown/HTML chunk); the model is explicitly told never to emit literal `![...](...)` syntax itself, even if the source text still contains it. After the call, the Lambda rewrites `{{IMG:n}}` to `![alt]({jobId}/{questionId}/{filename})` and copies **only the images actually referenced in the surviving output** from `scratch/` to their permanent `images/{sub}/{jobId}/{questionId}/` key — nothing is promoted just because it was sent to the model. Before use, `_load_images` sniffs each image's real format from its magic bytes rather than trusting the file extension — a real HTML export was found to serve some `.jpg` files that are actually PNG-encoded, which Bedrock rejects with a MIME-mismatch error if told they're JPEG.

**Known limitation, not a bug**: the model frequently doesn't bother referencing an image at all, even when one clearly illustrates the question or its explanation — confirmed by tracing a real chunk end to end (correct images, correctly resolved, correctly sent as vision input) and by two separate attempts at strengthening the prompt/tool-schema wording, neither of which moved a real 0-image-in-7-questions result. See the README's "Adding Questions" section for the user-facing mitigation (attach the image by hand via `POST /data/assets/upload`, then paste the generated `![alt](key)` snippet into the question).

**Deleting a question also deletes its images.** `DELETE /data/questions/{id}` (in `lambda/data/app.py`, not this pipeline's own code) parses the question's stem/alternatives/comments for `![alt](relativeKey)` references, validates each key the same way the presign GET endpoint does, and best-effort deletes each one from S3 before removing the DynamoDB item — so re-importing or deleting a pack doesn't leave orphaned images billing for storage forever. Editing a question (`PUT`) does not do this cleanup yet if an image reference is removed or replaced.

Any failure (model refusal, malformed output, validation failure) is caught internally and returned as `{"status": "FAILED"}` rather than thrown, so one bad question never fails the other 74. `processedCount`/`failedCount` are incremented via a genuinely atomic DynamoDB `UpdateItem ADD` on native top-level attributes (not inside the JSON `data` blob most other item types use) — this is what lets several Map iterations update the same job record concurrently without racing.

### 3. `import-finalize` — aggregate into a final status

Counts `SUCCEEDED` vs `FAILED` results and sets the job's final `status`: `SUCCEEDED` (no failures), `PARTIAL` (some failures), or `FAILED` (all failures, or preprocessing itself failed).

## Idempotency

`questionId` is always `{jobId}-{chunkIndex}` — deterministic, never random. Retrying a job (clicking "Process" again on a `FAILED`/`PARTIAL` job, or re-running the same execution) overwrites the same `study-questions` item and the same `images/...` S3 keys rather than creating duplicates.

## Frontend

Images are rendered by `markdown-renderer.component.ts` resolving each `![alt](key)` reference through `ImageAssetService` (presigned GET, cached per session). A key that fails to resolve — a since-deleted image, a bad key from hand-editing — renders a small dashed-border placeholder with the image's own alt text rather than silently showing nothing; the previous behavior (calling the presign fetch directly from the template) hit Angular's `NG0600` guard against writing a signal mid-render and failed silently every time, which is why this needed a constructor `effect()` instead of a template-level call. The same `ImageAssetService` also backs manual image attachment (`POST /data/assets/upload`) — see the README's "Adding Questions" section.

`core/services/import-exam.service.ts` owns one `jobs` signal (the user's full job list, refreshed via `GET /data/imports`) that both `features/import-exam/import-exam.component.ts` (grouped into "Ready to process" / "Processing" / "Recent") and the header `ImportStatusPillComponent` read from — no per-component polling. The service centrally polls every ~15s **only while at least one job is `PROCESSING`**, stopping automatically once none are, and calls `StorageService.refresh()` when a job just reached `SUCCEEDED`/`PARTIAL` — new questions were written directly by backend Lambdas, bypassing this app's own debounced push path entirely, so a pull is the only way they appear in `QuestionsService`.

## Flow diagram

```mermaid
flowchart TD
    A["User picks a file\n(features/import-exam)"] --> B["POST /data/imports\ncreates IMPORTJOB# (AWAITING_UPLOAD), returns presigned PUT URL"]
    B --> C["Browser PUTs file directly to S3\nuploads/{sub}/{jobId}/{filename} (XHR, tracks % progress)"]
    C --> D["POST /data/imports/{id}/confirm-upload\nstatus -> UPLOADED"]
    D --> E["Shown in 'Ready to process'\n(no auto-processing)"]

    E -->|"user selects file(s), clicks Process"| F["POST /data/imports/{id}/process\nresets counters, status -> PROCESSING"]
    F --> G["states:StartExecution\n(study-import-exam state machine)"]

    G --> H["import-preprocess\nsplit into per-question chunks (no AI)"]
    H --> I{"Map state\nMaxConcurrency 4"}
    I --> J["import-extract (per chunk)\nBedrock Converse + forced tool-use"]
    J -->|success| K["PutItem study-questions\n+ atomic ADD processedCount"]
    J -->|failure, caught| L["{status: FAILED}\n+ atomic ADD processedCount, failedCount"]
    K --> M["import-finalize"]
    L --> M
    M --> N["Job status: SUCCEEDED / PARTIAL / FAILED"]

    N --> O["Frontend polls GET /data/imports\nevery ~15s while any job is PROCESSING"]
    O --> P["StorageService.refresh()\non terminal success"]
```

## Related docs

- [DynamoDB schema](./dynamodb-schema.md) — the `IMPORTJOB#` and `Question` (`starred` field) shapes
- [Question ingestion pipeline](./question-ingestion.md) — the single-question flow this one deliberately does NOT reuse for extraction, and why
- [Backend documentation](./backend.md)
