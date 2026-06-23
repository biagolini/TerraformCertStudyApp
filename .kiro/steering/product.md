---
inclusion: auto
name: product-overview
description: Project purpose, objectives, and guiding principles. Use when planning new projects or making architectural decisions.
---

# Product Overview

This is a collection of didactic Terraform projects demonstrating AWS services and infrastructure patterns. Each project folder is a self-contained, shareable repository designed for educational purposes.

## Objectives

- Create reusable Terraform examples that teach AWS services
- Provide complete, working infrastructure-as-code deployable with minimal configuration
- Follow AWS Well-Architected Framework principles

## Target Audience

- Developers learning Terraform and AWS
- Cloud architects looking for reference implementations
- Students following tutorials or courses

## Guiding Principles

- Every project must be deployable by copying `.example` files, filling values, and running `terraform apply`
- Security by default: no secrets in version control, least-privilege IAM
- Cost-conscious: use minimal resources suitable for learning
- Each project is independent — no cross-project dependencies
- Code should be self-documenting with clear variable descriptions
