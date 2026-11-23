#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-dev}"
SYNC_BRANCH="${1:-upstream-sync-$(date +%Y%m%d)}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script from inside the git repository." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash your changes first." >&2
  exit 1
fi

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "Error: git remote '$UPSTREAM_REMOTE' does not exist." >&2
  echo "Add it with: git remote add $UPSTREAM_REMOTE https://github.com/anomalyco/opencode.git" >&2
  exit 1
fi

echo "Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..."
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

if git show-ref --verify --quiet "refs/heads/$SYNC_BRANCH"; then
  echo "Error: branch '$SYNC_BRANCH' already exists. Pass a different branch name as the first argument." >&2
  exit 1
fi

echo "Creating sync branch '$SYNC_BRANCH'..."
git checkout -b "$SYNC_BRANCH"

echo "Merging $UPSTREAM_REMOTE/$UPSTREAM_BRANCH into $SYNC_BRANCH..."
if ! git merge "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" --no-edit; then
  echo ""
  echo "Merge stopped due to conflicts."
  echo "Conflicted files:"
  git diff --name-only --diff-filter=U
  echo ""
  echo "Resolve conflicts following UPSTREAM.md, then run:"
  echo "  bun install"
  echo "  git add -A && git merge --continue"
  echo "  bun scripts/check-branding.ts"
  echo "  GITHUB_ACTIONS=false bun turbo test --concurrency=3"
  exit 2
fi

echo "Merge completed cleanly. Reinstalling dependencies and checking branding..."
bun install
bun scripts/check-branding.ts
bun run --cwd packages/cli test test/pendix-rebrand.test.ts
bun run --cwd packages/core test test/pendix-rebrand.test.ts

echo ""
echo "Upstream sync on '$SYNC_BRANCH' succeeded."
echo "Run the full test suite before merging into dev:"
echo "  GITHUB_ACTIONS=false bun turbo test --concurrency=3 && bun run lint && bun run typecheck"
