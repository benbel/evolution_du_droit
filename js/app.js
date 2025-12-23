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
        showError('Impossible de charger la liste des codes: ' + err.message);
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
            const div = document.createElement('div');
            div.className = `diff-line diff-line-${line.type}`;

            const marker = document.createElement('span');
            marker.className = 'diff-line-marker';
            marker.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

            const content = document.createElement('span');
            content.className = 'diff-line-content';
            content.textContent = line.content;

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

            commitHeader.innerHTML = `
                <h4>${escapeHtml(detail.message)}</h4>
                <div class="commit-meta">
                    ${formatDate(detail.date)} •
                    ${detail.stats.filesChanged} fichier(s) •
                    <span class="stat-add">+${detail.stats.additions}</span>
                    <span class="stat-del">-${detail.stats.deletions}</span>
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
                    <span class="file-name">${escapeHtml(file.filename)}</span>
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

        // Aggregate all diffs
        const leftLines = [];
        const rightLines = [];

        for (const commit of commits.slice(0, 10)) { // Limit to 10
            try {
                const detail = await API.fetchCommitDetail(repoName, commit.sha);
                for (const file of detail.files || []) {
                    leftLines.push({ type: 'unchanged', content: `=== ${file.filename} ===` });
                    rightLines.push({ type: 'unchanged', content: `=== ${file.filename} ===` });

                    for (const line of file.diff || []) {
                        if (line.type === 'del') {
                            leftLines.push(line);
                            rightLines.push({ type: 'empty', content: '' });
                        } else if (line.type === 'add') {
                            leftLines.push({ type: 'empty', content: '' });
                            rightLines.push(line);
                        } else {
                            leftLines.push(line);
                            rightLines.push(line);
                        }
                    }
                }
            } catch (e) {
                console.error('Error loading commit:', e);
            }
        }

        renderDiffPane(leftLines, diffLeft);
        renderDiffPane(rightLines, diffRight);
    }

    function renderDiffPane(lines, container) {
        container.innerHTML = '';
        lines.forEach(line => {
            const div = document.createElement('div');
            div.className = `diff-line diff-line-${line.type}`;
            if (line.type === 'empty') {
                div.style.minHeight = '1.6em';
            }

            const marker = document.createElement('span');
            marker.className = 'diff-line-marker';
            marker.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

            const content = document.createElement('span');
            content.className = 'diff-line-content';
            content.textContent = line.content;

            div.appendChild(marker);
            div.appendChild(content);
            container.appendChild(div);
        });
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
                    li.innerHTML = `
                        <div class="commit-date">${formatDate(commit.date)}</div>
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
