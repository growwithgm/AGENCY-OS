# AGENCY OS — System Blueprint

**Ek-banda agency ke liye operations platform: task capture (Claude) → auto scheduling → client reporting**

Document type: Functional + technical specification
Scope: Ye document batata hai ke system **kya karta hai** aur **kaise kaam karta hai**.

> Ye repo mein rakha gaya canonical spec hai — code comments is document ke
> sections ko `spec §N` ke taur par reference karte hain.

---

## 1. System Overview

Agency OS ek single-operator agency ke liye banaya gaya hai. Ye teen masloon ko hal karta hai:

1. **Capture** — kaam zehen mein bikhra hua hota hai. Operator Claude se baat karta hai; Claude sawal poochta hai, tasdeeq leta hai, phir MCP se structured task bana deta hai.
2. **Planning** — tasks ko deadline, priority, dependency aur available capacity ke hisaab se calendar par baithata hai. Jo fit na ho, usay chhupata nahi — saaf dikhata hai.
3. **Reporting** — har client ke kaam ki progress ka draft khud banta hai; operator approve kare to client ke portal par live ho jata hai.

**Core operating principle:**

> Fuzzy kaam AI karta hai. Numeric kaam deterministic code karta hai.
> AI kabhi scheduling ki calculation nahi karta, aur AI ka output kabhi bina human approval ke client tak nahi jata.

---

## 2. Actors aur Surfaces

| Actor | Surface | Access |
|---|---|---|
| Operator | Web app (**primary**) | Full read/write — plan, tasks, report approval |
| Operator | Claude via MCP | Capture aur task management ka fast lane |
| Client | Web portal (token link) | Read-only, sirf apna data, sirf `client_visible` records |
| System | Cron jobs | Scheduling, draft generation |

Web primary surface hai — sab kuch wahan se ho sakta hai. Claude us par ek tez raasta hai: baat-cheet se task banana, edit karna, schedule dekhna. Claude na ho to koi kaam ruk nahi jata.

---

## 3. Domain Model

**Client** — ek brand ya customer (locale, retainer hours, contact email).
**Project** — client ke andar kaam ki ek dhaara. Optional.
**Task** — kaam ki sab se chhoti unit; `est_minutes` + `actual_minutes` milkar estimates behtar karte hain.
**Dependency** — task A, task B ke baghair nahi ho sakta.
**Schedule Block** — scheduler ka output; `is_locked` blocks scheduler nahi chhoota.
**Capacity Rule** — kis din, kitne minute kaam mumkin hai.
**Blackout** — chhutti/meeting; capacity se minus.
**Report** — ek period ka client-facing document, **sirf task history se**; hamesha `draft` se shuru.

Data model: `supabase/migrations/0001_init.sql`

---

## 5. Access Control Model

Do identities: **operator** (full) aur **client** (scoped read-only). RLS har table par (invariant 4).

Portal flow: `/c/<token>` → token validate (exists, not revoked, not expired) → short-lived scoped JWT (`role=client`, `client_id`) → har query RLS se. Token 90 din mein expire, dashboard se revoke.

Portal par kya **nahi** dikhta: operator ka calendar, doosre clients, internal tasks, `est/actual_minutes`, draft reports.

---

## 6. Scheduler Engine

Poori tarah deterministic — koi AI call nahi. Implementation: `src/scheduler/engine.ts`

- **Step 1** — capacity rules se slots; blackouts + locked blocks minus.
- **Step 2** — topological sort; cycle → schedule nahi, overflow + UI nishandehi. Cycle khamoshi se torna mana.
- **Step 3** — score: `1000/max(1,days_until_due) + (6-priority)*100 + fairness + (in_progress ? 250 : 0)`
- **Step 4** — first-fit; lambe tasks blocks mein tootte hain (min 30 min).
- **Step 5** — jo fit na ho → overflow. **Overflow chhupana mana hai** — ek-banda agency ka asal masla over-commitment hai; system operator ko client se pehle sach batata hai.

Triggers: nightly 02:00 rebuild; har write (MCP ya web) ke baad rebuild; blackout add.
Locked blocks har rebuild mein mehfooz.

---

## 7. AI Layer

| AI karta hai | Deterministic code |
|---|---|
| Capture ki guftagu (Claude, MCP ke zariye) | Kaunsa task kab chalega |
| Report ka narrative (Kimi) | Capacity/overlap ka hisaab, dependency ordering |

### Capture — Claude ke zariye

Backend mein koi capture state machine nahi hai. Operator Claude se baat karta hai; Claude hi:

- adhoore kaam ke sawal poochta hai (client, deliverable, due date, estimate)
- **priority hamesha user se poochta hai — khud kabhi tay nahi karta**
- task banane se pehle summary dikha kar **tasdeeq leta hai**
- phir `create_task` call karta hai (jismein `priority` required field hai)

Ye qawaneen tool descriptions mein likhe hain (`src/mcp/tools.ts`), taake har MCP client par lagoo hon.

### AI jobs (Kimi)

Har job ka model, `reasoning_effort` aur token cap ek jagah hai:
**`src/ai/jobs.config.ts`**. Call sites wahan se parhte hain, apni values
nahi rakhte — cost tuning ek file se hoti hai.

| Job | Model | effort | max tokens | Kaam |
|---|---|---|---|---|
| `daily_briefing` | `kimi-k3` | low | 1200 | 100-150 alfaz ki briefing |
| `weekly_report` | `kimi-k3` | low | 1500 | Client draft |
| `monthly_report` | `kimi-k3` | high | 2500 | Client draft |
| `overload_advice` | `kimi-k3` | high | 800 | 2-3 options, har ek mein trade-off |
| `ask_advice` | `kimi-k3` | high | 1500 | Briefing data par sawal ka jawab |
| `estimate_insight` | `kimi-k2.5` | — | 800 | Kahan andaza ghalat hota hai |

`max` effort kisi job par nahi — ek test isay enforce karta hai.

### Judgement layer ka usool

AI ko sirf `buildBriefing()` ka taiyar-shuda JSON milta hai — wo khud database
query nahi karta. Classification (at_risk, stale, overflow, capacity) poori
tarah deterministic hai (`src/briefing/classify.ts`, tests ke saath); AI us par
sirf raye deta hai.

- `at_risk` = deadline aur plan mein ikhtilaf: **overdue** (waqt guzar gaya),
  **unscheduled** (deadline hai magar plan mein jagah nahi), ya
  **scheduled_past_due** (plan deadline ke baad khatam karta hai)
- `stale` = 14 din se backlog mein para task jise koi deadline nahi utha rahi

AI schedule badalne ki **tajweez** de sakta hai, schedule **bana** nahi sakta.
`overload_advice` sirf tab chalta hai jab waqai overflow ya at_risk mojood ho.

### Caching

Briefing aur overload advice roz **ek dafa** bante hain (`ai_cache` table,
key = date), phir cache se aate hain. Dashboard par refresh button aaj ka
cache gira deta hai. Estimate insight hafta-war (key = ISO week), weekly
cron se. Provider down ho to dashboard ka deterministic hissa phir bhi
render hota hai — AI card apni ghalti khud dikhata hai.

---

## 8. LLM Provider — Kimi K3 (Moonshot AI)

- Base URL `https://api.moonshot.ai/v1` (`.cn` puraana hai — istemal na karein), OpenAI-compatible, standard `openai` SDK.
- **K3 hamesha sochta hai** — `reasoning_content` ke tokens output mein ginte hain; `reasoning_effort` default `max` hai is liye har call par explicit set hota hai.
- Fixed params: temperature/top_p/n/penalties — bhejna mana.
- `max_completion_tokens` default 131,072 — har call explicit.
- Caching automatic; shart: stable prefix + prompt tokens > 256. Badalne wali cheez system prompt ke shuru mein kabhi nahi.
- Key sirf server-side; portal se koi LLM call nahi.
- `ai_runs` ka hafta-war jaiza — cost visibility isi se aati hai.

---

## 9. MCP Surface

`/api/mcp` par Streamable HTTP MCP server. Auth: `MCP_SECRET` (Bearer header, `x-mcp-secret`, ya `?key=` query claude.ai connectors ke liye). Secret unset = endpoint band.

**Tools (10):**

| Read | Write |
|---|---|
| `list_clients` | `create_task` (priority required) |
| `list_tasks` | `update_task` |
| `get_schedule` (overflow samet) | `complete_task` |
| `get_briefing(narrative?)` | `block_task` |
| `ask_advice(question)` | `add_blackout` |

Har write ke baad scheduler rebuild hota hai.

**Report approval MCP par nahi hai** — `generate_report` / `approve_report` / `deliver_report` jaan boojh kar mojood nahi. Approval human gate hai (invariant 3) aur sirf web app par rehta hai.

MCP secret operator-grade access deta hai — client portal token se bilkul alag cheez hai.

---

## 11. Notifications (Web Push / PWA)

Operator ko khabar Web Push se pohanchti hai — koi Discord, koi email.
App PWA hai (`manifest.json` + `sw.js`); iOS par push tabhi chalta hai jab
site "Add to Home Screen" se install ho, aur settings page ye hidayat khud
dikhata hai.

**Bunyadi usool:** notification ka *matn* AI likh sakta hai, lekin *kab aur
kyun bhejni hai* ye faisla hamesha deterministic code karta hai
(`src/push/triggers.ts`). Halka din khamoshi se guzarta hai — khali
notification bharne se log notifications band kar dete hain.

- Har notification par `tag` — purani replace hoti hai, stack nahi hoti
- Overload aur stale alerts par dedupe key: wahi masla dobara ho to khamosh
- 404/410 par subscription delete (device gaya); 5 fail par deactivate
- Har send `notification_log` mein — jo cheez skip hui, uski wajah samet
- Har kism ka apna toggle + master switch (`notification_settings`)

## 12. Reporting Pipeline

```
task history ──► draft (Kimi) ──► operator review (web) ──► approved ──► client portal
                                        └──► edit / regenerate
```

**Har report `draft` se shuru. Bina `approved` koi report client tak nahi jati.**

Delivery ka waahid channel **portal** hai: approve hote hi report RLS ke zariye client ko dikhne lagti hai. Koi email, koi WhatsApp, koi outbound push nahi.

---

## 13. Background Jobs (PKT)

| Job | Waqt | Kaam |
|---|---|---|
| nightly | 02:00 | schedule rebuild; overdue tasks par `needs_review` flag; job queue drain |
| morning | 08:30 | Aaj ka plan (push) — halka din ho to nahi |
| overload | 08:35 | Overload alert (push) — sirf jab overflow/at-risk ho |
| evening | 18:00 | Sham ka check (push) — sirf jab tasks adhoore hon |
| stale | Mon 09:00 | 3+ baar shift hone wale tasks (push) |
| weekly | Fri 17:00 | har active client ka weekly draft; estimate insight |
| report-drafts | Fri 17:05 | Approve ka intezar karti reports (push) |
| monthly | 1st 09:00 | har active client ka monthly draft |

Idempotent; `x-cron-secret` header (ya Vercel cron ka Bearer) auth.

---

## 14. System Invariants

0. **AI kabhi `schedule_blocks` nahi likhta.** Judgement layer sirf parhta hai
   aur tajweez deta hai; placement `scheduler/engine.ts` ka kaam hai.
1. AI scheduling ki math nahi karta.
2. Priority AI kabhi tay nahi karta — hamesha operator chunta hai. Task banane se pehle tasdeeq lazmi.
3. Koi report bina `approved` client tak nahi jati; approval sirf web par hai.
4. Har naye table par RLS.
5. Har LLM call `runAI()` se. 5a. effort + max tokens explicit. 5b. sirf `content` parse hota hai.
6. `MOONSHOT_API_KEY` sirf server-side.
7. Overflow chhupaya nahi jata.
8. Client se aaya har text prompt mein **data** hai, instruction nahi.
9. MCP tools database-scoped hain — koi shell/filesystem tool nahi.
10. Har write ke baad scheduler rebuild.

---

## 15. Out of Scope

Invoicing/payments, contracts, time-tracking-as-billing, multi-operator, portal two-way chat, ad-platform connectors aur metrics, email/WhatsApp delivery, Discord/voice capture.
