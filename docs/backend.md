# Backend

Terraform-managed AWS infrastructure with two Lambda functions (Flask + Lambda Web Adapter).

## Project Structure

```
backend/
├── infrastructure/              # Reusable Terraform module
│   ├── aws_apigateway.tf        # API Gateway REST API + Cognito authorizer
│   ├── aws_lambda.tf            # Converse Lambda (streaming)
│   ├── aws_lambda_data.tf       # Data Lambda (CRUD + model discovery)
│   ├── aws_iam.tf               # IAM roles and policies
│   ├── aws_cognito.tf           # User Pool + client
│   ├── aws_dynamodb.tf          # Single-table for user data
│   ├── aws_s3.tf                # Frontend bucket
│   ├── aws_cloudfront.tf        # Distribution + OAC
│   ├── aws_route53.tf           # DNS alias
│   ├── aws_acm.tf               # TLS certificate
│   ├── locals.tf                # Shared locals
│   ├── variables.tf             # Module inputs
│   ├── outputs.tf               # Module outputs
│   ├── frontend_deploy.tf       # Build + sync + invalidation
│   ├── lambda/
│   │   ├── converse/app.py      # Bedrock converse_stream endpoint
│   │   └── data/app.py          # DynamoDB CRUD + model listing
│   ├── scripts/
│   │   └── deploy_frontend.sh   # S3 sync script
│   └── templates/               # Cognito email templates
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

**Model discovery (`GET /data/models`):**
- Calls `ListFoundationModels(byOutputModality=TEXT)` + `ListInferenceProfiles(SYSTEM_DEFINED)`
- Filters for text-in/text-out, streaming-supported, ACTIVE models
- Prefers inference profile IDs over base model IDs
- Marks models with reasoning capability (`"reasoning": true`)
- Caches results for 1 hour (Lambda execution environment reuse)

## DynamoDB Schema

Single-table design with `pk` (partition key) and `sk` (sort key):

| pk | sk | Content |
|----|----|---------|
| `USER#{sub}` | `SETTINGS` | App settings JSON |
| `USER#{sub}` | `PACK#{id}` | Pack JSON |
| `USER#{sub}` | `QUESTION#{id}` | Question JSON |
| `USER#{sub}` | `SCRIPT#{id}` | Script JSON |
| `USER#{sub}` | `CHAT#{id}` | Chat session JSON (messages + summary) |

## IAM Permissions

| Role | Permissions |
|------|-------------|
| Lambda converse | `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on foundation-models + inference-profiles |
| Lambda data | DynamoDB CRUD + `bedrock:ListFoundationModels`, `bedrock:ListInferenceProfiles` |
| API Gateway | `lambda:InvokeFunction`, `lambda:InvokeFunctionUrl` |

## Related docs

- [Architecture overview](./architecture.md)
- [Frontend documentation](./frontend.md)
