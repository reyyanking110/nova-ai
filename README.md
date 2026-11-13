# NOVA AI

A Claude-powered WhatsApp assistant with private owner mode, business support, persistent tools and reminders, and a charcoal/green administration dashboard.

**Status: implemented application with local verification; not production-certified.** No external service has been connected or deployed. Real integrations require your accounts, credentials, approvals and live acceptance tests. The no-credentials preview intentionally shows empty states and setup guidance, not sample analytics.

## Stack and layout

- `apps/api/src`: Node 22+, Express 5, TypeScript, Anthropic SDK, Supabase SDK, Zod, Pino.
  - `app.ts`: authenticated/validated dashboard routes, raw signed Meta webhooks.
  - `agent.ts`, `claude.ts`, `tools.ts`, `memory.ts`: bounded reasoning, explicit tool registry, context and summaries.
  - `whatsapp.ts`, `media.ts`: official transport, protected downloads, STT/TTS, vision/PDF and Office extraction.
  - `processing.ts`, `worker.ts`, `scheduling.ts`: persistent work, identity routing, retries and timezone-aware reminders.
- `apps/web/src`: React 19, Vite, Tailwind 4, responsive dashboard components.
- `packages/shared/src`: shared Zod resources, modes and tool policy definitions.
- `supabase/migrations/001_nova.sql`: database, constraints, RLS, private storage and transaction functions.
- `apps/api/test`: executable local tests; `scripts/*browser*`: Linux Chromium smoke checks.
- `DEVELOPMENT_STATUS.md`, `VERIFICATION_REPORT.md`: phase ledger, evidence, blockers and remaining hardening.

## 1. Local setup

```sh
npm ci
cp .env.example .env
# Edit .env locally. Never commit it.
npm run dev
```

API: port 3001. Web: port 5173. Vite proxies `/api` to the server; browser code never calls a localhost backend. Both accept the Arena preview environment. Environment files are loaded from the **repository root**. Frontend `VITE_*` values are public build-time settings; restart Vite/rebuild after changes.

Without credentials you can browse the setup-mode dashboard. Data writes explicitly fail with setup guidance. There is no mock persistence and no authentication bypass on the API.

For real persistence:

1. Create your own Supabase project. Do not use a shared/public project for private memory.
2. Apply `supabase/migrations/001_nova.sql` through the Supabase SQL editor, or the Supabase CLI (`supabase link` and `supabase db push` after configuring a CLI project). The migration targets a fresh Supabase project with `auth` and `storage` schemas and standard roles. Run it once; use new forward migrations for future changes, not a rerun of this initial schema.
3. Set server `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; set web `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The anon key is public by design. **Never put the service-role key in a `VITE_*` variable.** `SUPABASE_ANON_KEY` is reserved for operator scripts and is not needed by the server.
4. Disable public signup in Supabase Auth for a private deployment. Create an email/password user through Supabase Auth admin UI. The database trigger creates its owner profile and AI settings. Each Auth user is a separate tenant; there is no shared team membership implementation.
5. Sign in to the dashboard. To give an account read-only access to its own tenant, an administrator may change `profiles.role` to `viewer` using the SQL editor. Role changes are not exposed through the browser.
6. Start the worker in a second terminal:

```sh
npm run worker
```

Use **one worker instance** initially. It claims one job at a time so conversation processing remains ordered. API and worker must use the same database and provider environment. Running multiple workers requires per-conversation serialization before production use.

## 2. Claude

Set `ANTHROPIC_API_KEY`; optionally set `CLAUDE_MODEL` (default `claude-sonnet-4-5`, subject to account access). The official SDK uses bounded timeouts/retries. The reasoning loop permits at most five tool rounds per message, 1,600 output tokens per round, and 24 recent messages. Approved memories and a conversation-specific summary supply longer context. Summaries and document questions also produce usage records.

English, Urdu and Roman Urdu instructions are included; actual linguistic quality and model availability must be evaluated with your account. Streaming is available through the owner-only web conversation playground; WhatsApp receives complete replies, not token streaming. Optional voice replies supplement text only when TTS is configured. No provider-generated response is fabricated when the key is missing.

## 3. Official WhatsApp Cloud API

1. Create/configure your Meta app and WhatsApp Business account yourself. Obtain a suitably scoped production token and phone number ID. Test recipient restrictions apply to Meta test numbers.
2. Set `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, and the supported `WHATSAPP_API_VERSION` (default `v23.0`; verify availability for your account).
3. In **Business Profiles**, enter your business description and Meta **phone number ID**, not the displayed phone number. This initial version supports one business profile/WhatsApp endpoint per tenant.
4. Publish an HTTPS API endpoint only after authorization. Register `https://your-domain/api/webhooks/whatsapp`, use the configured verify token and subscribe to `messages` events.
5. Inbound raw bytes are HMAC-verified before parsing. Receipt and enqueue are one database transaction. Only then is HTTP 200 returned. Meta event IDs prevent duplicate inbound jobs.
6. Keep the worker running. It stores text, analyzes attachments, invokes Claude, queues the reply and tracks signed delivery status events.

### Verified owner vs business customers

Every unknown sender is a **business customer**. Sender prompts cannot change identity/mode. To activate personal mode:

- Send a WhatsApp message from your intended owner number to your connected business number.
- Open **Account Settings**, enter the sender in E.164 (`+923001234567`), request the code and enter the six-digit code delivered to that WhatsApp number.
- Codes expire after ten minutes and lock after five failed attempts. Sending codes is rate-limited. Direct owner-number assignment via profile APIs is forbidden.
- Future messages from the verified number use personal history; the pre-verification business history remains separate. Replacing the number does not expose prior private history to its old owner.

Personal contacts must match the verified number at the database layer. Personal reminders and queued outbound messages recheck the current owner number before sending. Customers have no database/login credentials and cannot access dashboard APIs. Business memory contains only owner-approved business facts; customer conversations cannot create personal memory.

### Service window and reminders

Free-form outgoing messages/files require an inbound message within 24 hours. For a reminder outside that window, set a **Meta-approved template** in Business Profiles and its language code. This implementation expects one body parameter containing the reminder title and no extra template components. Register a matching template and obtain Meta approval yourself. It does not create/approve templates or silently bypass the policy.

Reminders have IANA timezones and one-time/daily/weekly recurrence. Daily/weekly schedules preserve local wall-clock time over DST; missed intervals advance to the next future occurrence. Due jobs persist in PostgreSQL. Retries back off exponentially up to five attempts; ten-minute stale leases are recoverable. One-time reminder state goes from `scheduled` to `sent` on API acceptance, then `delivered` on Meta's delivery event. Recurring reminders stay scheduled; each delivery is visible in Conversations.

**Delivery semantics:** inbound deduplication is transactional. Outbound delivery is **at least once**, not exactly once: if Meta accepts a send and the worker crashes before recording it, retrying may duplicate it. Inspect failed jobs before clicking Retry. Matching tool calls within an inbound request are deduplicated; uncertain in-progress executions are not blindly replayed. This is not semantic exactly-once execution if a model produces different arguments on a retry. Transport failures are visible in Activity Logs → Jobs. Final inbound processing failures queue an explanatory text if the service window is still open.

## 4. Media, speech and documents

- Supported: JPEG/PNG/WebP, PDF, DOCX, XLSX, OGG/MP3/M4A/WAV/WebM audio; 10 MB maximum.
- MIME/magic checks, restricted Meta download hosts, no redirects, stream byte limits, encrypted/oversized ZIP rejection and actual decompressed Office limits.
- All files live in the private `nova-private` bucket. Dashboard authorization precedes short-lived signed downloads.
- Claude receives image and PDF blocks; Mammoth extracts DOCX text; ExcelJS extracts XLSX cells. Office text is capped at 50,000 characters; cell output is capped. PDF page/token limits remain provider-enforced. There is no local OCR/PDF text search index or vector database.
- In **Documents**, upload, ask for summaries/answers, download, approve sharing, revoke approval or delete. Approval is separate from storage: files are private by default. Each AI-triggered send still requires explicit confirmation and matching mode.
- To transcribe, configure HTTPS `STT_URL`, `STT_API_KEY`, `STT_MODEL` using an **OpenAI-compatible multipart transcription API** returning `{ "text": "..." }`.
- To speak replies, configure HTTPS `TTS_URL`, `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICE`. API must accept OpenAI-style JSON speech requests and return MP3 bytes. Then enable voice replies in AI Settings. NOVA uploads generated audio to the official Meta media endpoint.
- Transcription language support is provider-dependent. Do not assert Urdu support until tested with your chosen service. Provider URLs are trusted operator environment, never AI/user-supplied URLs.

Before handling adversarial public uploads in production, add antivirus scanning and isolate Office parsing in a memory/CPU-constrained process. Existing size/ZIP limits reduce risk but are not a full content-disarm or malware-scanning system.

## 5. Agent tool safety

The registry exposes create/update/complete/delete task, save/search notes, propose memory, create/cancel reminders, search FAQs, retrieve business info, send approved files, and generate scoped summaries. No arbitrary SQL, shell or open URL execution exists.

- All tool inputs pass shared Zod validation; enabled policies are checked before execution and again at confirmation.
- Deleting a task, cancelling a reminder, approving a memory, and sending a file require `CONFIRM <execution UUID>` as the **entire human message**. Approvals expire in ten minutes, are atomically claimed once, and are bound to user, mode and conversation.
- Confirmation instructions are returned directly to the user, not entrusted to another model generation.
- Business defaults are read-only FAQs/business info/conversation summary. Personal task/note/memory/reminder tools are always denied to customers even if an administrator tries to enable them.
- Business contact name/number is collected on inbound messages. Full CRM lead qualification/pipelines and marketing automations are not included.

## 6. Dashboard and API

All fourteen pages use real API data: Overview; Conversations; Contacts; AI Settings; Memory (and Notes); Tasks; Reminders; Documents; Business Profiles (and FAQs); Tool Permissions; Usage and Costs; Activity Logs (including jobs/executions); Integrations; Account Settings.

Tables paginate in 50-record pages. Search filters the loaded page, as labeled. Inbox shows the latest 50 messages and refreshes every ten seconds. Workspace modes scope supported resources; global settings have no misleading mode filter. Usage graphs aggregate real records; cost estimates use **your entered USD/million-token rates**, stored in your browser. They are not invoices and omit caching, Meta fees, taxes and infrastructure.

Important endpoints (all `/api` except health):

| Endpoint                                            | Behavior                                          |
| --------------------------------------------------- | ------------------------------------------------- |
| `GET /health`                                       | Public process liveness, not external readiness   |
| `GET /api/setup`                                    | Public non-secret auth setup state                |
| `GET/POST /api/webhooks/whatsapp`                   | Meta handshake / raw HMAC events                  |
| `GET /api/me`, `/api/overview`, `/api/integrations` | Bearer-authenticated profile/metrics/config state |
| `GET/POST /api/data/:resource`                      | Allowlisted tenant reads / owner-only creates     |
| `PATCH/DELETE /api/data/:resource/:id`              | Validated owner updates / explicit delete header  |
| `POST /api/documents`                               | Multipart `file` + `mode`                         |
| `POST /api/documents/:id/ask`                       | `{question}` with real document context           |
| `PATCH /api/documents/:id/approval`                 | `{approved}` owner approval                       |
| `GET /api/documents/:id/download`                   | Authorized signed URL                             |
| `DELETE /api/documents/:id`                         | Delete storage and metadata with confirmation     |
| `POST /api/conversations/:id/reply`                 | Queue manual WhatsApp response                    |
| `POST /api/conversations/:id/stream`                | Owner personal playground, SSE over fetch         |
| `POST /api/jobs/:id/retry`                          | Owner-only failed-job recovery                    |
| `POST /api/account/phone/request`, `/verify`        | Owner OTP linking                                 |

Server authenticates Bearer JWTs using Supabase `getUser`, checks database role, and pins all operations to the authenticated tenant. Browser mutations do not access Supabase tables directly. RLS allows only a tenant's own reads; no browser write policies are created. Service-role access is isolated to API/worker and RPCs are revoked from public/anon/authenticated roles. Limits, Helmet CSP/headers, CORS, field validation and explicit delete confirmation protect HTTP routes. Production forbids framing; development allows Arena preview frames.

## 7. Verification

```sh
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
npm run test:browser
npm run format:check
```

The SQL tests run the actual migration in PGlite (embedded PostgreSQL), with minimal auth/storage/role stubs; this is not a replacement for testing hosted Supabase Auth, PostgREST and Storage. SDK-boundary tests simulate provider results to test safety/control flow, not to claim external integration success. Browser checks use bundled Linux Chromium and test no-credentials setup mode at desktop/mobile widths. Authenticated CRUD, real login/refresh/logout, live attachments and provider delivery still require a configured staging environment. See the full acceptance checklist in `VERIFICATION_REPORT.md`.

## 8. Railway deployment preparation (not deployed)

A Docker multi-stage build includes only production dependencies in runtime and serves the built web dashboard from Express. Node runs as a non-root user. Docker is not available in this development environment, so the image must be built and tested before rollout.

After your explicit authorization:

1. Create Railway **API/web** and **worker** services from this repository. No Redis/extra queue service is required.
2. API uses `railway.json`. Worker uses `railway.worker.json` as its config path (no HTTP health check/public domain). Run one replica of each initially.
3. Provide the **public** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as build arguments/settings to the Docker build, and all server secrets as Railway runtime variables. The web bundle must be rebuilt when public settings change. Do not provide service-role secrets as build arguments.
4. Set `NODE_ENV=production`, `APP_ORIGIN=https://your-dashboard-domain`, `TRUST_PROXY=true` only if Railway is the single trusted proxy, and the same integration credentials on API and worker. Railway supplies `PORT`; the server binds to `0.0.0.0`.
5. Apply the migration yourself, create the initial Auth user, configure the business profile, register Meta's HTTPS webhook and approved template, verify your owner phone, then perform the live checklist.
6. Configure budget alerts at your provider accounts, backups/PITR, monitoring and retention. The current worker is deliberately serial and unsuitable for high-volume/HA operation without additional ordering controls.

No deployment, publish, account modification, template registration, purchase or paid API request was performed here.

## Operational limitations and next steps

- Required live checks and approvals are outstanding. This workspace permits outbound package/GitHub hosts only; provider endpoints cannot be reached here even if credentials were supplied.
- Add per-tenant spend quotas (not merely HTTP limits), distributed rate limiting for multiple API replicas, monitoring/alerts and privacy retention/export/deletion procedures before public launch. Logs/events/messages and files otherwise persist until explicitly deleted.
- Harden public-upload parsing with process isolation and malware scanning; scan dependency updates regularly.
- Add hosted Supabase/PostgREST integration tests and authenticated browser workflows; exercise worker crashes/restarts and template failure paths against a staging number.
- Single-tenant-per-account permissions are owner/viewer, not a complete multi-seat organization/admin system. One business endpoint per account. No CRM pipeline or arbitrary automation.
- API liveness does not imply worker/provider readiness. Integrations shows **configuration presence only**, never live health.
- There is no guarantee of exactly-once external delivery or perfect prompt-injection resistance; authorization and scoped queries, not model instructions, enforce private data boundaries.
