#!/usr/bin/env bash
# Builds the image, pushes it, applies migrations as the schema owner, then
# rolls the app over to it. ECS replaces tasks one at a time and rolls back
# by itself if the new ones fail their health check.
# Needs only AWS credentials (no Terraform state): everything is found by the
# names Terraform gives it. Used by hand and by .github/workflows/ci.yml.
#   infra/aws/scripts/deploy.sh [tag]        (default: current git commit)
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:-$(git rev-parse --short=12 HEAD)}"
REGION="${AWS_REGION:-ap-south-1}"
PREFIX="${PREFIX:-township-prod}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$PREFIX"
CLUSTER="$PREFIX"; SERVICE=app; APP="$PREFIX"; MIGRATE="$PREFIX-migrate"
SUBNETS=$(aws ec2 describe-subnets --region "$REGION" --filters "Name=tag:Name,Values=$PREFIX-private-*" --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
SG=$(aws ec2 describe-security-groups --region "$REGION" --filters "Name=group-name,Values=$PREFIX-app" --query 'SecurityGroups[0].GroupId' --output text)

if [ -n "$(git status --porcelain)" ] && [ -z "${ALLOW_DIRTY:-}" ]; then
  echo "Uncommitted changes; commit first (or ALLOW_DIRTY=1)." >&2; exit 1
fi
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${REPO%%/*}"
if ! aws ecr describe-images --region "$REGION" --repository-name "${REPO#*/}" --image-ids imageTag="$TAG" >/dev/null 2>&1; then
  docker build --platform "${PLATFORM:-linux/amd64}" -t "$REPO:$TAG" ../..
  docker push "$REPO:$TAG"
fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
# New revision of a task family: the latest one with only the image changed.
revise() {
  aws ecs describe-task-definition --region "$REGION" --task-definition "$1" --query taskDefinition --output json \
    | jq --arg img "$REPO:$TAG" '.containerDefinitions[0].image = $img
        | {family, taskRoleArn, executionRoleArn, networkMode, containerDefinitions, requiresCompatibilities, cpu, memory, runtimePlatform}' \
    > "$TMP/taskdef.json"
  aws ecs register-task-definition --region "$REGION" --cli-input-json "file://$TMP/taskdef.json" --query taskDefinition.taskDefinitionArn --output text
}
MIGRATE_ARN=$(revise "$MIGRATE")
APP_ARN=$(revise "$APP")

echo "Migrating with $TAG…"
TASK=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$MIGRATE_ARN" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$CODE" != "0" ]; then
  echo "Migration failed (exit $CODE). The running app is unchanged. Logs: /ecs/$PREFIX, stream prefix migrate." >&2; exit 1
fi

echo "Rolling out $TAG…"
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$APP_ARN" >/dev/null
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE"
RUNNING=$(aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].taskDefinition' --output text)
if [ "$RUNNING" != "$APP_ARN" ]; then
  echo "The new version failed its health checks and ECS rolled back to $RUNNING." >&2; exit 1
fi
echo "Deployed $TAG."
