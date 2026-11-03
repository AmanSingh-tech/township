#!/usr/bin/env bash
# Puts the app's credentials into Secrets Manager without them touching
# Terraform state, shell history or the process list. Prompts for each value;
# press Enter to keep what is already stored.
#   infra/aws/scripts/set-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-ap-south-1}"
SECRET=$(terraform output -raw app_secret)
current=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET" --query SecretString --output text 2>/dev/null || echo '{}')
json="$current"
for key in MSG91_AUTH_KEY MSG91_OTP_TEMPLATE_ID MSG91_ALERT_TEMPLATE_ID RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET \
           FILE_URL_SECRET VAPID_PRIVATE_KEY SENTRY_DSN ANTHROPIC_API_KEY; do
  has=$(jq -r --arg k "$key" 'if (.[$k] // "") != "" then "set" else "empty" end' <<<"$json")
  if [ "$key" = FILE_URL_SECRET ] && [ "$has" = empty ]; then
    json=$(jq --arg k "$key" --arg v "$(openssl rand -hex 32)" '.[$k] = $v' <<<"$json"); echo "$key: generated"; continue
  fi
  read -rsp "$key ($has): " value; echo
  [ -n "$value" ] && json=$(jq --arg k "$key" --arg v "$value" '.[$k] = $v' <<<"$json")
done
# Every key must exist, even empty, or ECS cannot start the task; the app then
# says itself which required values are missing.
json=$(jq '([$ARGS.positional[] | {(.): ""}] | add) + .' --args MSG91_AUTH_KEY MSG91_OTP_TEMPLATE_ID MSG91_ALERT_TEMPLATE_ID \
  RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET FILE_URL_SECRET VAPID_PRIVATE_KEY SENTRY_DSN ANTHROPIC_API_KEY <<<"$json")
aws secretsmanager put-secret-value --region "$REGION" --secret-id "$SECRET" --secret-string "$json" >/dev/null
echo "Saved. Deploy (or restart the service) for the app to pick them up."
