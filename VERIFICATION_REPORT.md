# NOVA AI — verification and release gate

**Date:** 2026-11-13

**Disposition:** locally verified implementation; **not production-ready or externally certified**.

**Deployment:** none. No paid requests, external account changes, publishing or purchases performed.

## Implemented and tested locally

| Area               | Evidence / scope                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace/build    | Locked npm workspaces; strict TypeScript passes for API, web and shared schemas; Vite production bundle builds. API runs TypeScript with the production `tsx` dependency.                                                                                                                                                                                                                                                     |
| HTTP/API           | Supertest covers liveness and security headers; missing JWT; viewer mutation denial; resource allowlist; tenant-field injection rejection; malformed JSON; explicit delete confirmation; owner-phone assignment protection.                                                                                                                                                                                                   |
| WhatsApp webhooks  | Exact raw-body HMAC tests, malformed/tampered signature rejection, verify-token handshake, signed event enqueue and failure-before-ack behavior. Transport delivery itself is not tested against Meta.                                                                                                                                                                                                                        |
| SQL migration      | Entire migration executes in PGlite, an actual embedded PostgreSQL-compatible engine, with test-only Supabase auth/storage stubs. Tests cover Auth trigger bootstrap, RLS tenant reads/write denial, composite tenant/mode foreign keys, unverified personal contact rejection, OTP linking, atomic webhook dedupe, atomic reply + outbound persistence, job leasing/recovery, reminder enqueue and scoped usage aggregation. |
| Tool safety        | Business personal tools are denied; explicit permission overrides; pending approval before deletion; confirmation query scope/expiry; unknown/invalid tool rejection; recorded-result reuse; uncertain execution replay prevention.                                                                                                                                                                                           |
| Agent control flow | SDK-boundary simulations test Urdu text handling, mode-safe prompt construction, tool-result round trips, deterministic approval instructions, exact human confirmation routing, bounded loop, error propagation and no fabricated success. These are not live Claude tests.                                                                                                                                                  |
| Media              | Magic/type mismatch rejection, download byte limits, excessive archive size rejection, Claude vision/PDF block construction and extraction from a generated real XLSX workbook. Office ZIP expansion is additionally streamed/validated before parsing.                                                                                                                                                                       |
| Scheduling         | Strict 24-hour boundary, future-date and IANA timezone validation, daily DST preservation, weekly scheduling and missed-run advancement.                                                                                                                                                                                                                                                                                      |
| Partial updates    | Regression test prevents Zod defaults from silently resetting omitted mode/status/timezone fields in PATCH requests.                                                                                                                                                                                                                                                                                                          |
| Dashboard browser  | Headless Chromium navigates all 14 pages at 1440 × 1100 and 390 × 844, exercises a task form's truthful no-configuration error and integration instructions, and checks for JavaScript errors/page overflow. Setup mode only, not authenticated/live CRUD.                                                                                                                                                                    |
| Dependency review  | `npm audit --audit-level=moderate`: zero known vulnerabilities in the tested lockfile, including development dependencies. This is a point-in-time dependency check, not a penetration test.                                                                                                                                                                                                                                  |

**Automated suite: 61 tests across 5 files.**

Commands used:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
npm run test:browser
npm run format:check
```

The intentional provider/database failure test emits a sanitized error-level log. That expected log is not a failing test. Browser screenshots are generated in ignored `.artifacts/`; no screenshots, browser binaries or datasets are added to source control.

## Implemented but not externally tested

- Supabase email/password login, JWT verification, session refresh/logout, service-role queries, hosted RLS through PostgREST, private Storage uploads and signed downloads.
- Real Claude Sonnet conversations/tool calling, streaming, summaries, image/PDF analysis, long-term context, and multilingual response quality.
- Meta webhook registration and live payloads, production permissions, text/media/template sending, outgoing voice, delivery callbacks and genuine duplicate/redelivery/crash scenarios.
- STT/TTS provider contracts, supported audio codecs and English/Urdu transcription quality.
- Continuous worker operation against hosted PostgreSQL, recovery under real network outages, provider throttling and recurrence deliveries across an actual clock boundary.
- DOCX extraction is implemented with Mammoth but has not been acceptance-tested using customer documents. Image/PDF processing is tested only at request construction boundaries, not real interpretation quality. XLSX extraction has a real local file test.
- Docker image build, Railway configuration acceptance, proxy/TLS behavior and worker service supervision. Docker is not installed in this workspace. Node production builds and local Express serving were tested, not a container rollout.
- CI configuration is written but no remote GitHub workflow run has been initiated or claimed successful.

## Exact external blockers

| Blocker                           | Required operator action                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase project and keys absent  | Create a project, apply migration, set server URL/service key and public web URL/anon key; create an Auth user and disable public signup for private deployment.                |
| Anthropic key/model access absent | Configure `ANTHROPIC_API_KEY`, confirm Sonnet model access and billing/budget limits.                                                                                           |
| Meta app/WhatsApp account absent  | Configure app secret, access/verify tokens and phone number ID; register HTTPS webhook; obtain required permissions and production access.                                      |
| Approved reminder template absent | Register and obtain Meta approval for a matching one-body-parameter reminder template; enter name/language in Business Profiles.                                                |
| Owner number not linked           | Send an inbound message, then perform dashboard OTP verification on the actual intended owner's phone.                                                                          |
| Speech service absent             | Choose/configure compatible HTTPS STT and optional TTS endpoints, keys/models/voice; test supported languages and formats.                                                      |
| Deployment authorization absent   | Explicitly authorize a Railway staging deployment/account actions before any external creation or rollout.                                                                      |
| Sandbox egress restricted         | Only package registries and GitHub hosts are reachable here. Anthropic, Supabase, Meta and speech endpoints need a permitted staging/runtime environment even after keys exist. |

Do not paste secrets into chat. Set credentials in the deployment/local environment using the README and `.env.example`.

## Live acceptance checklist (remaining release work)

1. Build the Docker image; start API and exactly one worker against a staging Supabase project. Confirm HTTPS, origin, headers and trusted-proxy configuration.
2. Apply the migration on actual Supabase. Verify profile creation, Auth login/refresh/logout, RLS and Storage access as owner, viewer, another tenant, anonymous client and unauthorized client.
3. Complete actual authenticated dashboard CRUD for every page; validate paging, filters, contact recipient selection and error messages. The current contact dropdown deliberately caps at 500 records per mode.
4. Register Meta webhook, receive messages from owner and unknown customer, verify owner by OTP, then prove customer prompts/IDs/confirmations cannot access personal data. Replace the owner number and verify old-number private deliveries are blocked.
5. Run real English/Urdu/Roman Urdu conversations, task tools, safe note search, approved memory operations and summary context. Verify expiring/replayed/foreign confirmations and permission revocation.
6. Upload valid and adversarial images, PDFs, DOCX/XLSX and audio; test STT errors, provider language quality, private downloads, file approvals, document answers and optional spoken responses.
7. Run one-time and daily/weekly reminders inside/outside the 24-hour window. Check API acceptance vs delivery/read/failure events, template restrictions, DST cases, cancellation, lease expiry and manual recovery.
8. Simulate worker termination before/after provider sends, database/provider outages, repeated callbacks and long files. Document at-least-once duplicate behavior before allowing retries in production.
9. Review actual provider costs, model/Graph API versions, language quality, privacy policy and retention obligations with the operator.
10. Complete the hardening items below, assess residual risks, and obtain explicit rollout authorization.

## Remaining engineering / production hardening

- Add malware scanning and resource-isolated document parsing. Current size, MIME, ZIP and stream limits are not a complete defense against malicious Office/PDF content.
- Add spend quotas, abuse controls per WhatsApp sender/tenant, distributed rate limiting if scaling API replicas, and operational alerts/worker readiness monitoring.
- Add automatic retention/export/tenant deletion workflows and backup/restore drills. Current data remains until explicitly deleted; webhook raw payloads are private to the service role but still need a retention policy.
- One worker is the supported initial topology. Add per-conversation locks/ordering before horizontal workers. Transport calls cannot guarantee exactly-once delivery; provider acceptance followed by a crash can duplicate a message. Request-scoped tool argument deduplication does not guarantee semantic exactly-once behavior across different model arguments.
- API/worker calls, storage operations and audit writes are not one global transaction. Some partial failures require inspecting the protected job/tool logs. Unknown/unmapped WhatsApp endpoint failures have no tenant and require operator investigation.
- Account model is one owner/viewer tenant per Auth user, one business endpoint per tenant. Shared multi-seat organizations, richer CRM lead qualification, vector document indexing and arbitrary automation are not included.
- Local browser verification covers setup states only. Add configured staging browser tests for login, every CRUD action, streaming and real media/reminder flows before claiming full end-to-end functionality.

## Deliverable inventory

Source code, API, worker, React dashboard, shared validations, database migration/RLS, tool registry, memory/media/voice/reminder integrations, test suite, `.env.example`, Dockerfile, Railway API/worker configuration, CI workflow, detailed README, phase ledger and this report are present in the repository. The live local preview is intentionally unconfigured. **Implemented is not the same as externally tested or production-approved.**
