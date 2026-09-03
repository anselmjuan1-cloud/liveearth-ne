#!/usr/bin/env bash
# Clone the orphan `data` branch into _data so workers can read prior state.
# If the branch does not exist yet (first ever run), start empty.
set -euo pipefail
BRANCH="${DATA_BRANCH:-data}"
rm -rf _data
if git clone --depth 1 --branch "$BRANCH" \
     "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" _data 2>/dev/null; then
  echo "fetched existing $BRANCH branch"
else
  echo "$BRANCH branch does not exist yet; starting fresh"
  mkdir -p _data
fi
