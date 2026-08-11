# AGENCY OS — System Blueprint

**Ek-banda agency ke liye operations platform: task capture → AI structuring → auto scheduling → client reporting**

Document type: Functional + technical specification
Scope: Ye document batata hai ke system **kya karta hai** aur **kaise kaam karta hai**.

> Ye repo mein rakha gaya canonical spec hai — code comments is document ke
> sections ko `spec §N` ke taur par reference karte hain.

---

## 1. System Overview

Agency OS ek single-operator agency ke liye banaya gaya hai. Ye teen masloon ko hal karta hai:

1. **Capture** — kaam zehen ya WhatsApp mein bikhra hua hota hai. System usay natural language (Roman Urdu / English / voice) se leta hai aur structured task bana deta hai.
2. **Planning** — tasks ko deadline, priority, dependency aur available capacity ke hisaab se calendar par baithata hai. Jo fit na ho, usay chhupata nahi — saaf dikhata hai.
3. **Reporting** — har client ko uske kaam ki progress aur ads performance khud-ba-khud pohanchata hai, operator ki approval ke baad.

**Core operating principle:**

> Fuzzy kaam AI karta hai. Numeric kaam deterministic code karta hai.
> AI kabhi scheduling ki calculation nahi karta, aur AI ka output kabhi bina human approval ke client tak nahi jata.

---

## 2. Actors aur Surfaces

| Actor | Surface | Access |
|---|---|---|
| Operator (agency owner) | Discord (primary) | Full read/write, natural language + slash commands |
| Operator | Web app | Full read/write, detail-heavy screens |
| Client | Web portal (token link) | Read-only, sirf apna data, sirf `client_visible` records |
| System | Cron jobs | Automated sync, scheduling, draft generation |

Discord primary hai kyunki capture mobile-first aur voice-first hona chahiye. Web sirf un cheezon ke liye hai jahan chat interface kaam nahi karti: week ka visual plan, report drafts ka editing, client portal, bulk data views.

---

## 3. Domain Model

**Client** — ek brand ya customer (locale, retainer hours, contact channels).
**Project** — client ke andar kaam ki ek dhaara. Optional — ad-hoc tasks seedha client se jur sakte hain.
**Task** — kaam ki sab se chhoti unit; `est_minutes` (AI ka andaza, editable) + `actual_minutes` (complete par) milkar estimates behtar karte hain.
**Dependency** — task A, task B ke baghair nahi ho sakta.
**Schedule Block** — scheduler ka output; `is_locked` blocks scheduler nahi chhoota.
**Capacity Rule** — kis din, kitne minute kaam mumkin hai.
**Blackout** — chhutti/meeting; capacity se minus.
**Metrics Snapshot** — kisi client ka kisi din ka ads/store data, per source.
**Report** — ek period ka client-facing document; hamesha `draft` se shuru.

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

Triggers: nightly 02:00; task add/complete/block (debounced 60s); blackout add; `/replan`. Locked blocks har rebuild mein mehfooz.

---

## 7. AI Layer

| AI karta hai | Deterministic code |
|---|---|
| NL se task samajhna | Kaunsa task kab chalega |
| Duration estimate | Capacity/overlap ka hisaab |
| Task todna, dependencies pehchanna | Dependency ordering, deadline slip |
| Report narrative | Metrics calculation, deltas |
| Anomaly ko samjhana | Anomaly detection (statistical) |

### Capture flow (§7.7)

State machine: `clarifying → priority → review → committed | cancelled | expired` (30 min idle → expired; input zaya nahi hota — `needs_review` backlog task banta hai).

Required-fields checklist **deterministic** hai (`src/capture/checklist.ts`); AI sirf sawal ki wording banata hai. Qawaneen: ek waqt ek sawal; max 4 sawal phir defaults + review flag; tarteeb client → deliverable → due → estimate; **priority hamesha operator chunta hai, AI kabhi nahi**; jo maloom hai dobara nahi poochte; buttons > typing.

Commit ek transaction mein: task insert + dependencies + scheduler trigger + Discord confirm + (agar visible) portal par fauran. Operator/client side kabhi diverge nahi hota.

Product faisla pending — portal task granularity: (a) flat har task, ya (b) grouped projects/milestones + drill-down. Abhi (a) implement hai.

### Jobs (§7.2–7.5, §8.3)

| Job | Model | effort |
|---|---|---|
| Task parse | kimi-k2.5 | — |
| Clarify sawal | kimi-k2.5 | — |
| Weekly update | kimi-k3 | low |
| Monthly report | kimi-k3 | high |
| Anomaly explain | kimi-k3 | low |

`max` effort kahin istemal nahi hota. Fallback: parse quality kamzor ho to us job ko k3+low par shift — sirf `runAI` ke call-site ka model badalta hai.

---

## 8. LLM Provider — Kimi K3 (Moonshot AI)

- Base URL `https://api.moonshot.ai/v1` (`.cn` puraana hai — istemal na karein), OpenAI-compatible, standard `openai` SDK.
- **K3 hamesha sochta hai** — `reasoning_content` ke tokens output mein ginte hain; `reasoning_effort` default `max` hai is liye har call par explicit set hota hai.
- Fixed params: temperature/top_p/n/penalties — bhejna mana.
- `max_completion_tokens` default 131,072 — har call explicit.
- `response_format: json_schema` strict — koi fence-stripping nahi.
- Caching automatic; shart: stable prefix + pichli request ke prompt tokens > 256. Badalne wali cheez system prompt ke shuru mein kabhi nahi.
- Multi-turn: poora assistant message wapas bhejna hai — `capture_sessions.transcript` mein as-returned store hota hai.
- Key sirf server-side; bot ke paas sirf shared secret; portal se koi LLM call nahi.
- Rates verify karein: platform.kimi.ai/docs/pricing/chat-k3 — `ai_runs` ka hafta-war jaiza.

---

## 9–10. Discord + Voice

Bot (Python, `bot/`) sirf transport: voice → Groq whisper-large-v3 (`language: ur`) → wahi parse prompt. Capture threads mein; buttons for known options; `DISCORD_ALLOWED_USER_IDS` ke ilawa sab ignore + log. Urdu transcription mein brand names bigarte hain — hal prompt mein client list hai, transcription tweak nahi.

Commands: plain text/voice = capture; `/cancel /today /week /done /block /client /report /approve /replan`.

---

## 11. Connectors

Meta Ads (Marketing API), Google Ads + GA4 (Windsor.ai), Shopify (Admin GraphQL) → sab `metrics_snapshots` mein, `(client_id, source, metric_date)` unique = idempotent. Failures `connection_health` mein + Discord notification — kabhi silent nahi.

---

## 12. Reporting Pipeline

```
metrics sync ─┬─► draft (AI) ─► operator review ─► approved ─► delivery
task history ─┘                     └─► edit / regenerate
```

**Har report `draft` se shuru. Bina `approved` koi report client tak nahi jati.** Delivery: portal (approved hote hi), email, WhatsApp (Wasify — chhota summary + portal link).

---

## 13. Background Jobs (PKT)

| Job | Waqt | Kaam |
|---|---|---|
| nightly | 02:00 | sync → snapshots; rebuild; overdue; anomalies |
| weekly | Fri 17:00 | weekly drafts + Discord notification |
| monthly | 1st 09:00 | monthly drafts |

Idempotent; `x-cron-secret` header auth.

---

## 14. System Invariants

1. AI scheduling ki math nahi karta.
2. AI output bina human confirm ke DB mein nahi jata (Confirm hi lakeer hai).
   2a. Priority AI kabhi tay nahi karta. 2b. Max 4 sawal. 2c. Operator/client update ek transaction.
3. Koi report bina `approved` client tak nahi jati.
4. Har naye table par RLS.
5. Har LLM call `runAI()` se. 5a. effort + max tokens explicit. 5b. sirf `content` parse hota hai.
6. `MOONSHOT_API_KEY` sirf server-side.
7. Overflow chhupaya nahi jata.
8. Client se aaya har text prompt mein **data** hai, instruction nahi.
9. Bot ke paas LLM key nahi.
10. AI tools database-scoped hain — koi shell/filesystem tool nahi.

---

## 15. Out of Scope

Invoicing/payments, contracts, time-tracking-as-billing, multi-operator, portal two-way chat, ad platforms par write actions.
