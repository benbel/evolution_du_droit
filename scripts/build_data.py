#!/usr/bin/env python3
"""
Build script to download all legal codes and generate static data.

Usage:
    python scripts/build_data.py [--update-only]

Options:
    --update-only   Only regenerate data from existing repos (skip clone/fetch)
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

PROJECT_DIR = Path(__file__).parent.parent
CODES_DIR = PROJECT_DIR / "codes"
DATA_DIR = PROJECT_DIR / "data"
API_URL = "https://git.tricoteuses.fr/api/v1"
ORG = "codes"
CLONE_ATTEMPTS = 3


def fetch_repo_list() -> list:
    """Fetch list of all repositories from git.tricoteuses.fr."""
    repos = []
    page = 1

    print("=== Fetching repository list ===")
    while True:
        print(f"Fetching page {page}...")
        url = f"{API_URL}/orgs/{ORG}/repos?limit=50&page={page}"
        try:
            with urlopen(url, timeout=30) as response:
                data = json.loads(response.read().decode('utf-8'))
                if not data:
                    break
                for repo in data:
                    if repo.get('empty'):
                        print(f"Skipping empty repository {repo['name']}")
                    elif repo.get('name'):
                        repos.append(repo['name'])
                page += 1
        except Exception as e:
            print(f"Error fetching page {page}: {e}")
            print("The repository list is incomplete: stopping rather than publishing partial data.")
            sys.exit(1)

    repos = sorted(set(repos))
    print(f"Found {len(repos)} repositories")
    return repos


def clone_or_update_repo(repo_name: str, current: int, total: int) -> bool:
    """Clone or update a single repository."""
    repo_path = CODES_DIR / repo_name

    print(f"\n=== [{current}/{total}] {repo_name} ===")

    if (repo_path / ".git").exists():
        print("Updating existing repo...")
        try:
            subprocess.run(
                ["git", "fetch", "--all", "--quiet"],
                cwd=repo_path,
                check=True,
                timeout=60
            )
            # Try main first, then master
            try:
                subprocess.run(
                    ["git", "reset", "--hard", "origin/main", "--quiet"],
                    cwd=repo_path,
                    check=True,
                    capture_output=True,
                    timeout=30
                )
            except subprocess.CalledProcessError:
                subprocess.run(
                    ["git", "reset", "--hard", "origin/master", "--quiet"],
                    cwd=repo_path,
                    check=True,
                    capture_output=True,
                    timeout=30
                )
            return True
        except Exception as e:
            print(f"Warning: Update failed for {repo_name}: {e}")
            return False
    else:
        repo_url = f"https://git.tricoteuses.fr/{ORG}/{repo_name}.git"
        for attempt in range(1, CLONE_ATTEMPTS + 1):
            print(f"Cloning new repo (attempt {attempt}/{CLONE_ATTEMPTS})...")
            shutil.rmtree(repo_path, ignore_errors=True)
            try:
                subprocess.run(
                    ["git", "clone", "--quiet", repo_url, str(repo_path)],
                    check=True,
                    timeout=1200
                )
                return True
            except Exception as e:
                print(f"Warning: Clone failed for {repo_name}: {e}")
        shutil.rmtree(repo_path, ignore_errors=True)
        return False


def main():
    update_only = "--update-only" in sys.argv

    # Create directories
    CODES_DIR.mkdir(exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)

    if not update_only:
        # Fetch and clone/update repositories
        repos = fetch_repo_list()

        if not repos:
            print("No repositories found!")
            sys.exit(1)

        failed_repos = []
        for i, repo_name in enumerate(repos, 1):
            if not clone_or_update_repo(repo_name, i, len(repos)):
                failed_repos.append(repo_name)

        print(f"\n=== Repository download complete ===")
        print(f"Successfully processed {len(repos) - len(failed_repos)}/{len(repos)} repositories")
        if failed_repos:
            print(f"Failed: {', '.join(failed_repos)}")
            print("Stopping rather than publishing partial data.")
            sys.exit(1)
    else:
        print("=== Skipping repository download (--update-only) ===")

    # Generate data
    print("\n=== Generating static data ===")
    generate_script = PROJECT_DIR / "scripts" / "generate_data.py"

    try:
        subprocess.run(
            [sys.executable, str(generate_script)],
            check=True
        )
    except subprocess.CalledProcessError as e:
        print(f"Error generating data: {e}")
        sys.exit(1)

    print("\n=== Build complete! ===")
    print(f"Codes are in: {CODES_DIR}")
    print(f"Data is in: {DATA_DIR}")


if __name__ == "__main__":
    main()
