# AWS Services in the Stack

Everything below is declared in `backend/infrastructure/`, one file per service (`aws_<service>.tf`). Resources are named `${var.project_prefix}-<suffix>`, and the project prefix is `study`.

## Service Inventory

| Service | Declared in | Purpose in this stack |
|---------|-------------|----------------------|
| **S3** | `aws_s3.tf`, `aws_s3_assets.tf` | Two buckets. The frontend bucket holds the built Angular static site. The assets bucket holds user uploads (exam files), scratch working data for the import pipeline, and extracted question images. |
| **CloudFront** | `aws_cloudfront.tf` | The only public entry point to the site. Serves the SPA from S3 over HTTPS via Origin Access Control, and rewrites 403/404 to `/index.html` so client-side routing works. |
| **ACM** | `aws_acm.tf` | TLS certificate for the custom domain, with DNS validation, consumed by the CloudFront distribution. |
| **Route 53** | `aws_route53.tf` | Alias record pointing the custom domain at CloudFront, plus the DNS records that validate the ACM certificate. |
| **Cognito** | `aws_cognito.tf` | User pool with email/password (SRP) auth, an app client for the SPA, a hosted domain, and a seeded initial user. It is the identity source for the API authorizer. |
| **API Gateway** (REST) | `aws_apigateway.tf` | The single authenticated API surface. A `COGNITO_USER_POOLS` authorizer validates the id token before any Lambda runs; `/converse`, `/review`, and `/data/{proxy+}` are proxied to Lambdas, and CORS preflight methods stay unauthenticated. |
| **Lambda** | `aws_lambda.tf`, `aws_lambda_data.tf`, `aws_lambda_review.tf`, `aws_lambda_import_*.tf`, `aws_lambda_mcp_aws_docs.tf` | Eight functions: `converse` (Bedrock streaming), `data` (CRUD, model discovery, presigned URLs, starts the workflows), `review`, the four import-pipeline functions (`preprocess`, `extract`, `finalize`, `explain`), and an MCP AWS-docs helper. |
| **DynamoDB** | `aws_dynamodb.tf` | Five tables: `data` (packs, scripts, chats, settings, import jobs), `questions`, `quiz-attempts`, `import-drafts` and `costs` (both TTL-enabled; costs holds token usage records plus monthly budget counters). |
| **Step Functions** | `aws_sfn_import.tf`, `aws_sfn_import_explain.tf` | Two workflows. The import pipeline chunks an uploaded exam file, fans out one Bedrock extraction per question through a Map state, then finalizes. The explanation pipeline generates per-question explanations for approved drafts. |
| **Bedrock** | no Terraform resource (IAM only) | The AI itself. Called at runtime: `converse_stream` for streaming reviews and chat, `converse` with vision plus forced tool-use for import extraction, and `ListFoundationModels`/`ListInferenceProfiles` for dynamic model discovery. Access is granted through IAM policies in `aws_iam.tf`. |
| **Bedrock AgentCore** | `aws_agentcore.tf` | Hosts the dedicated review agent that writes the final question explanations. Created through deploy scripts (`null_resource` plus `data "external"`) because there is no native Terraform resource for it; Terraform still owns its IAM roles and log wiring. |
| **ECR** | `aws_ecr.tf` | Stores the container image for the AgentCore review agent, built and pushed on apply. |
| **CloudWatch Logs** | across the Lambda files and `aws_agentcore.tf` | Log groups for every Lambda with explicit retention, plus a log delivery source/destination pair that ships AgentCore runtime and application logs. |
| **X-Ray** | `aws_xray.tf` | Distributed tracing. All eight Lambdas run with `tracing_config { mode = "Active" }` and get the managed X-Ray write policy attached. |
| **IAM** | `aws_iam.tf` (plus per-service files) | Execution roles and least-privilege inline policies for every Lambda, the Step Functions state machines, and the AgentCore runtime and gateway. |
| **EventBridge** | `aws_s3_assets.tf` | The assets bucket has EventBridge notifications enabled. This is a leftover from when the import pipeline was triggered automatically by an S3 upload event; today the `data` Lambda starts the workflow explicitly, and no rule is declared. |
| **STS** | `locals.tf` (`data "aws_caller_identity"`) | Supplies the account id used to make bucket names globally unique. |

## Request Paths Worth Knowing

A page load is pure CDN: browser to CloudFront to S3, with no Lambda involved. Every dynamic action instead goes browser to API Gateway (Cognito authorizer) to Lambda.

AI streaming uses the `converse` Lambda, which runs a Flask app behind the Lambda Web Adapter layer (`handler = "run.sh"`, with `AWS_LWA_INVOKE_MODE` set for response streaming) and relays Bedrock deltas to the client as NDJSON lines.

A bulk import is explicitly user-triggered, not event-driven: the SPA uploads the exam file straight to the assets bucket with a presigned PUT, then calls the API, and the `data` Lambda issues `StartExecution` on the import state machine (its input mirrors the old S3-to-EventBridge event shape, which is why `import_preprocess` still reads `event["detail"]["bucket"]`). Extraction results land in `import-drafts` for human review; promoting them starts the second workflow.

## Conventions and Cost Notes

Tags come from the provider's `default_tags` (`project_id`, `managed_by`, `environment`), so individual resources do not repeat them.

The frontend bucket blocks all public access and is readable only by CloudFront through OAC. The assets bucket is fully private too, reachable from the browser only via presigned URLs.

Bedrock is the dominant cost driver, since one bulk import can issue dozens of model calls. Every AI call writes a usage record to the `costs` table, and an optional monthly budget is checked before a call runs and blocks further spend once reached.

Transient data expires on purpose, and two of those windows are deliberately paired: the assets bucket expires `uploads/` after 2 days and `scratch/` after 14 days, and the `scratch/` window matches the `import-drafts` table TTL because a draft points at `scratch/` keys. Changing one without the other can leave a still-listed draft referencing objects that were already deleted. CloudWatch log groups retain 14 days.

## Related docs

- [Architecture overview](./architecture.md)
- [Backend documentation](./backend.md)
- [Frontend documentation](./frontend.md)
- [DynamoDB schema](./dynamodb-schema.md)
