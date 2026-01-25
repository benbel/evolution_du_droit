/**
 * App - Simple viewer for pre-computed legal code changes
 */

window.addEventListener('load', async () => {
    // DOM Elements
    const codeInput = document.getElementById('code-input');
    const codeList = document.getElementById('code-list');
    const dateStart = document.getElementById('date-start');
    const dateEnd = document.getElementById('date-end');
    const btnPrint = document.getElementById('btn-print');
    const modeToggleContainer = document.getElementById('mode-toggle-container');
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const errorMessage = document.getElementById('error-message');
    const results = document.getElementById('results');
    const printHeader = document.getElementById('print-header');
    const viewBeforeAfter = document.getElementById('view-before-after');
    const viewChanges = document.getElementById('view-changes');
    const commitsList = document.getElementById('commits-list');
    const commitHeader = document.getElementById('commit-header');
    const commitDiff = document.getElementById('commit-diff');
    const diffLeft = document.getElementById('diff-left');

    // State
    let currentMode = 'before-after';
    let currentCommits = [];
    let currentRepo = null;
    let currentStartDate = null;
    let currentEndDate = null;
    let currentStartDateISO = null;  // ISO format (YYYY-MM-DD) for URLs
    let currentEndDateISO = null;    // ISO format (YYYY-MM-DD) for URLs
    let reposMap = new Map(); // Map displayName -> repo object

    // Format date for display
    function formatDate(dateStr) {
        return new Date(dateStr).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    // Show/hide loading
    function showLoading() {
        loading.classList.remove('hidden');
        error.classList.add('hidden');
        results.classList.add('hidden');
    }

    function hideLoading() {
        loading.classList.add('hidden');
    }

    function showError(msg) {
        errorMessage.textContent = msg;
        error.classList.remove('hidden');
        hideLoading();
    }

    // Get selected repo from input text
    function getSelectedRepo() {
        const inputValue = codeInput.value.trim();
        // Check if it matches a display name
        if (reposMap.has(inputValue)) {
            return reposMap.get(inputValue);
        }
        // Check if it matches a repo name directly
        for (const repo of reposMap.values()) {
            if (repo.name === inputValue) {
                return repo;
            }
        }
        return null;
    }

    // Validate form (returns true if all fields are valid)
    function isFormValid() {
        const repo = getSelectedRepo();
        return repo && dateStart.value && dateEnd.value && dateStart.value < dateEnd.value;
    }

    // Called on form change - validates and triggers comparison if valid
    function onFormChange() {
        if (isFormValid()) {
            performComparison();
        }
    }

    // Load repositories
    try {
        const repos = await API.fetchRepositories();
        codeList.innerHTML = '';
        reposMap.clear();

        repos.forEach(repo => {
            reposMap.set(repo.displayName, repo);
            const opt = document.createElement('option');
            opt.value = repo.displayName;
            opt.dataset.name = repo.name;
            codeList.appendChild(opt);
        });

        codeInput.disabled = false;
        codeInput.placeholder = 'Sélectionnez ou tapez un code...';

        const defaultRepo = repos.find(repo => repo.name === 'code_general_des_impots');
        if (defaultRepo) {
            codeInput.value = defaultRepo.displayName;
            dateStart.value = '2025-12-01';
            dateEnd.value = '2026-01-01';
            // Trigger comparison automatically
            await performComparison();
        }
    } catch (err) {
        console.error('Error loading repos:', err);
        if (window.location.protocol === 'file:') {
            showError('Pour tester localement, lancez un serveur HTTP: python3 -m http.server 8000');
        } else {
            showError('Impossible de charger la liste des codes: ' + err.message);
        }
    }

    // Event listeners - auto-update on change
    codeInput.addEventListener('change', onFormChange);
    codeInput.addEventListener('input', () => {
        // Trigger change when user selects from datalist
        if (getSelectedRepo()) {
            onFormChange();
        }
    });
    dateStart.addEventListener('change', onFormChange);
    dateEnd.addEventListener('change', onFormChange);

    // Mode toggle
    modeToggleContainer.addEventListener('click', async () => {
        // Toggle mode
        if (currentMode === 'before-after') {
            currentMode = 'changes';
            modeToggleContainer.classList.add('mode-changes');
        } else {
            currentMode = 'before-after';
            modeToggleContainer.classList.remove('mode-changes');
        }

        // If data is already loaded, refresh the view
        if (currentCommits.length > 0 && currentRepo) {
            refreshView();
        }
    });

    // Perform comparison
    async function performComparison() {
        if (!isFormValid()) return;

        const repo = getSelectedRepo();
        const repoName = repo.name;
        const since = dateStart.value;
        const until = dateEnd.value;

        showLoading();

        try {
            currentCommits = await API.fetchCommits(repoName, since, until);
            currentRepo = repoName;
            currentStartDate = formatDate(since);
            currentEndDate = formatDate(until);
            currentStartDateISO = since;  // Store ISO format for URLs
            currentEndDateISO = until;    // Store ISO format for URLs

            hideLoading();
            await refreshView();

        } catch (err) {
            showError('Erreur: ' + err.message);
        }
    }

    // Print button click - Prepare header and trigger print dialog
    btnPrint.addEventListener('click', () => {
        // Populate print header with current selection info
        const repo = getSelectedRepo();
        const codeName = repo ? repo.displayName : 'Code juridique';
        const viewType = currentMode === 'before-after' ? 'Vue Avant / Après' : 'Liste des modifications';
        const commitsCount = currentCommits.length;

        printHeader.innerHTML = `
            <h1>${escapeHtml(codeName)}</h1>
            <p><strong>Période :</strong> ${currentStartDate} - ${currentEndDate}</p>
            <p><strong>Mode d'affichage :</strong> ${viewType}</p>
            <p><strong>Nombre de modifications :</strong> ${commitsCount}</p>
        `;

        // Trigger browser print dialog
        // User can save as PDF from the print dialog
        window.print();
    });

    // Render diff lines (pre-computed)
    function renderDiffLines(diffLines, container) {
        container.innerHTML = '';
        diffLines.forEach(line => {
            // Skip reference sections
            if (shouldSkipLine(line.content)) {
                return;
            }

            const div = document.createElement('div');
            div.className = `diff-line diff-line-${line.type}`;

            const marker = document.createElement('span');
            marker.className = 'diff-line-marker';
            marker.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

            const content = document.createElement('span');
            content.className = 'diff-line-content';
            content.innerHTML = renderMarkdown(line.content || '');

            div.appendChild(marker);
            div.appendChild(content);
            container.appendChild(div);
        });
    }

    // Render commit detail
    async function renderCommitDetail(repoName, commit) {
        try {
            commitDiff.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

            const detail = await API.fetchCommitDetail(repoName, commit.sha);

            const externalLink = detail.externalUrl
                ? `<a href="${detail.externalUrl}" target="_blank" rel="noopener" class="external-link">Voir sur git.tricoteuses.fr ↗</a>`
                : '';

            // Handle unavailable details
            if (detail.unavailable) {
                commitHeader.innerHTML = `
                    <h4>${escapeHtml(detail.message)}</h4>
                `;
                commitDiff.innerHTML = `
                    <div class="error">
                        <p>${escapeHtml(detail.errorMessage)}</p>
                        ${externalLink ? `<p>Vous pouvez consulter ce commit sur le dépôt externe :</p><p>${externalLink}</p>` : ''}
                    </div>
                `;
                return;
            }

            const articlesLabel = detail.stats.filesChanged === 1 ? '1 article' : `${detail.stats.filesChanged} articles`;

            commitHeader.innerHTML = `
                <h4>${escapeHtml(detail.message)}</h4>
                <div class="commit-meta">
                    ${formatDate(detail.date)} •
                    ${articlesLabel} •
                    <span class="stat-add">+${detail.stats.additions}</span>
                    <span class="stat-del">-${detail.stats.deletions}</span>
                    ${externalLink}
                </div>
            `;

            commitDiff.innerHTML = '';

            if (!detail.files || detail.files.length === 0) {
                commitDiff.innerHTML = '<div class="no-results"><p>Aucun changement.</p></div>';
                return;
            }

            detail.files.forEach(file => {
                const header = document.createElement('div');
                header.className = 'diff-file-header';

                let fileName = escapeHtml(file.articleName || file.filename);

                // Build external links with dated URLs
                let externalLinks = '';
                // Use dated Legifrance URL
                const legiUrl = buildLegifranceUrlWithDate(file.legifranceUrl, detail.date);
                if (legiUrl) {
                    externalLinks += ` <a href="${escapeHtml(legiUrl)}" target="_blank" rel="noopener" class="external-link">↗ Légifrance</a>`;
                }
                // Use file-specific Tricoteuses URL
                if (detail.fullSha && file.filename) {
                    const tricoteusesUrl = `https://git.tricoteuses.fr/codes/${repoName}/src/commit/${detail.fullSha}/${file.filename}`;
                    externalLinks += ` <a href="${tricoteusesUrl}" target="_blank" rel="noopener" class="external-link">↗ Tricoteuses</a>`;
                }
                fileName += externalLinks;

                header.innerHTML = `
                    <span class="file-name">${fileName}</span>
                    <span class="file-stats">
                        <span class="stat-add">+${file.additions}</span>
                        <span class="stat-del">-${file.deletions}</span>
                    </span>
                `;
                commitDiff.appendChild(header);

                const diffContainer = document.createElement('div');
                renderDiffLines(file.diff, diffContainer);
                commitDiff.appendChild(diffContainer);
            });

        } catch (err) {
            commitDiff.innerHTML = `<div class="error"><p>Erreur: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    // Render side-by-side view from multiple commits
    async function renderBeforeAfterView(repoName, commits, startDate, endDate, startDateISO, endDateISO) {
        if (commits.length === 0) {
            diffLeft.innerHTML = '<div class="no-results"><p>Aucune modification.</p></div>';
            return;
        }

        // Show loading spinner while fetching commits
        diffLeft.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement des modifications...</p></div>';

        // Aggregate all files from commits, tracking first and last commits for each file
        const fileMap = new Map(); // filename -> file data with first/last commits

        for (const commit of commits) {
            try {
                const detail = await API.fetchCommitDetail(repoName, commit.sha);
                for (const file of detail.files || []) {
                    const key = file.filename;
                    if (!fileMap.has(key)) {
                        // First occurrence of this file
                        fileMap.set(key, {
                            ...file,
                            commitDate: detail.date,
                            commitFullSha: detail.fullSha,
                            firstCommitSha: detail.fullSha,
                            lastCommitSha: detail.fullSha,
                            commitRepoName: repoName
                        });
                    } else {
                        // Update last commit for this file
                        const existing = fileMap.get(key);
                        existing.lastCommitSha = detail.fullSha;
                        // Also merge diff if needed (keep latest version)
                        existing.diff = file.diff;
                        existing.additions = file.additions;
                        existing.deletions = file.deletions;
                    }
                }
            } catch (e) {
                console.error('Error loading commit:', e);
            }
        }

        const allFiles = Array.from(fileMap.values());

        // Render each file as a separate table
        renderBeforeAfterTables(allFiles, diffLeft, startDate, endDate, startDateISO, endDateISO);
    }

    // Helper to extract LEGIARTI ID from Legifrance URL
    function extractLegifranceId(url) {
        if (!url) return null;
        // Match LEGIARTI followed by 12+ digits
        const match = url.match(/LEGIARTI\d{12,}/);
        return match ? match[0] : null;
    }

    // Helper to build Legifrance URL with date
    // Format: https://www.legifrance.gouv.fr/codes/article_lc/{LEGIARTI}/{YYYY-MM-DD}
    function buildLegifranceUrlWithDate(legifranceUrl, isoDate) {
        if (!legifranceUrl || !isoDate) return null;
        const legiId = extractLegifranceId(legifranceUrl);
        if (!legiId) return null;
        return `https://www.legifrance.gouv.fr/codes/article_lc/${legiId}/${isoDate}`;
    }

    function renderBeforeAfterTables(files, container, startDate, endDate, startDateISO, endDateISO) {
        container.innerHTML = '';

        if (files.length === 0) {
            container.innerHTML = '<div class="no-results"><p>Aucune modification.</p></div>';
            return;
        }

        // Create single sticky header with dates
        const stickyHeader = document.createElement('div');
        stickyHeader.className = 'before-after-sticky-header';
        stickyHeader.innerHTML = `
            <div class="sticky-date-left">Version du ${startDate}</div>
            <div class="sticky-date-right">Version du ${endDate}</div>
        `;
        container.appendChild(stickyHeader);

        files.forEach((file, fileIndex) => {
            // Create a single table for this article with two columns
            const table = document.createElement('table');
            table.className = 'before-after-table';
            table.style.width = '100%';
            table.style.marginBottom = '2em';

            // Create header with article title spanning both columns
            const thead = document.createElement('thead');

            // Title row
            const titleRow = document.createElement('tr');
            const titleCell = document.createElement('th');
            titleCell.colSpan = 2;
            titleCell.innerHTML = escapeHtml(file.articleName || file.filename);
            titleCell.style.textAlign = 'center';
            titleCell.style.fontSize = '1.1em';
            titleCell.style.padding = '0.75em 0.75em 0.25em 0.75em';
            titleCell.style.borderTop = '2px solid var(--color-border)';
            titleRow.appendChild(titleCell);
            thead.appendChild(titleRow);

            // Links row - one cell per column with dated links
            const linksRow = document.createElement('tr');
            linksRow.className = 'article-links-row';

            // Left column links (before - start date)
            const linksLeftCell = document.createElement('th');
            linksLeftCell.style.textAlign = 'center';
            linksLeftCell.style.padding = '0.25em 0.5em 0.75em 0.5em';
            linksLeftCell.style.fontWeight = 'normal';
            linksLeftCell.style.fontSize = '0.85em';

            let leftLinks = [];
            const legiUrlBefore = buildLegifranceUrlWithDate(file.legifranceUrl, startDateISO);
            if (legiUrlBefore) {
                leftLinks.push(`<a href="${escapeHtml(legiUrlBefore)}" target="_blank" rel="noopener" class="external-link">Légifrance</a>`);
            }
            if (file.commitRepoName && file.filename && file.firstCommitSha) {
                const gitUrlBefore = `https://git.tricoteuses.fr/codes/${file.commitRepoName}/src/commit/${file.firstCommitSha}/${file.filename}`;
                leftLinks.push(`<a href="${escapeHtml(gitUrlBefore)}" target="_blank" rel="noopener" class="external-link">Tricoteuses</a>`);
            }
            linksLeftCell.innerHTML = leftLinks.length > 0 ? leftLinks.join(' · ') : '';
            linksRow.appendChild(linksLeftCell);

            // Right column links (after - end date)
            const linksRightCell = document.createElement('th');
            linksRightCell.style.textAlign = 'center';
            linksRightCell.style.padding = '0.25em 0.5em 0.75em 0.5em';
            linksRightCell.style.fontWeight = 'normal';
            linksRightCell.style.fontSize = '0.85em';

            let rightLinks = [];
            const legiUrlAfter = buildLegifranceUrlWithDate(file.legifranceUrl, endDateISO);
            if (legiUrlAfter) {
                rightLinks.push(`<a href="${escapeHtml(legiUrlAfter)}" target="_blank" rel="noopener" class="external-link">Légifrance</a>`);
            }
            if (file.commitRepoName && file.filename && file.lastCommitSha) {
                const gitUrlAfter = `https://git.tricoteuses.fr/codes/${file.commitRepoName}/src/commit/${file.lastCommitSha}/${file.filename}`;
                rightLinks.push(`<a href="${escapeHtml(gitUrlAfter)}" target="_blank" rel="noopener" class="external-link">Tricoteuses</a>`);
            }
            linksRightCell.innerHTML = rightLinks.length > 0 ? rightLinks.join(' · ') : '';
            linksRow.appendChild(linksRightCell);

            thead.appendChild(linksRow);
            table.appendChild(thead);

            // Create body
            const tbody = document.createElement('tbody');

            // Process diff lines for before/after aligned view
            const alignedLines = alignBeforeAfterLines(file.diff || []);

            // Render aligned lines
            alignedLines.forEach(({beforeLine, afterLine}) => {
                const row = document.createElement('tr');

                // Left cell (before)
                const cellLeft = document.createElement('td');
                cellLeft.className = beforeLine ? `diff-line-${beforeLine.type}` : 'diff-line-empty';
                cellLeft.innerHTML = beforeLine ? renderMarkdown(beforeLine.content || '') : '&nbsp;';
                cellLeft.style.width = '50%';
                cellLeft.style.verticalAlign = 'top';
                cellLeft.style.padding = '0.25em 0.5em';
                row.appendChild(cellLeft);

                // Right cell (after)
                const cellRight = document.createElement('td');
                cellRight.className = afterLine ? `diff-line-${afterLine.type}` : 'diff-line-empty';
                cellRight.innerHTML = afterLine ? renderMarkdown(afterLine.content || '') : '&nbsp;';
                cellRight.style.width = '50%';
                cellRight.style.verticalAlign = 'top';
                cellRight.style.padding = '0.25em 0.5em';
                row.appendChild(cellRight);

                tbody.appendChild(row);
            });

            table.appendChild(tbody);
            container.appendChild(table);
        });
    }

    function alignBeforeAfterLines(diffLines) {
        // Process diff lines to create aligned before/after view
        // Strategy: unchanged lines appear in both, deletions only in before, additions only in after
        // Add blank lines to maintain alignment
        const result = [];
        let i = 0;

        while (i < diffLines.length) {
            const line = diffLines[i];

            // Skip reference sections
            if (shouldSkipLine(line.content)) {
                i++;
                continue;
            }

            if (line.type === 'unchanged') {
                // Show in both columns
                result.push({beforeLine: line, afterLine: line});
                i++;
            } else if (line.type === 'del') {
                // Collect consecutive deletions
                const deletions = [];
                while (i < diffLines.length && diffLines[i].type === 'del' && !shouldSkipLine(diffLines[i].content)) {
                    deletions.push(diffLines[i]);
                    i++;
                }

                // Check if followed by additions (replacement scenario)
                const additions = [];
                let j = i;
                while (j < diffLines.length && diffLines[j].type === 'add' && !shouldSkipLine(diffLines[j].content)) {
                    additions.push(diffLines[j]);
                    j++;
                }

                if (additions.length > 0) {
                    // Replacement: align deletions and additions
                    const maxLen = Math.max(deletions.length, additions.length);
                    for (let k = 0; k < maxLen; k++) {
                        result.push({
                            beforeLine: k < deletions.length ? deletions[k] : null,
                            afterLine: k < additions.length ? additions[k] : null
                        });
                    }
                    i = j; // Skip the additions we just processed
                } else {
                    // Pure deletions: show in before only, blank in after
                    deletions.forEach(del => {
                        result.push({beforeLine: del, afterLine: null});
                    });
                }
            } else if (line.type === 'add') {
                // Collect consecutive additions
                const additions = [];
                while (i < diffLines.length && diffLines[i].type === 'add' && !shouldSkipLine(diffLines[i].content)) {
                    additions.push(diffLines[i]);
                    i++;
                }

                // Pure additions: blank in before, show in after
                additions.forEach(add => {
                    result.push({beforeLine: null, afterLine: add});
                });
            } else {
                i++;
            }
        }

        return result;
    }

    function shouldSkipLine(content) {
        if (!content) return false;
        const trimmed = content.trim();

        // Skip markdown separators (---, ===, etc.)
        if (/^[\-=]{3,}$/.test(trimmed)) {
            return true;
        }

        // Skip reference section headers
        if (trimmed === 'Références' || trimmed === 'Autres formats') {
            return true;
        }
        if (trimmed.startsWith('### Articles faisant référence') || trimmed.startsWith('### Textes faisant référence') || trimmed.startsWith('### Références faites par l\'article')) {
            return true;
        }
        if (trimmed.startsWith('## Références') || trimmed.startsWith('## Autres formats')) {
            return true;
        }

        // Skip article header (e.g., "Article R4137-48")
        if (/^Article\s+[A-Z]?\d+[A-Z0-9\-]*$/i.test(trimmed)) {
            return true;
        }

        // Skip file format bullets with markdown links
        if (trimmed.startsWith('* [JSON dans git]') || trimmed.startsWith('* [Références JSON dans git]')) {
            return true;
        }
        if (trimmed.startsWith('* [Markdown dans git]') || trimmed.startsWith('* [Légifrance]')) {
            return true;
        }
        if (trimmed.startsWith('* [Markdown chronologique dans git]')) {
            return true;
        }

        // Also skip simple bullet points (backward compatibility)
        if (trimmed.startsWith('* JSON dans git') || trimmed.startsWith('* Références JSON dans git')) {
            return true;
        }
        if (trimmed.startsWith('* Markdown dans git') || trimmed.startsWith('* Légifrance')) {
            return true;
        }
        if (trimmed.startsWith('* Markdown chronologique dans git')) {
            return true;
        }

        // Skip reference content with legal status keywords (including CODIFICATION)
        if (/AUTONOME|VIGUEUR|MODIFIE|CITATION|CREE|ENTIEREMENT_MODIF|CODIFICATION/.test(trimmed)) {
            if (trimmed.includes(' cible') || trimmed.includes(' source')) {
                return true;
            }
        }

        // Skip date-based references
        if (/^\d{4}-\d{2}-\d{2}\s+(CREE|MODIFIE|CITATION)/.test(trimmed)) {
            return true;
        }

        // Skip special date references
        if (/^\s*\d{4}-\d{2}-\d{2}\s+(cible|source)/.test(trimmed)) {
            return true;
        }

        // Skip article references
        if (trimmed.startsWith('Code de ') || trimmed.startsWith('Code général')) {
            if (/AUTONOME|VIGUEUR|MODIFIE|en vigueur/.test(trimmed)) {
                return true;
            }
        }

        // Skip decree/law references
        if (/^(Décret n°|Ordonnance n°|LOI n°|Loi n°)/.test(trimmed)) {
            if ((trimmed.includes(' - article ') || trimmed.includes(' - art. ')) && /AUTONOME|VIGUEUR|MODIFIE|CREE|ENTIEREMENT_MODIF|CODIFICATION/.test(trimmed)) {
                return true;
            }
        }

        return false;
    }


    function renderMarkdown(text) {
        if (!text) return '';

        let html = escapeHtml(text);

        // Headers
        html = html.replace(/^### (.+)$/gm, '<strong>$1</strong>');
        html = html.replace(/^## (.+)$/gm, '<strong>$1</strong>');
        html = html.replace(/^# (.+)$/gm, '<strong>$1</strong>');

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.+?)_/g, '<em>$1</em>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        return html;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }


    // Refresh view based on current mode
    async function refreshView() {
        results.classList.remove('hidden');
        btnPrint.classList.remove('hidden');

        if (currentMode === 'changes') {
            viewChanges.classList.remove('hidden');
            viewBeforeAfter.classList.add('hidden');

            commitsList.innerHTML = '';

            if (currentCommits.length === 0) {
                commitsList.innerHTML = '<li class="no-results"><p>Aucune modification.</p></li>';
                commitHeader.innerHTML = '<p class="placeholder">Aucune modification trouvée.</p>';
                commitDiff.innerHTML = '';
                return;
            }

            currentCommits.forEach((commit, idx) => {
                const li = document.createElement('li');
                const articlesLabel = commit.files === 1 ? '1 article' : `${commit.files || '?'} articles`;
                li.innerHTML = `
                    <div class="commit-date">${formatDate(commit.date)} <span class="commit-files">(${articlesLabel})</span></div>
                    <div class="commit-message">${escapeHtml(commit.message)}</div>
                `;
                li.addEventListener('click', () => {
                    commitsList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
                    li.classList.add('active');
                    renderCommitDetail(currentRepo, commit);
                });
                commitsList.appendChild(li);

                if (idx === 0) li.click();
            });

        } else {
            viewBeforeAfter.classList.remove('hidden');
            viewChanges.classList.add('hidden');
            await renderBeforeAfterView(currentRepo, currentCommits, currentStartDate, currentEndDate, currentStartDateISO, currentEndDateISO);
        }
    }

});
