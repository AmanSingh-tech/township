# The app on ECS Fargate: at least two tasks in different zones, scaled on
# CPU, replaced one at a time on deploy and rolled back if the new version
# fails its health check.
resource "aws_ecs_cluster" "main" {
  name = local.prefix
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  #checkov:skip=CKV_AWS_338:90 days on purpose (data minimisation); the lasting record is the audit log in the database.
  name              = "/ecs/${local.prefix}"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.main.arn
}

locals {
  image = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
  base_env = merge({
    NODE_ENV         = "production"
    PORT             = "4000"
    PUBLIC_URL       = "https://${var.domain_name}"
    TRUST_PROXY      = "true"
    DATABASE_SSL     = "true"
    PGHOST           = aws_db_instance.main.address
    PGPORT           = tostring(aws_db_instance.main.port)
    PGDATABASE       = aws_db_instance.main.db_name
    DB_POOL_MAX      = "10"
    MIGRATE_ON_START = "false"
    STORAGE          = "s3"
    S3_BUCKET        = aws_s3_bucket.photos.bucket
    AWS_REGION       = var.region
    SMS_PROVIDER     = "msg91"
  }, var.app_env)
  app_secrets = [for k in local.app_secret_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }]
  log_config = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.app.name
      awslogs-region        = var.region
      awslogs-stream-prefix = "app"
    }
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  container_definitions = jsonencode([{
    name                   = "app"
    image                  = local.image
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = 4000, protocol = "tcp" }]
    environment            = [for k, v in local.base_env : { name = k, value = v }]
    secrets = concat(local.app_secrets, [
      { name = "PGUSER", valueFrom = "${aws_secretsmanager_secret.app_db.arn}:username::" },
      { name = "PGPASSWORD", valueFrom = "${aws_secretsmanager_secret.app_db.arn}:password::" },
    ])
    logConfiguration = local.log_config
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:4000/api/health || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    stopTimeout = 30
  }])
}

# One-off task for each deploy: applies migrations as the schema owner, then
# (re)grants the app's role. scripts/deploy.sh runs it before the service update.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  container_definitions = jsonencode([{
    name        = "migrate"
    image       = local.image
    essential   = true
    command     = ["sh", "-c", "node server/cli.js migrate && node server/cli.js grant-app-role && node server/cli.js verify"]
    environment = [for k, v in merge(local.base_env, { MIGRATE_ON_START = "true", APP_DB_USER = "township_app" }) : { name = k, value = v }]
    secrets = [
      { name = "PGUSER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
      { name = "APP_DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app_db.arn}:password::" },
    ]
    logConfiguration = merge(local.log_config, { options = merge(local.log_config.options, { awslogs-stream-prefix = "migrate" }) })
  }])
}

resource "aws_ecs_service" "app" {
  name                               = "app"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.app.arn
  desired_count                      = var.min_tasks
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 30
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 4000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  # Autoscaling owns the count; scripts/deploy.sh owns which revision runs.
  lifecycle { ignore_changes = [desired_count, task_definition] }
  depends_on = [aws_lb_listener.https]
}

resource "aws_appautoscaling_target" "app" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_tasks
  max_capacity       = var.max_tasks
}
resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.prefix}-cpu"
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}

# ---- IAM ---------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Pulls the image, reads the secrets it injects, writes logs.
resource "aws_iam_role" "execution" {
  name               = "${local.prefix}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.app.arn, aws_secretsmanager_secret.app_db.arn, aws_db_instance.main.master_user_secret[0].secret_arn]
      }, {
      Effect   = "Allow"
      Action   = ["kms:Decrypt"]
      Resource = aws_kms_key.main.arn
    }]
  })
}

# What the running app may do: photos in its bucket, nothing else.
resource "aws_iam_role" "task" {
  name               = "${local.prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
resource "aws_iam_role_policy" "task_photos" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = "${aws_s3_bucket.photos.arn}/*"
      }, {
      Effect   = "Allow"
      Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
      Resource = aws_kms_key.main.arn
    }]
  })
}
