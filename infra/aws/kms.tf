# One customer-managed key for residents' data at rest: the database, its
# backups, photos, secrets and logs. Rotated yearly. Disabling it makes all of
# that unreadable, which is also how access can be cut off in an emergency.
data "aws_iam_policy_document" "kms" {
  #checkov:skip=CKV_AWS_109:In a key policy, "*" means this key; the account root statement is AWS's standard first statement.
  #checkov:skip=CKV_AWS_111:As above.
  #checkov:skip=CKV_AWS_356:As above.
  statement {
    sid       = "Account"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.me.account_id}:root"]
    }
  }
  statement {
    sid       = "Logs"
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.me.account_id}:log-group:*"]
    }
  }
  statement {
    sid       = "AlarmsToEncryptedTopic"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "main" {
  description             = "${local.prefix} data at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms.json
}
resource "aws_kms_alias" "main" {
  name          = "alias/${local.prefix}"
  target_key_id = aws_kms_key.main.key_id
}

# Backup copies in Hyderabad are encrypted with a key that lives there.
data "aws_iam_policy_document" "kms_dr" {
  #checkov:skip=CKV_AWS_109:In a key policy, "*" means this key.
  #checkov:skip=CKV_AWS_111:As above.
  #checkov:skip=CKV_AWS_356:As above.
  statement {
    sid       = "Account"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.me.account_id}:root"]
    }
  }
}
resource "aws_kms_key" "dr" {
  provider                = aws.dr
  description             = "${local.prefix} backup copies"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_dr.json
}
resource "aws_kms_alias" "dr" {
  provider      = aws.dr
  name          = "alias/${local.prefix}-dr"
  target_key_id = aws_kms_key.dr.key_id
}
