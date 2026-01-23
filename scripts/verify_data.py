#!/usr/bin/env python3
"""
Verify the completeness of generated data.
Checks that all codes have commit data and detail files.
"""

import json
import os
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
DATA_DIR = PROJECT_DIR / "data"
COMMITS_DIR = DATA_DIR / "commits"
DETAILS_DIR = DATA_DIR / "details"

def get_commit_codes():
    """Get list of codes that have commit data."""
    if not COMMITS_DIR.exists():
        return []

    codes = []
    for file in sorted(COMMITS_DIR.glob("*.json")):
        codes.append(file.stem)
    return codes

def get_detail_codes():
    """Get list of codes that have detail data."""
    if not DETAILS_DIR.exists():
        return []

    codes = []
    for dir in sorted(DETAILS_DIR.iterdir()):
        if dir.is_dir():
            codes.append(dir.name)
    return codes

def get_detail_count(code_name):
    """Get count of detail files for a code."""
    detail_dir = DETAILS_DIR / code_name
    if not detail_dir.exists():
        return 0
    return len(list(detail_dir.glob("*.json.gz")))

def get_commit_count(code_name):
    """Get count of commits for a code."""
    commit_file = COMMITS_DIR / f"{code_name}.json"
    if not commit_file.exists():
        return 0

    try:
        with open(commit_file, 'r', encoding='utf-8') as f:
            commits = json.load(f)
            return len(commits)
    except Exception:
        return 0

def get_code_display_name(code_name):
    """Get display name for a code (fallback to formatted name)."""
    # Format: code_civil -> Code Civil
    display = code_name.replace("_", " ")
    return display.title()

def main():
    print("=== Verifying Data Completeness ===\n")

    # Get all codes
    commit_codes = set(get_commit_codes())
    detail_codes = set(get_detail_codes())

    print(f"Codes with commit data: {len(commit_codes)}")
    print(f"Codes with detail data: {len(detail_codes)}")
    print()

    # Find codes with missing details
    missing_details = commit_codes - detail_codes
    print(f"Codes missing details: {len(missing_details)}")

    if missing_details:
        print("\nCodes missing detail files:")
        for code in sorted(missing_details):
            commit_count = get_commit_count(code)
            print(f"  - {code}: {commit_count} commits")

    # Check detail completeness
    print("\n=== Detail File Completeness ===")
    incomplete_codes = []

    for code in sorted(detail_codes):
        commit_count = get_commit_count(code)
        detail_count = get_detail_count(code)

        if detail_count < commit_count:
            incomplete_codes.append((code, commit_count, detail_count))
            print(f"  {code}: {detail_count}/{commit_count} details ({detail_count*100//commit_count if commit_count > 0 else 0}%)")
        else:
            print(f"  {code}: {detail_count}/{commit_count} details (100%)")

    if incomplete_codes:
        print(f"\n{len(incomplete_codes)} codes have incomplete details")
    else:
        print("\nAll codes with details are complete!")

    # Update repos.json
    print("\n=== Updating repos.json ===")
    repos = []
    for code in sorted(commit_codes):
        repos.append({
            "name": code,
            "displayName": get_code_display_name(code)
        })

    repos_file = DATA_DIR / "repos.json"
    with open(repos_file, 'w', encoding='utf-8') as f:
        json.dump(repos, f, ensure_ascii=False, indent=2)

    print(f"Updated {repos_file} with {len(repos)} codes")

    # Summary
    print("\n=== Summary ===")
    print(f"Total codes: {len(commit_codes)}")
    print(f"Codes with complete details: {len(detail_codes) - len(incomplete_codes)}")
    print(f"Codes with incomplete details: {len(incomplete_codes)}")
    print(f"Codes with no details: {len(missing_details)}")

    if missing_details or incomplete_codes:
        print("\n⚠️  Some codes are missing or have incomplete detail files")
        print("Run update_codes.sh and generate_data.py to regenerate missing data")
        return 1
    else:
        print("\n✓ All data is complete!")
        return 0

if __name__ == "__main__":
    exit(main())
