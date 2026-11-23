# AGENTS.md: rules for coding agents working on Pendix

## What this repo is
Pendix is a fork of OpenCode (MIT) with a paid learning layer: grading, notes, assessments, teach mode, groups and human mentors. SPEC.md is the source of truth for behaviour. ENGINE-NOTES.md maps the forked engine.

## Before you start any task
1. Read this file, SPEC.md (at least the sections the task names) and ENGINE-NOTES.md if you touch the engine.
2. Read AGENTS.upstream.md before editing upstream engine code and follow its conventions there.
3. Restate the task in two sentences and list the files you expect to touch. Then work.

## Hard rules
- Do only what the task asks. No drive-by refactors. No new dependencies without saying why.
- Keep engine changes small and isolated (hooks, not rewrites) so upstream merges stay easy.
- Never call OpenCode's own servers. Never add telemetry.
- Never log or store secrets, file contents, command arguments, card data, account numbers or full dates of birth.
- Every value that is a price, plan, model id, colour or rubric item comes from @pendix/shared. Never hard-code them elsewhere.
- Money is in integer cents. Never floats.
- Ledgers (credits, earnings) are insert-only.
- Every webhook is verified and idempotent. Never trust a webhook body for amounts; verify with Flutterwave.
- Payments are Flutterwave only.
- Teen rules in SPEC S6 are never relaxed for convenience. If a task seems to conflict with S6, stop and ask.
- Writing in the UI and emails: plain English, short sentences, no em dashes or en dashes.
- Brand: neutral first (ink, off-black, white, off-white). Hot orange #FF5A1F only for focus, the single main action and score badges.

## The Test Loop (every task)
1. Write the tests the task names first.
2. Run them and confirm they fail for the right reason.
3. Write the code.
4. Run the full test suite for every package you touched.
5. Fix and rerun until everything passes. Never delete or weaken a test to make it pass; if a test is wrong, explain why before changing it.
6. Run lint and typecheck for touched packages.
7. Paste the real terminal output of the test, lint and typecheck commands. Never summarise instead of pasting.
8. Go through the task's DONE WHEN list and say how each item is proven (test name or output line).
9. Commit with the commit message the task gives, then run `git push`. If the push fails, show the error and stop.

## Tests
- Unit and integration: Vitest (or the upstream runner inside upstream packages).
- Web end to end: Playwright.
- Extension: @vscode/test-electron.
- No real network in tests: use fakes for models (FakeModel), Flutterwave, Resend and storage. The only exception is pnpm golden:check, which is run on purpose.

## Golden data
golden/golden-prompts.json holds 40 human-graded prompts. Fields: id, prompt, context_note, scores, total, reason, worked_example, mentor_test. The 6 with worked_example true may appear as examples in grading instructions and must never be used to test the grader. The 20 with mentor_test true form the mentor applicant test. Never show their scores to an applicant.
- Tests that use time use a fake clock.
- Cloud tests use the test database with a fresh schema per file.

## Commits
One task, one commit, using the message the task gives, then push. Never commit .env files or keys.

## When stuck
After three failed attempts at the same problem, stop, explain what you tried and what you think is wrong, and wait.