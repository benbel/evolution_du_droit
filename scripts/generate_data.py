#!/usr/bin/env python3
"""
Generate static JSON data from cloned legal code repositories.
Uses git diff directly for fast diff computation.
Strips metadata, handles HTML tags, and formats diffs by article.
"""

import gzip
import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
CODES_DIR = PROJECT_DIR / "codes"
DATA_DIR = PROJECT_DIR / "data"

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


def build_legifrance_cache(repo_path: Path) -> dict:
    """Build a cache of Légifrance URLs for all articles at HEAD (current version).

    Returns:
        dict: Mapping of filename -> legifrance_url
    """
    cache = {}
    try:
        # Get all .md files in the repo
        files_output = run_git(repo_path, "ls-files", "*.md")
        files = [f for f in files_output.split('\n') if f.strip() and 'article_' in f]

        for filename in files:
            try:
                # Read file content from HEAD
                content = run_git(repo_path, "show", f"HEAD:{filename}")
                if not content:
                    continue

                # Look for Légifrance link in "Autres formats" section
                # Pattern: * [Légifrance](URL)
                lines = content.split('\n')
                for line in lines:
                    # Match markdown link: * [Légifrance](URL)
                    match = re.search(r'\*\s*\[L[ée]gifrance\]\(([^)]+)\)', line, re.IGNORECASE)
                    if match:
                        legifrance_url = match.group(1)
                        cache[filename] = legifrance_url
                        break
            except Exception:
                continue

    except Exception:
        pass

    return cache


def format_code_name(name: str) -> str:
    """Format repository name for display."""
    display = name.replace("_", " ")
    return display[0].upper() + display[1:] if display else display


def format_article_name(filename: str) -> str:
    """Extract a readable article name from the filename."""
    # Example: partie_legislative/livre_premier/.../article_l1234-5.md -> Article L1234-5
    path = Path(filename)
    name = path.stem  # Get filename without extension

    # Handle article files
    if name.startswith("article_"):
        article_id = name[8:]  # Remove 'article_'
        # Format: l1234-5 -> L1234-5, r1234-5 -> R1234-5
        article_id = article_id.upper().replace("_", " ")

        # Build breadcrumb from path parts
        parts = path.parts[:-1]  # Exclude the filename itself
        breadcrumb_parts = []

        for i, part in enumerate(parts):
            # Format part nicely
            formatted = format_path_part(part)
            if formatted:
                breadcrumb_parts.append(formatted)

        # Add article at the end
        if breadcrumb_parts:
            return " / ".join(breadcrumb_parts) + f" / Article {article_id}"
        return f"Article {article_id}"

    # Handle README files
    if name.lower() == "readme":
        # Get parent folder name for context
        parts = path.parts
        if len(parts) > 1:
            parent = format_path_part(parts[-2])
            return f"Sommaire - {parent}"
        return "Sommaire"

    return name.replace("_", " ").title()


def format_path_part(part: str) -> str:
    """Format a path part nicely (e.g., livre_premier -> Livre Premier)."""
    # Handle common patterns
    part_lower = part.lower()

    # Roman numerals mapping
    roman_map = {
        "premier": "Ier", "premiere": "Ière",
        "i": "I", "ii": "II", "iii": "III", "iv": "IV", "v": "V",
        "vi": "VI", "vii": "VII", "viii": "VIII", "ix": "IX", "x": "X",
        "xi": "XI", "xii": "XII", "xiii": "XIII", "xiv": "XIV", "xv": "XV"
    }

    # Check if it's a livre/titre/chapitre pattern
    if part_lower.startswith("livre_"):
        num = part_lower[6:]
        if num in roman_map:
            return f"Livre {roman_map[num]}"
        return f"Livre {num.replace('_', ' ').title()}"

    if part_lower.startswith("titre_"):
        num = part_lower[6:]
        if num in roman_map:
            return f"Titre {roman_map[num]}"
        return f"Titre {num.replace('_', ' ').title()}"

    if part_lower.startswith("chapitre_"):
        num = part_lower[9:]
        if num in roman_map:
            return f"Chapitre {roman_map[num]}"
        return f"Chapitre {num.replace('_', ' ').title()}"

    if part_lower.startswith("section_"):
        num = part_lower[8:]
        if num in roman_map:
            return f"Section {roman_map[num]}"
        return f"Section {num.replace('_', ' ').title()}"

    # Skip generic parts
    if part_lower in ["partie_legislative", "partie_reglementaire", "partie_arretes"]:
        return ""

    return part.replace("_", " ").title()


def get_repos() -> list:
    """Get list of all repositories with real names from README.md."""
    repos = []
    if not CODES_DIR.exists():
        return repos

    for item in sorted(CODES_DIR.iterdir()):
        if item.is_dir() and (item / ".git").exists():
            # Try to extract real title from README.md
            display_name = format_code_name(item.name)  # fallback
            readme_path = item / "README.md"
            if readme_path.exists():
                try:
                    with open(readme_path, 'r', encoding='utf-8') as f:
                        for line in f:
                            if line.startswith('# '):
                                display_name = line[2:].strip()
                                break
                except Exception:
                    pass  # Use fallback if reading fails

            repos.append({
                "name": item.name,
                "displayName": display_name
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
            # Get file count for this commit (exclude README.md files)
            files_output = run_git(repo_path, "diff-tree", "--no-commit-id", "-r", "--name-only", sha)
            file_count = len([f for f in files_output.split("\n") if f.strip() and not f.lower().endswith("readme.md")])

            commits.append({
                "sha": sha[:12],
                "fullSha": sha,  # Keep full SHA for API requests
                "date": date_str.split("T")[0],
                "message": message[:300],
                "files": file_count
            })

    commits.sort(key=lambda x: x["date"], reverse=True)
    return commits


def get_commit_diff(repo_path: Path, sha: str, legifrance_cache: dict = None) -> dict:
    """Get diff for a commit using git diff.

    Args:
        repo_path: Path to the repository
        sha: Commit SHA
        legifrance_cache: Optional cache of filename -> legifrance_url mappings
    """
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

    # Parse diff into structured format (include full context for before/after view)
    file_diffs = parse_unified_diff(diff_output, files, legifrance_cache, include_context=True)

    # Calculate stats
    total_add = sum(f.get("additions", 0) for f in file_diffs)
    total_del = sum(f.get("deletions", 0) for f in file_diffs)

    return {
        "sha": sha[:12],
        "fullSha": sha,
        "date": date,
        "message": message,
        "files": file_diffs,
        "stats": {
            "additions": total_add,
            "deletions": total_del,
            "filesChanged": len(file_diffs)
        }
    }


def is_article_header(content: str) -> bool:
    """Check if line is just the article number (e.g., 'Article R4137-48')."""
    stripped = content.strip()
    # Match "Article" followed by alphanumeric code (e.g., R4137-48, L123-4)
    return bool(re.match(r'^Article\s+[A-Z]?\d+[A-Z0-9\-]*$', stripped, re.IGNORECASE))


def is_section_header(content: str) -> bool:
    """Check if line is a section header that should skip entire section."""
    stripped = content.strip()
    if not stripped:
        return False

    # Skip reference section headers and everything after them
    if stripped in ["Références", "Autres formats"]:
        return True
    if stripped.startswith("### Articles faisant référence") or stripped.startswith("### Textes faisant référence") or stripped.startswith("### Références faites par l'article"):
        return True
    if stripped.startswith("## Références") or stripped.startswith("## Autres formats"):
        return True

    return False


def should_skip_content(content: str) -> bool:
    """Check if content should be skipped (references, other formats, etc.)."""
    stripped = content.strip()
    if not stripped:
        return False

    # Skip markdown separators (---, ===, etc.)
    if re.match(r'^[\-=]{3,}$', stripped):
        return True

    # Skip article header (redundant with title)
    if is_article_header(stripped):
        return True

    # Skip section headers
    if stripped in ["Références", "Autres formats"]:
        return True
    if stripped.startswith("### Articles faisant référence") or stripped.startswith("### Textes faisant référence") or stripped.startswith("### Références faites par l'article"):
        return True
    if stripped.startswith("## Références") or stripped.startswith("## Autres formats"):
        return True

    # Skip file format bullets - match exact URLs in markdown links
    if stripped.startswith("* [JSON dans git]") or stripped.startswith("* [Références JSON dans git]"):
        return True
    if stripped.startswith("* [Markdown dans git]") or stripped.startswith("* [Légifrance]"):
        return True
    if stripped.startswith("* [Markdown chronologique dans git]"):
        return True

    # Also match simple bullet points (backward compatibility)
    if stripped.startswith("* JSON dans git") or stripped.startswith("* Références JSON dans git"):
        return True
    if stripped.startswith("* Markdown dans git") or stripped.startswith("* Légifrance"):
        return True
    if stripped.startswith("* Markdown chronologique dans git"):
        return True

    # Skip reference content with legal status keywords (including CODIFICATION)
    # Pattern: contains AUTONOME, VIGUEUR, MODIFIE, CITATION, CREE, CODIFICATION followed by "cible" or "source"
    if any(keyword in stripped for keyword in ["AUTONOME", "VIGUEUR", "MODIFIE", "CITATION", "CREE", "ENTIEREMENT_MODIF", "CODIFICATION"]):
        if " cible" in stripped or " source" in stripped:
            return True

    # Skip date-based references (YYYY-MM-DD followed by CREE/MODIFIE/CITATION)
    if re.match(r'^\d{4}-\d{2}-\d{2}\s+(CREE|MODIFIE|CITATION)', stripped):
        return True

    # Skip special date references
    if re.match(r'^\s*\d{4}-\d{2}-\d{2}\s+(cible|source)', stripped):
        return True

    # Skip lines that look like article references
    # Pattern: "Code de ... - article ..." with status keywords
    if stripped.startswith("Code de ") or stripped.startswith("Code général"):
        if any(keyword in stripped for keyword in ["AUTONOME", "VIGUEUR", "MODIFIE", "en vigueur"]):
            return True

    # Skip decree/law references in citation format
    if any(stripped.startswith(prefix) for prefix in ["Décret n°", "Ordonnance n°", "LOI n°", "Loi n°"]):
        if (" - article " in stripped or " - art. " in stripped) and any(keyword in stripped for keyword in ["AUTONOME", "VIGUEUR", "MODIFIE", "CREE", "ENTIEREMENT_MODIF", "CODIFICATION"]):
            return True

    # Skip decision references (e.g., "Décision n° 2024-1116 QPC du 10 janvier 2025 MODIFICATION cible")
    if stripped.startswith("Décision n°") or stripped.startswith("D\u00e9cision n°"):
        if any(keyword in stripped for keyword in ["AUTONOME", "VIGUEUR", "MODIFIE", "CITATION", "CREE", "ENTIEREMENT_MODIF", "CODIFICATION", "cible", "source"]):
            return True

    return False


def parse_unified_diff(diff_text: str, files_info: list, legifrance_cache: dict = None, include_context: bool = False) -> list:
    """Parse unified diff output into structured format, filtering metadata.

    Args:
        diff_text: Raw unified diff output
        files_info: List of file info dicts with status
        legifrance_cache: Optional cache of filename -> legifrance_url mappings
        include_context: If False, skip unchanged lines to save space
    """
    file_diffs = []
    current_file = None
    current_diff = []
    additions = 0
    deletions = 0
    skip_details = False  # Track if we're inside <details> tag
    before_article = True  # Track if we're before the article header
    in_reference_section = False  # Track if we're in a reference section

    for line in diff_text.split("\n"):
        if line.startswith("diff --git"):
            # Save previous file
            if current_file and not current_file.lower().endswith("readme.md"):
                # Get Légifrance URL from cache
                legifrance_url = ""
                if legifrance_cache and current_file in legifrance_cache:
                    legifrance_url = legifrance_cache[current_file]

                file_diffs.append({
                    "filename": current_file,
                    "articleName": format_article_name(current_file),
                    "legifranceUrl": legifrance_url,
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
            skip_details = False
            before_article = True
            in_reference_section = False

        # Skip git diff metadata headers
        elif line.startswith("index ") or line.startswith("--- a/") or line.startswith("+++ b/") or line.startswith("new file mode") or line.startswith("deleted file mode") or line.startswith("similarity index") or line.startswith("rename from") or line.startswith("rename to") or line == "--- /dev/null":
            continue

        elif current_file and line.startswith("+") and not line.startswith("+++"):
            content = line[1:]
            stripped = content.strip()

            # Track <details> tag
            if "<details>" in stripped or stripped.startswith("<details"):
                skip_details = True
                continue
            if "</details>" in stripped:
                skip_details = False
                continue
            if skip_details:
                continue

            # Track reference sections
            if stripped.startswith("### Textes faisant référence") or stripped.startswith("### Articles faisant référence"):
                in_reference_section = True
                continue
            if in_reference_section:
                # End reference section when we hit a new heading or empty line after references
                if stripped.startswith("#") and not stripped.startswith("###"):
                    in_reference_section = False
                else:
                    continue

            # Track article header - skip metadata before article
            if stripped.startswith("# Article "):
                before_article = False
                in_reference_section = False  # Reset when we see article header
                continue  # Skip the article header itself
            if before_article:
                continue  # Skip all metadata before article

            # Skip metadata lines
            if is_metadata_line(content):
                continue

            # Skip individual content that should be filtered
            if should_skip_content(content):
                continue

            # Convert HTML to plain text
            content = html_to_text(content)
            if content.strip():  # Only add non-empty lines
                additions += 1
                current_diff.append({"type": "add", "content": content})

        elif current_file and line.startswith("-") and not line.startswith("---"):
            content = line[1:]
            stripped = content.strip()

            # Track <details> tag
            if "<details>" in stripped or stripped.startswith("<details"):
                skip_details = True
                continue
            if "</details>" in stripped:
                skip_details = False
                continue
            if skip_details:
                continue

            # Track reference sections
            if stripped.startswith("### Textes faisant référence") or stripped.startswith("### Articles faisant référence"):
                in_reference_section = True
                continue
            if in_reference_section:
                # End reference section when we hit a new heading or empty line after references
                if stripped.startswith("#") and not stripped.startswith("###"):
                    in_reference_section = False
                else:
                    continue

            # Track article header - skip metadata before article
            if stripped.startswith("# Article "):
                before_article = False
                in_reference_section = False  # Reset when we see article header
                continue  # Skip the article header itself
            if before_article:
                continue  # Skip all metadata before article

            # Skip metadata lines
            if is_metadata_line(content):
                continue

            # Skip individual content that should be filtered
            if should_skip_content(content):
                continue

            # Convert HTML to plain text
            content = html_to_text(content)
            if content.strip():  # Only add non-empty lines
                deletions += 1
                current_diff.append({"type": "del", "content": content})

        elif include_context and current_file and not line.startswith("@@") and not line.startswith("\\"):
            # Only include context lines if requested (saves significant space)
            if line:
                content = line[1:] if line.startswith(" ") else line
                stripped = content.strip()

                # Track <details> tag
                if "<details>" in stripped or stripped.startswith("<details"):
                    skip_details = True
                    continue
                if "</details>" in stripped:
                    skip_details = False
                    continue
                if skip_details:
                    continue

                # Track reference sections
                if stripped.startswith("### Textes faisant référence") or stripped.startswith("### Articles faisant référence"):
                    in_reference_section = True
                    continue
                if in_reference_section:
                    # End reference section when we hit a new heading or empty line after references
                    if stripped.startswith("#") and not stripped.startswith("###"):
                        in_reference_section = False
                    else:
                        continue

                # Track article header - skip metadata before article
                if stripped.startswith("# Article "):
                    before_article = False
                    in_reference_section = False  # Reset when we see article header
                    continue  # Skip the article header itself
                if before_article:
                    continue  # Skip all metadata before article

                # Skip metadata lines in context too
                if is_metadata_line(content):
                    continue

                # Skip individual content that should be filtered
                if should_skip_content(content):
                    continue

                # Convert HTML to plain text
                content = html_to_text(content)
                if content.strip():  # Only add non-empty lines
                    current_diff.append({"type": "unchanged", "content": content})

        # Reset flags on new hunk
        if line.startswith("@@"):
            before_article = False
            skip_details = False
            in_reference_section = False

    # Save last file (skip README.md files)
    if current_file and not current_file.lower().endswith("readme.md"):
        # Get Légifrance URL from cache
        legifrance_url = ""
        if legifrance_cache and current_file in legifrance_cache:
            legifrance_url = legifrance_cache[current_file]

        file_diffs.append({
            "filename": current_file,
            "articleName": format_article_name(current_file),
            "legifranceUrl": legifrance_url,
            "additions": additions,
            "deletions": deletions,
            "diff": current_diff
        })

    # Add status from files_info
    files_dict = {f["filename"]: f["status"] for f in files_info}
    for fd in file_diffs:
        fd["status"] = files_dict.get(fd["filename"], "modified")

    # Collapse multiple consecutive empty lines into one for each file
    for fd in file_diffs:
        collapsed_diff = []
        last_was_empty = False

        for line in fd["diff"]:
            is_empty = not line.get("content", "").strip()

            if is_empty and last_was_empty:
                # Skip this empty line
                continue

            collapsed_diff.append(line)
            last_was_empty = is_empty

        fd["diff"] = collapsed_diff

    return file_diffs


def main():
    print("=== Generating static data with pre-computed diffs ===")
    print("Optimized: no context lines, compact JSON, metadata stripped")

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

    total_commits = 0
    total_details = 0
    for idx, repo in enumerate(repos):
        repo_name = repo["name"]
        repo_path = CODES_DIR / repo_name

        print(f"\n[{idx+1}/{len(repos)}] {repo_name}")

        commits = get_commits(repo_path)
        print(f"  {len(commits)} commits")
        total_commits += len(commits)

        if not commits:
            continue

        # Save commits index (compact JSON)
        with open(commits_dir / f"{repo_name}.json", "w", encoding="utf-8") as f:
            json.dump(commits, f, ensure_ascii=False, separators=(',', ':'))

        # Build Légifrance URL cache once for this repo (much faster than per-commit)
        print(f"  Building Légifrance URL cache...")
        legifrance_cache = build_legifrance_cache(repo_path)
        print(f"  Cached {len(legifrance_cache)} article URLs")

        # Generate details for each commit
        repo_details_dir = details_dir / repo_name
        repo_details_dir.mkdir(exist_ok=True)

        for i, commit in enumerate(commits):
            sha = commit["fullSha"]
            detail_file = repo_details_dir / f"{sha[:12]}.json.gz"

            # Skip if already generated
            if detail_file.exists():
                total_details += 1
                continue

            try:
                detail = get_commit_diff(repo_path, sha, legifrance_cache)
                # Save as gzip-compressed JSON
                json_bytes = json.dumps(detail, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                with gzip.open(detail_file, 'wb') as f:
                    f.write(json_bytes)
                total_details += 1

                if (i + 1) % 100 == 0:
                    print(f"    {i+1}/{len(commits)} commits processed")
            except Exception as e:
                print(f"  Warning: Failed to get diff for {sha[:12]}: {e}")

        print(f"  Generated {len(commits)} detail files")

    print(f"\n=== Done! ===")
    print(f"Total: {total_commits} commits, {total_details} detail files")
    print(f"Data stored in {DATA_DIR}")


if __name__ == "__main__":
    main()
