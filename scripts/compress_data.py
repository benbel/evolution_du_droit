#!/usr/bin/env python3
"""
Compress existing JSON detail files to gzip format.
Much faster than regenerating all data.
"""

import gzip
import os
import shutil
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
DATA_DIR = PROJECT_DIR / "data"
DETAILS_DIR = DATA_DIR / "details"

def main():
    print("=== Compressing detail files to gzip ===")

    if not DETAILS_DIR.exists():
        print("No details directory found!")
        return

    total_files = 0
    total_compressed = 0
    original_size = 0
    compressed_size = 0

    for repo_dir in sorted(DETAILS_DIR.iterdir()):
        if not repo_dir.is_dir():
            continue

        json_files = list(repo_dir.glob("*.json"))
        gz_files = list(repo_dir.glob("*.json.gz"))

        # Skip if already compressed
        if gz_files and not json_files:
            total_files += len(gz_files)
            continue

        repo_original = 0
        repo_compressed = 0

        for json_file in json_files:
            gz_file = json_file.with_suffix('.json.gz')

            # Read and compress
            content = json_file.read_bytes()
            repo_original += len(content)

            with gzip.open(gz_file, 'wb') as f:
                f.write(content)

            repo_compressed += gz_file.stat().st_size

            # Remove original
            json_file.unlink()
            total_compressed += 1

        if json_files:
            ratio = (repo_compressed / repo_original * 100) if repo_original else 0
            print(f"  {repo_dir.name}: {len(json_files)} files, {repo_original/1024/1024:.1f}MB -> {repo_compressed/1024/1024:.1f}MB ({ratio:.1f}%)")
            original_size += repo_original
            compressed_size += repo_compressed
            total_files += len(json_files)

    if original_size > 0:
        ratio = compressed_size / original_size * 100
        print(f"\n=== Done! ===")
        print(f"Compressed {total_compressed} files")
        print(f"Size: {original_size/1024/1024/1024:.2f}GB -> {compressed_size/1024/1024/1024:.2f}GB ({ratio:.1f}%)")
    else:
        print(f"All {total_files} files already compressed")

if __name__ == "__main__":
    main()
