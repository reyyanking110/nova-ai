# NOVA AI development status

Status: local implementation and verification complete to the no-credentials boundary. External acceptance and production hardening remain. No external deployment authorized.

## Phase 1 — foundation

- Created npm workspaces for shared validation, Express API, React dashboard.
- Environment-only credentials, separate API and worker entry points.
- External blockers: Supabase project, Anthropic key, Meta app and WhatsApp registration.

## Verification ledger

Checks and subsequent phases will be recorded as they are completed. No external integration has been verified yet.

## Phase 2 — Claude integration

- Added official Anthropic SDK client, bounded timeouts and retries, configurable Sonnet model.
- Shared Zod schemas define the only permitted AI actions; agent loop follows after persistence/webhooks.
- Live Claude calls blocked by missing API key; no fabricated responses.

## Phase 3 — persistence

- Added relational migration with tenant RLS, composite conversation/contact scope keys, private storage, audit and usage records.
- Added atomic webhook dedupe/enqueue, SKIP LOCKED job leasing, reminder enqueue and lease recovery functions.
- Supabase environment unavailable; migration will additionally be exercised in local PostgreSQL-compatible tests with auth/storage stubs.

## Phase 4 — WhatsApp transport

- Implemented official Graph API text/media/template transport, HMAC signature validation, restricted media download hosts and bounded requests.
- Webhook route and worker consume these primitives with durable queue deduplication.
- Live sending, webhook registration and template approvals require Meta credentials/authorization.

## Phase 5 — agent and safe tools

- Implemented bounded Claude tool loop, schema validation, configurable permissions and persistent tool execution records.
- Deletion, cancellation, memory approval and file sending require exact, expiring, conversation-bound confirmation codes; no shell/SQL tools exist.
- Read-only business defaults; personally scoped actions cannot be enabled for business customers.

## Phase 6 — memory and modes

- Implemented owner-number identity resolution design, application scope filters and composite database constraints.
- Approved facts, relevance ranking, scoped conversation summaries and recent message context feed Claude.
- Dashboard owners approve/edit memories; business and personal facts are separate.

## Phase 7 — media and speech

- Implemented private media storage, 10 MB limits, MIME/magic checks, bounded download streams, Office archive limits.
- Claude image/PDF blocks, DOCX text, XLSX cells, configurable OpenAI-compatible STT and optional MP3 TTS.
- Transcription language capability depends on configured provider; no claim of live Urdu verification.
- Parser isolation / antivirus scanning remain production-hardening items; uploads are never executed or served publicly.

## Phase 8 — reminders and worker

- Added IANA timezone validation, DST-aware recurrence and 24-hour WhatsApp service-window policy primitives.
- Persistent leased worker handles webhook, outbound and reminder jobs; capped retries and recovery follow below.
- Outside-window reminders require a configured, Meta-approved template.

## Phase 9 — dashboard

- Implemented all 14 navigation pages, responsive charcoal/green design, Supabase sign-in, mode filters, paginated real data and empty states.
- CRUD forms for contacts, memories, tasks, notes, reminders, business profile and FAQs; real permissions, document upload/approval/QA/download/delete.
- Inbox with queued WhatsApp replies, private streaming AI playground, usage charts, user-supplied cost estimates, audit/job views and recovery.
- Account phone linking requires a WhatsApp-delivered OTP; profile edits cannot bypass it.
- Missing credentials show setup instructions, never fabricated analytics or conversation records.

## Phase 10 — security, verification and deployment preparation

- Added HTTP integration, schema/security, actual SQL-engine migration/RLS/queue, agent boundary, and tool confirmation tests.
- 61 tests currently passing; TypeScript and production builds pass.
- Browser smoke checks navigate all 14 routes at 1440px and 390px, exercise a form and setup guidance; no runtime errors/page overflow.
- npm audit reports zero known vulnerabilities after SDK-compatible Zod, UUID, Vite and test-runner updates.
- Added Docker, Railway API/worker configs and CI workflow. No external deployment performed.
- Hardened archive expansion, service windows, verified personal recipients, bounded tool recursion, confirmation replay, transport delivery IDs and request-scoped tool idempotency.
- Production acceptance remains blocked: external credentials/approvals, hosted Supabase migration/Auth/Storage tests and live end-to-end messages. See VERIFICATION_REPORT.md and README.md.

## Final verification snapshot

- All ten phases have implementation artifacts; no phase is claimed externally validated.
- Added regression protection for default-valued partial updates, scoped live overview filters and a real contact recipient selector.
- Production Vite output is split into application, React and Supabase chunks.
- Final release gate and exact blockers: `VERIFICATION_REPORT.md`.
