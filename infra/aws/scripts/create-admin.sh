#!/usr/bin/env bash
# Creates (or restores) an administrator, who then signs in with an SMS code.
#   infra/aws/scripts/create-admin.sh "Full Name" 98XXXXXXXX
set -euo pipefail
[ $# -eq 2 ] || { echo 'Usage: create-admin.sh "Full Name" 98XXXXXXXX' >&2; exit 1; }
REGION="${AWS_REGION:-ap-south-1}"
PREFIX="${PREFIX:-township-prod}"
SUBNETS=$(aws ec2 describe-subnets --region "$REGION" --filters "Name=tag:Name,Values=$PREFIX-private-*" --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
SG=$(aws ec2 describe-security-groups --region "$REGION" --filters "Name=group-name,Values=$PREFIX-app" --query 'SecurityGroups[0].GroupId' --output text)
OVERRIDES=$(jq -n --arg n "$1" --arg p "$2" '{containerOverrides: [{name: "migrate", command: ["node", "server/cli.js", "create-admin", "--name", $n, "--phone", $p]}]}')
TASK=$(aws ecs run-task --region "$REGION" --cluster "$PREFIX" --launch-type FARGATE --task-definition "$PREFIX-migrate" --overrides "$OVERRIDES" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --region "$REGION" --cluster "$PREFIX" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --region "$REGION" --cluster "$PREFIX" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$CODE" != 0 ]; then echo "Failed (exit $CODE). Logs: /ecs/$PREFIX, prefix migrate." >&2; exit 1; fi
echo "Done: $1 can sign in with $2."

