#!/bin/bash
# Script to download/update all legal codes from git.tricoteuses.fr
# Run this script periodically to keep the codes up to date

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CODES_DIR="$PROJECT_DIR/codes"
DATA_DIR="$PROJECT_DIR/data"
API_URL="https://git.tricoteuses.fr/api/v1"
ORG="codes"

# Create directories
mkdir -p "$CODES_DIR"
mkdir -p "$DATA_DIR"

echo "=== Fetching repository list ==="

# Fetch all repositories (paginated)
REPO_NAMES=""
PAGE=1
while true; do
    echo "Fetching page $PAGE..."
    PAGE_JSON=$(curl -s "$API_URL/orgs/$ORG/repos?limit=50&page=$PAGE")
    PAGE_REPOS=$(echo "$PAGE_JSON" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)

    if [ -z "$PAGE_REPOS" ]; then
        break
    fi

    REPO_NAMES="$REPO_NAMES $PAGE_REPOS"
    PAGE=$((PAGE + 1))
done

# Sort and dedupe
REPO_NAMES=$(echo "$REPO_NAMES" | tr ' ' '\n' | sort -u | grep -v '^$')

# Count repos
REPO_COUNT=$(echo "$REPO_NAMES" | wc -l)
echo "Found $REPO_COUNT repositories"

# Clone or update each repo
CURRENT=0
for REPO in $REPO_NAMES; do
    CURRENT=$((CURRENT + 1))
    REPO_PATH="$CODES_DIR/$REPO"

    echo ""
    echo "=== [$CURRENT/$REPO_COUNT] $REPO ==="

    if [ -d "$REPO_PATH/.git" ]; then
        echo "Updating existing repo..."
        cd "$REPO_PATH"
        git fetch --all --quiet
        git reset --hard origin/main --quiet 2>/dev/null || git reset --hard origin/master --quiet 2>/dev/null || true
        cd "$PROJECT_DIR"
    else
        echo "Cloning new repo..."
        git clone --quiet "https://git.tricoteuses.fr/$ORG/$REPO.git" "$REPO_PATH"
    fi
done

echo ""
echo "=== Generating index data ==="

# Generate commits index for each repo
python3 "$SCRIPT_DIR/generate_data.py"

echo ""
echo "=== Done! ==="
echo "Codes are in: $CODES_DIR"
echo "Data index is in: $DATA_DIR"
