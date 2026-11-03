# Township on AWS (Mumbai)

> **Optional and paid** (roughly US$250–300 a month). The app runs free without any of this: see "Runs free" in the
> main README.

Terraform for production in `ap-south-1`, with backup copies in Hyderabad (`ap-south-2`). All residents' data
stays in India.

```
Internet ── HTTPS ── Load balancer (TLS 1.2+, AWS WAF) ── App: ECS Fargate, 2–6 tasks, two zones
                                                            │
                                     RDS PostgreSQL 16, Multi-AZ ── AWS Backup, copied to Hyderabad
                                     S3 bucket for photos (private, KMS-encrypted)
```

## What it sets up

**Network**
- A VPC with public and private subnets in two zones.
- The app and the database have no public address.
- One NAT gateway per zone, so losing a zone doesn't cut the other off.
- VPC flow logs.

**App**
- ECS Fargate tasks, at least two, scaling to six on CPU.
- Deploys replace tasks one at a time and roll back automatically if the new version is unhealthy.
- The container runs as a non-root user on a read-only filesystem.

**Database**
- PostgreSQL 16, Multi-AZ, with TLS enforced and 35 days of point-in-time recovery.
- Deletion protection is on.
- Queries slower than 500 ms are logged.

**Two database roles**

| Role | Used by | Can do |
|---|---|---|
| `township_owner` | Migrations only | Owns the schema. Its password is created and rotated by RDS. |
| `township_app` | The running app | Read and write data. Cannot change tables, switch off the append-only triggers, or update or delete rows in the ledger, payments, audit log or signed reports. |

**Encryption**
- One customer-managed KMS key, rotated yearly, for the database and its backups, photos, secrets and logs.
- Backup copies in Hyderabad use a key that lives there.

**Edge**
- An ACM certificate.
- HTTP redirects to HTTPS.
- **AWS WAF:**
  - The common rule set and known-bad inputs rules. The common set's 8 KB body limit only counts, so photo uploads and bank statements still get through.
  - A per-address rate limit.
  - Logging of blocked requests, with the session token removed.

**Backups** (AWS Backup)
- Daily, kept 35 days.
- Monthly, kept for `archive_retention_days` (ten years by default; set it from your record-keeping rules).
- Both are copied to Hyderabad.

**Alarms**, emailed to `alarm_email`:
- server errors
- slow responses
- unhealthy or missing tasks
- database CPU, memory, storage and connections
- the app refusing to start

**Deploys from GitHub Actions:** optional. They use a role limited to this repository's `main` branch.

Checked with `terraform validate` and Checkov: 223 checks pass. 23 are skipped on purpose, each with its reason in the code. For
example, the photos bucket is not versioned or replicated, so an erased photo is really gone.

**Not yet run against a real AWS account.** The first `terraform apply` is where any account-specific problems
will show.

## First deploy

You need: an AWS account, the AWS CLI signed in as an administrator, Terraform 1.6+, Docker, `jq`, and the domain.

1. **State bucket, once:**
   ```bash
   cd infra/aws
   scripts/bootstrap-state.sh
   terraform init -backend-config=backend.hcl
   ```
2. **Variables:** `cp example.tfvars prod.tfvars` and fill it in.
   - Put the VAPID public key from `npm run cli -- vapid-keys` in `app_env`. The private key goes in the secret in step 5.
3. **Image tag:** the first apply needs an image tag, but the repository doesn't exist yet. Create it, then push the image:
   ```bash
   terraform apply -var-file=prod.tfvars -target=aws_ecr_repository.app
   REPO=$(terraform output -raw ecr_repository)
   aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
   docker build --platform linux/amd64 -t "$REPO:first" ../.. && docker push "$REPO:first"
   ```
4. **Everything else:** `terraform apply -var-file=prod.tfvars`.
   - **DNS outside Route 53:** add the `certificate_validation_records` output at your registrar while the apply waits, then point the domain at `load_balancer_dns` with a CNAME.
   - **Confirm the alarm email** AWS sends.
5. **Credentials:** run `scripts/set-secrets.sh`.
   - It prompts for MSG91, Razorpay, the VAPID private key, and optionally Sentry and Claude.
   - It generates `FILE_URL_SECRET` itself.
   - Values never pass through Terraform or your shell history.
6. **Migrate and start:**
   ```bash
   scripts/deploy.sh first
   ```
   This runs the migrate task, which:
   - applies the schema as the owner,
   - creates `township_app`,
   - runs the integrity checks.

   Then the app starts. Any provider left empty runs as its free placeholder, listed in the log under
   `Running with placeholders`. A missing database setting or migration logs `Refusing to start`, and the
   `refused-start` alarm fires.
7. **First administrator:** `scripts/create-admin.sh "Full Name" 98XXXXXXXX`, then sign in with the SMS code and set the society up
   (see "Going live" in the main README).

## Day to day

| What | How |
|---|---|
| Deploy | Push to `main`, with CI deploying once `AWS_DEPLOY_ROLE_ARN` is set as a repository variable (the `deploy_role_arn` output). Or run `scripts/deploy.sh` locally. Migrations always run first. A failed migration leaves the running app untouched. |
| Change a credential | `scripts/set-secrets.sh`, then deploy (or force a new deployment) so tasks pick it up |
| Logs | CloudWatch `/ecs/township-prod`: `app/…` for the app, `migrate/…` for migrations |
| Restore drill (monthly) | `scripts/restore-drill.sh [minutes-ago]` restores to a temporary instance, runs `cli verify` on it (books balance, receipts gapless, append-only triggers on, signed reports match their fingerprints), then deletes it. Keep the output. |
| Rotate the app's DB password | Change the `db-app` secret's password (or `terraform apply -replace=random_password.app_db`), then deploy. The migrate task sets the new password before the app tasks restart. |
| Real restore | RDS console → point-in-time restore to a new instance, check it with the drill's verify task, then set `PGHOST` on the app task definition to the new endpoint and deploy |

## Capacity and cost

From the full-size load test (`load/`), one app process handled:
- 40 requests a second, five times the expected bill-day peak, with 95% of responses under 30 ms;
- about 270–300 requests a second at its ceiling.

The minimum of two tasks therefore has a wide margin. The database class (`db.t4g.small`) is the first thing to raise if `db-cpu` alarms.

**Cost:** roughly US$250–300 a month at the defaults. Check it with the AWS pricing calculator; I have not priced it against a live account. The big items:
- the Multi-AZ database
- two NAT gateways
- two app tasks
- the load balancer
- WAF

Single-zone database and NAT would save about a third, but an outage in one zone would then take the app down.
