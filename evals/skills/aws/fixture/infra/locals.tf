locals {
  name = "orders-${var.environment}"

  tags = {
    Project     = "orders-platform"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
