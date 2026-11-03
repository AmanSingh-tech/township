output "app_url" {
  value = "https://${var.domain_name}"
}
output "load_balancer_dns" {
  description = "Without Route 53: point the domain here with a CNAME"
  value       = aws_lb.app.dns_name
}
output "certificate_validation_records" {
  description = "Without Route 53: add these at the registrar so the certificate can be issued"
  value = var.hosted_zone_id != "" ? [] : [for o in aws_acm_certificate.app.domain_validation_options : {
    name = o.resource_record_name, type = o.resource_record_type, value = o.resource_record_value
  }]
}
output "ecr_repository" {
  value = aws_ecr_repository.app.repository_url
}
output "cluster" {
  value = aws_ecs_cluster.main.name
}
output "service" {
  value = aws_ecs_service.app.name
}
output "app_task_family" {
  value = aws_ecs_task_definition.app.family
}
output "migrate_task_family" {
  value = aws_ecs_task_definition.migrate.family
}
output "private_subnets" {
  value = join(",", aws_subnet.private[*].id)
}
output "app_security_group" {
  value = aws_security_group.app.id
}
output "app_secret" {
  description = "Fill with scripts/set-secrets.sh"
  value       = aws_secretsmanager_secret.app.name
}
output "db_instance" {
  value = aws_db_instance.main.identifier
}
output "deploy_role_arn" {
  value = var.github_repo == "" ? null : aws_iam_role.deploy[0].arn
}
