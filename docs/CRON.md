# Cron setup — cron-job.org

Agency OS ke saare scheduled kaam `/api/cron/*` routes se chalte hain.
Vercel ke built-in crons **istemal nahi ho rahe** (Hobby plan par sirf 2
allowed hain, aur yahan 9 chahiye) — is liye `vercel.json` mein koi cron
nahi hai.

## Har job ke liye common settings

| Setting | Value |
|---|---|
| Method | `GET` |
| Timezone | `Asia/Karachi` (cron-job.org har job par timezone deta hai — UTC mein convert karne ki zaroorat nahi) |
| Header | `x-cron-secret: <CRON_SECRET>` |
| Save responses | On (rakhein — masla aaye to jawab dikh jata hai) |

Header lagane ki jagah: job banate waqt **Advanced → Headers** mein
`x-cron-secret` naam aur value daalein. Ye wahi value hai jo Vercel ke
env vars mein `CRON_SECRET` hai.

> Secret URL mein na daalein — cron-job.org URLs apne logs mein rakhta hai.
> Header hi sahi jagah hai.

## Jobs

Base URL: `https://<aapka-app>.vercel.app`

| # | Path | Kab (PKT) | cron expression | Kaam |
|---|---|---|---|---|
| 1 | `/api/cron/nightly` | Roz 02:00 | `0 2 * * *` | Schedule rebuild, overdue flags, expired requests, job queue |
| 2 | `/api/cron/morning` | Roz 08:30 | `30 8 * * *` | "Aaj ka plan" notification (halka din → kuch nahi) |
| 3 | `/api/cron/overload` | Roz 08:35 | `35 8 * * *` | Overload alert (sirf jab overflow/at-risk ho) |
| 4 | `/api/cron/evening` | Roz 18:00 | `0 18 * * *` | Sham ka check (sirf adhoore tasks par) |
| 5 | `/api/cron/stale` | Mon 09:00 | `0 9 * * 1` | 3+ baar shift hone wale tasks |
| 6 | `/api/cron/weekly` | Fri 17:00 | `0 17 * * 5` | Weekly report drafts + estimate insight |
| 7 | `/api/cron/report-drafts` | Fri 17:05 | `5 17 * * 5` | "Approve ka intezar" notification |
| 8 | `/api/cron/monthly` | 1st 09:00 | `0 9 1 * *` | Monthly report drafts |

Test ke liye ek aur route hai: `/api/cron/ping` — kuch karta nahi, sirf
batata hai ke secret sahi hai. Naya job banate waqt pehle isi par test
kar lein.

## Pehli dafa setup

1. `CRON_SECRET` Vercel ke env vars mein set karein (lamba random string).
2. cron-job.org par account banayein.
3. Ek job banayein jo `/api/cron/ping` ko hit kare, header ke saath.
   "Run now" dabayein — jawab `{"ok":true,...}` aana chahiye.
   `401` aaye to secret match nahi kar raha.
4. Ping wala job delete karke upar wali table ke 8 jobs bana lein.

Ya haath se banane ke bajaye script chala lein (neeche).

## Script se sab jobs banana

`scripts/setup-cronjobs.mjs` cron-job.org ke API se saare jobs bana deta
hai. API key unke dashboard mein **Settings → API** se milti hai.

```bash
# pehle dekh lein kya banega — koi request nahi jati
CRONJOB_API_KEY=xxx APP_BASE_URL=https://aapka-app.vercel.app \
  CRON_SECRET=yyy node scripts/setup-cronjobs.mjs --dry-run

# ab waqai banayein
CRONJOB_API_KEY=xxx APP_BASE_URL=https://aapka-app.vercel.app \
  CRON_SECRET=yyy node scripts/setup-cronjobs.mjs
```

Script dobara chalane par purane jobs delete nahi karta — pehle dashboard
se hata dein, warna duplicate ban jayenge.

## Timeout ka masla

cron-job.org request ka jawab **30 second** tak intezar karta hai. Kuch
routes is se lamba le sakte hain:

- `/api/cron/weekly` aur `/api/cron/monthly` — har client ke liye K3 call
- `/api/cron/morning` — briefing generate karti hai (agar cache khali ho)

Aisi surat mein cron-job.org job ko "failed" dikhayega, **lekin kaam phir
bhi ho jata hai** — serverless function chalti rehti hai chahe client
disconnect ho jaye. Aur har route idempotent hai: dobara chal jaye to
duplicate report ya duplicate notification nahi banti.

Yani red status pareshan-kun lagta hai lekin data theek rehta hai. Agar
saaf status chahiye to un teen jobs par cron-job.org ki timeout setting
barha dein (Advanced → Timeout), ya notifications band kar dein un jobs
par.

## Kisi aur scheduler se

Koi bhi cheez jo HTTP GET header ke saath bhej sake, kaam karegi:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  https://<aapka-app>.vercel.app/api/cron/nightly
```

Routes `Authorization: Bearer <CRON_SECRET>` bhi qubool karte hain (ye
Vercel Cron ki shakl hai), to us par wapas jana ho to code badalna nahi
parega.
