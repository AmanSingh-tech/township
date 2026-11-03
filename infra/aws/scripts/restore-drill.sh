#!/usr/bin/env bash
# Proves the backups work: restores the database as it was N minutes ago to a
# new, temporary instance, runs the integrity checks against it, and deletes
# it. Run monthly and keep the output; the app is not touched.
#   infra/aws/scripts/restore-drill.sh [minutes-ago]     (default 60)
set -euo pipefail
cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-ap-south-1}"
AGO="${1:-60}"
DB=$(terraform output -raw db_instance)
CLUSTER=$(terraform output -raw cluster); APP=$(terraform output -raw app_task_family)
SUBNETS=$(terraform output -raw private_subnets); SG=$(terraform output -raw app_security_group)
DRILL="$DB-drill-$(date +%Y%m%d%H%M)"
WHEN=$(date -u -d "-$AGO minutes" +%Y-%m-%dT%H:%M:%SZ)
desc() { aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$1" --query "DBInstances[0].$2" --output text; }

echo "Restoring $DB as of $WHEN to $DRILL…"
aws rds restore-db-instance-to-point-in-time --region "$REGION" --source-db-instance-identifier "$DB" \
  --target-db-instance-identifier "$DRILL" --restore-time "$WHEN" --no-multi-az --no-publicly-accessible \
  --db-subnet-group-name "$(desc "$DB" DBSubnetGroup.DBSubnetGroupName)" \
  --vpc-security-group-ids "$(desc "$DB" 'VpcSecurityGroups[0].VpcSecurityGroupId')" \
  --db-parameter-group-name "$(desc "$DB" 'DBParameterGroups[0].DBParameterGroupName')" >/dev/null
trap 'echo "Deleting $DRILL…"; aws rds delete-db-instance --region "$REGION" --db-instance-identifier "$DRILL" --skip-final-snapshot --delete-automated-backups >/dev/null' EXIT
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DRILL"
HOST=$(desc "$DRILL" Endpoint.Address)

# The integrity checks, from inside the VPC with the app's image and its own
# login (which, unlike the master password, does not rotate, so it is valid on
# a copy from the past).
OVERRIDES=$(jq -n --arg h "$HOST" '{containerOverrides: [{name: "app", command: ["node", "server/cli.js", "verify"], environment: [{name: "PGHOST", value: $h}]}]}')
TASK=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$APP" --overrides "$OVERRIDES" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
echo "Integrity checks on the restored copy: $([ "$CODE" = 0 ] && echo PASSED || echo "FAILED (exit $CODE)"). Details: log group /ecs/township-prod, prefix app."
[ "$CODE" = 0 ]
