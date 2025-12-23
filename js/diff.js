/**
 * Diff Module - Computes and renders text differences
 * Uses a simple LCS-based diff algorithm
 */

const Diff = (() => {
    /**
     * Compute the Longest Common Subsequence table
     */
    function computeLCSTable(oldLines, newLines) {
        const m = oldLines.length;
        const n = newLines.length;
        const table = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldLines[i - 1] === newLines[j - 1]) {
                    table[i][j] = table[i - 1][j - 1] + 1;
                } else {
                    table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
                }
            }
        }

        return table;
    }

    /**
     * Backtrack through the LCS table to generate diff operations
     */
    function backtrackDiff(table, oldLines, newLines, i, j) {
        const result = [];

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
                result.unshift({ type: 'unchanged', content: oldLines[i - 1], oldLine: i, newLine: j });
                i--;
                j--;
            } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
                result.unshift({ type: 'add', content: newLines[j - 1], newLine: j });
                j--;
            } else if (i > 0) {
                result.unshift({ type: 'del', content: oldLines[i - 1], oldLine: i });
                i--;
            }
        }

        return result;
    }

    /**
     * Compute diff between two text contents
     */
    function computeDiff(oldContent, newContent) {
        const oldLines = oldContent ? oldContent.split('\n') : [];
        const newLines = newContent ? newContent.split('\n') : [];

        // Handle edge cases
        if (oldLines.length === 0 && newLines.length === 0) {
            return [];
        }

        if (oldLines.length === 0) {
            return newLines.map((line, i) => ({
                type: 'add',
                content: line,
                newLine: i + 1
            }));
        }

        if (newLines.length === 0) {
            return oldLines.map((line, i) => ({
                type: 'del',
                content: line,
                oldLine: i + 1
            }));
        }

        const table = computeLCSTable(oldLines, newLines);
        return backtrackDiff(table, oldLines, newLines, oldLines.length, newLines.length);
    }

    /**
     * Render a unified diff view (single column with + and -)
     */
    function renderUnifiedDiff(diff) {
        const container = document.createElement('div');
        container.className = 'diff-unified';

        diff.forEach(item => {
            const line = document.createElement('div');
            line.className = `diff-line diff-line-${item.type}`;

            const marker = document.createElement('span');
            marker.className = 'diff-line-marker';

            const lineNum = document.createElement('span');
            lineNum.className = 'diff-line-number';

            const content = document.createElement('span');
            content.className = 'diff-line-content';
            content.textContent = item.content;

            switch (item.type) {
                case 'add':
                    marker.textContent = '+';
                    lineNum.textContent = item.newLine || '';
                    break;
                case 'del':
                    marker.textContent = '-';
                    lineNum.textContent = item.oldLine || '';
                    break;
                default:
                    marker.textContent = ' ';
                    lineNum.textContent = item.oldLine || item.newLine || '';
            }

            line.appendChild(lineNum);
            line.appendChild(marker);
            line.appendChild(content);
            container.appendChild(line);
        });

        return container;
    }

    /**
     * Render side-by-side diff (two columns)
     */
    function renderSideBySideDiff(diff) {
        const leftLines = [];
        const rightLines = [];

        diff.forEach(item => {
            switch (item.type) {
                case 'unchanged':
                    leftLines.push({ type: 'unchanged', content: item.content, lineNum: item.oldLine });
                    rightLines.push({ type: 'unchanged', content: item.content, lineNum: item.newLine });
                    break;
                case 'del':
                    leftLines.push({ type: 'del', content: item.content, lineNum: item.oldLine });
                    rightLines.push({ type: 'empty', content: '', lineNum: '' });
                    break;
                case 'add':
                    leftLines.push({ type: 'empty', content: '', lineNum: '' });
                    rightLines.push({ type: 'add', content: item.content, lineNum: item.newLine });
                    break;
            }
        });

        return { leftLines, rightLines };
    }

    /**
     * Render one side of the side-by-side diff
     */
    function renderDiffPane(lines) {
        const container = document.createElement('div');

        lines.forEach(item => {
            const line = document.createElement('div');
            line.className = `diff-line diff-line-${item.type}`;

            const lineNum = document.createElement('span');
            lineNum.className = 'diff-line-number';
            lineNum.textContent = item.lineNum || '';

            const marker = document.createElement('span');
            marker.className = 'diff-line-marker';

            const content = document.createElement('span');
            content.className = 'diff-line-content';
            content.textContent = item.content;

            switch (item.type) {
                case 'add':
                    marker.textContent = '+';
                    break;
                case 'del':
                    marker.textContent = '-';
                    break;
                case 'empty':
                    marker.textContent = ' ';
                    line.style.minHeight = '1.6em';
                    break;
                default:
                    marker.textContent = ' ';
            }

            line.appendChild(lineNum);
            line.appendChild(marker);
            line.appendChild(content);
            container.appendChild(line);
        });

        return container;
    }

    /**
     * Render multiple file diffs
     */
    function renderMultiFileDiff(fileDiffs) {
        const container = document.createElement('div');

        fileDiffs.forEach(file => {
            // File header
            const header = document.createElement('div');
            header.className = 'diff-file-header';

            const statusIcon = file.status === 'added' ? '+' :
                             file.status === 'deleted' ? '-' : '~';

            header.innerHTML = `
                <span class="file-status">${statusIcon}</span>
                <span class="file-name">${escapeHtml(file.filename)}</span>
                <span class="file-stats">
                    <span class="stat-add">+${file.additions}</span>
                    <span class="stat-del">-${file.deletions}</span>
                </span>
            `;
            container.appendChild(header);

            // Compute and render diff
            const diff = computeDiff(file.previousContent || '', file.currentContent || '');
            const diffView = renderUnifiedDiff(diff);
            container.appendChild(diffView);
        });

        return container;
    }

    /**
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get summary statistics from a diff
     */
    function getDiffStats(diff) {
        let additions = 0;
        let deletions = 0;
        let unchanged = 0;

        diff.forEach(item => {
            switch (item.type) {
                case 'add': additions++; break;
                case 'del': deletions++; break;
                default: unchanged++;
            }
        });

        return { additions, deletions, unchanged };
    }

    // Public API
    return {
        computeDiff,
        renderUnifiedDiff,
        renderSideBySideDiff,
        renderDiffPane,
        renderMultiFileDiff,
        getDiffStats,
        escapeHtml
    };
})();
