/**
 * API Module - Handles all communication with the Forgejo API
 */

const API = (() => {
    const BASE_URL = 'https://git.tricoteuses.fr/api/v1';
    const CORS_PROXY = 'https://corsproxy.io/?';
    const ORG = 'codes';

    // Whether to use CORS proxy (determined after first request)
    let useCorsProxy = false;

    // Cache for API responses
    const cache = new Map();

    // Fallback list of repositories (in case API is blocked by CORS)
    const FALLBACK_REPOS = [
        'code_civil', 'code_de_commerce', 'code_de_justice_administrative',
        'code_de_l_action_sociale_et_des_familles', 'code_de_l_artisanat',
        'code_de_l_education', 'code_de_l_energie', 'code_de_l_entree_et_du_sejour_des_etrangers_et_du_droit_d_asile',
        'code_de_l_environnement', 'code_de_l_expropriation_pour_cause_d_utilite_publique',
        'code_de_l_organisation_judiciaire', 'code_de_l_urbanisme',
        'code_de_la_commande_publique', 'code_de_la_consommation',
        'code_de_la_construction_et_de_l_habitation', 'code_de_la_defense',
        'code_de_la_famille_et_de_l_aide_sociale', 'code_de_la_justice_penale_des_mineurs',
        'code_de_la_mutualite', 'code_de_la_propriete_intellectuelle',
        'code_de_la_recherche', 'code_de_la_route', 'code_de_la_sante_publique',
        'code_de_la_securite_interieure', 'code_de_la_securite_sociale',
        'code_de_la_voirie_routiere', 'code_de_procedure_civile',
        'code_de_procedure_penale', 'code_des_assurances',
        'code_des_impositions_sur_les_biens_et_services', 'code_des_juridictions_financieres',
        'code_des_pensions_civiles_et_militaires_de_retraite', 'code_des_pensions_militaires_d_invalidite_et_des_victimes_de_guerre',
        'code_des_ports_maritimes', 'code_des_postes_et_des_communications_electroniques',
        'code_des_procedures_civiles_d_execution', 'code_des_relations_entre_le_public_et_l_administration',
        'code_des_transports', 'code_du_cinema_et_de_l_image_animee',
        'code_du_domaine_de_l_etat', 'code_du_patrimoine', 'code_du_service_national',
        'code_du_sport', 'code_du_tourisme', 'code_du_travail',
        'code_du_travail_maritime', 'code_electoral', 'code_forestier_nouveau',
        'code_general_de_la_fonction_publique', 'code_general_de_la_propriete_des_personnes_publiques',
        'code_general_des_collectivites_territoriales', 'code_general_des_impots',
        'code_minier_nouveau', 'code_monetaire_et_financier', 'code_penal',
        'code_rural_et_de_la_peche_maritime', 'code_rural_nouveau',
        'livre_des_procedures_fiscales'
    ];

    /**
     * Build the URL, optionally with CORS proxy
     */
    function buildUrl(path) {
        const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
        return useCorsProxy ? `${CORS_PROXY}${encodeURIComponent(url)}` : url;
    }

    /**
     * Make a fetch request with CORS fallback
     */
    async function fetchWithFallback(url, isJson = true) {
        try {
            const response = await fetch(buildUrl(url));
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return isJson ? await response.json() : await response.text();
        } catch (error) {
            // If direct request failed and we haven't tried proxy yet
            if (!useCorsProxy && (error.name === 'TypeError' || error.message.includes('CORS'))) {
                console.log('Direct API failed, trying CORS proxy...');
                useCorsProxy = true;
                const response = await fetch(buildUrl(url));
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return isJson ? await response.json() : await response.text();
            }
            throw error;
        }
    }

    /**
     * Make a cached API request
     */
    async function fetchWithCache(url, cacheKey, ttl = 300000) {
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ttl) {
            return cached.data;
        }

        const data = await fetchWithFallback(url, true);
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    /**
     * Fetch all repositories (legal codes)
     */
    async function fetchRepositories() {
        try {
            const url = `/orgs/${ORG}/repos?limit=200`;
            const repos = await fetchWithCache(url, 'repos', 600000);

            // Sort by name and format for display
            return repos
                .map(repo => ({
                    name: repo.name,
                    displayName: formatCodeName(repo.name),
                    description: repo.description || ''
                }))
                .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
        } catch (error) {
            console.warn('API failed, using fallback repository list:', error);
            // Use fallback list
            return FALLBACK_REPOS
                .map(name => ({
                    name,
                    displayName: formatCodeName(name),
                    description: ''
                }))
                .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
        }
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
        let url = `/repos/${ORG}/${repoName}/commits?limit=100`;

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
        const url = `/repos/${ORG}/${repoName}/git/commits/${sha}`;
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
        const url = `/repos/${ORG}/${repoName}/raw/${sha}/${encodeURIComponent(filePath)}`;
        const cacheKey = `file:${repoName}:${sha}:${filePath}`;

        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 3600000) {
            return cached.data;
        }

        try {
            const content = await fetchWithFallback(url, false);
            cache.set(cacheKey, { data: content, timestamp: Date.now() });
            return content;
        } catch (error) {
            if (error.message.includes('404')) {
                return null; // File doesn't exist at this commit
            }
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
        const url = `/repos/${ORG}/${repoName}/git/commits/${sha}`;
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
