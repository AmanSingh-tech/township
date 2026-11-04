# Township: deployment and demo guide

| | |
|---|---|
| Live app | **https://township-91vm.onrender.com/welcome** (Render free plan: the first visit after a quiet spell takes about a minute while the server wakes) |
| Repository | https://github.com/AmanSingh-tech/township |
| Design | `docs/Township-TDD.pdf` (architecture, data model, flows, AI, UI, what was cut) |
| Evaluation | `docs/evaluation.md` (how accurate the complaint AI and the bank matching are) |

The app runs on Render from `render.yaml`, and on any machine with Docker using one command. Both load the sample
township on first start: the brief's three flats plus about 60 more, with residents, bills, payments, complaints,
visitors, bookings and notices. No paid service is used. SMS, online payment and file storage are mocked, as the brief
allows ("Mock payments, messages and outside systems"), and each mock is labelled on screen.

## 1. Five-minute tour of the core build

On the live app or a local run. Each step names the login to use (section 2).

1. **Resident login and bills.** Sign in as Swati (`9822010002`). Home shows ₹13,004 due, 47 days overdue; tap
   **What is in this** for the two unpaid months and the interest. Open **Bills**: tap a month in the chart, then a bill,
   to see 980 sq ft × ₹6.50.
2. **Test payment.** Tap **Pay now**, then **Complete test payment**. A numbered receipt appears under Bills →
   Receipts, with a PDF. (**Decline** shows a failed payment.)
3. **Complaint with AI.** Complaints → **Raise a complaint**: type "Smell of gas near the meter room" and submit. It is
   escalated to the duty manager by the safety rule. Raise a plain one too ("Kitchen tap is dripping") and see the
   category, urgency and assignee the app chose.
4. **Help desk.** Sign in as the help desk (`9000000001`) in a private window. Open the complaint: change its category
   in one tap, see the AI's confidence against the 60% line, then **Start work** and **Mark resolved**. Back as Swati,
   rate the fix or reopen it.
5. **Bank matching (the hard part).** Sign in as accounts (`9000000004`) → Bank matching → **download the sample
   statement** → drop it back in. Confident credits post themselves; the rest wait with their evidence and suggested
   flats. **Post here** on one; it then needs a second person: sign in as admin (`9000000005`) → Approvals → **Approve**.
6. **Committee view.** Sign in as committee (`9000000002`) → Committee report: collections, dues ageing, complaint times
   and the brief's three targets. **Sign off** freezes the month.

## 2. Demo logins

Enter the mobile number and press **Send code**. Because SMS is mocked, the 6-digit code appears on the sign-in screen:
press **Fill it in**, then **Sign in**. The sign-in page also lists these accounts: tap one to sign in. In demo mode one
number can request 15 codes an hour (3 in production).

| Role | Mobile | What to try |
|---|---|---|
| Resident: **Swati Joshi** (tenant, T12-0408) | `9822010002` | The brief's flat that is 47 days overdue. Dues breakdown, bills chart, test payment, her water-leak complaint, a visitor waiting at the gate, guest codes, booking. |
| Resident: **Aamir Shaikh** (owner, T21-1601) | `9822010003` | Paid ₹5,000 of ₹10,660, 18 days overdue (₹5,719 due with interest). Pay the rest and get a receipt. |
| Resident: **Neeraj Kulkarni** (owner, T07-1203) | `9822010001` | Fully paid. His tower 7 lift complaint is linked to three other flats' reports. |
| Help desk: Priya Patil | `9000000001` | Complaints queue: count tiles, category change, assignment, status, linked duplicates. |
| Accounts: Meena Kulkarni | `9000000004` | Bank matching, flats and bills, bill runs, register import, Tally export. |
| Committee: Rajan Gokhale | `9000000002` | Committee report; approve a bill run; sign off a month. |
| Admin | `9000000005` | Approvals (second person), settings, staff, technicians, gate tablets, amenities, notices, messages, data requests, audit log. |
| Guard (gate tablet) | `9000000003`, PIN `2468` | Needs a paired tablet, below. |

**Gate tablet:** sign in as admin → Admin → Gate tablets → register a tablet and note the 8-digit pairing code. Open
`/gate` in another browser or a private window and enter the code, then sign in as the guard with `9000000003` and PIN
`2468`. Log a visitor for T12-0408, then approve it as Swati. Switch the browser offline to see entries saved on the
tablet.

**Two-person checks:** a manual bank post, a ledger adjustment or a change to a resident's login number, requested by one
person, must be approved by another (for example accounts requests, admin approves).

**Theme and language:** light and dark under Profile → Appearance (residents) or at the bottom of the desk sidebar
(staff). English, Marathi and Hindi from the sign-in page or the profile.

All names, numbers and UPI IDs in the sample data are invented. The three sample flats come from the brief.

## 3. Run locally with Docker (recommended)

You only need Docker.

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
- If port 4000 or 5440 is in use, change the left-hand port in `docker-compose.yml`.

## 4. Run for development, tests and evaluation

You need Node 20+ and Docker.

```bash
npm install
docker compose up -d db                                            # PostgreSQL 16 on localhost:5440
docker compose exec db psql -U township -c "create database township_test"
npm run dev:fixtures                                               # sample township
npm run dev                                                        # API :4000, app with hot reload on http://localhost:5173
```

```bash
npm test             # 53 server tests: billing, interest, matching, complaints, roles, security, evaluation floors
npm run eval         # scores complaint triage and bank matching; writes docs/evaluation.md
npm run test:e2e     # 6 browser tests (needs Chrome; set CHROME_PATH if it is not /usr/bin/google-chrome)
npm run load:seed && npm run load:run      # optional: full-size load test, 2,400 flats
```

## 5. How it is deployed

One container runs a Node 20 API that also serves the built React app, next to PostgreSQL 16.

| Part | Where |
|---|---|
| App | Docker image from `Dockerfile`: non-root user; it refuses to start without its required settings |
| Database | PostgreSQL 16. Migrations run on start. |
| Photos | The server's disk. Links are signed and expire after 15 minutes. |
| SMS, payments | Mocked: the login code is shown on the sign-in screen; payments go through a test gateway in which no money moves |

**On Render (the live app).** `render.yaml` is a Blueprint: one web service built from the `Dockerfile` and one
PostgreSQL 16 database, both on the free plan in Singapore, the nearest region to Pune.

1. render.com → **New → Blueprint** → connect this repository → **Apply**.
2. Render creates the database, builds the image and starts the app; the sample township loads.
3. Every push to `main` redeploys. The database keeps its data across deploys.

The Blueprint sets `PORT`, `DATABASE_URL` (from the database), `FILE_URL_SECRET` (generated by Render), `DEMO_DATA`,
`TRUST_PROXY`, `STORAGE` and `STORAGE_DIR`.

**Optional, not applied:** a production setup on AWS Mumbai in Terraform (`infra/aws/`, with its own runbook), about
US$250–300 a month. CI (`.github/workflows/ci.yml`) runs the tests, builds the image and checks the Terraform on every
push.

## 6. Environment variables (names only)

Required in production: `DATABASE_URL` (or `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) and
`FILE_URL_SECRET`. Everything else is optional; without it a labelled placeholder is used, or the feature is off.

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

`.env.example` lists them all with comments. No secret is stored in the repository and `.env` is git-ignored. The only
value committed in `docker-compose.yml` is a local-only `FILE_URL_SECRET` default; replace it for anything beyond a
local run.

## 7. If something goes wrong

| What you see | What to do |
|---|---|
| The live app takes a minute, or shows 502, on the first visit | The free server was asleep. Wait 30–60 seconds and refresh. |
| An old logo or page after a deploy | Refresh once; the logo has a versioned address and the service worker drops old copies. |
| No demo list on the sign-in page | `DEMO_DATA` is not `true`, or the database was not empty on first start. Run `docker compose down -v` and start again. |
| "Too many codes" when signing in | Each number can request 15 codes an hour in demo mode; use another demo login or wait. |
| The gate asks for a pairing code | Pair the tablet first, as in section 2. |

## 8. Limits of the demo

- The live app is on Render's free plan: it sleeps after 15 idle minutes, photos uploaded there are lost when it
  restarts, and the free database expires after 30 days.
- Payments, SMS and WhatsApp are not real. Payments and SMS follow the real providers' steps behind a labelled
  placeholder; WhatsApp is not built.
- Without an `ANTHROPIC_API_KEY` the complaint AI is the built-in keyword model (81% category accuracy in
  `docs/evaluation.md`); anything it is unsure of is flagged for the help desk.
