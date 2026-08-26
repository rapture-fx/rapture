#!/usr/bin/env bash
set -euo pipefail

REPO="."
LIMIT=30

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if ! git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not a git repository: $REPO" >&2
  exit 2
fi

# Prefer gh CLI when available; fall back to git log for commit-based window
if command -v gh >/dev/null 2>&1 && gh pr list --help >/dev/null 2>&1; then
  echo "Using gh CLI to enumerate last $LIMIT PRs" >&2
  gh pr list --limit "$LIMIT" --json number,baseRefOid,headRefOid,url,title --jq '.' > /tmp/rapture-prs.json 2>/dev/null || true
  if [[ -s /tmp/rapture-prs.json ]] && command -v jq >/dev/null 2>&1; then
    echo "[" >&2
    FIRST=1
    jq -c '.[]' /tmp/rapture-prs.json | while read -r pr; do
      BASE=$(echo "$pr" | jq -r '.baseRefOid')
      HEAD_SHA=$(echo "$pr" | jq -r '.headRefOid')
      NUM=$(echo "$pr" | jq -r '.number')
      if [[ "$FIRST" -eq 0 ]]; then echo ","; fi
      FIRST=0
      node apps/cli/dist/index.js verify --repo "$REPO" --base "$BASE" --candidate "$HEAD_SHA" --json 2>/dev/null | jq -c --arg num "$NUM" '. + {pr: ($num|tonumber)}'
    done
    echo "]"
    exit 0
  fi
fi

# Fallback: recent commit window (no gh/jq) — still exercises the same CLI/core path
echo "gh not available; falling back to last $LIMIT commits" >&2
BASE=$(git -C "$REPO" merge-base HEAD~"$LIMIT" HEAD 2>/dev/null || git -C "$REPO" rev-parse "HEAD~$LIMIT" 2>/dev/null || echo "")
if [[ -z "$BASE" ]]; then
  echo "unable to determine base for fallback window" >&2
  exit 2
fi
node apps/cli/dist/index.js scan --repo "$REPO" --base "$BASE" --head HEAD --json 2>/dev/null | jq '.findings | map({pr: .commit, verdict, signals})' 2>/dev/null || cat
