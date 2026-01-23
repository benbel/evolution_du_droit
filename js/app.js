/**
 * App - Simple viewer for pre-computed legal code changes
 */

document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const codeSelect = document.getElementById('code-select');
    const dateStart = document.getElementById('date-start');
    const dateEnd = document.getElementById('date-end');
    const btnCompare = document.getElementById('btn-compare');
    const modeBeforeAfter = document.getElementById('mode-before-after');
    const modeChanges = document.getElementById('mode-changes');
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
    const diffRight = document.getElementById('diff-right');
    const labelDateStart = document.getElementById('label-date-start');
    const labelDateEnd = document.getElementById('label-date-end');

    // State
    let currentMode = 'changes';
    let currentCommits = [];

    // Set default dates
    const today = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    dateEnd.value = today.toISOString().split('T')[0];
    dateStart.value = oneMonthAgo.toISOString().split('T')[0];

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

    modeBeforeAfter.addEventListener('click', () => {
        currentMode = 'before-after';
        modeBeforeAfter.classList.add('active');
        modeChanges.classList.remove('active');
    });

    modeChanges.addEventListener('click', () => {
        currentMode = 'changes';
        modeChanges.classList.add('active');
        modeBeforeAfter.classList.remove('active');
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
    async function renderBeforeAfterView(repoName, commits) {
        if (commits.length === 0) {
            diffLeft.innerHTML = '<div class="no-results"><p>Aucune modification.</p></div>';
            diffRight.innerHTML = '<div class="no-results"><p>Aucune modification.</p></div>';
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
        renderBeforeAfterTables(allFiles, diffLeft, diffRight);
    }

    function renderBeforeAfterTables(files, leftContainer, rightContainer) {
        leftContainer.innerHTML = '';
        rightContainer.innerHTML = '';

        if (files.length === 0) {
            leftContainer.innerHTML = '<div class="no-results"><p>Aucune modification.</p></div>';
            rightContainer.innerHTML = '<div class="no-results"><p>Aucune modification.</p></div>';
            return;
        }

        files.forEach((file, fileIndex) => {
            // Create article title section (spans both columns)
            const titleLeft = document.createElement('div');
            titleLeft.className = 'article-title';
            titleLeft.innerHTML = `<strong>${escapeHtml(file.articleName || file.filename)}</strong>`;

            const titleRight = document.createElement('div');
            titleRight.className = 'article-title';
            titleRight.innerHTML = `<strong>${escapeHtml(file.articleName || file.filename)}</strong>`;

            leftContainer.appendChild(titleLeft);
            rightContainer.appendChild(titleRight);

            // Process diff lines for before/after complete view
            // BEFORE: unchanged + del (with del in red)
            // AFTER: unchanged + add (with add in green)
            const leftLines = [];
            const rightLines = [];

            for (const line of file.diff || []) {
                // Skip reference sections
                if (shouldSkipLine(line.content)) {
                    continue;
                }

                if (line.type === 'del') {
                    // Show deletion in BEFORE (left) only
                    leftLines.push(line);
                } else if (line.type === 'add') {
                    // Show addition in AFTER (right) only
                    rightLines.push(line);
                } else {
                    // Show unchanged in both
                    leftLines.push(line);
                    rightLines.push(line);
                }
            }

            // Render diff lines for this file (no markers in before/after view)
            const leftDiffSection = document.createElement('div');
            leftDiffSection.className = 'article-diff-section';
            renderDiffLinesInContainer(leftLines, leftDiffSection, false);
            leftContainer.appendChild(leftDiffSection);

            const rightDiffSection = document.createElement('div');
            rightDiffSection.className = 'article-diff-section';
            renderDiffLinesInContainer(rightLines, rightDiffSection, false);
            rightContainer.appendChild(rightDiffSection);
        });
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

        // Skip reference section headers
        if (trimmed === 'Références' || trimmed === 'Autres formats') {
            return true;
        }
        if (trimmed.startsWith('### Articles faisant référence')) {
            return true;
        }
        if (trimmed.startsWith('## Références') || trimmed.startsWith('## Autres formats')) {
            return true;
        }

        // Skip file format bullets
        if (trimmed.startsWith('* JSON dans git') || trimmed.startsWith('* Références JSON dans git')) {
            return true;
        }
        if (trimmed.startsWith('* Markdown dans git') || trimmed.startsWith('* Légifrance')) {
            return true;
        }

        // Skip reference content with legal status keywords
        if (/AUTONOME |VIGUEUR,|MODIFIE,|CITATION |CREE /.test(trimmed)) {
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
            if (trimmed.includes(' - article ') && /AUTONOME|VIGUEUR|MODIFIE|CREE/.test(trimmed)) {
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

    // Compare button click
    btnCompare.addEventListener('click', async () => {
        if (!validateForm()) return;

        const repoName = codeSelect.value;
        const since = dateStart.value;
        const until = dateEnd.value;

        showLoading();

        try {
            currentCommits = await API.fetchCommits(repoName, since, until);
            hideLoading();
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
                        renderCommitDetail(repoName, commit);
                    });
                    commitsList.appendChild(li);

                    if (idx === 0) li.click();
                });

            } else {
                viewBeforeAfter.classList.remove('hidden');
                viewChanges.classList.add('hidden');
                labelDateStart.textContent = formatDate(since);
                labelDateEnd.textContent = formatDate(until);
                await renderBeforeAfterView(repoName, currentCommits);
            }

        } catch (err) {
            showError('Erreur: ' + err.message);
        }
    });

    // Scroll sync for side-by-side view
    let syncing = false;
    diffLeft.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        diffRight.scrollTop = diffLeft.scrollTop;
        setTimeout(() => syncing = false, 10);
    });
    diffRight.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        diffLeft.scrollTop = diffRight.scrollTop;
        setTimeout(() => syncing = false, 10);
    });
});
