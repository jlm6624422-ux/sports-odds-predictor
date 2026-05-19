#!/bin/bash
# Daily prediction + full page build + deploy
# Cron: 0 11 * * * (11 UTC = 7am ET)
# Generates MLB picks, NBA analysis, parlays, and pushes to Railway

set -e
cd "$(dirname "$0")"

echo "[$(date)] Starting daily update..."

# Generate full picks page (MLB + NBA + parlays + HTML)
node generate-daily.js

echo "[$(date)] Page generated. Committing and pushing..."

# Ensure correct GitHub account
gh auth switch --user jlm6624422-ux 2>/dev/null || true

# Git commit and push
git add -A
if git diff --cached --quiet; then
  echo "[$(date)] No changes to commit"
else
  git commit -m "Daily update: $(date +%Y-%m-%d) predictions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  git push origin master
  echo "[$(date)] Pushed to GitHub (Railway auto-deploying)"
fi

echo "[$(date)] Daily update complete."
