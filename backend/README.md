# Project Name

TODO: Replace this line with a one-paragraph description of what this project does and its main purpose.

> **Didactic notice:** This project was developed as a practical example to accompany a blog post. The architecture decisions made here were chosen to meet an educational objective — they illustrate concepts clearly, not necessarily in the most production-ready way. Feel free to draw inspiration from these ideas, but remember to evaluate the limitations and constraints of your own business before adopting any of them. This project is released under the [MIT License](./LICENSE): you are free to copy, modify, and use it as you wish, but it comes with no warranties and the author takes no responsibility for its use in any environment.

---

## Overview

TODO: Project description

## Prerequisites

- Terraform >= 1.0
- AWS CLI configured
- S3 bucket for Terraform state

## Setup

```bash
cd environments/dev
cp backend.hcl.example backend.hcl    # Edit with your values
cp terraform.tfvars.example terraform.tfvars  # Edit with your values
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

## Backend Configuration

This project uses S3 as the Terraform backend. The `config.tf` file declares an empty `backend "s3" {}` block, and the actual values are loaded from `backend.hcl` at init time.

**Files:**
- `backend.hcl.example` — Template committed to the repo (placeholder values)
- `backend.hcl` — Your actual config (gitignored, never committed)

To initialize:
```bash
terraform init -backend-config=backend.hcl
```

---

## About the Author

This project is part of a series of didactic content published on my blog. If you'd like to read the full explanation, architecture breakdown, and step-by-step walkthrough that accompanies this repository, visit:

- **English:** [https://medium.com/@biagolini](https://medium.com/@biagolini)
- **Portuguese:** [https://builder.aws.com/community/@cbiagolini](https://builder.aws.com/community/@cbiagolini)
