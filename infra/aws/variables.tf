variable "name" {
  type    = string
  default = "township"
}
variable "env" {
  type    = string
  default = "prod"
}
variable "region" {
  type    = string
  default = "ap-south-1"
}
variable "dr_region" {
  description = "Where backup copies go. Hyderabad keeps them in India."
  type        = string
  default     = "ap-south-2"
}

variable "domain_name" {
  description = "The app's address, e.g. app.your-society.in"
  type        = string
}
variable "hosted_zone_id" {
  description = "Route 53 zone for the domain. Leave empty if DNS is at another registrar; the outputs then list the records to add there."
  type        = string
  default     = ""
}
variable "alarm_email" {
  description = "Who is emailed when an alarm fires"
  type        = string
}

variable "image_tag" {
  description = "Image tag for the first deploy. Later deploys go through scripts/deploy.sh."
  type        = string
}
variable "cpu_architecture" {
  description = "X86_64, or ARM64 if the image is built for arm64"
  type        = string
  default     = "X86_64"
}
variable "task_cpu" {
  type    = number
  default = 512
}
variable "task_memory" {
  type    = number
  default = 1024
}
variable "min_tasks" {
  description = "Never fewer than two, so one zone or one deploy can fail without downtime"
  type        = number
  default     = 2
}
variable "max_tasks" {
  type    = number
  default = 6
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}
variable "db_storage_gb" {
  type    = number
  default = 50
}
variable "db_multi_az" {
  type    = bool
  default = true
}
variable "db_backup_days" {
  description = "Point-in-time recovery window (RDS allows up to 35 days)"
  type        = number
  default     = 35
}
variable "archive_retention_days" {
  description = "How long monthly database snapshots are kept. Set from the society's record-keeping rules; ten years by default."
  type        = number
  default     = 3650
}

variable "app_env" {
  description = "Non-secret settings for the app, e.g. SMS_PROVIDER, VAPID_PUBLIC_KEY, VAPID_SUBJECT"
  type        = map(string)
  default     = {}
}

variable "waf_rate_limit" {
  description = "Requests per 5 minutes from one address before it is blocked. A society's office or gate may share one address, so keep this generous."
  type        = number
  default     = 3000
}

variable "github_repo" {
  description = "owner/repo allowed to deploy from GitHub Actions (main branch only). Empty: no deploy role."
  type        = string
  default     = ""
}
