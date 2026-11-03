# Alarms by email, long-term backups with a copy in Hyderabad, and the
# GitHub deploy role.

resource "aws_sns_topic" "alarms" {
  name              = "${local.prefix}-alarms"
  kms_master_key_id = aws_kms_key.main.arn
}
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  lb  = { LoadBalancer = aws_lb.app.arn_suffix }
  tg  = { LoadBalancer = aws_lb.app.arn_suffix, TargetGroup = aws_lb_target_group.app.arn_suffix }
  db  = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  svc = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.app.name }
  alarms = {
    "server-errors"   = { ns = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", dims = local.lb, op = "GreaterThanThreshold", threshold = 10, periods = 1, desc = "More than 10 server errors in 5 minutes" }
    "slow-responses"  = { ns = "AWS/ApplicationELB", metric = "TargetResponseTime", stat = "p95", dims = local.lb, op = "GreaterThanThreshold", threshold = 1, periods = 3, desc = "95% of responses slower than 1 s for 15 minutes" }
    "unhealthy-tasks" = { ns = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", dims = local.tg, op = "GreaterThanThreshold", threshold = 0, periods = 2, desc = "An app task is failing its health check" }
    "tasks-down"      = { ns = "ECS/ContainerInsights", metric = "RunningTaskCount", stat = "Minimum", dims = local.svc, op = "LessThanThreshold", threshold = var.min_tasks, periods = 2, desc = "Fewer app tasks running than the minimum" }
    "db-cpu"          = { ns = "AWS/RDS", metric = "CPUUtilization", stat = "Average", dims = local.db, op = "GreaterThanThreshold", threshold = 80, periods = 3, desc = "Database CPU above 80% for 15 minutes" }
    "db-storage"      = { ns = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", dims = local.db, op = "LessThanThreshold", threshold = 5368709120, periods = 1, desc = "Less than 5 GB of database storage left" }
    "db-memory"       = { ns = "AWS/RDS", metric = "FreeableMemory", stat = "Minimum", dims = local.db, op = "LessThanThreshold", threshold = 134217728, periods = 3, desc = "Database below 128 MB free memory" }
    "db-connections"  = { ns = "AWS/RDS", metric = "DatabaseConnections", stat = "Maximum", dims = local.db, op = "GreaterThanThreshold", threshold = 150, periods = 2, desc = "Unusually many database connections" }
  }
}
resource "aws_cloudwatch_metric_alarm" "a" {
  for_each            = local.alarms
  alarm_name          = "${local.prefix}-${each.key}"
  alarm_description   = each.value.desc
  namespace           = each.value.ns
  metric_name         = each.value.metric
  statistic           = contains(["Sum", "Average", "Minimum", "Maximum"], each.value.stat) ? each.value.stat : null
  extended_statistic  = contains(["Sum", "Average", "Minimum", "Maximum"], each.value.stat) ? null : each.value.stat
  dimensions          = each.value.dims
  comparison_operator = each.value.op
  threshold           = each.value.threshold
  period              = 300
  evaluation_periods  = each.value.periods
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# The app logs "Refusing to start" when configuration or migrations are missing.
resource "aws_cloudwatch_log_metric_filter" "refused" {
  name           = "${local.prefix}-refused-start"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "\"Refusing to start\""
  metric_transformation {
    name      = "RefusedStart"
    namespace = "Township"
    value     = "1"
  }
}
resource "aws_cloudwatch_metric_alarm" "refused" {
  alarm_name          = "${local.prefix}-refused-start"
  alarm_description   = "The app refused to start: missing secrets or migrations. See the log group."
  namespace           = "Township"
  metric_name         = "RefusedStart"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

# ---- Backups -------------------------------------------------------------------------
# RDS keeps 35 days of point-in-time recovery. On top: a monthly snapshot kept
# for the archive period, copied to Hyderabad, plus daily copies there for 35
# days, so a lost region still leaves recent books.
resource "aws_backup_vault" "main" {
  name        = local.prefix
  kms_key_arn = aws_kms_key.main.arn
}
resource "aws_backup_vault" "dr" {
  provider    = aws.dr
  name        = "${local.prefix}-dr"
  kms_key_arn = aws_kms_key.dr.arn
}
resource "aws_backup_plan" "db" {
  name = "${local.prefix}-db"
  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(30 22 * * ? *)" # 04:00 IST
    lifecycle { delete_after = 35 }
    copy_action {
      destination_vault_arn = aws_backup_vault.dr.arn
      lifecycle { delete_after = 35 }
    }
  }
  rule {
    rule_name         = "monthly"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 23 1 * ? *)" # 1st of the month, 04:30 IST
    lifecycle { delete_after = var.archive_retention_days }
    copy_action {
      destination_vault_arn = aws_backup_vault.dr.arn
      lifecycle { delete_after = var.archive_retention_days }
    }
  }
}
resource "aws_iam_role" "backup" {
  name = "${local.prefix}-backup"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "backup.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}
resource "aws_backup_selection" "db" {
  name         = "${local.prefix}-db"
  plan_id      = aws_backup_plan.db.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = [aws_db_instance.main.arn]
}

# ---- Deploys from GitHub Actions (main branch only) -------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  count           = var.github_repo == "" ? 0 : 1
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
resource "aws_iam_role" "deploy" {
  count = var.github_repo == "" ? 0 : 1
  name  = "${local.prefix}-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github[0].arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
}
resource "aws_iam_role_policy" "deploy" {
  count = var.github_repo == "" ? 0 : 1
  role  = aws_iam_role.deploy[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # These actions cannot be limited to a resource.
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken", "ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ec2:DescribeSubnets", "ec2:DescribeSecurityGroups"], Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:DescribeImages"]
        Resource = aws_ecr_repository.app.arn
      },
      {
        Effect    = "Allow"
        Action    = ["ecs:RunTask"]
        Resource  = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.me.account_id}:task-definition/${local.prefix}-migrate:*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks"]
        Resource = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.me.account_id}:task/${aws_ecs_cluster.main.name}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = aws_ecs_service.app.id
      },
      {
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}
