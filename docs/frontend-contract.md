# Frontend → backend contract

The frontend (`gcb-frontend`) currently runs in demo mode: every API call is answered in the browser by
`gcb-frontend/lib/mock/server.ts`. That file is the executable version of this contract: it has the exact
paths, request bodies, response shapes and rules the screens rely on. This document lists what the
backend must add or change so the frontend can run with `NEXT_PUBLIC_API_MODE=live`.

Conventions (same as the existing API):

- Base path `/api`, tenant from `X-Tenant-Slug`, member auth with `Authorization: Bearer <jwt>`.
- Errors are `{ "error": "message" }` with a meaningful status; the UI shows the message as is.
- Money is integer kobo (`*_kobo`); timestamps are ISO strings; every query filters by `tenant_id`.
- "Staff" below means one of `tenant_admin`, `lga_coordinator`, `treasurer`, `situation_agent`, as named per endpoint.

Status: 49 endpoints already match, 28 are missing, and 7 existing endpoints need small changes.

---

## 1. Changes to existing endpoints

| Endpoint | Change | Used by |
|---|---|---|
| `GET /tenant/current` | Include `ebira_language` in `features` (already seeded). | Language menu shows Ebira only when on |
| `PATCH /members/me` | Accept `preferred_lang` (`en`, `igb`, `ha`, `yo`, `ig`) and store it on `users.preferred_lang`. Return it from `GET /auth/me` as `user.preferred_lang`. | Navbar language menu |
| `PUT /members/me/bank` | Accept optional `bvn` (11 digits). Store encrypted or as an HMAC like NIN; never return it in full. | Verification step 3 |
| `GET /members` | Add `lga_name` and `ward_name` to each member (use `withLocationNames`). | Admin → Members |
| `GET /incidents` | Add `description`, `lga_name` and `reporter` (full name) to each row. | Admin → Situation room |
| `POST /incidents` | Accept `evidence_upload_ids: string[]` (new upload kind `incident_evidence`, images/video up to 20 MB). | Situation room report panel |
| `GET /chat/conversations/:id` | Add `peer_title` for direct messages: the other member's level name for supporters, otherwise a role title (`Campaign Admin`, `Treasurer`, `LGA Coordinator`, `Situation Room Agent`). | Messages thread header |

---

## 2. Missing endpoints

### 2.1 Public (no sign-in)

**`GET /public/stats`**: home page numbers for the current tenant.

```json
{ "month": "September", "joined_this_month": 1424,
  "joins_by_month": [{ "month": "Apr", "count": 620 }],
  "verified_supporters": 364059, "wards_covered": 97, "lgas": 5 }
```
`joins_by_month` is the last 6 months of new members. Cache for a few minutes; it is public.

### 2.2 Dashboard

**`GET /tasks/summary`**: `{ "completed": 23, "ward_rank_percent": 18 }`.
Tasks don't exist yet. Either design the tasks feature (assign, complete, verify) or return zeros and
the card says "Tasks from your coordinator appear here". **Decision needed.**

### 2.3 Verification

**`GET /banks/resolve?bank_name=&account_number=`** → `{ "account_name": "AMINA IBRAHIM" }`, or 404 when not found.
Use Youverify's Nigerian bank account verification (premium returns the account holder's name, see 2.8), or a
payment provider's lookup. Either needs bank codes instead of names. The UI falls back to typing the name.

### 2.4 Meeting room

Tables: `meetings` (tenant, title, kind `meeting|training|town_hall`, starts_at, duration_min, venue, online,
host member, audience text, description, invited count, recording flag), `meeting_rsvps`, `meeting_recordings`.

| Endpoint | Who | Notes |
|---|---|---|
| `GET /meetings` | member | `{ meetings: [...] }` sorted by `starts_at`; each adds `host` (name), `going` (caller RSVP'd), `rsvp_count`, `invited`, `recording` |
| `GET /meetings/:id` | member | `{ meeting, participants: [{ member_id, name, role: 'host'\|'participant', muted, camera, hand }] }`. Participants come from the video provider's room state |
| `POST /meetings` | `tenant_admin`, `lga_coordinator` | body: `title, kind, starts_at, duration_min, venue, online, audience, description, invited, recording` → `{ meeting }` |
| `POST /meetings/:id/rsvp` | member | toggles; → `{ going }` |
| `GET /meetings/recordings` | member | `{ recordings: [{ id, title, recorded_at, duration_min, views }] }` |

Video needs a provider (LiveKit or Agora, see the earlier plan). Add `POST /meetings/:id/join` returning a
short-lived room token once one is chosen. **Decision needed: provider.**

### 2.5 Official broadcast (one-way channel)

Tables: `broadcast_posts` (title, body, attachment upload id, video upload id + duration, created_by),
`broadcast_post_reads` (member, post, viewed_at, read_at), `broadcast_notification_prefs`.

| Endpoint | Who | Response / rules |
|---|---|---|
| `GET /broadcast` | member | `{ channel: { name, verified, subscribers, notifications, can_post }, stats: { reached, reach_goal, read_rate, total_views }, posts: [{ id, title, body, created_at, views, reads, attachment: { name, kind:'pdf', size_mb, pages } \| null, video: { duration } \| null }] }` |
| `POST /broadcast/posts` | `tenant_admin` | `{ title, body }` (later: attachment/video upload ids) → `{ post }`; push a notification to subscribers |
| `DELETE /broadcast/posts/:id` | `tenant_admin` | 204 |
| `POST /broadcast/notifications` | member | `{ on: boolean }` → `{ on }` |

Record a view when a post is shown and a read when it's opened, to compute `views`, `reads`, `read_rate`.
`subscribers` = members with notifications on; `reached` = distinct viewers in 30 days.

### 2.6 Situation room

| Endpoint | Who | Notes |
|---|---|---|
| `GET /situation` | member | `{ stats: { registered, registered_week, online, lgas_live, open_incidents, high_priority, results_uploaded, results_total }, lgas: [{ name, registered, strength }], feed: [{ id, title, type, severity, status, created_at, place, agent, mine }], agents_online }` |
| `POST /situation/results` | member (polling agents) | `{ polling_unit_id, ec8a_upload_id }`; one sheet per polling unit (409 on duplicate); new upload kind `ec8a` |

- `online` / `agents_online`: count of connected sockets (Socket.IO presence), agents = `situation_agent` role.
- `strength` per LGA: verified ÷ target. **Needs a target per LGA** (new column on `lgas`).
- `place` = "LGA · Ward · PU code" of the reporter; `agent` = a short agent code (add `agent_code` to `tenant_members`).
- `results_total` = number of polling units in the tenant.

### 2.7 Gifting & finance

| Endpoint | Who | Notes |
|---|---|---|
| `GET /gifting/summary` | member | `{ disbursed_month_kobo, successful_gifts }` for the current month |
| `GET /gifting/eligible?lga_id=&ward_id=&level_id=` | `tenant_admin`, `treasurer` | `{ count }`: same filter as batch creation |
| `POST /gifting/withdrawals` | member | `{ amount_kobo }`; debit wallet in a transaction, create a transfer via the payment provider, return `{ ok }`. Reject above balance |
| `POST /donations` | member | `{ amount_kobo (min 10 000), frequency: 'once'\|'monthly', method: 'card'\|'transfer'\|'ussd' }` → `{ donation: { id, amount_kobo, frequency, reference } }`; really a payment-provider checkout |
| `GET /donations/mine` | member | `{ donations: [...] }` |
| `GET /pvc/check?vin=` | member | `{ found, vin, status, polling_unit }`. Backed by Youverify's PVC check (section 2.8) |

Payments need a provider (Paystack or Flutterwave): transfers for withdrawals, checkout for donations, account
lookup for `banks/resolve`. Donations must respect INEC campaign finance limits.

### 2.8 Identity checks with Youverify

Voter verification (NIN, voter card) and bank account checks go through [Youverify](https://doc.youverify.co).
Calls are **server-side only**: the API secret key must never reach the browser.

| | |
|---|---|
| Base URL | sandbox `https://api.sandbox.youverify.co`, live `https://api.youverify.co` |
| Auth | header `token: <API secret key>` (separate keys per environment) |
| Env vars | `YOUVERIFY_BASE_URL`, `YOUVERIFY_API_KEY`, `YOUVERIFY_WEBHOOK_SECRET` |
| NIN | `POST /v2/api/identity/ng/nin`, body `{ id, isSubjectConsent: true, validations: { data: { firstName, lastName, dateOfBirth } } }` → `data.status` (`found`/`not_found`), `data.allValidationPassed`, names, `dateOfBirth`, `address`, `image` (base64) |
| Voter card | `POST /v2/api/identity/ng/pvc`, body `{ id: <VIN>, isSubjectConsent: true }`. **Confirm the response fields** (name, polling unit, ward, LGA) in the Youverify dashboard before mapping them |
| Bank account | Nigerian bank account verification (basic = details correct, premium = also account holder's name). **Confirm the path** in the docs |
| Webhooks | verify `x-youverify-signature` = HMAC-SHA256 of the raw body with the secret |

Sandbox test values: NIN found `11111111111` / not found `00000000000`; voter card found `00A0A0A000000000000` /
not found `11A1A1A111111111111`; BVN found `11111111111`; bank account found `1000000000` / not found `1111111111`.
The frontend demo mode imitates these.

**Changes to KYC:**

- `POST /kyc/submit` calls Youverify for the NIN (validating the member's name) and the VIN before saving.
  NIN `not_found` → 422 `"We could not find this NIN. Check the 11 digits and try again."`; VIN not found → 422
  with the same style of message. Name mismatches don't block; they flag the submission for review.
- Store only a summary on `kyc_submissions`: `nin_check` and `pvc_check` (`verified` | `mismatch` | `not_found`),
  the provider reference and checked-at time. **Don't store the returned photo or full record.**
- `GET /kyc/submissions` returns `checks: { nin, pvc }` so reviewers see the provider result (the admin screen shows
  it as badges). Human review stays; auto-verify when both checks are `verified` is a policy choice.
- Each call is billed: never re-check a NIN or VIN that already has a result, and rate-limit submissions.

### 2.9 Platform console (superadmin)

Completely separate from tenant auth. Mount `/api/superadmin` **before** `tenantResolver`.

- New table `platform_admins` (username, bcrypt/argon2 password hash, created_at, last_login_at). Seed the first admin from env; **don't reuse the demo password**.
- Login issues a JWT with `scope: 'platform'` and no `tenant_id`; the member `requireAuth` must reject it, and a new `requirePlatformAdmin` must reject member tokens.
- Rate-limit login (5 per minute per IP), log every action to a `platform_audit` table.

| Endpoint | Notes |
|---|---|
| `POST /superadmin/login` | `{ username, password }` → `{ token }`; 401 "Invalid username or password"; 429 after 5 failures |
| `POST /superadmin/logout` | revoke the token (keep a deny-list or short expiry) |
| `GET /superadmin/me` | `{ username }` |
| `GET /superadmin/overview` | `{ tenants, active, members, verified, open_incidents, disbursed_kobo, activity: [{ id, at, action, target }] }` |
| `GET /superadmin/tenants` | `{ tenants: [Tenant] }` |
| `GET /superadmin/tenants/:slug` | `{ tenant: Tenant }` |
| `POST /superadmin/tenants` | `{ name, slug, tagline, plan, primary_color, admin_phone }` → `{ tenant }`; slug `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`, 409 if taken; creates branding, default features, default level |
| `PATCH /superadmin/tenants/:slug` | any of `status: 'active'\|'suspended'`, `plan`, `custom_domain`, `features: { key: bool }`, `branding: {...}` → `{ tenant }` |

`Tenant` = `{ slug, name, status, plan, subdomain, custom_domain, created_at, admin_phone, branding: { app_name, tagline, primary_color, secondary_color, support_email, support_phone }, features: { [key]: boolean }, stats: { members, verified, open_incidents, disbursed_kobo } }`.

A suspended tenant already blocks members (`tenantResolver` returns 403). The demo also keeps `/tenant/current`
working while suspended, so the login page can still show branding; the backend should allow that too.

---

## 3. Suggested order

1. **Small changes** (section 1) and `GET /public/stats`: unblock existing screens in live mode.
2. **Platform console** (2.9): security-sensitive; replaces the browser-only demo login.
3. **Broadcast feed** (2.5) and **situation room** (2.6): data you already have plus a few tables.
4. **Meetings** (2.4) once a video provider is chosen.
5. **Youverify** (2.8): NIN and voter card checks on submission, then the PVC check card and bank name lookup.
6. **Payments** (withdrawals, donations) once a payment provider is chosen.
7. **Decisions first:** tasks, LGA targets, whether to auto-verify when Youverify matches.
