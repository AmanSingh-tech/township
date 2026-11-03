# Township on AWS, Mumbai (ap-south-1). Everything lives in India; disaster
# recovery copies go to Hyderabad (ap-south-2).
#
#   ALB (HTTPS, WAF) -> ECS Fargate, 2+ tasks in private subnets -> RDS PostgreSQL (Multi-AZ)
#                                                                 -> S3 (photos)
# See README.md in this folder for the first deploy and the runbooks.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.70" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # State in S3 with locking. Create the bucket once (README), then:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags { tags = { app = var.name, env = var.env } }
}
provider "aws" {
  alias  = "dr"
  region = var.dr_region
  default_tags { tags = { app = var.name, env = var.env } }
}

data "aws_caller_identity" "me" {}
data "aws_availability_zones" "up" { state = "available" }

locals {
  prefix = "${var.name}-${var.env}"
  azs    = slice(data.aws_availability_zones.up.names, 0, 2)
}
