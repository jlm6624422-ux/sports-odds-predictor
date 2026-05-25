#!/bin/bash
# Daily prediction + full page build + deploy
# Cron: 0 9 * * * (9 UTC = 5am ET)
# Generates MLB picks, NBA analysis, parlays, and pushes to Railway

set -e
cd "$(dirname "$0")"

echo "[$(date)] Starting daily update..."

# NOTE: Pages are now dynamic (fetch from API on load).
# Do NOT run generate-daily.js — it used to overwrite HTML with static content.
# The Railway app's built-in cron at 10am ET handles predictions.
# This script is only needed if you want to manually trigger a data refresh.
echo "[$(date)] Pages are dynamic — skipping HTML generation."

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
