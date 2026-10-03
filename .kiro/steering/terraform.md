---
inclusion: always
---

# Terraform Conventions

How to write Terraform in this repo. The service-by-service inventory is in `docs/aws-services.md`.

## Layout

- `backend/infrastructure/` is the reusable module: one file per AWS service, `aws_<service>.tf`, plus `variables.tf`, `locals.tf`, `outputs.tf`. A Lambda that warrants its own file uses `aws_lambda_<name>.tf`.
- `backend/environments/production/` is the single deployment environment and instantiates the module. There is no dev/staging.
- Lambda source lives in `backend/infrastructure/lambda/<function>/`; the matching `aws_lambda_<function>.tf` builds and wires it.
- Generated Lambda zips go to `backend/infrastructure/.build/` (gitignored).

## Style

- Section headers as `# ====...====` blocks in every `.tf` file.
- Resource names `${var.project_prefix}-<suffix>`; this project's prefix is `study`.
- Tags come only from the provider's `default_tags` (`project_id`, `managed_by`, `environment`). Do not repeat them per resource.
- `for_each` over a `locals` map for families of similar resources.
- `create_before_destroy = true` where a replacement would otherwise cause downtime.
- `filesha256(...)` / `sha256(jsonencode(...))` as build and deployment triggers, so a rebuild happens only when the source actually changes.
- Mark sensitive variables `sensitive = true`; authenticate with `profile`, never hardcoded keys.

## Module Inputs Worth Knowing

`project_prefix`, `aws_region`, `project_id` are always required. `environment` defaults to `production`. `frontend_deploy_enabled` turns the SPA build-and-sync into part of `terraform apply`. Model ids (`bedrock_model_id`, `bedrock_extraction_model_id`, `review_agent_model_id`) are variables so a model can be swapped without code changes.

## Workflow

```bash
cd backend/environments/production
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

Run plan/validate freely; never run `apply` without asking first. `backend.hcl` and `terraform.tfvars` are gitignored: only the `.example` templates are committed, and real values must not be echoed anywhere (see `workflow.md`).
