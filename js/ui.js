/**
 * UI Module - Handles DOM manipulation and user interactions
 */

const UI = (() => {
    // DOM Elements cache
    let elements = {};

    /**
     * Initialize UI elements cache
     */
    function init() {
        elements = {
            codeSelect: document.getElementById('code-select'),
            dateStart: document.getElementById('date-start'),
            dateEnd: document.getElementById('date-end'),
            btnCompare: document.getElementById('btn-compare'),
            modeBeforeAfter: document.getElementById('mode-before-after'),
            modeChanges: document.getElementById('mode-changes'),
            loading: document.getElementById('loading'),
            error: document.getElementById('error'),
            errorMessage: document.getElementById('error-message'),
            results: document.getElementById('results'),
            viewBeforeAfter: document.getElementById('view-before-after'),
            viewChanges: document.getElementById('view-changes'),
            labelDateStart: document.getElementById('label-date-start'),
            labelDateEnd: document.getElementById('label-date-end'),
            diffLeft: document.getElementById('diff-left'),
            diffRight: document.getElementById('diff-right'),
            commitsList: document.getElementById('commits-list'),
            commitHeader: document.getElementById('commit-header'),
            commitDiff: document.getElementById('commit-diff'),
            fileSelector: document.getElementById('file-selector'),
            fileSelect: document.getElementById('file-select')
        };

        // Set default dates
        const today = new Date();
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

        elements.dateEnd.value = formatDateForInput(today);
        elements.dateStart.value = formatDateForInput(oneMonthAgo);

        // Setup scroll synchronization for side-by-side view
        setupScrollSync();
    }

    /**
     * Format date for input[type="date"]
     */
    function formatDateForInput(date) {
        return date.toISOString().split('T')[0];
    }

    /**
     * Format date for display (French format)
     */
    function formatDateForDisplay(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    }

    /**
     * Populate the code selector dropdown
     */
    function populateCodeSelector(codes) {
        elements.codeSelect.innerHTML = '<option value="">Sélectionnez un code...</option>';

        codes.forEach(code => {
            const option = document.createElement('option');
            option.value = code.name;
            option.textContent = code.displayName;
            elements.codeSelect.appendChild(option);
        });

        elements.codeSelect.disabled = false;
    }

    /**
     * Get current form values
     */
    function getFormValues() {
        return {
            code: elements.codeSelect.value,
            dateStart: elements.dateStart.value,
            dateEnd: elements.dateEnd.value,
            mode: elements.modeBeforeAfter.classList.contains('active') ? 'before-after' : 'changes'
        };
    }

    /**
     * Validate form and enable/disable compare button
     */
    function validateForm() {
        const values = getFormValues();
        const isValid = values.code && values.dateStart && values.dateEnd &&
                       values.dateStart < values.dateEnd;
        elements.btnCompare.disabled = !isValid;
        return isValid;
    }

    /**
     * Show loading state
     */
    function showLoading() {
        elements.loading.classList.remove('hidden');
        elements.error.classList.add('hidden');
        elements.results.classList.add('hidden');
        elements.fileSelector.classList.add('hidden');
    }

    /**
     * Hide loading state
     */
    function hideLoading() {
        elements.loading.classList.add('hidden');
    }

    /**
     * Show error message
     */
    function showError(message) {
        elements.errorMessage.textContent = message;
        elements.error.classList.remove('hidden');
        elements.results.classList.add('hidden');
        hideLoading();
    }

    /**
     * Show results section
     */
    function showResults(mode) {
        elements.results.classList.remove('hidden');

        if (mode === 'before-after') {
            elements.viewBeforeAfter.classList.remove('hidden');
            elements.viewChanges.classList.add('hidden');
        } else {
            elements.viewBeforeAfter.classList.add('hidden');
            elements.viewChanges.classList.remove('hidden');
        }
    }

    /**
     * Update date labels in the before/after view
     */
    function updateDateLabels(startDate, endDate) {
        elements.labelDateStart.textContent = formatDateForDisplay(startDate);
        elements.labelDateEnd.textContent = formatDateForDisplay(endDate);
    }

    /**
     * Render the before/after side-by-side view
     */
    function renderBeforeAfterView(oldContent, newContent) {
        const diff = Diff.computeDiff(oldContent, newContent);
        const { leftLines, rightLines } = Diff.renderSideBySideDiff(diff);

        elements.diffLeft.innerHTML = '';
        elements.diffRight.innerHTML = '';

        elements.diffLeft.appendChild(Diff.renderDiffPane(leftLines));
        elements.diffRight.appendChild(Diff.renderDiffPane(rightLines));
    }

    /**
     * Render commits list for changes view
     */
    function renderCommitsList(commits, onSelectCommit) {
        elements.commitsList.innerHTML = '';

        if (commits.length === 0) {
            const li = document.createElement('li');
            li.className = 'no-results';
            li.innerHTML = '<p>Aucune modification trouvée pour cette période.</p>';
            elements.commitsList.appendChild(li);
            return;
        }

        commits.forEach((commit, index) => {
            const li = document.createElement('li');
            li.dataset.sha = commit.sha;

            li.innerHTML = `
                <div class="commit-date">${formatDateForDisplay(commit.date)}</div>
                <div class="commit-message">${Diff.escapeHtml(commit.message)}</div>
                <div class="commit-stats">
                    <span class="stat-add">+${commit.stats.additions || 0}</span>
                    <span class="stat-del">-${commit.stats.deletions || 0}</span>
                </div>
            `;

            li.addEventListener('click', () => {
                // Update active state
                elements.commitsList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
                li.classList.add('active');

                // Trigger callback
                onSelectCommit(commit);
            });

            elements.commitsList.appendChild(li);

            // Auto-select first commit
            if (index === 0) {
                li.click();
            }
        });
    }

    /**
     * Render commit detail in changes view
     */
    function renderCommitDetail(commit, fileDiffs) {
        // Update header
        elements.commitHeader.innerHTML = `
            <h4>${Diff.escapeHtml(commit.message)}</h4>
            <div class="commit-meta">
                <span>${formatDateForDisplay(commit.date)}</span>
                <span> • </span>
                <span>${fileDiffs.length} fichier(s) modifié(s)</span>
                <span> • </span>
                <span class="stat-add">+${commit.stats.additions || 0}</span>
                <span class="stat-del">-${commit.stats.deletions || 0}</span>
            </div>
        `;

        // Render diffs
        elements.commitDiff.innerHTML = '';

        if (fileDiffs.length === 0) {
            elements.commitDiff.innerHTML = '<div class="no-results"><p>Aucun changement de contenu.</p></div>';
            return;
        }

        const diffView = Diff.renderMultiFileDiff(fileDiffs);
        elements.commitDiff.appendChild(diffView);
    }

    /**
     * Populate file selector dropdown
     */
    function populateFileSelector(files, onSelectFile) {
        elements.fileSelect.innerHTML = '<option value="">Tous les fichiers modifiés</option>';

        files.forEach(file => {
            const option = document.createElement('option');
            option.value = file;
            // Display just the filename, not full path
            const displayName = file.split('/').pop();
            option.textContent = displayName;
            option.title = file; // Full path on hover
            elements.fileSelect.appendChild(option);
        });

        elements.fileSelector.classList.remove('hidden');

        elements.fileSelect.addEventListener('change', () => {
            onSelectFile(elements.fileSelect.value);
        });
    }

    /**
     * Setup scroll synchronization between left and right panes
     */
    function setupScrollSync() {
        let isSyncing = false;

        const syncScroll = (source, target) => {
            if (isSyncing) return;
            isSyncing = true;

            const scrollPercentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
            target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);

            setTimeout(() => { isSyncing = false; }, 10);
        };

        elements.diffLeft.addEventListener('scroll', () => {
            syncScroll(elements.diffLeft, elements.diffRight);
        });

        elements.diffRight.addEventListener('scroll', () => {
            syncScroll(elements.diffRight, elements.diffLeft);
        });
    }

    /**
     * Setup mode toggle buttons
     */
    function setupModeToggle(onModeChange) {
        elements.modeBeforeAfter.addEventListener('click', () => {
            elements.modeBeforeAfter.classList.add('active');
            elements.modeChanges.classList.remove('active');
            onModeChange('before-after');
        });

        elements.modeChanges.addEventListener('click', () => {
            elements.modeChanges.classList.add('active');
            elements.modeBeforeAfter.classList.remove('active');
            onModeChange('changes');
        });
    }

    /**
     * Show empty state for before/after view
     */
    function showEmptyBeforeAfter(message) {
        elements.diffLeft.innerHTML = `<div class="no-results"><p>${message}</p></div>`;
        elements.diffRight.innerHTML = `<div class="no-results"><p>${message}</p></div>`;
    }

    // Public API
    return {
        init,
        populateCodeSelector,
        getFormValues,
        validateForm,
        showLoading,
        hideLoading,
        showError,
        showResults,
        updateDateLabels,
        renderBeforeAfterView,
        renderCommitsList,
        renderCommitDetail,
        populateFileSelector,
        setupModeToggle,
        showEmptyBeforeAfter,
        formatDateForDisplay,
        elements: () => elements
    };
})();
