# Complaint and visitor photos. Private, encrypted, reachable only over TLS,
# and only by the app's task role. Not versioned: when a resident's data is
# erased, or a visitor photo passes its retention period, it is really gone.
resource "aws_s3_bucket" "photos" {
  #checkov:skip=CKV_AWS_21:Not versioned on purpose: erased photos must really be gone (DPDP).
  #checkov:skip=CKV_AWS_144:Not replicated on purpose, for the same reason; photos are not part of the books.
  #checkov:skip=CKV_AWS_18:Only the app's role can reach the bucket; who saw a photo is in the app's audit log.
  #checkov:skip=CKV2_AWS_62:Nothing needs to react to uploads.
  bucket = "${local.prefix}-photos-${data.aws_caller_identity.me.account_id}"
}
resource "aws_s3_bucket_public_access_block" "photos" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
    bucket_key_enabled = true
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_s3_bucket_policy" "photos" {
  bucket = aws_s3_bucket.photos.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TlsOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.photos.arn, "${aws_s3_bucket.photos.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_ecr_repository" "app" {
  #checkov:skip=CKV_AWS_136:The image holds code, not residents' data; AES-256 is enough.
  name                 = local.prefix
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# Credentials for SMS, payments, push, Sentry and Claude. Terraform creates
# the secret but never sees the values: put them with scripts/set-secrets.sh.
# Until it is filled, the app refuses to start.
resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV2_AWS_57:Provider API keys (MSG91, Razorpay) cannot be rotated automatically; rotate in their dashboards, then set-secrets.sh.
  name                    = "${local.prefix}/app"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 7
}
locals {
  app_secret_keys = [
    "MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID", "MSG91_ALERT_TEMPLATE_ID",
    "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
    "FILE_URL_SECRET", "VAPID_PRIVATE_KEY", "SENTRY_DSN", "ANTHROPIC_API_KEY",
  ]
}
