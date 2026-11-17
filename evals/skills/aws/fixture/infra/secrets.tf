resource "aws_secretsmanager_secret" "api_key" {
  name = "${local.name}/api-key"

  tags = local.tags
}
