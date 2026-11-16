terraform {
  required_version = ">= 1.5"
}

resource "aws_instance" "staging" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t3.small"
}

resource "aws_instance" "production" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t3.medium"
}
