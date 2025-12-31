#!/usr/bin/env python3
"""
Generate static JSON data from cloned legal code repositories.
Uses git diff directly for fast diff computation.
Falls back to Forgejo API when local repos are unavailable.
Strips metadata, handles HTML tags, and formats diffs by article.
"""

import gzip
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
CODES_DIR = PROJECT_DIR / "codes"
DATA_DIR = PROJECT_DIR / "data"

# Forgejo API configuration
FORGEJO_BASE = "https://git.tricoteuses.fr"
API_BASE = f"{FORGEJO_BASE}/api/v1"
ORG = "codes"

# Metadata patterns to strip from diffs
METADATA_PATTERNS = [
    r'^Nature:\s*',
    r'^Numéro:\s*',
    r'^Type:\s*',
    r'^État:\s*',
    r'^Date de début:\s*',
    r'^Date de fin:\s*',
    r'^Identifiant:\s*',
    r'^Ancien identifiant:\s*',
    r'^URL:\s*',
    r'^Origine:\s*',
    r'^NOTA:\s*$',  # Just the header, keep content
    r'^Liens relatifs à cet article\s*$',
    r'^Cite:\s*$',
    r'^Cité par:\s*$',
    r'^Anciens textes:\s*$',
    r'^Nouveaux textes:\s*$',
]

METADATA_REGEX = re.compile('|'.join(METADATA_PATTERNS), re.IGNORECASE)


def is_metadata_line(content: str) -> bool:
    """Check if a line is metadata that should be stripped."""
    stripped = content.strip()
    if not stripped:
        return False
    # Check against metadata patterns
    if METADATA_REGEX.match(stripped):
        return True
    # Also match lines that are just identifiers like LEGIARTI000045137090
    if re.match(r'^LEGI[A-Z]{4}\d{12}$', stripped):
        return True
    return False


def html_to_text(content: str) -> str:
    """Convert HTML content to plain text."""
    if not content or '<' not in content:
        return content

    text = content

    # Convert <br> and <br/> to newlines
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)

    # Convert </p> to double newline (paragraph break)
    text = re.sub(r'</p\s*>', '\n\n', text, flags=re.IGNORECASE)

    # Remove <p> opening tags
    text = re.sub(r'<p\s*[^>]*>', '', text, flags=re.IGNORECASE)

    # Extract link text from <a> tags (keep the text, drop the href)
    text = re.sub(r'<a\s+[^>]*>([^<]*)</a>', r'\1', text, flags=re.IGNORECASE)

    # Remove all other HTML tags but keep their content
    text = re.sub(r'<[^>]+>', '', text)

    # Decode HTML entities (e.g., &amp; -> &, &lt; -> <)
    text = html.unescape(text)

    # Clean up excessive whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()

    return text


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


# --- Forgejo API fallback functions ---

def fetch_url(url: str, max_retries: int = 3) -> str:
    """Fetch URL content with retries."""
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'EvolutionDuDroit/1.0'})
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.read().decode('utf-8')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise
    raise Exception(f"Failed to fetch {url} after {max_retries} attempts")


def fetch_commit_diff_from_api(repo_name: str, sha: str) -> dict:
    """Fetch commit diff from Forgejo API when local repo is unavailable."""
    # Fetch commit info
    info_url = f"{API_BASE}/repos/{ORG}/{repo_name}/git/commits/{sha}"
    info = json.loads(fetch_url(info_url))

    # Fetch diff
    diff_url = f"{FORGEJO_BASE}/{ORG}/{repo_name}/commit/{sha}.diff"
    diff_text = fetch_url(diff_url)

    # Parse diff (reuse existing function with empty files_info)
    file_diffs = parse_unified_diff(diff_text, [])

    # Get stats from API response
    stats = info.get("stats", {})
    commit_info = info.get("commit", {})
    author_info = commit_info.get("author", {})

    return {
        "sha": sha[:12],
        "fullSha": sha,
        "date": author_info.get("date", "").split("T")[0],
        "message": commit_info.get("message", "").split("\n")[0][:300],
        "files": file_diffs,
        "stats": {
            "additions": stats.get("additions", sum(f["additions"] for f in file_diffs)),
            "deletions": stats.get("deletions", sum(f["deletions"] for f in file_diffs)),
            "filesChanged": len(file_diffs)
        }
    }


def format_code_name(name: str) -> str:
    """Format repository name for display."""
    display = name.replace("_", " ")
    return display[0].upper() + display[1:] if display else display


def format_article_name(filename: str) -> str:
    """Extract a readable article name from the filename."""
    # Example: partie_legislative/livre_premier/.../article_l1234-5.md -> Article L1234-5
    name = Path(filename).stem  # Get filename without extension

    # Handle article files
    if name.startswith("article_"):
        article_id = name[8:]  # Remove 'article_'
        # Format: l1234-5 -> L1234-5, r1234-5 -> R1234-5
        article_id = article_id.upper().replace("_", " ")
        return f"Article {article_id}"

    # Handle README files
    if name.lower() == "readme":
        # Get parent folder name for context
        parts = Path(filename).parts
        if len(parts) > 1:
            parent = parts[-2].replace("_", " ").title()
            return f"Sommaire - {parent}"
        return "Sommaire"

    return name.replace("_", " ").title()


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
    """Get all commits for a repository with file count."""
    # Get commit info with numstat for file count
    log_output = run_git(repo_path, "log", "--format=%H|%aI|%s", "--all", timeout=120)

    commits = []
    for line in log_output.split("\n"):
        if not line.strip():
            continue
        parts = line.split("|", 2)
        if len(parts) >= 3:
            sha, date_str, message = parts
            # Get file count for this commit
            files_output = run_git(repo_path, "diff-tree", "--no-commit-id", "-r", "--name-only", sha)
            file_count = len([f for f in files_output.split("\n") if f.strip()])

            commits.append({
                "sha": sha[:12],
                "fullSha": sha,  # Keep full SHA for API requests
                "date": date_str.split("T")[0],
                "message": message[:300],
                "files": file_count
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


def parse_unified_diff(diff_text: str, files_info: list, include_context: bool = False) -> list:
    """Parse unified diff output into structured format, filtering metadata.

    Args:
        diff_text: Raw unified diff output
        files_info: List of file info dicts with status
        include_context: If False, skip unchanged lines to save space
    """
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
                    "articleName": format_article_name(current_file),
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
            content = line[1:]
            # Skip metadata lines
            if is_metadata_line(content):
                continue
            # Convert HTML to plain text
            content = html_to_text(content)
            additions += 1
            current_diff.append({"type": "add", "content": content})

        elif current_file and line.startswith("-") and not line.startswith("---"):
            content = line[1:]
            # Skip metadata lines
            if is_metadata_line(content):
                continue
            # Convert HTML to plain text
            content = html_to_text(content)
            deletions += 1
            current_diff.append({"type": "del", "content": content})

        elif include_context and current_file and not line.startswith("@@") and not line.startswith("\\"):
            # Only include context lines if requested (saves significant space)
            if line:
                content = line[1:] if line.startswith(" ") else line
                # Skip metadata lines in context too
                if is_metadata_line(content):
                    continue
                # Convert HTML to plain text
                content = html_to_text(content)
                current_diff.append({"type": "unchanged", "content": content})

    # Save last file
    if current_file:
        file_diffs.append({
            "filename": current_file,
            "articleName": format_article_name(current_file),
            "additions": additions,
            "deletions": deletions,
            "diff": current_diff
        })

    # Add status from files_info
    files_dict = {f["filename"]: f["status"] for f in files_info}
    for fd in file_diffs:
        fd["status"] = files_dict.get(fd["filename"], "modified")

    return file_diffs


def generate_details_from_api(repo_name: str, commits: list, details_dir: Path) -> tuple:
    """Generate detail files for a repo using the Forgejo API."""
    repo_details_dir = details_dir / repo_name
    repo_details_dir.mkdir(exist_ok=True)

    generated = 0
    skipped = 0
    failed = 0

    for i, commit in enumerate(commits):
        sha = commit.get("fullSha") or commit.get("sha")
        short_sha = sha[:12]
        detail_file = repo_details_dir / f"{short_sha}.json.gz"

        if detail_file.exists():
            skipped += 1
            continue

        try:
            detail = fetch_commit_diff_from_api(repo_name, sha)
            json_bytes = json.dumps(detail, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            with gzip.open(detail_file, 'wb') as f:
                f.write(json_bytes)
            generated += 1

            if (i + 1) % 50 == 0:
                print(f"    {i+1}/{len(commits)} commits processed...")

            # Rate limiting for API
            time.sleep(0.1)

        except Exception as e:
            failed += 1
            if "404" not in str(e):
                print(f"    Warning: Failed {short_sha}: {e}")

    return generated, skipped, failed


def main():
    print("=== Generating static data with pre-computed diffs ===")
    print("Optimized: no context lines, compact JSON, metadata stripped")
    print("Falls back to Forgejo API when local repos unavailable")

    DATA_DIR.mkdir(exist_ok=True)
    commits_dir = DATA_DIR / "commits"
    commits_dir.mkdir(exist_ok=True)
    details_dir = DATA_DIR / "details"
    details_dir.mkdir(exist_ok=True)

    # Get repos from local clones
    local_repos = get_repos()
    local_repo_names = {r["name"] for r in local_repos}
    print(f"Found {len(local_repos)} local repositories")

    # Also check for repos that have existing commits data but no local clone
    existing_commits = set(f.stem for f in commits_dir.glob("*.json"))
    existing_details = set(d.name for d in details_dir.iterdir() if d.is_dir())
    repos_needing_details = existing_commits - existing_details

    # Load repos.json if it exists to get display names for API-only repos
    repos_json_path = DATA_DIR / "repos.json"
    existing_repos = {}
    if repos_json_path.exists():
        with open(repos_json_path, 'r', encoding='utf-8') as f:
            for r in json.load(f):
                existing_repos[r["name"]] = r

    # Combine local repos with existing repos data
    all_repos = list(local_repos)
    for repo_name in sorted(existing_commits - local_repo_names):
        if repo_name in existing_repos:
            all_repos.append(existing_repos[repo_name])
        else:
            all_repos.append({"name": repo_name, "displayName": format_code_name(repo_name)})

    if not all_repos:
        print("No repositories found! Run update_codes.sh first.")
        sys.exit(1)

    # Save repos index
    with open(repos_json_path, "w", encoding="utf-8") as f:
        json.dump(all_repos, f, ensure_ascii=False, indent=2)
    print(f"Created data/repos.json with {len(all_repos)} repos")

    total_commits = 0
    total_details = 0
    total_api_generated = 0

    for idx, repo in enumerate(all_repos):
        repo_name = repo["name"]
        repo_path = CODES_DIR / repo_name
        has_local_repo = repo_path.exists() and (repo_path / ".git").exists()

        print(f"\n[{idx+1}/{len(all_repos)}] {repo_name}", end="")
        if not has_local_repo:
            print(" (via API)", end="")
        print()

        # Get commits - either from local git or existing commits file
        if has_local_repo:
            commits = get_commits(repo_path)
            # Save commits index (compact JSON)
            with open(commits_dir / f"{repo_name}.json", "w", encoding="utf-8") as f:
                json.dump(commits, f, ensure_ascii=False, separators=(',', ':'))
        else:
            # Load existing commits data
            commits_file = commits_dir / f"{repo_name}.json"
            if commits_file.exists():
                with open(commits_file, 'r', encoding='utf-8') as f:
                    commits = json.load(f)
            else:
                print("  No commits data available, skipping")
                continue

        print(f"  {len(commits)} commits")
        total_commits += len(commits)

        if not commits:
            continue

        # Generate details
        repo_details_dir = details_dir / repo_name
        repo_details_dir.mkdir(exist_ok=True)

        if has_local_repo:
            # Use local git
            for i, commit in enumerate(commits):
                sha = commit["fullSha"]
                detail_file = repo_details_dir / f"{sha[:12]}.json.gz"

                if detail_file.exists():
                    total_details += 1
                    continue

                try:
                    detail = get_commit_diff(repo_path, sha)
                    json_bytes = json.dumps(detail, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                    with gzip.open(detail_file, 'wb') as f:
                        f.write(json_bytes)
                    total_details += 1

                    if (i + 1) % 100 == 0:
                        print(f"    {i+1}/{len(commits)} commits processed")
                except Exception as e:
                    print(f"  Warning: Failed to get diff for {sha[:12]}: {e}")

            print(f"  Generated details from local git")
        else:
            # Use API fallback
            generated, skipped, failed = generate_details_from_api(repo_name, commits, details_dir)
            total_details += generated + skipped
            total_api_generated += generated
            print(f"  API: generated {generated}, skipped {skipped}, failed {failed}")

    print(f"\n=== Done! ===")
    print(f"Total: {total_commits} commits, {total_details} detail files")
    if total_api_generated:
        print(f"Generated {total_api_generated} details via API")
    print(f"Data stored in {DATA_DIR}")


if __name__ == "__main__":
    main()
