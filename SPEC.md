# Pendix product spec

## S1. Product
Pendix is a coding agent (fork of OpenCode) that people use to build real apps, plus a paid learning layer. Users pick models from the Models.dev list, bring their own keys or use free models. Pendix never resells model access. Surfaces: terminal app, editor extension (VS Code, Cursor, Antigravity), MCP server and hooks for Claude Code and Codex, web dashboard, cloud backend. No desktop app. Audience: anyone learning to build with AI, solo or through a bootcamp, school, company or study group, worldwide.

## S2. Brand
Colours: ink #0A0A0A (primary), off-black #1C1C1C, white #FFFFFF, off-white #F6F5F2 (most used background), line #E4E2DD, muted #6B6862, hot orange #FF5A1F (accent), orange tint #FFF1EB.
Rules: neutral first. Orange only for focus rings, the one main action per screen, score badges, the logo dot and the teach mode tag. Fonts: Inter (UI), JetBrains Mono (code). Radius 10px. Logo: lowercase "pendix" preceded by an orange dot. Voice: plain English, short sentences, calm, no hype, no em dashes or en dashes.

## S3. Architecture
Terminal app (forked engine + @pendix/recorder + teach mode + sign-in gate) on the user's machine. Code and keys stay local. Cloud: Hono API and worker on Bun, Postgres via Drizzle, Better Auth, Postgres job queue, Resend email, S3-compatible private storage, Sentry. Web dashboard: React + Vite. Grading via Vercel AI SDK with Google and DeepSeek providers. Hosting: one VPS with Docker Compose and Caddy. Domains: pendix.dev (landing, install scripts), app.pendix.dev (dashboard), api.pendix.dev (API).

## S4. Accounts and sign-in
Everyone needs an account before the agent runs. Sign-up: email and password or Google, email verification, display name, date of birth, terms and privacy acceptance (versioned). Terminal, extension and MCP sign in through a device flow: user code shown in terminal, approved in the browser, device token stored in OS keychain or a 600-permission file. Devices listed and revocable. Offline: agent runs with a /me cache up to 7 days old; paid features need the cloud. Account deletion removes all data.

## S5. Age
accountKindFor(dob): under 15 blocked (nothing stored), 15 to 17 teen, 18+ adult. Date of birth is self-declared. Daily job converts teens to adults on their 18th birthday and emails both user and guardian. Mentors must be adults.

## S6. Teen accounts (15 to 17)
1. Guardian approval required before the account works. Guardian email must differ from the teen's. Approval link expires in 7 days. Decline deletes the teen's data.
2. Guardian pays for anything paid. Teens see no purchase buttons.
3. Mentors see only the teen's display name and time zone. Never real name, email, photo, date of birth, school or city.
4. Messages: text only, inside Pendix. Phone numbers, emails, URLs, domains and social handles (including spelled-out numbers and phrases like "whatsapp me") are blocked, not delivered, and flagged to admin.
5. All teen threads stored; guardian can read (not post).
6. No one-to-one live calls. Mentors send recorded feedback. A guardian may request a call that the guardian attends.
7. Only mentors with the teen badge (extra reference check, safeguarding training, ID verified) are matched with teens.
8. Public skill record requires guardian approval and shows display name only.
9. No marketing emails to teens.
10. Guardians can pause or close the account and withdraw consent.
11. Teen data is excluded from grader training exports.

## S7. Grading
Rubric, five criteria scored 0 to 2:
- goal: 0 no clear outcome, 1 outcome stated but vague, 2 clear specific outcome.
- context: 0 none, 1 some with gaps, 2 the files, stack and current state the agent needs.
- constraints: 0 none, 1 some limits, 2 clear limits (what not to touch, versions, style).
- verification: 0 no way to check, 1 vague check, 2 concrete test or observable result.
- steps: 0 one giant ask, 1 partly broken down, 2 sensible order or scoped to one step.
Per prompt: scores, one-line reasons, total 0 to 10, improved prompt, confidence 0 to 1. Per session: understanding score 0 to 10 with reason (separate from prompt skill, never combined), and notes under 250 words (what was built, three things learned, two to work on). Batches of 15 prompts. Golden data: golden/golden-prompts.json (40 prompts; 6 marked worked_example, 20 marked mentor_test). Golden pass rule: per criterion at least 80% exact match with human grades and at most 5% off by two, for both model tiers, on the 34 prompts that are not worked examples. Mentor corrections are stored alongside, never overwrite AI grades.

## S8. Plans, prices and entitlements
Free: agent, model list, own keys, free models, teach mode. Credits: pack of 3 for 200 cents, pack of 10 for 500 cents; session grade costs 1 credit, assessment 2. Solo: monthly 1000, two-month 1500 (one-off, 60 days), yearly 7200. Mentored: monthly 2500, two-month 4500, yearly 24000. Subscriptions include grading, notes and assessments up to a fair use cap of 100 graded sessions per month, then credits apply. Group discounts: 5 to 19 seats 15%, 20+ seats 25%. Refunds within 7 days of first payment. Upgrades prorated by days. NGN prices set manually by admin config for Nigerian users. All amounts in integer cents.

## S9. Grading models
Tier credit: primary DeepSeek deepseek-flash, fallback Gemini Flash (current Flash model id in config). Tier subscriber: primary Gemini gemini-4-argon, fallback DeepSeek deepseek-v4-pro. All ids in @pendix/shared models.ts with environment overrides. Retry once, then fallback. 60-second timeout. Record the model used on every result. Admin can route teen and EU users to Gemini-only via config.

## S10. Data model (minimum tables)
users (id, email, display_name, dob, account_kind, status, country, tz, role, created_at), consents, guardians (guardian_user_id or email, teen_user_id, approved_at), devices (hashed tokens), sessions (user, source terminal|claude-code|codex|other, project_title, model, status, tier, graded_at), session_records (redacted JSON), grades (per prompt), corrections, session_notes, understanding_scores, assessments, assessment_answers, credit_ledger, payments (tx_ref, flutterwave ids, amount, currency, status), billing_plans, subscriptions, groups, group_members, group_invites, mentors (status, capacity, teen_badge, rating, stacks, tz, payout details encrypted), mentor_applications, mentor_tests, matches, reviews, messages, message_flags, feedback_files, calls, ratings, earnings_ledger, payouts, skill_records, endorsements, jobs, audit_log.

## S11. Environment variables
DATABASE_URL, TEST_DATABASE_URL, NODE_ENV, API_URL, WEB_URL, AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, EMAIL_FROM, FLW_PUBLIC_KEY, FLW_SECRET_KEY, FLW_ENCRYPTION_KEY, FLW_WEBHOOK_HASH, GOOGLE_GENERATIVE_AI_API_KEY, DEEPSEEK_API_KEY, PENDIX_GRADER_CREDIT_PRIMARY, PENDIX_GRADER_CREDIT_FALLBACK, PENDIX_GRADER_SUBSCRIBER_PRIMARY, PENDIX_GRADER_SUBSCRIBER_FALLBACK, STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, PAYOUT_ENCRYPTION_KEY, SENTRY_DSN_API, SENTRY_DSN_WEB, RATE_LIMIT_*, NGN_PRICES_JSON.

## S12. Recording and privacy
Recorded locally: prompts, turn summaries (tool names and counts, files changed with line counts, command names only, errors, first 500 characters of reply), teach Q&A, model, timings. Never: file contents, env values, command arguments, keys. Redaction runs client side and again server side. Upload only with grading consent and entitlement. Local records deleted 30 days after upload. Max record 2 MB.

## S13. Teach mode
Free for all. Explains before and after changes, asks a check question every two or three turns, never withholds code, adapts to level. Toggle by shortcut or /teach. Locks: self (learner, unlock from dashboard) and class (instructor). Not available inside Claude Code or Codex.

## S14. Emails
Resend with React Email, brand styling. Session report (score, understanding, two weakest prompts with improved versions, notes, link). Weekly assessment ready. Billing receipts and renewal reminders. Mentor match, review reminders, message digests (max one per hour). Guardian approval and notices. Users can turn off session reports. No marketing to teens.

## S15. Payments
Flutterwave only. Standard checkout for one-off payments (credits, two-month plans, groups, prorations). Payment plans for recurring Solo and Mentored monthly and yearly. Webhooks verified by secret hash, then confirmed with the verify transaction endpoint, idempotent by transaction. Redirect page uses the same verification. Failed renewal: 3-day grace, then free. Cancel keeps access to period end. Mentor payouts by Flutterwave transfers after admin approval on the 5th of each month, idempotent references, failed transfers roll over. Mentor countries limited to those Flutterwave can pay.

## S16. Groups
Roles: owner, instructor, member. Owner buys seats (Solo or Mentored) with group discounts, invites by email, sets grade_visibility (owner_only, owner_and_member, member_decides) and teach_lock, assigns instructors, switches seats between Solo and Mentored, removes members. Instructors use the same review queue as mentors. Groups with instructors normally buy Solo seats; Mentored seats get Pendix mentors (renting mentors).

## S17. Assessments
Weekly, Saturday 09:00 learner time, for learners with 2+ graded sessions that week. Five questions from the learner's own work (2 why, 1 what would break, 1 how to check, 1 multiple choice). Marked 0 to 2 each, total 10, with feedback. Subscribers free, credit users 2 credits on open with confirmation. Due in 7 days. Visible to mentor and, if visibility allows, instructor.

## S18. Dashboard
Learner: home, sessions, session detail, assessments, credits and billing, settings, skill record, messages, mentor. Group owner and instructor: members, invites, settings, seats, review queue. Mentor: learners, review queue, messages, feedback uploads, calls, earnings, profile. Guardian: linked teens, activity, messages read-only, approvals, billing, pause or close. Admin: mentor pipeline, flags, users, refunds, payouts, audit log. Accessibility WCAG AA, keyboard navigation, orange focus rings. Mobile-friendly.

## S19. Mentors
Adults only. Pipeline: application (with ID upload) → grading test on the 20 golden prompts marked mentor_test, pass 80% exact, one retake after 14 days → interview (by admin) → probation (capacity 5, 30 days, pass with rating 4.0+ and spot-check agreement 80%+) → active (capacity 20). Teen badge as S6. Matching: capacity, teen badge, stack, time zone within 3 hours, rating, fewest learners. Learner may rematch once per month; no-mentor periods extend the plan. Weekly review: 10 flagged prompts per learner (lowest totals, lowest confidence, learner-disputed), agree or change each criterion, feedback of 40+ words, due Sunday. Spot checks: 5% blind second review. Messages answered within 48 hours. One 30-minute call per month for adults. Ratings 1 to 5, 90-day average. Pay: 1000 cents per learner per month prorated by matched days, quarter deducted per missed review, refund-flagged learners excluded, paid monthly.

## S20. Admin
Role admin set by script. Mentor pipeline, teen badge checklist, flags (messages, reports, failed jobs), users, credit grants, refunds, payout approval. Every action in audit_log with before and after.

## S21. Skill record
Weekly prompt and understanding trends, assessments, projects (renamed or hidden), approved mentor endorsements, graded session count. Private by default, revocable public link with chosen sections, evidence links to graded sessions (hideable). Teens need guardian approval and show display name only. Public rubric methodology page. No directory or search.

## S22. Editor extension
VS Code, Cursor (Open VSX) and Antigravity (Open VSX). Commands: Pendix: Open (shortcut), Pendix: Add file to prompt. Runs the installed pendix CLI in an editor terminal. Install helper when missing. Status bar with plan and latest score. Sidebar with recent sessions and plan from `pendix whoami --json` and `pendix sessions --json`. Never stores tokens.

## S23. MCP server and hooks
`pendix mcp` stdio server with tools: pendix_status, pendix_start_session, pendix_log_prompt, pendix_log_turn, pendix_end_session, pendix_last_report, pendix_teach_tip. `pendix hook claude-code` handles prompt-submit, stop and session-end events, returns within 300 ms. `pendix connect claude-code | codex` and `pendix disconnect ...` edit settings with backups and are idempotent. Codex uses hooks if supported, else MCP plus an instructions block with a reliability warning. Credit users grade hook sessions only with "always grade" set.

## S24. Distribution
Standalone binaries for macOS arm64 and x64, Windows x64, Linux x64 and arm64. npm package `pendix` with per-platform optional dependencies; `npx pendix` works. install.sh and install.ps1 with checksum verification, served at pendix.dev/install and /install.ps1. Daily update check against api.pendix.dev/releases/latest; `pendix upgrade`. GitHub Actions CI on every push; release on version tags publishes binaries, npm packages and both extension marketplaces. Upstream OpenCode merged every two weeks using UPSTREAM.md.