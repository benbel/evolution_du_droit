/**
 * API Module - Handles all communication with the Forgejo API
 */

const API = (() => {
    const BASE_URL = 'https://git.tricoteuses.fr/api/v1';
    const ORG = 'codes';

    // Cache for API responses
    const cache = new Map();

    /**
     * Make a cached API request
     */
    async function fetchWithCache(url, cacheKey, ttl = 300000) {
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ttl) {
            return cached.data;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Erreur API: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    /**
     * Fetch all repositories (legal codes)
     */
    async function fetchRepositories() {
        const url = `${BASE_URL}/orgs/${ORG}/repos?limit=200`;
        const repos = await fetchWithCache(url, 'repos', 600000);

        // Sort by name and format for display
        return repos
            .map(repo => ({
                name: repo.name,
                displayName: formatCodeName(repo.name),
                description: repo.description || ''
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
    }

    /**
     * Format repository name for display
     * e.g., "code_du_travail" -> "Code du travail"
     */
    function formatCodeName(name) {
        return name
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char, index) => index === 0 ? char.toUpperCase() : char);
    }

    /**
     * Fetch commits for a repository within a date range
     */
    async function fetchCommits(repoName, since, until) {
        let url = `${BASE_URL}/repos/${ORG}/${repoName}/commits?limit=100`;

        if (since) {
            url += `&since=${since}T00:00:00Z`;
        }
        if (until) {
            url += `&until=${until}T23:59:59Z`;
        }

        const cacheKey = `commits:${repoName}:${since}:${until}`;
        const commits = await fetchWithCache(url, cacheKey, 60000);

        return commits.map(commit => ({
            sha: commit.sha,
            shortSha: commit.sha.substring(0, 7),
            date: commit.commit.author.date.split('T')[0],
            message: commit.commit.message,
            author: commit.commit.author.name,
            stats: commit.stats || { additions: 0, deletions: 0 }
        }));
    }

    /**
     * Fetch commit details including changed files
     */
    async function fetchCommitDetail(repoName, sha) {
        const url = `${BASE_URL}/repos/${ORG}/${repoName}/git/commits/${sha}`;
        const cacheKey = `commit:${repoName}:${sha}`;
        const commit = await fetchWithCache(url, cacheKey, 3600000);

        return {
            sha: commit.sha,
            message: commit.message,
            date: commit.author.date.split('T')[0],
            author: commit.author.name,
            files: commit.files || [],
            stats: commit.stats || { additions: 0, deletions: 0, total: 0 }
        };
    }

    /**
     * Fetch file content at a specific commit
     */
    async function fetchFileAtCommit(repoName, sha, filePath) {
        const url = `${BASE_URL}/repos/${ORG}/${repoName}/raw/${sha}/${encodeURIComponent(filePath)}`;
        const cacheKey = `file:${repoName}:${sha}:${filePath}`;

        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 3600000) {
            return cached.data;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) {
                if (response.status === 404) {
                    return null; // File doesn't exist at this commit
                }
                throw new Error(`Erreur API: ${response.status}`);
            }

            const content = await response.text();
            cache.set(cacheKey, { data: content, timestamp: Date.now() });
            return content;
        } catch (error) {
            console.error(`Error fetching file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Find the commit closest to a given date
     */
    async function findCommitAtDate(repoName, targetDate) {
        // Fetch commits up to the target date
        const commits = await fetchCommits(repoName, null, targetDate);

        if (commits.length === 0) {
            return null;
        }

        // The first commit should be the most recent one before/on the target date
        return commits[0];
    }

    /**
     * Get the diff between two commits
     */
    async function getCommitDiff(repoName, sha) {
        const url = `${BASE_URL}/repos/${ORG}/${repoName}/git/commits/${sha}`;
        const cacheKey = `diff:${repoName}:${sha}`;

        const commit = await fetchWithCache(url, cacheKey, 3600000);

        // Get parent commit SHA
        const parentSha = commit.parents && commit.parents.length > 0
            ? commit.parents[0].sha
            : null;

        const files = commit.files || [];
        const diffs = [];

        for (const file of files) {
            const currentContent = await fetchFileAtCommit(repoName, sha, file.filename);
            const previousContent = parentSha
                ? await fetchFileAtCommit(repoName, parentSha, file.filename)
                : null;

            diffs.push({
                filename: file.filename,
                status: file.status, // added, modified, deleted
                additions: file.additions || 0,
                deletions: file.deletions || 0,
                previousContent,
                currentContent
            });
        }

        return diffs;
    }

    /**
     * Get all files changed between two dates
     */
    async function getChangesBetweenDates(repoName, startDate, endDate) {
        const commits = await fetchCommits(repoName, startDate, endDate);

        // Collect all unique files changed
        const changedFiles = new Set();

        for (const commit of commits) {
            const detail = await fetchCommitDetail(repoName, commit.sha);
            for (const file of detail.files) {
                changedFiles.add(file.filename);
            }
        }

        return {
            commits,
            files: Array.from(changedFiles).sort()
        };
    }

    /**
     * Get file content at a specific date (finds nearest commit)
     */
    async function getFileAtDate(repoName, filePath, date) {
        const commit = await findCommitAtDate(repoName, date);
        if (!commit) {
            return null;
        }
        return fetchFileAtCommit(repoName, commit.sha, filePath);
    }

    // Public API
    return {
        fetchRepositories,
        fetchCommits,
        fetchCommitDetail,
        fetchFileAtCommit,
        findCommitAtDate,
        getCommitDiff,
        getChangesBetweenDates,
        getFileAtDate,
        formatCodeName
    };
})();
