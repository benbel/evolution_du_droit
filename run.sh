#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

python3 scripts/build_data.py

rm -rf _site
mkdir -p _site
cp -r index.html .nojekyll css js data _site/
echo "Done: _site/"
