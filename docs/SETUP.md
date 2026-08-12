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

## 2. Turn on email sign-in

Both the agency dashboard and the client portal use Supabase Auth magic
links. No passwords exist anywhere in this system.

**Authentication → Providers → Email**

| Setting | Value | Why |
|---|---|---|
| Enable Email provider | **On** | Magic links are email links |
| Confirm email | On | Default; harmless — users are created pre-confirmed |
| Enable email signups | **Off** | Nobody may create their own account. The app creates users with the service-role key, only for the operator address and addresses you have added as client contacts. |

**Authentication → URL Configuration**

| Setting | Value |
|---|---|
| Site URL | `https://your-app.vercel.app` |
| Redirect URLs | `https://your-app.vercel.app/auth/callback` |

Add `http://localhost:3000/auth/callback` as a second redirect URL while
you are developing.

> **Supabase's built-in email sender is rate limited** (a handful of
> messages an hour) and is meant for testing. Before real use, add your own
> SMTP under **Authentication → Emails → SMTP Settings** — otherwise a
> client asking for a second link may simply not receive one.

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
3. Enter the address in `OPERATOR_EMAIL`.
4. Open the link in the email. You land on Today.

Nothing needs creating in the Supabase dashboard first — the app creates
the auth user on the first request and stamps it with `role: owner` in
`app_metadata`, which only the service-role key can write. That claim is
what row level security reads, so the role cannot be forged by the user it
describes.

If the link fails:

| Symptom | Cause |
|---|---|
| "That link has expired" | The link was already used, or opened in a different browser from the one that requested it. Request another. |
| Redirected back to `/login` with no error | `OPERATOR_EMAIL` does not match the address you typed. |
| No email at all | Either the address is not the operator address, or you have hit Supabase's built-in email rate limit. |

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
