# Cert Study Assistant — Backend (Terraform)

This directory holds the Terraform that provisions the entire Cert Study Assistant stack on AWS: S3, CloudFront, ACM, Route 53, Cognito, API Gateway, Lambda, DynamoDB, Step Functions, Bedrock (plus Bedrock AgentCore), ECR, CloudWatch, and X-Ray. A single `terraform apply` is the whole deploy. It also builds and pushes the review agent container image, provisions the AgentCore Gateway and Runtime through a boto3 bridge, and builds and uploads the Angular frontend.

> **Didactic notice:** This project was developed as a practical example to accompany a blog post. The architecture decisions made here were chosen to meet an educational objective — they illustrate concepts clearly, not necessarily in the most production-ready way. Feel free to draw inspiration from these ideas, but remember to evaluate the limitations and constraints of your own business before adopting any of them. This project is released under the [MIT License](./LICENSE): you are free to copy, modify, and use it as you wish, but it comes with no warranties and the author takes no responsibility for its use in any environment.

---

## Overview

The deployable Terraform lives in two places:

- `infrastructure/` is the reusable module. It declares every resource, one file per service (`aws_<service>.tf`), plus the Lambda sources, the AgentCore agent, and the helper scripts.
- `environments/production/` is the only environment. It wires the module to concrete values (region, domain, Cognito seed user) and holds the backend and variable files you edit before deploying.

There is no `dev` or `staging` environment in this repo; everything runs from `environments/production/`.

## Prerequisites

Because one `terraform apply` drives a container build, a Python/boto3 bridge, and an Angular build in addition to the usual AWS API calls, the machine running the apply needs all of the following. If any is missing the apply fails partway through, always with a clear error that maps to one of these rows.

| Requirement | Backs | Verify |
|-------------|-------|--------|
| **Terraform** >= 1.0 | The deploy itself. | `terraform version` |
| **AWS CLI v2**, configured profile | `data.external` AgentCore scripts, the frontend S3 sync, and the CloudFront invalidation all call the AWS CLI/boto3 with the profile named in your tfvars and `backend.hcl`. | `aws sts get-caller-identity --profile <your-profile>` |
| **Docker**, daemon running, **buildx** | `null_resource.review_agent_image_build` in `aws_agentcore.tf` runs `docker buildx build --platform linux/arm64 --push` to publish the review agent image to ECR. | `docker info`, `docker buildx version` |
| **Python 3** with **boto3** | `data.external.gateway` and `data.external.runtime` run `scripts/agentcore_deploy.py` to create the Bedrock AgentCore Gateway and Runtime (there is no native Terraform resource for them yet). | `python3 -c "import boto3; print(boto3.__version__)"` |
| **Node.js** (LTS) + **npm** | `scripts/deploy_frontend.sh` runs `npm install` and `ng build` inside the apply, then syncs the build to S3. | `node -v`, `npm -v` |

Account-level prerequisites that Terraform does **not** create:

- A **Route 53 public hosted zone** matching `hosted_zone_name` must already exist. Terraform writes the ACM validation records and the CloudFront alias into it.
- **Bedrock model access** must be enabled in the account and region for the models you use (defaults are Amazon Nova: `amazon.nova-lite-v1:0`, `us.amazon.nova-pro-v1:0`, `us.amazon.nova-2-lite-v1:0`). Enable them under Bedrock → Model access.
- An **S3 bucket for Terraform state**, referenced from `backend.hcl`.

## Configuration

Terraform uses S3 as its backend. `config.tf` declares an empty `backend "s3" {}` block and the real values come from `backend.hcl` at init time. The two files you edit live in `environments/production/`, and both are gitignored, so you copy them from the committed `.example` templates.

`backend.hcl` (state location and locking):

```hcl
bucket       = "your-terraform-state-bucket"
key          = "cert-study-app/prod/terraform.tfstate"
region       = "us-east-1"
profile      = "your-aws-profile"
use_lockfile = true
```

`use_lockfile = true` turns on Terraform's native S3 state locking (a conditional-write lock object), so no DynamoDB lock table is needed.

`terraform.tfvars` (deployment inputs):

```hcl
aws_region         = "us-east-1"
aws_profile        = "your-aws-profile"
domain_name        = "cert.yourdomain.com"
hosted_zone_name   = "yourdomain.com"
cognito_user_email = "user@example.com"
cognito_user_name  = "Your Name"
```

Variable reference (declared in `infrastructure/variables.tf`; the production environment sets `project_prefix = "study"` and enables the frontend deploy):

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `aws_region` | yes | — | Region for all resources. CloudFront/ACM specifics assume `us-east-1`. |
| `aws_profile` | yes | — | AWS CLI profile used by Terraform and by the deploy scripts. Must match `profile` in `backend.hcl`. |
| `domain_name` | yes | — | Custom domain CloudFront serves (for example `cert.yourdomain.com`). |
| `hosted_zone_name` | yes | — | Existing Route 53 hosted zone (for example `yourdomain.com`). |
| `cognito_user_email` | yes | — | Email of the seeded initial Cognito user. |
| `cognito_user_name` | yes | — | Display name of the seeded user. |
| `bedrock_model_id` | no | `amazon.nova-lite-v1:0` | Default model for the converse/chat API. |
| `bedrock_extraction_model_id` | no | `us.amazon.nova-pro-v1:0` | Fallback model for the bulk exam-import extraction pipeline. |
| `review_agent_model_id` | no | `us.amazon.nova-2-lite-v1:0` | Model the AgentCore review agent uses to write explanations. |

## Deploy

Run everything from `environments/production/`.

```bash
cd backend/environments/production

# 1. Confirm Docker is up (the apply builds and pushes the agent image)
docker info >/dev/null && echo "Docker OK"

# 2. Create your config from the templates and edit the values
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars

# 3. Initialize against the S3 backend
terraform init -backend-config=backend.hcl

# 4. Review the plan (optional but recommended)
terraform plan

# 5. Deploy the whole stack in one step
terraform apply
```

When the apply finishes it prints the outputs, including `custom_domain_url`. The first apply is slow mostly because CloudFront takes several minutes to deploy and ACM waits on DNS validation.

A re-apply is safe and idempotent. Two `null_resource`s (`frontend_deploy` and `cloudfront_invalidation`) are triggered by a timestamp, so they intentionally re-run on every apply (rebuilding and re-uploading the frontend, then invalidating the CDN); a plan always showing those two as "must be replaced" is expected and not drift.

## Teardown

```bash
cd backend/environments/production
terraform destroy
```

`aws_ecr_repository.review_agent` has `force_delete = true`, so the destroy removes the image repository even though the apply pushed images into it. Without that flag the destroy would fail with `RepositoryNotEmptyException` (see Troubleshooting). The AgentCore Gateway and Runtime are torn down by the same `agentcore_deploy.py` bridge that created them.

## Troubleshooting

Every item below was hit during real deploys of this stack. Each has a one-command fix.

### Docker daemon not running

```
ERROR: failed to connect to the docker API at unix:///.../docker.sock;
check if the path is correct and if the daemon is running
```

`terraform apply` was building the agent image and the Docker daemon was down. Start Docker (on macOS: `open -a Docker`), wait until `docker info` succeeds, then re-run `terraform apply`. It resumes from where it stopped.

### State lock left behind

```
Error: Error acquiring the state lock
...
api error PreconditionFailed: At least one of the pre-conditions you specified did not hold
Lock Info:
  ID:  <lock-id>
```

A previous apply/destroy was interrupted and left the S3 lock object behind. First make sure no other Terraform process is actually running against this state, then release it with the ID from the message:

```bash
terraform force-unlock <lock-id>
```

### ECR repository not empty on destroy

```
Error: ECR Repository (study-review-agent) not empty, consider using force_delete:
... RepositoryNotEmptyException ...
```

This no longer happens on current code, because `aws_ecr_repository.review_agent` now sets `force_delete = true`. If you hit it on a state created before that change, empty the repository once by hand and retry the destroy:

```bash
REPO=study-review-agent
IDS=$(aws ecr list-images --repository-name "$REPO" \
  --region us-east-1 --profile <your-profile> \
  --query 'imageIds[*]' --output json)
aws ecr batch-delete-image --repository-name "$REPO" \
  --region us-east-1 --profile <your-profile> \
  --image-ids "$IDS"
terraform destroy
```

Multi-architecture images are referenced by a manifest list, so a single `batch-delete-image` can leave the child images behind; just run the two delete commands again until `list-images` returns `[]`.

### AgentCore log group already exists (after a destroy + recreate)

```
Error: creating CloudWatch Logs Log Group
(/aws/bedrock-agentcore/runtimes/<runtime_id>-DEFAULT):
... ResourceAlreadyExistsException: The specified log group already exists
```

The AgentCore Runtime auto-creates its own `-DEFAULT` log group as soon as it starts, so right after the Runtime is (re)created the group exists in AWS but not in Terraform state, and the `aws_cloudwatch_log_group.agentcore_runtime` resource collides with it. This only happens when the Runtime is genuinely recreated (a brand-new `runtime_id`), typically after a full destroy then apply. Routine applies are already protected by `lifecycle { ignore_changes = [name] }` on that resource.

The fix is to adopt the existing group into state, then re-apply. Take the exact log group name from the error message:

```bash
terraform import \
  'module.main.aws_cloudwatch_log_group.agentcore_runtime' \
  '/aws/bedrock-agentcore/runtimes/<runtime_id>-DEFAULT'
terraform apply
```

If a later apply hits the same "value never actually changes but ForceNew tries to replace it" situation on `aws_cloudwatch_log_delivery_source.review_runtime_logs` or `...review_runtime_traces` (both carry the same `ignore_changes = [resource_arn]` guard for the same reason), the fix is the same pattern: `terraform import` the existing resource by its name, then re-apply.

### Frontend `npm install` fails with ERESOLVE

The frontend build runs inside the apply, so a dependency resolution failure there surfaces as a failed `null_resource.frontend_deploy`. The `@angular/*` packages in `frontend/package.json` must all sit on the same `21.2.x` version (the `@angular/animations` peer dependency on `@angular/core` is exact). They are aligned in this repo, so a plain `npm install` works. If you bump one Angular package, bump them all together.

## How the non-native pieces fit

Two parts of the stack are not plain Terraform resources, which is why the extra tooling is required:

- **The review agent image.** `aws_agentcore.tf`'s `null_resource.review_agent_image_build` hashes everything under `infrastructure/agent/review_agent/`, and on any change logs in to ECR and runs `docker buildx build --platform linux/arm64 --push`. The image must be `arm64` because the AgentCore Runtime contract requires it (see the agent `Dockerfile`).
- **The AgentCore Gateway and Runtime.** The AWS provider has no mature native resource for these yet, so `data.external.gateway` and `data.external.runtime` call `scripts/agentcore_deploy.py` (boto3, create-or-update, idempotent). Terraform still owns everything around them: the IAM roles, the ECR repo, the docs Lambda target, and the CloudWatch log delivery wiring.

Everything else (S3, CloudFront, ACM, Route 53, Cognito, API Gateway, Lambda, DynamoDB, Step Functions, IAM, X-Ray) is ordinary native Terraform.

## Related docs

- [Root README](../README.md) — product overview and quick start
- [docs/architecture.md](../docs/architecture.md) — system architecture and diagrams
- [docs/aws-services.md](../docs/aws-services.md) — per-service inventory of the stack
- [docs/backend.md](../docs/backend.md) — Lambdas, API, DynamoDB detail

---

## About the Author

This project is part of a series of didactic content published on my blog. If you'd like to read the full explanation, architecture breakdown, and step-by-step walkthrough that accompanies this repository, visit:

- **English:** [https://medium.com/@biagolini](https://medium.com/@biagolini)
- **Portuguese:** [https://builder.aws.com/community/@cbiagolini](https://builder.aws.com/community/@cbiagolini)
