#!/usr/bin/env bash
# Commit _out/*.json to the orphan `data` branch.
# vercel.json disables deployments for this branch, so these commits never
# consume the Hobby plan's 100 deploys/day.
set -euo pipefail
BRANCH="${DATA_BRANCH:-data}"
REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

if [ ! -d _out ] || [ -z "$(ls -A _out 2>/dev/null)" ]; then
  echo "nothing in _out to publish"; exit 0
fi

if [ ! -d _data/.git ]; then
  rm -rf _data && mkdir -p _data
  git -C _data init -q
  git -C _data checkout -q --orphan "$BRANCH"
  git -C _data remote add origin "$REMOTE"
fi

cp _out/*.json _data/
git -C _data config user.name "liveearth-bot"
git -C _data config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C _data add -A

if git -C _data diff --cached --quiet; then
  echo "no data changes"; exit 0
fi

git -C _data commit -q -m "data: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git -C _data push -q origin "HEAD:$BRANCH"
echo "published to $BRANCH"
