# Copy to prod.tfvars and fill in: terraform apply -var-file=prod.tfvars
domain_name    = "app.your-society.in"
hosted_zone_id = "" # Route 53 zone id, or empty if DNS is elsewhere
alarm_email    = "office@your-society.in"
image_tag      = "first" # set by the first build; later deploys use scripts/deploy.sh
github_repo    = ""      # e.g. "your-org/township" to allow deploys from GitHub Actions

app_env = {
  VAPID_PUBLIC_KEY = "" # npm run cli -- vapid-keys (the private key goes in the secret)
  VAPID_SUBJECT    = "mailto:office@your-society.in"
}
