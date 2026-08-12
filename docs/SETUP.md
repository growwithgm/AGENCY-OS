# Setup

From an empty Supabase project to a working sign-in, in order.

---

## 1. Create the database

Supabase dashboard → **SQL Editor** → New query → paste the whole of
[`supabase/schema.sql`](../supabase/schema.sql) → **Run**.

That one file is everything: tables, functions, row level security, the
portal projections and the seed data.

It works on a fresh project and on a database that already has the older
schema in it — existing tables get their missing columns added, the old
single `due_at` is carried across into `internal_target`, and no data is
dropped. It is idempotent, so re-running it later is safe.

> The old date becomes an **internal target, never a commitment**. Those
> rows never recorded whether a date was a promise, and inventing promises
> is exactly what the commitment field exists to prevent. Promote the real
> ones yourself from each work item's page.

Check it worked: **Table Editor** should now list `clients`, `tasks`,
`client_contacts`, `attention_signals` and the rest.

---

## 2. Turn on sign-in

The two sides sign in differently, on purpose:

- **You** (the agency side) sign in with **email and password** — the
  Supabase Auth user itself, exactly like signing in to Supabase. No email
  in the loop.
- **Clients** sign in with an emailed link. Nothing to remember, nothing to
  reset, and access can be revoked instantly by removing the address.

**Create your own user** — Supabase dashboard → **Authentication → Users →
Add user**: enter the address you will put in `OPERATOR_EMAIL` and choose a
password. That password is your sign-in; change it any time from the same
place. (If the user already exists without a password, delete it and add it
again with one.)

**Authentication → Providers → Email**

| Setting | Value | Why |
|---|---|---|
| Enable Email provider | **On** | Both passwords and links live under this provider |
| Confirm email | On | Default; harmless — users are created pre-confirmed |
| Enable email signups | **Off** | Nobody may create their own account. The app creates users with the service-role key, only for the operator address and addresses you have added as client contacts. |

**Authentication → URL Configuration** — only needed for the client portal.
If you are the only one signing in, skip it.

| Setting | Value |
|---|---|
| Site URL | `https://your-app.vercel.app` |
| Redirect URLs | `https://your-app.vercel.app/auth/callback` |

Add `http://localhost:3000/auth/callback` as a second redirect URL while
you are developing.

> **Supabase's built-in email sender is rate limited** (a handful of
> messages an hour) and is meant for testing. Before giving the portal to
> clients, add your own SMTP under **Authentication → Emails → SMTP
> Settings** — otherwise a client asking for a second link may simply not
> receive one. This does not affect your own sign-in.

---

## 3. Environment variables

On Vercel: **Project → Settings → Environment Variables**. Locally: copy
`.env.example` to `.env.local`.

### Required — without these no page loads

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → **API** → Project URL. Looks like `https://abcdefgh.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → **anon public** key. Safe in a browser; that is what it is for. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → **service_role** key. Bypasses all security — server only, never in a `NEXT_PUBLIC_` variable, never in the browser. |
| `OPERATOR_EMAIL` | Your own email address. This single address is the agency side. |
| `CRON_SECRET` | Invent one: `openssl rand -base64 32` |
| `MCP_SECRET` | Invent one: `openssl rand -base64 32` |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are accepted as alternative names
for the first two, so an older deployment does not need renaming.

### Optional — the feature switches off, the app keeps working

| Variable | Missing means |
|---|---|
| `MOONSHOT_API_KEY` | Every AI job uses its deterministic fallback |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No push notifications. Generate with `npx web-push generate-vapid-keys`; `VAPID_SUBJECT` is `mailto:you@example.com` |
| `APP_URL` | Falls back to the Vercel deployment URL. `APP_BASE_URL` is accepted as the older name. |

### After adding them, redeploy

Environment variables are read when the app builds and boots. Values added
to a running deployment do not reach it until you redeploy.

### Checking what is missing

Visit `/api/health` on the deployment. It lists the names of missing
variables — never their values — and works even when nothing else does,
which is exactly when you need it:

```json
{ "ok": false, "missing_required": ["OPERATOR_EMAIL"], "features_off": [] }
```

If a variable is missing, every page shows a plain list of what to add
rather than a platform error.

`OPERATOR_EMAIL` is enforced when the link is requested, not merely hidden
afterwards: any other address gets the same "check your email" screen and
no email is sent. Changing it later immediately locks out the old address,
because the allowlist is re-checked on every request, not only at sign-in.

---

## 4. Sign in to the agency side

1. Deploy, or run `npm run dev`.
2. Go to `/login`.
3. Enter the email and password of your Supabase user — the one you created
   in step 2, whose address is `OPERATOR_EMAIL`.

You stay signed in on that device; the session refreshes itself in the
background, so this is a one-time cost per browser, not a daily one.

**The password lives in Supabase, not in this app.** The app never stores
or learns it — Supabase verifies it, the same check as signing in to
Supabase itself. Change it from the dashboard (Authentication → Users →
your user) and the old one stops working.

What the app does add, on each successful sign-in, is the `role: owner`
claim in `app_metadata` — writable only by the service-role key, which is
why a user you created by hand works without any extra clicking. That claim
is what row level security reads, so the role cannot be forged by the user
it describes. Only the `OPERATOR_EMAIL` address gets it; any other user
signing in here is rejected before the password is even checked.

If sign-in fails:

| Symptom | Cause |
|---|---|
| "That email or password is not right" | The pair does not match the Supabase user — or the email is not `OPERATOR_EMAIL`, which gets the same answer on purpose. If the user was created without a password, delete it in the dashboard and add it again with one. |
| "Too many attempts" | Ten wrong guesses in fifteen minutes from one place. Wait it out. |
| Every page says "not configured" | Variables were added after the last build. Redeploy, then check `/api/health`. |

Client sign-in needs no password: they enter their email at
`/portal/login` and open the link.

---

## 5. Set up the agency side

In this order, because each step depends on the last:

**a. Availability** (`/availability`) — set your working hours and the daily
cap for each day. The cap is what you can realistically deliver inside
those hours, not the length of the window; the planner treats it as the
truth and never plans beyond it. Everything the product says about capacity
rests on this number being honest.

**b. Clients** (`/clients`) — add your client brands.

**c. Portal access** — open a client, and under **Portal access** add the
email addresses of people at that client. That list is the entire
allowlist: an address that is not on it gets the same "check your email"
screen and no link. Adding an address sends nothing; they sign in at
`/portal/login` whenever they choose. Revoking removes their access
immediately, including any session already open.

**d. Recurrence** (optional, `/availability`) — rules for repeating work.
Approving a rule once authorises every occurrence it generates.

**e. Capture some work** (`/capture`) — type or dictate a sentence. The
system commits to an interpretation and asks only for what it cannot
infer, one question at a time. Priority is always asked, never guessed.

---

## 6. Cron

Two jobs, authenticated with the `x-cron-secret` header. `vercel.json`
already declares them for Vercel; for an external scheduler
(cron-job.org and similar), point it at:

| URL | When (your local time) |
|---|---|
| `https://your-app.vercel.app/api/cron/nightly` | 02:00 |
| `https://your-app.vercel.app/api/cron/morning` | 08:30 |

Send the secret as a header, not in the URL — schedulers keep URLs in
their logs. `/api/cron/ping` verifies the secret without doing any work,
so test a new job against that first.

---

## 7. Check it privately before trusting it

Two things are worth verifying yourself rather than taking on faith:

**Client isolation.** Add two dummy clients with two email addresses you
control, give each some visible work, and sign in as each in turn. Neither
should see the other's work, and neither should see an internal date, an
estimate or a priority anywhere.

**Working without AI.** Remove `MOONSHOT_API_KEY` and restart. Capture,
client intake, the daily brief, advice and client updates all still work —
they fall back to deterministic paths and say so on screen where it
matters.
