---
inclusion: auto
name: tech-stack
description: Technology stack, tools, and language choices. Use when selecting providers, libraries, or runtime decisions.
---

# Technology Stack

## Infrastructure as Code

- **Terraform** >= 1.0 with HCL syntax
- **AWS Provider** (`hashicorp/aws`) pinned to `~> 5.0`
- Additional providers as needed: `hashicorp/random`, `hashicorp/archive`

## Cloud Platform

- **AWS** as the sole cloud provider
- Services vary per project (Lambda, S3, DynamoDB, API Gateway, Cognito, CloudTrail, EventBridge, SNS, etc.)

## State Management

- S3 backend for remote state
- Default bucket: `tutorial-terraform-tfstate`
- Default profile: `BIAGOLINI-TUTORIAL`
- Default region: `us-east-1`

## Languages

- Terraform HCL for infrastructure
- Python for Lambda functions (preferred)
- Node.js as alternative for Lambda when appropriate

## Frontend (when applicable)

- Varies by project (Angular, plain HTML/JS, React)
- Lives in `frontend/` directory; Terraform moves to `backend/`

## Development Tools

- AWS CLI for verification and testing
- Terraform CLI for plan/apply/destroy
- Git for version control (each project is its own repo)
