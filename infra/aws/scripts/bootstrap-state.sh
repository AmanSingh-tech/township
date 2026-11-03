#!/usr/bin/env bash
# One-time: the S3 bucket that holds Terraform state, and backend.hcl.
#   infra/aws/scripts/bootstrap-state.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="township-tfstate-$ACCOUNT"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION"
fi
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
cat > backend.hcl <<HCL
bucket       = "$BUCKET"
key          = "township/prod.tfstate"
region       = "$REGION"
encrypt      = true
use_lockfile = true
HCL
echo "State bucket $BUCKET ready. Next: terraform init -backend-config=backend.hcl"
