/**
 * App - Simple viewer for pre-computed legal code changes
 */

document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const codeSelect = document.getElementById('code-select');
    const dateStart = document.getElementById('date-start');
    const dateEnd = document.getElementById('date-end');
    const btnCompare = document.getElementById('btn-compare');
    const modeToggleContainer = document.getElementById('mode-toggle-container');
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const errorMessage = document.getElementById('error-message');
    const results = document.getElementById('results');
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

    // Validate form
    function validateForm() {
        const valid = codeSelect.value && dateStart.value && dateEnd.value && dateStart.value < dateEnd.value;
        btnCompare.disabled = !valid;
        return valid;
    }

    // Load repositories
    try {
        const repos = await API.fetchRepositories();
        codeSelect.innerHTML = '<option value="">Sélectionnez un code...</option>';
        repos.forEach(repo => {
            const opt = document.createElement('option');
            opt.value = repo.name;
            opt.textContent = repo.displayName;
            codeSelect.appendChild(opt);
        });
        codeSelect.disabled = false;

        // Load default comparison: Code de la défense, 01/01/2020 vs 01/01/2026
        const defaultRepo = repos.find(repo => repo.name === 'code_de_la_defense');
        if (defaultRepo) {
            codeSelect.value = defaultRepo.name;
            dateStart.value = '2020-01-01';
            dateEnd.value = '2026-01-01';
            validateForm();
            // Trigger comparison automatically
            btnCompare.click();
        }
    } catch (err) {
        console.error('Error loading repos:', err);
        if (window.location.protocol === 'file:') {
            showError('Pour tester localement, lancez un serveur HTTP: python3 -m http.server 8000');
        } else {
            showError('Impossible de charger la liste des codes: ' + err.message);
        }
    }

    // Event listeners
    codeSelect.addEventListener('change', validateForm);
    dateStart.addEventListener('change', validateForm);
    dateEnd.addEventListener('change', validateForm);

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

    // Compare button click
    btnCompare.addEventListener('click', async () => {
        if (!validateForm()) return;

        const repoName = codeSelect.value;
        const since = dateStart.value;
        const until = dateEnd.value;

        showLoading();

        try {
            currentCommits = await API.fetchCommits(repoName, since, until);
            currentRepo = repoName;
            currentStartDate = formatDate(since);
            currentEndDate = formatDate(until);

            hideLoading();
            await refreshView();

        } catch (err) {
            showError('Erreur: ' + err.message);
        }
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
                header.innerHTML = `
                    <span class="file-name">${escapeHtml(file.articleName || file.filename)}</span>
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
    async function renderBeforeAfterView(repoName, commits, startDate, endDate) {
        if (commits.length === 0) {
            diffLeft.innerHTML = '<div class="no-results"><p>Aucune modification.</p></div>';
            return;
        }

        // Aggregate all files from commits
        const allFiles = [];

        for (const commit of commits.slice(0, 10)) { // Limit to 10
            try {
                const detail = await API.fetchCommitDetail(repoName, commit.sha);
                for (const file of detail.files || []) {
                    allFiles.push(file);
                }
            } catch (e) {
                console.error('Error loading commit:', e);
            }
        }

        // Render each file as a separate table
        renderBeforeAfterTables(allFiles, diffLeft, startDate, endDate);
    }

    function renderBeforeAfterTables(files, container, startDate, endDate) {
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

            // Title row (only article name, no dates)
            const titleRow = document.createElement('tr');
            const titleCell = document.createElement('th');
            titleCell.colSpan = 2;
            titleCell.innerHTML = escapeHtml(file.articleName || file.filename);
            titleCell.style.textAlign = 'center';
            titleCell.style.fontSize = '1.1em';
            titleCell.style.padding = '0.75em';
            titleCell.style.borderTop = '2px solid var(--color-border)';
            titleRow.appendChild(titleCell);
            thead.appendChild(titleRow);

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

    function renderDiffLinesInContainer(lines, container, showMarkers = true) {
        // Collapse multiple consecutive empty lines into one
        const collapsedLines = [];
        let lastWasEmpty = false;

        for (const line of lines) {
            const isEmpty = !line.content || line.content.trim() === '';

            if (isEmpty && lastWasEmpty) {
                // Skip this empty line, we already have one
                continue;
            }

            collapsedLines.push(line);
            lastWasEmpty = isEmpty;
        }

        // Render lines
        collapsedLines.forEach(line => {
            const div = document.createElement('div');
            div.className = `diff-line diff-line-${line.type}`;

            if (showMarkers) {
                const marker = document.createElement('span');
                marker.className = 'diff-line-marker';
                marker.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
                div.appendChild(marker);
            }

            const content = document.createElement('span');
            content.className = 'diff-line-content';
            content.innerHTML = renderMarkdown(line.content || '');

            div.appendChild(content);
            container.appendChild(div);
        });
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
        if (trimmed.startsWith('### Articles faisant référence') || trimmed.startsWith('### Textes faisant référence')) {
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
            await renderBeforeAfterView(currentRepo, currentCommits, currentStartDate, currentEndDate);
        }
    }

});
