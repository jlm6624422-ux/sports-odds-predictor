#!/bin/bash
# Grade yesterday's bets and push updated tracker to Railway
# Cron: 0 7 * * * (7 UTC = 2am CT)

set -e
cd "$(dirname "$0")"

echo "[$(date)] Starting daily grading..."

node grade-daily.js

echo "[$(date)] Committing and pushing to Railway..."

gh auth switch --user jlm6624422-ux 2>/dev/null || true

git add -A
if git diff --cached --quiet; then
  echo "[$(date)] No changes to commit"
else
  git commit -m "Grade results: $(date -d 'yesterday' +%Y-%m-%d)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  git push origin master
  echo "[$(date)] Pushed to Railway"
fi

echo "[$(date)] Done."
