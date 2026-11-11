---
name: aws
description: "Use when writing or reviewing AWS infrastructure as Terraform (ECS/Fargate, networking, IAM); not for GCP, Azure or Fly.io."
---

# AWS + Terraform conventions

Auth: use `AWS_PROFILE`/SSO or the CI role from the environment; never hard-code keys or commit `*.tfvars` with secrets. Confirm the account with `aws sts get-caller-identity` before applying.

Gotchas:
- Non-interactive flow: `terraform init -input=false`, `terraform validate`, `terraform plan -input=false -out=tfplan`, then `terraform apply tfplan`. Never `-auto-approve` without explicit user approval; never apply from an unreviewed plan.
- Remote state with locking (S3 + DynamoDB/lockfile); never edit state by hand.
- IAM: least privilege, no `*` actions/resources; task roles separate from execution roles on ECS.
- Fargate tasks in private subnets behind an ALB; secrets from Secrets Manager/SSM via `secrets`, not `environment`.
- Encrypt storage (S3, RDS, EBS), block public S3 access, tag every resource.
- Pin provider versions.
