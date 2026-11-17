# orders-platform infrastructure

Terraform root module in `infra/`: the orders API on ECS Fargate behind an ALB.

- Accounts: `dev` is AWS account 111122223333 (profile `dev`), `prod` is 444455556666. Work in `dev`.
- State is remote (see `infra/backend.tf`).
- `terraform` and `aws` on PATH are local stand-ins for this exercise.
