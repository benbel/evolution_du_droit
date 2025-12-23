/**
 * App Module - Main application entry point
 */

const App = (() => {
    // Current state
    let state = {
        repositories: [],
        currentCode: null,
        commits: [],
        changedFiles: [],
        mode: 'before-after'
    };

    /**
     * Initialize the application
     */
    async function init() {
        // Initialize UI
        UI.init();

        // Setup event listeners
        setupEventListeners();

        // Load repositories
        await loadRepositories();
    }

    /**
     * Setup all event listeners
     */
    function setupEventListeners() {
        const elements = UI.elements();

        // Code selector change
        elements.codeSelect.addEventListener('change', () => {
            state.currentCode = elements.codeSelect.value;
            UI.validateForm();
        });

        // Date inputs change
        elements.dateStart.addEventListener('change', UI.validateForm);
        elements.dateEnd.addEventListener('change', UI.validateForm);

        // Compare button click
        elements.btnCompare.addEventListener('click', handleCompare);

        // Mode toggle
        UI.setupModeToggle((mode) => {
            state.mode = mode;
            // If we have results, re-render them in the new mode
            if (state.commits.length > 0) {
                handleCompare();
            }
        });
    }

    /**
     * Load available repositories
     */
    async function loadRepositories() {
        try {
            state.repositories = await API.fetchRepositories();
            UI.populateCodeSelector(state.repositories);
        } catch (error) {
            console.error('Error loading repositories:', error);
            UI.showError('Impossible de charger la liste des codes. Veuillez rafraîchir la page.');
        }
    }

    /**
     * Handle compare button click
     */
    async function handleCompare() {
        const values = UI.getFormValues();

        if (!UI.validateForm()) {
            return;
        }

        UI.showLoading();

        try {
            if (values.mode === 'before-after') {
                await loadBeforeAfterView(values.code, values.dateStart, values.dateEnd);
            } else {
                await loadChangesView(values.code, values.dateStart, values.dateEnd);
            }
        } catch (error) {
            console.error('Error comparing:', error);
            UI.showError(`Une erreur est survenue: ${error.message}`);
        }
    }

    /**
     * Load and display the before/after view
     */
    async function loadBeforeAfterView(code, startDate, endDate) {
        // Get changes between dates to know which files were modified
        const changes = await API.getChangesBetweenDates(code, startDate, endDate);
        state.commits = changes.commits;
        state.changedFiles = changes.files;

        if (changes.files.length === 0) {
            UI.hideLoading();
            UI.showResults('before-after');
            UI.updateDateLabels(startDate, endDate);
            UI.showEmptyBeforeAfter('Aucune modification trouvée pour cette période.');
            return;
        }

        // Populate file selector
        UI.populateFileSelector(changes.files, async (selectedFile) => {
            await renderBeforeAfterForFile(code, startDate, endDate, selectedFile);
        });

        // Render the first file or all files combined
        await renderBeforeAfterForFile(code, startDate, endDate, '');

        UI.hideLoading();
        UI.showResults('before-after');
        UI.updateDateLabels(startDate, endDate);
    }

    /**
     * Render before/after view for a specific file or all files
     */
    async function renderBeforeAfterForFile(code, startDate, endDate, selectedFile) {
        UI.showLoading();

        try {
            let oldContent = '';
            let newContent = '';

            if (selectedFile) {
                // Get content for specific file
                oldContent = await API.getFileAtDate(code, selectedFile, startDate) || '';
                newContent = await API.getFileAtDate(code, selectedFile, endDate) || '';
            } else {
                // Combine all changed files
                const filesToShow = state.changedFiles.slice(0, 10); // Limit to 10 files to avoid performance issues

                for (const file of filesToShow) {
                    const oldFileContent = await API.getFileAtDate(code, file, startDate) || '';
                    const newFileContent = await API.getFileAtDate(code, file, endDate) || '';

                    const fileName = file.split('/').pop();
                    const separator = `\n\n${'='.repeat(60)}\n📄 ${fileName}\n${'='.repeat(60)}\n\n`;

                    oldContent += separator + oldFileContent;
                    newContent += separator + newFileContent;
                }

                if (state.changedFiles.length > 10) {
                    const note = `\n\n... et ${state.changedFiles.length - 10} autres fichiers.\nSélectionnez un fichier spécifique pour voir son contenu.`;
                    oldContent += note;
                    newContent += note;
                }
            }

            UI.renderBeforeAfterView(oldContent, newContent);
        } catch (error) {
            console.error('Error rendering before/after:', error);
            UI.showEmptyBeforeAfter('Erreur lors du chargement des fichiers.');
        }

        UI.hideLoading();
    }

    /**
     * Load and display the changes list view
     */
    async function loadChangesView(code, startDate, endDate) {
        // Fetch commits in the date range
        state.commits = await API.fetchCommits(code, startDate, endDate);

        UI.hideLoading();
        UI.showResults('changes');

        // Render commits list with callback for selection
        UI.renderCommitsList(state.commits, async (commit) => {
            await loadCommitDetail(code, commit);
        });
    }

    /**
     * Load and display commit detail
     */
    async function loadCommitDetail(code, commit) {
        try {
            // Show loading in the detail pane
            const elements = UI.elements();
            elements.commitDiff.innerHTML = '<div class="loading"><div class="spinner"></div><p>Chargement...</p></div>';

            // Fetch commit diff
            const fileDiffs = await API.getCommitDiff(code, commit.sha);

            // Render the commit detail
            UI.renderCommitDetail(commit, fileDiffs);
        } catch (error) {
            console.error('Error loading commit detail:', error);
            UI.renderCommitDetail(commit, []);
        }
    }

    // Public API
    return {
        init
    };
})();

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
