terraform {
  backend "s3" {
    bucket         = "orders-platform-tfstate-111122223333"
    key            = "dev/infra.tfstate"
    region         = "us-east-1"
    dynamodb_table = "orders-platform-tflock"
    encrypt        = true
  }
}
