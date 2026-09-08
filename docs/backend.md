# Backend

Terraform-managed AWS infrastructure. Two Flask + Lambda Web Adapter
Lambdas behind API Gateway (converse, data) handle everything
request/response; three plain-Python Lambdas orchestrated by Step
Functions (`import_preprocess`, `import_extract`, `import_finalize`)
handle the [bulk exam import pipeline](./question-import-pipeline.md) —
see that doc for why the import pipeline needed its own async workflow
instead of another API Gateway route. The pipeline is only ever started
explicitly (`POST /data/imports/{id}/process`), never automatically on
upload — see that doc's "Upload and processing are two separate, explicit
steps" section for why.

## Project Structure

```
backend/
├── infrastructure/              # Reusable Terraform module
│   ├── aws_apigateway.tf        # API Gateway REST API + Cognito authorizer
│   ├── aws_lambda.tf            # Converse Lambda (streaming)
│   ├── aws_lambda_data.tf       # Data Lambda (CRUD + model discovery + imports)
│   ├── aws_lambda_import_preprocess.tf  # Import pipeline: chunking Lambda
│   ├── aws_lambda_import_extract.tf     # Import pipeline: per-question extraction Lambda
│   ├── aws_lambda_import_finalize.tf    # Import pipeline: result-aggregation Lambda
│   ├── aws_sfn_import.tf        # Step Functions state machine (Preprocess -> Map -> Finalize)
│   ├── aws_iam.tf               # IAM roles and policies
│   ├── aws_cognito.tf           # User Pool + client
│   ├── aws_dynamodb.tf          # Two tables: general/config + questions
│   ├── aws_s3.tf                # Frontend bucket
│   ├── aws_s3_assets.tf         # Private bucket: uploaded exams + question images
│   ├── aws_cloudfront.tf        # Distribution + OAC
│   ├── aws_route53.tf           # DNS alias
│   ├── aws_acm.tf               # TLS certificate
│   ├── locals.tf                # Shared locals
│   ├── variables.tf             # Module inputs
│   ├── outputs.tf               # Module outputs
│   ├── frontend_deploy.tf       # Build + sync + invalidation
│   ├── lambda/
│   │   ├── converse/app.py      # Bedrock converse_stream endpoint
│   │   ├── data/app.py          # DynamoDB CRUD + model listing + import jobs/presign
│   │   ├── import_preprocess/app.py  # Splits an uploaded file into per-question chunks
│   │   ├── import_extract/app.py     # One Bedrock vision/tool-use call per chunk
│   │   ├── import_extract/prompt.py  # Extraction system prompt + tool schema
│   │   └── import_finalize/app.py    # Aggregates Map results into a final job status
│   ├── scripts/
│   │   └── deploy_frontend.sh   # S3 sync script
│   └── templates/
│       ├── cognito-*/           # Cognito email templates
│       └── step-functions/      # Import workflow ASL definition
└── environments/
    └── production/              # Production config
        ├── config.tf            # Provider + backend "s3" {}
        ├── main.tf              # Module instantiation
        ├── backend.hcl.example  # Backend config template
        └── terraform.tfvars.example
```

## Lambda: Converse

**Purpose:** Stream Bedrock model responses to the client via NDJSON.

**Endpoint:** `POST /converse`

**Key behaviors:**
- Validates `model_id` format via regex (no static allowlist — IAM is the security boundary)
- Automatically enables **reasoning** (`reasoningConfig` with effort `low`) for Amazon Nova 2 models
- Streams `TOKEN`, `END`, `METADATA`, and `ERROR` events
- Reasoning tokens (`reasoningContent`) are not streamed to the client

**Request body:**
```json
{
  "model_id": "us.amazon.nova-2-lite-v1:0",
  "system_prompt": "You are...",
  "messages": [{"role": "user", "content": [{"text": "..."}]}]
}
```

## Lambda: Data

**Purpose:** CRUD for user data (packs, questions, scripts, settings) + model discovery.

**Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/data` | Fetch all user data |
| PUT | `/data` | Batch write all entities |
| PUT | `/data/settings` | Update settings |
| PUT | `/data/packs/{id}` | Upsert a pack |
| DELETE | `/data/packs/{id}` | Delete a pack |
| PUT | `/data/questions/{id}` | Upsert a question |
| DELETE | `/data/questions/{id}` | Delete a question |
| PUT | `/data/scripts/{id}` | Upsert a script |
| DELETE | `/data/scripts/{id}` | Delete a script |
| PUT | `/data/chats/{id}` | Upsert a chat session |
| DELETE | `/data/chats/{id}` | Delete a chat session |
| GET | `/data/models` | List usable Bedrock models |
| POST | `/data/imports` | Validates the pack, creates an `IMPORTJOB#` record (`AWAITING_UPLOAD`), returns a presigned S3 PUT URL |
| POST | `/data/imports/{id}/confirm-upload` | Marks a job `UPLOADED` once the browser's presigned PUT resolves |
| POST | `/data/imports/{id}/process` | Explicitly starts the Step Functions extraction for one uploaded (or previously failed) job |
| GET | `/data/imports/{id}` | Poll one import job's status |
| GET | `/data/imports` | List the user's import jobs |
| GET | `/data/assets/presign` | Presigned GET URL for one question image (`?key={jobId}/{questionId}/{filename}`) |

**Model discovery (`GET /data/models`):**
- Calls `ListFoundationModels(byOutputModality=TEXT)` + `ListInferenceProfiles(SYSTEM_DEFINED)`
- Filters for text-in/text-out, streaming-supported, ACTIVE models
- Prefers inference profile IDs over base model IDs
- Marks models with reasoning capability (`"reasoning": true`)
- Caches results for 1 hour (Lambda execution environment reuse)

## Bulk Exam Import Pipeline

A Step Functions Standard workflow (`study-import-exam`), started
explicitly by `POST /data/imports/{id}/process` (`states:StartExecution`
from `lambda/data/app.py`) once the user picks an already-uploaded file to
process — never automatically on upload. Three plain-Python Lambdas, not
behind API Gateway:

1. **`import-preprocess`** — splits the uploaded PDF/Markdown/ZIP into
   per-question chunks (text + candidate images), no AI involved.
2. **`import-extract`** (Map state, `MaxConcurrency: 4`) — one Bedrock
   Converse call per chunk, forcing structured JSON via tool-use.
3. **`import-finalize`** — aggregates the Map's results into the job's
   final status.

See [Bulk exam import pipeline](./question-import-pipeline.md) for the full
design, including why extraction needs a vision-capable model instead of a
deterministic parser, and how images get associated with the right
question.

## DynamoDB Schema

Two single-table-design tables, both partitioned per user (`pk =
USER#{sub}`): a general/config table (settings, packs, scripts, chats) and
a dedicated questions table. See
[DynamoDB schema](./dynamodb-schema.md) for the full `pk`/`sk` layout, the
structured `Question` v2 item shape, and why questions get their own table.

## IAM Permissions

| Role | Permissions |
|------|-------------|
| Lambda converse | `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on foundation-models + inference-profiles |
| Lambda data | DynamoDB CRUD + `bedrock:ListFoundationModels`, `bedrock:ListInferenceProfiles` + S3 `PutObject` on `uploads/*` / `GetObject` on `images/*` (assets bucket) + `states:StartExecution` on `study-import-exam` |
| Lambda import-preprocess | S3 `GetObject` on `uploads/*`, `PutObject` on `scratch/*`; DynamoDB `GetItem`/`PutItem` on the general table |
| Lambda import-extract | S3 `GetObject` on `scratch/*`, `PutObject` on `images/*`; DynamoDB `UpdateItem` (general table) + `PutItem` (questions table); `bedrock:InvokeModel` |
| Lambda import-finalize | DynamoDB `GetItem`/`PutItem` on the general table |
| Step Functions (`study-import-exam`) | `lambda:InvokeFunction` on the 3 import Lambdas; CloudWatch Logs delivery (for `logging_configuration`) |
| API Gateway | `lambda:InvokeFunction`, `lambda:InvokeFunctionUrl` |

## Related docs

- [DynamoDB schema](./dynamodb-schema.md)
- [Bulk exam import pipeline](./question-import-pipeline.md)
- [Architecture overview](./architecture.md)
- [Frontend documentation](./frontend.md)
