# Township: deployment

Repository: https://github.com/AmanSingh-tech/township

The app is not deployed to a public host. It runs on any machine with Docker, using one command, with sample data
loaded on first start. The project uses no paid services. SMS, online payment and file storage are mocked, as the brief
allows ("Mock payments, messages and outside systems"). Each mock is labelled on screen where people see it.

## 1. Run locally with Docker (recommended)

You only need Docker with Compose v2.

```bash
git clone https://github.com/AmanSingh-tech/township.git
cd township
docker compose up --build        # or: docker-compose up --build
```

Open **http://localhost:4000**. The first start takes a minute or two: it builds the app, creates the database,
applies the migrations and loads the sample township. The log ends with
`Township API on http://localhost:4000 (production)`.

- Stop with Ctrl+C, or `docker compose down`. Data is kept in a Docker volume.
- Start again from a clean sample township with `docker compose down -v && docker compose up --build`.
- If port 4000 or 5440 is already in use, stop whatever holds it, or change the left-hand port in `docker-compose.yml`.

## 2. Run for development (Node)

You need Node 20+ and Docker.

```bash
npm install
docker compose up -d db                                            # PostgreSQL 16 on localhost:5440
docker compose exec db psql -U township -c "create database township_test"
npm run dev:fixtures                                               # sample township
npm run dev                                                        # API :4000, app with hot reload on http://localhost:5173
```

Tests:

```bash
npm test             # 51 server tests: billing, interest, matching, complaints, roles, security
npm run test:e2e     # 6 browser tests (needs Chrome; set CHROME_PATH if it is not /usr/bin/google-chrome)
npm run load:seed && npm run load:run      # optional: full-size load test, 2,400 flats
```

## 3. How it is deployed

There is one container: a Node 20 API, which also serves the built React web app. It runs alongside PostgreSQL 16.

| Service | Where |
|---|---|
| App | Docker image built from `Dockerfile`: a non-root user, and it refuses to start without its required settings |
| Database | PostgreSQL 16 (the `db` service in `docker-compose.yml`). Migrations run on start. |
| Photos | The server's disk (the `township-uploads` volume). Links are signed and expire after 15 minutes. |
| SMS, payments | Mocked: the login code is shown on the sign-in screen, and payments go through a test gateway in which no money moves |

A production setup on AWS Mumbai is written in Terraform in `infra/aws/`, with its own runbook. It is optional and costs
money, so it is not applied. CI (`.github/workflows/ci.yml`) runs the tests, builds the image and checks the Terraform on
every push.

### Environment variables (names only)

Required in production:

- `DATABASE_URL`, or the separate `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`
- `FILE_URL_SECRET`

Optional. Without them a labelled placeholder is used, or the feature is off:

| Area | Variables |
|---|---|
| App | `NODE_ENV`, `PORT`, `PUBLIC_URL`, `TRUST_PROXY`, `DEMO_DATA`, `MIGRATE_ON_START` |
| Database TLS | `DATABASE_SSL`, `DATABASE_SSL_CA`, `DB_POOL_MAX` |
| SMS (MSG91) | `SMS_PROVIDER`, `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_ALERT_TEMPLATE_ID` |
| Online payment (Razorpay) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Photo storage | `STORAGE`, `STORAGE_DIR`, `S3_BUCKET`, `AWS_REGION` |
| Push alerts | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Complaint AI (Claude) | `ANTHROPIC_API_KEY`, `CLASSIFIER` |
| Error reports (Sentry) | `SENTRY_DSN` |

`.env.example` lists them all with comments. No secret is stored in the repository. `.env` is git-ignored. The only value
committed in `docker-compose.yml` is a local-only `FILE_URL_SECRET` default, which you should replace for anything
beyond a local run.

## 4. Demo logins for the reviewer

To sign in, enter the mobile number and press **Send code**. Because SMS is mocked, the 6-digit code appears on the sign-in
screen: press **Fill it in**, then **Verify**. In demo mode one number can request 15 codes an hour (3 in production).

| Role | Mobile | What to try |
|---|---|---|
| Resident: **Swati Joshi** (tenant, T12-0408) | `9822010002` | The brief's flat that is 47 days overdue. Home, Bills, Pay now (test gateway), her open water-leak complaint. |
| Resident: **Aamir Shaikh** (owner, T21-1601) | `9822010003` | Paid ₹5,000 of ₹10,660, 18 days overdue. Pay the rest, get a receipt (and its PDF), raise a complaint. |
| Resident: **Neeraj Kulkarni** (owner, T07-1203) | `9822010001` | Fully paid. His complaint about the tower 7 lift is linked to three other flats' reports. |
| Help desk | `9000000001` | The complaints queue: change a category in one tap, assign, update status. |
| Accounts | `9000000004` | Bank matching: use **download the sample statement**, drop it back in, and review the queue. |
| Committee | `9000000002` | The committee report: collections, dues ageing, complaint times. Sign off a month. |
| Admin | `9000000005` | Settings, staff, gate tablets, amenities, audit log. |
| Guard (gate tablet) | `9000000003`, PIN `2468` | See below |

**Two-person checks:** a manual bank posting or ledger adjustment requested by accounts must be approved by a different
person, for example by the admin.

**Gate tablet:**
1. Sign in as admin and go to Admin → Gate tablets → register a tablet. Note the 8-digit pairing code.
2. Open http://localhost:4000/gate in another browser or a private window, and enter the code.
3. Sign in as the guard with `9000000003` and PIN `2468`.
4. Log a visitor for T12-0408, then approve it as Swati.

**Theme:** light and dark are under Profile → Appearance for residents, and at the bottom of the desk sidebar for
staff.

All names, numbers and UPI IDs in the sample data are invented. The three sample flats come from the brief.
