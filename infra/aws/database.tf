# PostgreSQL 16, encrypted, in two zones, with 35 days of point-in-time
# recovery. The master password lives in a secret that RDS creates and
# rotates; only the one-off migrate task uses it. The app connects as its own
# role (township_app), which cannot change the schema or append-only records.
resource "aws_db_subnet_group" "main" {
  name       = local.prefix
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.prefix}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500" # log any query slower than half a second
  }
  parameter {
    name  = "timezone"
    value = "Asia/Kolkata"
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.prefix}-rds-monitoring"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "monitoring.rds.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "main" {
  #checkov:skip=CKV_AWS_161:The app authenticates with its own password-based role; IAM auth is not used.
  identifier                      = local.prefix
  engine                          = "postgres"
  engine_version                  = "16"
  instance_class                  = var.db_instance_class
  allocated_storage               = var.db_storage_gb
  max_allocated_storage           = var.db_storage_gb * 4
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.main.arn
  db_name                         = "township"
  username                        = "township_owner"
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = aws_kms_key.main.key_id
  multi_az                        = var.db_multi_az
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  parameter_group_name            = aws_db_parameter_group.main.name
  backup_retention_period         = var.db_backup_days
  backup_window                   = "20:30-21:30" # 02:00–03:00 IST
  maintenance_window              = "sun:21:30-sun:22:30"
  copy_tags_to_snapshot           = true
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.prefix}-final"
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.main.arn
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
  auto_minor_version_upgrade      = true
  apply_immediately               = false
}

resource "random_password" "app_db" {
  length  = 40
  special = false
}

# The app's database login, created by the migrate task (cli grant-app-role).
resource "aws_secretsmanager_secret" "app_db" {
  #checkov:skip=CKV2_AWS_57:Rotating it means re-running grant-app-role and restarting the app; done by hand (README).
  name                    = "${local.prefix}/db-app"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 7
}
resource "aws_secretsmanager_secret_version" "app_db" {
  secret_id     = aws_secretsmanager_secret.app_db.id
  secret_string = jsonencode({ username = "township_app", password = random_password.app_db.result })
}
