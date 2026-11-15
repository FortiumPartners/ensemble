variable "region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "image" {
  description = "Container image of the orders service, with a pinned tag"
  type        = string
  default     = "111122223333.dkr.ecr.us-east-1.amazonaws.com/orders:1.8.2"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}
