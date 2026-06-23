---
inclusion: auto
name: project-structure
description: Repository layout, naming conventions, and how to scaffold new projects. Use when creating or navigating project folders.
---

# Project Structure

## Repository Layout

```
/
├── .kiro/                          # Kiro agent and steering configs
├── .copy_to_terraform_projects/    # Template files for new projects
├── create-terraform-project.sh     # Script to scaffold new projects
└── TerraformProjectName/           # Individual projects (each is its own git repo)
```

## Project Types

### Terraform-only

```
TerraformProjectName/
├── infrastructure/           # Reusable module (aws_<service>.tf per service)
│   ├── variables.tf
│   ├── locals.tf
│   ├── outputs.tf
│   └── aws_*.tf
├── environments/dev/         # Environment-specific config
│   ├── config.tf
│   ├── main.tf
│   ├── backend.hcl(.example)
│   └── terraform.tfvars(.example)
├── .kiro/
├── .gitignore
├── LICENSE
└── README.md
```

### Fullstack (Terraform + Frontend)

```
TerraformProjectName/
├── backend/
│   ├── infrastructure/
│   └── environments/dev/
├── frontend/
├── .kiro/
├── .gitignore
├── LICENSE
└── README.md
```

## Naming Conventions

- Project folders: PascalCase prefixed with `Terraform` (e.g., `TerraformCloudTrailGeoMonitor`)
- Terraform files: `aws_<service>.tf` per AWS service, `variables.tf`, `locals.tf`, `outputs.tf`
- Resources: `${var.project_prefix}-<suffix>` pattern

## Creating New Projects

```bash
./create-terraform-project.sh TerraformMyProject           # terraform-only
./create-terraform-project.sh TerraformMyProject --fullstack  # with frontend
```
