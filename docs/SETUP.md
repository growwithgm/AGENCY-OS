# Setup

From an empty Supabase project to a working sign-in, in order.

---

## 1. Create the database

Supabase dashboard → **SQL Editor** → New query → paste the whole of
[`supabase/schema.sql`](../supabase/schema.sql) → **Run**.

That one file is everything: tables, functions, row level security, the
portal projections and the seed data.

It works on a fresh project and on a database that already has an older
schema in it — existing tables get their missing columns added and no data
is dropped. It is idempotent, so re-running it later is safe.

Check it worked: **Table Editor** should now list `clients`, `tasks`,
`day_zones`, `client_contacts`, `app_users` and the rest.

---

## 2. Turn on sign-in

Both sides sign in the same way: **email and password**, against the
Supabase Auth user itself. No magic links anywhere.

**Authentication → Providers → Email**

| Setting | Value | Why |
|---|---|---|
| Enable Email provider | **On** | Passwords live under this provider |
| Confirm email | On | Default; harmless — every user is created pre-confirmed |
| Enable email signups | **Off** | Nobody may create their own account. You create the operator user; the app creates client logins with the service-role key. |

**Create your own user** — Supabase dashboard → **Authentication → Users →
Add user**: the address you will put in `OPERATOR_EMAIL`, and a password.
That password is your sign-in, and you change it from the same place.

Or run the bootstrap script once, which does the same thing and stamps the
owner claim at the same time:

```bash
OPERATOR_EMAIL=you@example.com OPERATOR_PASSWORD='choose-something-long' \
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/create-operator.mjs
```

**Authentication → URL Configuration** — only needed for password resets.

| Setting | Value |
|---|---|
| Site URL | `https://your-app.vercel.app` |
| Redirect URLs | `https://your-app.vercel.app/auth/callback` |

Add `http://localhost:3000/auth/callback` as a second redirect URL while
you are developing.

> **Supabase's built-in email sender is rate limited** and is meant for
> testing. It is only used for "Forgot password?", so this rarely matters —
> but if you want reliable resets, add your own SMTP under
> **Authentication → Emails → SMTP Settings**.

---

## 3. Environment variables

On Vercel: **Project → Settings → Environment Variables**. Locally: copy
`.env.example` to `.env.local`.

### Required — without these no page loads

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → **API** → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → **anon public** key. Safe in a browser; that is what it is for. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → **service_role** key. Bypasses all security — server only, never in a `NEXT_PUBLIC_` variable. |
| `OPERATOR_EMAIL` | Your own email address. This single address is the agency side. |
| `CRON_SECRET` | Invent one: `openssl rand -base64 32` |
| `MCP_SECRET` | Invent one: `openssl rand -base64 32` |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are accepted as alternative names
for the first two.

### Optional — the feature switches off, the app keeps working

| Variable | Missing means |
|---|---|
| `MOONSHOT_API_KEY` | Every AI job uses its deterministic fallback, and the assistant becomes a button panel |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No push notifications. Generate with `npx web-push generate-vapid-keys` |
| `RESEND_API_KEY`, `RESEND_FROM` | No weekly client digests. Settings says so rather than pretending. |
| `TRANSCRIPTION_URL`, `TRANSCRIPTION_KEY` | The microphone button is hidden. Groq's whisper-large-v3. |
| `APP_URL` | Falls back to the Vercel deployment URL. `APP_BASE_URL` is accepted as the older name. |

### After adding them, redeploy

Environment variables are read when the app builds and boots. Values added
to a running deployment do not reach it until you redeploy.

### Checking what is missing

Visit `/api/health`. It lists the names of missing variables — never their
values — and works even when nothing else does, which is exactly when you
need it:

```json
{ "ok": false, "missing_required": ["OPERATOR_EMAIL"], "features_off": [] }
```

If a variable is missing, every page shows a plain list of what to add
rather than a platform error.

---

## 4. Sign in

Go to `/login` and enter the email and password of your Supabase user.

You stay signed in on that device; the session refreshes itself in the
background, so this is a one-time cost per browser.

**The password lives in Supabase, not in this app.** The app never stores
or learns it. Change it from the dashboard and the old one stops working.

What the app does add, on each successful sign-in, is the `role: owner`
claim in `app_metadata` — writable only by the service-role key, which is
why a user you created by hand works with no extra clicking. That claim is
what row level security reads, so the role cannot be forged by the user it
describes. Only the `OPERATOR_EMAIL` address gets it.

If sign-in fails:

| Symptom | Cause |
|---|---|
| "Email or password is incorrect" | The pair does not match the Supabase user — or the email is not `OPERATOR_EMAIL`, which gets the same answer on purpose. If the user was created without a password, delete it and add it again with one. |
| "Too many attempts" | Ten wrong guesses in fifteen minutes from one place. Wait it out. |
| Every page says "not configured" | Variables were added after the last build. Redeploy, then check `/api/health`. |

---

## 5. Set up the agency side

In this order, because each step depends on the last:

**a. Your day** (`/settings`) — the zones: which hours exist and what kind
of work each admits. This is the most load-bearing setting in the product;
the scheduler obeys it exactly and the assistant is not allowed to change
it. Set the working hours and the daily cap in the same screen. The cap is
what you can realistically deliver inside those hours, not the length of
the window.

**b. Clients** (`/clients`) — add your brands. Each gets a colour mark it
keeps everywhere, and a language for their portal.

**c. Logins** — open a client → **Portal access** → Create login. You get a
generated password shown exactly once; hand it over however you like. They
can change it at `/portal/account`. Reset, disable and remove are on the
same row. Removing ends any session already open.

**d. Recurring work** (`/settings`) — rules for repeating work. Approving a
rule once authorises every occurrence it generates.

**e. Capture something** (`/capture`) — type or dictate a sentence. The
system commits to an interpretation and asks only for what it cannot
infer. It never guesses the client, and never guesses the priority.

---

## 6. Cron

Five jobs, authenticated with the `x-cron-secret` header. `vercel.json`
already declares them for Vercel; for an external scheduler (cron-job.org
and similar), point it at:

| URL | When (your local time) | What it does |
|---|---|---|
| `/api/cron/nightly` | 02:00 | Generates recurring work, re-plans, refreshes attention signals |
| `/api/cron/morning` | 08:30 | Sends the morning attention notification, if anything needs you |
| `/api/cron/windows` | 09:00, 13:00, 18:00 | Delivers whatever was held for a delivery window |
| `/api/cron/weekly-updates` | Thursday 11:00 | Drafts one client update per client, for you to edit and publish |
| `/api/cron/digest` | Friday 16:00 | One weekly email per client that wants one |

Send the secret as a header, not in the URL — schedulers keep URLs in their
logs. `/api/cron/ping` verifies the secret without doing any work, so test
a new job against that first.

The windows job is what makes notifications bearable: anything not urgent
waits for the next window and arrives as a single message, and nothing at
all is delivered during a peak zone. Calling it more often than the three
windows is harmless — it only acts on what is due.

---

## 7. Check it privately before trusting it

Three things are worth verifying yourself rather than taking on faith.

**Client isolation.** Run it against your own database:

```bash
psql -d <your-db> -f scripts/verify-portal-isolation.sql
```

It signs in as a client and checks that the base tables return nothing,
that the internal fields are not columns of the portal views at all, that
another client's work and unpublished drafts are unreachable, and that a
request cannot be filed against someone else. It rolls back, so it changes
nothing.

**Working without AI.** Remove `MOONSHOT_API_KEY` and restart. Capture,
client intake, the daily brief, the assistant and client updates all still
work — they fall back to deterministic paths and say so on screen.

**The zones you actually keep.** Open Today after a week. If the shape of
the day on screen is not the shape of your real day, change the zones
rather than working around them — everything the product says about
capacity rests on them being true.
