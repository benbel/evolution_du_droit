#!/usr/bin/env python3
"""
Generate static JSON data from cloned legal code repositories.
Uses git diff directly for fast diff computation.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
CODES_DIR = PROJECT_DIR / "codes"
DATA_DIR = PROJECT_DIR / "data"


def run_git(repo_path: Path, *args, timeout=30) -> str:
    """Run a git command and return output."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result.stdout.strip()
    except Exception as e:
        return ""


def format_code_name(name: str) -> str:
    """Format repository name for display."""
    display = name.replace("_", " ")
    return display[0].upper() + display[1:] if display else display


def get_repos() -> list:
    """Get list of all repositories."""
    repos = []
    if not CODES_DIR.exists():
        return repos

    for item in sorted(CODES_DIR.iterdir()):
        if item.is_dir() and (item / ".git").exists():
            repos.append({
                "name": item.name,
                "displayName": format_code_name(item.name)
            })
    return repos


def get_commits(repo_path: Path) -> list:
    """Get all commits for a repository."""
    log_output = run_git(repo_path, "log", "--format=%H|%aI|%s", "--all", timeout=60)

    commits = []
    for line in log_output.split("\n"):
        if not line.strip():
            continue
        parts = line.split("|", 2)
        if len(parts) >= 3:
            sha, date_str, message = parts
            commits.append({
                "sha": sha[:12],
                "date": date_str.split("T")[0],
                "message": message[:300]
            })

    commits.sort(key=lambda x: x["date"], reverse=True)
    return commits


def get_commit_diff(repo_path: Path, sha: str) -> dict:
    """Get diff for a commit using git diff."""
    # Get commit message
    message = run_git(repo_path, "log", "-1", "--format=%s", sha)
    date = run_git(repo_path, "log", "-1", "--format=%aI", sha).split("T")[0]

    # Get changed files
    files_output = run_git(repo_path, "diff-tree", "--no-commit-id", "-r", "--name-status", sha)

    files = []
    for line in files_output.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if len(parts) == 2:
            status_code, filename = parts
            status = "added" if status_code == "A" else "deleted" if status_code == "D" else "modified"
            files.append({"status": status, "filename": filename})

    # Get unified diff
    diff_output = run_git(repo_path, "diff", f"{sha}^..{sha}", "--", timeout=60)

    # Parse diff into structured format
    file_diffs = parse_unified_diff(diff_output, files)

    # Calculate stats
    total_add = sum(f.get("additions", 0) for f in file_diffs)
    total_del = sum(f.get("deletions", 0) for f in file_diffs)

    return {
        "sha": sha[:12],
        "date": date,
        "message": message,
        "files": file_diffs,
        "stats": {
            "additions": total_add,
            "deletions": total_del,
            "filesChanged": len(file_diffs)
        }
    }


def parse_unified_diff(diff_text: str, files_info: list) -> list:
    """Parse unified diff output into structured format."""
    file_diffs = []
    current_file = None
    current_diff = []
    additions = 0
    deletions = 0

    for line in diff_text.split("\n"):
        if line.startswith("diff --git"):
            # Save previous file
            if current_file:
                file_diffs.append({
                    "filename": current_file,
                    "additions": additions,
                    "deletions": deletions,
                    "diff": current_diff
                })

            # Extract filename
            parts = line.split(" b/")
            current_file = parts[-1] if len(parts) > 1 else None
            current_diff = []
            additions = 0
            deletions = 0

        elif current_file and line.startswith("+") and not line.startswith("+++"):
            additions += 1
            current_diff.append({"type": "add", "content": line[1:]})

        elif current_file and line.startswith("-") and not line.startswith("---"):
            deletions += 1
            current_diff.append({"type": "del", "content": line[1:]})

        elif current_file and not line.startswith("@@") and not line.startswith("\\"):
            if line:
                current_diff.append({"type": "unchanged", "content": line[1:] if line.startswith(" ") else line})

    # Save last file
    if current_file:
        file_diffs.append({
            "filename": current_file,
            "additions": additions,
            "deletions": deletions,
            "diff": current_diff
        })

    # Add status from files_info
    files_dict = {f["filename"]: f["status"] for f in files_info}
    for fd in file_diffs:
        fd["status"] = files_dict.get(fd["filename"], "modified")

    return file_diffs


def main():
    print("=== Generating static data ===")

    DATA_DIR.mkdir(exist_ok=True)
    commits_dir = DATA_DIR / "commits"
    commits_dir.mkdir(exist_ok=True)
    details_dir = DATA_DIR / "details"
    details_dir.mkdir(exist_ok=True)

    repos = get_repos()
    print(f"Found {len(repos)} repositories")

    if not repos:
        print("No repositories found! Run update_codes.sh first.")
        sys.exit(1)

    # Save repos index
    with open(DATA_DIR / "repos.json", "w", encoding="utf-8") as f:
        json.dump(repos, f, ensure_ascii=False, indent=2)
    print("Created data/repos.json")

    for idx, repo in enumerate(repos):
        repo_name = repo["name"]
        repo_path = CODES_DIR / repo_name

        print(f"\n[{idx+1}/{len(repos)}] {repo_name}")

        commits = get_commits(repo_path)
        print(f"  {len(commits)} commits")

        if not commits:
            continue

        # Save commits index
        with open(commits_dir / f"{repo_name}.json", "w", encoding="utf-8") as f:
            json.dump(commits, f, ensure_ascii=False)

        # Generate detailed data for recent commits only
        repo_details_dir = details_dir / repo_name
        repo_details_dir.mkdir(exist_ok=True)

        recent = commits[:50]  # Only 50 most recent
        for i, commit in enumerate(recent):
            if (i + 1) % 10 == 0:
                print(f"  Commit {i+1}/{len(recent)}...")

            try:
                detail = get_commit_diff(repo_path, commit["sha"])
                with open(repo_details_dir / f"{commit['sha']}.json", "w", encoding="utf-8") as f:
                    json.dump(detail, f, ensure_ascii=False)
            except Exception as e:
                print(f"  Error on {commit['sha']}: {e}")

    print("\n=== Done! ===")


if __name__ == "__main__":
    main()
