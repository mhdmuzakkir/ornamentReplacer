/*
Mushaf-Warsh Extension - Main JavaScript
Handles UI interactions and communication with Illustrator
*/

(function() {
    'use strict';

    var csInterface = new CSInterface();
    var STORAGE_KEY = 'mushafwarsh_saved_templates';
    var SETTINGS_KEY = 'mushafwarsh_settings';
    
    var currentTemplate = null;
    var MY_TEMPLATES_FOLDER = "";
    var myTemplates = [];
    var additionalTemplates = [];
    var detectedDesigns = {};
    var scanResultsData = null;
    var isBrowsing = false;

    // === CACHES ===
    var cachedRiwayahLayers = {};      // riwayahPath -> layers array
    var cachedTemplateDesigns = {};    // templatePath -> designs object
    var lastBatchLog = [];             // last batch result details
    var batchCancelled = false;        // cancellation flag

    // Robust Node.js require detection (CEP can expose it in different ways)
    function getNodeRequire() {
        if (typeof require !== 'undefined') return require;
        if (window.cep_node && typeof window.cep_node.require !== 'undefined') return window.cep_node.require;
        if (window.cep && typeof window.cep.require !== 'undefined') return window.cep.require;
        return null;
    }

    function hasNodeJs() {
        return getNodeRequire() !== null;
    }

    // Mushaf data for Juz/Surah lookups
    var mushafData = { surahStatistics: [], pageStatistics: [], loaded: false };
    var pageToJuz = {
        1: [1, 21], 2: [22, 41], 3: [42, 61], 4: [62, 81],
        5: [82, 101], 6: [102, 121], 7: [122, 141], 8: [142, 161],
        9: [162, 181], 10: [182, 201], 11: [202, 221], 12: [222, 241],
        13: [242, 261], 14: [262, 281], 15: [282, 301], 16: [302, 321],
        17: [322, 341], 18: [342, 361], 19: [362, 381], 20: [382, 401],
        21: [402, 421], 22: [422, 441], 23: [442, 461], 24: [462, 481],
        25: [482, 501], 26: [502, 521], 27: [522, 541], 28: [542, 561],
        29: [562, 581], 30: [582, 604]
    };

    function loadMushafData() {
        if (mushafData.loaded || !hasNodeJs()) return;
        try {
            var req = getNodeRequire();
            var fs = req('fs');
            var path = req('path');
            // __dirname in CEP <script> tags points to extension root (where index.html is)
            var dataPath = path.join(__dirname, 'lib', 'mushaf_info.json');
            if (!fs.existsSync(dataPath)) {
                // Fallback: try same directory as this script
                dataPath = path.join(__dirname, 'mushaf_info.json');
            }
            if (fs.existsSync(dataPath)) {
                var raw = fs.readFileSync(dataPath, 'utf8');
                var parsed = JSON.parse(raw);
                mushafData.surahStatistics = parsed.surah_statistics || [];
                mushafData.pageStatistics = parsed.page_statistics || [];
                mushafData.loaded = true;
            } else {
                console.error('mushaf_info.json not found at:', dataPath);
            }
        } catch (e) {
            console.error('Failed to load mushaf_info.json:', e);
        }
    }

    function getJuzFromPage(page) {
        for (var juz = 1; juz <= 30; juz++) {
            var range = pageToJuz[juz];
            if (page >= range[0] && page <= range[1]) return juz;
        }
        return null;
    }

    function getSurahName(num) {
        if (!mushafData.loaded) loadMushafData();
        for (var i = 0; i < mushafData.surahStatistics.length; i++) {
            if (mushafData.surahStatistics[i].surah_number === num) {
                return mushafData.surahStatistics[i].surah_name;
            }
        }
        return 'Surah ' + num;
    }

    function computeAllowedPages() {
        var mode = appSettings.filterMode;
        // Normalize to numbers — handles string values from old settings files
        var juzs = (appSettings.selectedJuzs || []).map(function(j) { return parseInt(j, 10); });
        var surahs = (appSettings.selectedSurahs || []).map(function(s) { return parseInt(s, 10); });
        if (!mode || (mode === 'juz' && juzs.length === 0) || (mode === 'surah' && surahs.length === 0)) {
            return null;
        }
        loadMushafData();
        var allowed = [];
        if (mode === 'juz') {
            for (var page = 1; page <= 604; page++) {
                var pageJuz = getJuzFromPage(page);
                if (juzs.indexOf(pageJuz) !== -1) {
                    allowed.push(page);
                }
            }
        } else if (mode === 'surah') {
            // Use surah_statistics.pages for direct lookup — much faster and accurate
            for (var i = 0; i < surahs.length; i++) {
                var surahNum = surahs[i];
                for (var s = 0; s < mushafData.surahStatistics.length; s++) {
                    var stat = mushafData.surahStatistics[s];
                    if (parseInt(stat.surah_number, 10) === surahNum && stat.pages) {
                        for (var p = 0; p < stat.pages.length; p++) {
                            var pageNum = parseInt(stat.pages[p], 10);
                            if (allowed.indexOf(pageNum) === -1) {
                                allowed.push(pageNum);
                            }
                        }
                        break;
                    }
                }
            }
            allowed.sort(function(a, b) { return a - b; });
        }
        return allowed;
    }

    var elements = {
        templatePath: document.getElementById('templatePath'),
        templateName: document.getElementById('templateName'),
        browseTemplateBtn: document.getElementById('browseTemplateBtn'),
        saveTemplateBtn: document.getElementById('saveTemplateBtn'),
        savedTemplatesList: document.getElementById('savedTemplatesList'),
        designsSection: document.querySelector('.ornaments-section'),
        designsList: document.getElementById('designsList'),
        refreshDesignsBtn: document.getElementById('refreshDesignsBtn'),
        refreshTemplatesBtn: document.getElementById('refreshTemplatesBtn'),
        refreshLayerCopyRiwayahsBtn: document.getElementById('refreshLayerCopyRiwayahsBtn'),
        selectAllBtn: document.getElementById('selectAllBtn'),
        scanBtn: document.getElementById('scanBtn'),
        processBtn: document.getElementById('processBtn'),
        statusBar: document.getElementById('statusBar'),
        statusText: document.getElementById('statusText'),
        silentMode: document.getElementById('silentMode'),
        fitArtboard: document.getElementById('fitArtboard'),
        browseOutputBtn: document.getElementById('browseOutputBtn'),
        outputPath: document.getElementById('outputPath'),
        nameSeparator: document.getElementById('nameSeparator'),
        nameSuffix: document.getElementById('nameSuffix'),
        newFileOptions: document.getElementById('newFileOptions'),
        selectAllSwatchesBtn: document.getElementById('selectAllSwatchesBtn'),
        ornamentsOptions: document.getElementById('ornamentsOptions'),
        swatchesOptions: document.getElementById('swatchesOptions'),
        swatchesList: document.getElementById('swatchesList'),
        currentLayersList: document.getElementById('currentLayersList'),
        refreshLayersBtn: document.getElementById('refreshLayersBtn'),
        unifyLayersBtn: document.getElementById('unifyLayersBtn'),
        browseSourceFileBtn: document.getElementById('browseSourceFileBtn'),
        sourceFilePath: document.getElementById('sourceFilePath'),
        sourceFileName: document.getElementById('sourceFileName'),
        copyLayersBtn: document.getElementById('copyLayersBtn'),
        sourceLayersList: document.getElementById('sourceLayersList'),
        refreshSourceLayersBtn: document.getElementById('refreshSourceLayersBtn'),
        modeSingleFile: document.getElementById('modeSingleFile'),
        modeRiwayah: document.getElementById('modeRiwayah'),
        singleFileSection: document.getElementById('singleFileSection'),
        layerCopyRiwayahSection: document.getElementById('layerCopyRiwayahSection'),
        sourceRiwayahSelect: document.getElementById('sourceRiwayahSelect'),
        targetRiwayahSelect: document.getElementById('targetRiwayahSelect'),
        mushafProjectPath: document.getElementById('mushafProjectPath'),
        mushafProjectName: document.getElementById('mushafProjectName'),
        refreshRiwayahsBtn: document.getElementById('refreshRiwayahsBtn'),
        riwayahLayersList: document.getElementById('riwayahLayersList'),
        riwayahProgressArea: document.getElementById('riwayahProgressArea'),
        riwayahProgressBar: document.getElementById('riwayahProgressBar'),
        riwayahProgressText: document.getElementById('riwayahProgressText'),
        startRiwayahCopyBtn: document.getElementById('startRiwayahCopyBtn'),
        cancelRiwayahCopyBtn: document.getElementById('cancelRiwayahCopyBtn'),
        fixCurrentLayerOrderBtn: document.getElementById('fixCurrentLayerOrderBtn'),
        fixOrderRiwayahSelect: document.getElementById('fixOrderRiwayahSelect'),
        fixRiwayahLayerOrderBtn: document.getElementById('fixRiwayahLayerOrderBtn'),
        fixOrderProgressArea: document.getElementById('fixOrderProgressArea'),
        fixOrderProgressBar: document.getElementById('fixOrderProgressBar'),
        fixOrderProgressText: document.getElementById('fixOrderProgressText'),
        batchControls: document.getElementById('batchControls'),
        cancelBatchBtn: document.getElementById('cancelBatchBtn'),
        exportLogBtn: document.getElementById('exportLogBtn'),
        btnAutoDetectFolders: document.getElementById('btnAutoDetectFolders')
    };

    // Settings — same pattern as Mushaf Task Manager
    var appSettings = {
        templatesFolder: '',
        mushafFilesFolder: '',
        mushafTasksFolder: '',
        selectedRiwayah: '',
        filterMode: '',       // 'juz' | 'surah' | ''
        selectedJuzs: [],     // array of juz numbers
        selectedSurahs: []    // array of surah numbers
    };

    function getSettingsPath() {
        if (!hasNodeJs()) return null;
        var req = getNodeRequire();
        var path = req('path');
        var os = req('os');
        return path.join(os.homedir(), 'Documents', 'MushafOrnamentReplacer', 'settings.json');
    }

    function saveSettings() {
        if (!hasNodeJs()) return;
        try {
            var req = getNodeRequire();
            var fs = req('fs');
            var path = req('path');
            var settingsPath = getSettingsPath();
            if (!settingsPath) return;

            var settingsDir = path.dirname(settingsPath);
            if (!fs.existsSync(settingsDir)) {
                fs.mkdirSync(settingsDir, { recursive: true });
            }

            var settings = {
                templatesFolder: appSettings.templatesFolder,
                mushafFilesFolder: appSettings.mushafFilesFolder,
                mushafTasksFolder: appSettings.mushafTasksFolder,
                selectedRiwayah: appSettings.selectedRiwayah,
                filterMode: appSettings.filterMode,
                selectedJuzs: appSettings.selectedJuzs,
                selectedSurahs: appSettings.selectedSurahs
            };

            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        } catch (e) {
            console.error('Error saving settings:', e);
        }
    }

    function autoDetectFolders() {
        var statusEl = document.getElementById('autoDetectStatus');
        if (!hasNodeJs()) {
            updateStatus('Node.js not available', 'error');
            if (statusEl) statusEl.textContent = 'Node.js not available in this CEP context.';
            return;
        }
        updateStatus('Scanning drives...', 'info');
        if (statusEl) statusEl.textContent = 'Scanning all drives...';
        console.log('ornamentReplacer: auto-detect starting');

        var req = getNodeRequire();
        var fs = req('fs');
        var path = req('path');
        var os = req('os');

        var foundFiles = null;
        var foundTasks = null;
        var foundTemplates = null;
        var foundSource = '';

        // Helper: test a path and log it
        function testPath(p) {
            try {
                var exists = fs.existsSync(p);
                console.log('ornamentReplacer: testPath:', p, '→', exists);
                return exists;
            } catch (e) {
                console.log('ornamentReplacer: testPath ERROR:', p, e.message);
                return false;
            }
        }

        // Helper: derive templates path from files path
        function deriveTemplates(filesPath) {
            var parent = path.dirname(filesPath);
            var templatesPath = path.join(parent, 'templates');
            if (testPath(templatesPath)) {
                console.log('ornamentReplacer: found templates:', templatesPath);
                return templatesPath;
            }
            return null;
        }

        // 0. Fast path: read MushafTaskManager settings
        var mtmSettings = readMushafTaskSettings();
        if (mtmSettings) {
            console.log('ornamentReplacer: MushafTaskManager settings found:', JSON.stringify(mtmSettings));
            if (mtmSettings.projectFolder && testPath(mtmSettings.projectFolder)) {
                var parentOfFiles = path.dirname(mtmSettings.projectFolder);
                var fastTasks = mtmSettings.tasksFolder || path.join(parentOfFiles, 'mushaftasks');
                if (testPath(fastTasks)) {
                    foundFiles = mtmSettings.projectFolder;
                    foundTasks = fastTasks;
                    foundTemplates = deriveTemplates(foundFiles);
                    foundSource = 'MushafTaskManager settings';
                    console.log('ornamentReplacer: using MushafTaskManager fast path:', foundFiles, foundTasks, foundTemplates);
                }
            }
        }

        // 1. Check all drive letters (skip if fast path succeeded)
        if (!foundFiles) for (var i = 65; i <= 90; i++) {
            var drive = String.fromCharCode(i) + ':\\';

            // Pattern A: X:\My Drive\mushafproject\mushaffiles
            var filesA = path.join(drive, 'My Drive', 'mushafproject', 'mushaffiles');
            var tasksA = path.join(drive, 'My Drive', 'mushafproject', 'mushaftasks');
            if (testPath(filesA) && testPath(tasksA)) {
                foundFiles = filesA; foundTasks = tasksA; foundTemplates = deriveTemplates(filesA); foundSource = 'My Drive/mushafproject';
                break;
            }

            // Pattern B: X:\Google Drive\mushafproject\mushaffiles
            var filesB = path.join(drive, 'Google Drive', 'mushafproject', 'mushaffiles');
            var tasksB = path.join(drive, 'Google Drive', 'mushafproject', 'mushaftasks');
            if (testPath(filesB) && testPath(tasksB)) {
                foundFiles = filesB; foundTasks = tasksB; foundTemplates = deriveTemplates(filesB); foundSource = 'Google Drive/mushafproject';
                break;
            }

            // Pattern C: X:\mushafproject\mushaffiles
            var filesC = path.join(drive, 'mushafproject', 'mushaffiles');
            var tasksC = path.join(drive, 'mushafproject', 'mushaftasks');
            if (testPath(filesC) && testPath(tasksC)) {
                foundFiles = filesC; foundTasks = tasksC; foundTemplates = deriveTemplates(filesC); foundSource = 'mushafproject';
                break;
            }

            // Pattern D: legacy root-level
            var filesD = path.join(drive, 'mushaffiles');
            var tasksD = path.join(drive, 'mushaftasks');
            if (testPath(filesD) && testPath(tasksD)) {
                foundFiles = filesD; foundTasks = tasksD; foundTemplates = deriveTemplates(filesD); foundSource = 'legacy root';
                break;
            }
        }

        // 2. Check profile paths (skip if fast path succeeded)
        if (!foundFiles) {
            var home = os.homedir();
            var profileChecks = [
                path.join(home, 'Google Drive', 'mushafproject'),
                path.join(home, 'My Drive', 'mushafproject'),
                path.join(home, 'Google Drive'),
                path.join(home, 'My Drive')
            ];
            for (var j = 0; j < profileChecks.length; j++) {
                var base = profileChecks[j];
                var f = path.join(base, 'mushaffiles');
                var t = path.join(base, 'mushaftasks');
                if (testPath(f) && testPath(t)) {
                    foundFiles = f; foundTasks = t; foundTemplates = deriveTemplates(f); foundSource = 'profile/' + base;
                    break;
                }
            }
        }

        // 3. Apply results
        if (foundFiles && foundTasks) {
            console.log('ornamentReplacer: SUCCESS → files:', foundFiles, 'tasks:', foundTasks, 'templates:', foundTemplates);
            var changed = false;
            if (foundFiles !== appSettings.mushafFilesFolder) {
                appSettings.mushafFilesFolder = foundFiles;
                document.getElementById('mushafFilesFolderPath').value = foundFiles;
                changed = true;
            }
            if (foundTasks !== appSettings.mushafTasksFolder) {
                appSettings.mushafTasksFolder = foundTasks;
                document.getElementById('mushafTasksFolderPath').value = foundTasks;
                changed = true;
            }
            if (foundTemplates && foundTemplates !== appSettings.templatesFolder) {
                appSettings.templatesFolder = foundTemplates;
                document.getElementById('templatesFolderPath').value = foundTemplates;
                changed = true;
            }
            if (changed) {
                saveSettings();
                updateStatus('Auto-detected from Google Drive (' + foundSource + ')', 'success');
                if (statusEl) statusEl.textContent = 'Found: ' + foundSource + (foundTemplates ? ' + templates' : '');
                populateRiwayahDropdown();
            } else {
                updateStatus('Paths already up to date', 'success');
                if (statusEl) statusEl.textContent = 'Paths already up to date.';
            }
        } else {
            console.log('ornamentReplacer: FAILED — no valid mushafproject found');
            updateStatus('Could not find mushafproject. Try Test & Use below.', 'warning');
            if (statusEl) statusEl.textContent = 'Not found. Try pasting the exact path below.';
        }
    }

    function testMushafPath() {
        var input = document.getElementById('testPathInput');
        var statusEl = document.getElementById('testPathStatus');
        var rawPath = input.value.trim();
        if (!rawPath) {
            statusEl.textContent = 'Please enter a path.';
            return;
        }
        if (!hasNodeJs()) {
            statusEl.textContent = 'Node.js not available.';
            return;
        }
        var req = getNodeRequire();
        var fs = req('fs');
        var path = req('path');
        var base = rawPath.replace(/\//g, '\\');

        statusEl.textContent = 'Testing...';

        function applyResults(filesPath, tasksPath, sourceName) {
            var templatesPath = path.join(path.dirname(filesPath), 'templates');
            var templatesOk = fs.existsSync(templatesPath);
            appSettings.mushafFilesFolder = filesPath;
            appSettings.mushafTasksFolder = tasksPath;
            document.getElementById('mushafFilesFolderPath').value = filesPath;
            document.getElementById('mushafTasksFolderPath').value = tasksPath;
            if (templatesOk) {
                appSettings.templatesFolder = templatesPath;
                document.getElementById('templatesFolderPath').value = templatesPath;
            }
            saveSettings();
            updateStatus('Loaded ' + sourceName + ' from: ' + base, 'success');
            statusEl.textContent = 'Success! ' + sourceName + ': mushaffiles + mushaftasks' + (templatesOk ? ' + templates' : '') + ' found.';
            populateRiwayahDropdown();
        }

        // Check flat: base/mushaffiles + base/mushaftasks
        var flatFiles = path.join(base, 'mushaffiles');
        var flatTasks = path.join(base, 'mushaftasks');
        var flatFilesOk = fs.existsSync(flatFiles);
        var flatTasksOk = fs.existsSync(flatTasks);
        if (flatFilesOk && flatTasksOk) {
            applyResults(flatFiles, flatTasks, 'flat structure');
            return;
        }

        // Check one level deeper: base/mushafproject/mushaffiles
        var deepFiles = path.join(base, 'mushafproject', 'mushaffiles');
        var deepTasks = path.join(base, 'mushafproject', 'mushaftasks');
        var deepFilesOk = fs.existsSync(deepFiles);
        var deepTasksOk = fs.existsSync(deepTasks);
        if (deepFilesOk && deepTasksOk) {
            applyResults(deepFiles, deepTasks, 'nested structure');
            return;
        }

        statusEl.textContent = 'Not found. Flat mushaffiles:' + flatFilesOk + ' mushaftasks:' + flatTasksOk +
            ' | Nested mushafproject/mushaffiles:' + deepFilesOk + ' mushaftasks:' + deepTasksOk;
    }

    function loadSettings() {
        if (!hasNodeJs()) return null;
        try {
            var fs = getNodeRequire()('fs');
            var settingsPath = getSettingsPath();
            if (!settingsPath) return null;

            if (fs.existsSync(settingsPath)) {
                var data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                appSettings.templatesFolder = data.templatesFolder || '';
                appSettings.mushafFilesFolder = data.mushafFilesFolder || '';
                appSettings.mushafTasksFolder = data.mushafTasksFolder || '';
                appSettings.selectedRiwayah = data.selectedRiwayah || '';
                appSettings.filterMode = data.filterMode || '';
                appSettings.selectedJuzs = data.selectedJuzs || [];
                appSettings.selectedSurahs = data.selectedSurahs || [];
                return data;
            }
        } catch (e) {
            console.error('Error loading settings:', e);
        }
        return null;
    }

    var CHANGELOG = {
        '3.4.0': {
            date: 'May 24, 2026',
            new: [
                'Updater now uses git pull for extensions with a .git folder — preserves your cloned repos',
                'If git pull fails, the updater reports the error instead of overwriting with ZIP'
            ],
            fixed: [],
            improved: []
        },
        '3.3.0': {
            date: 'May 24, 2026',
            new: [
                'Surah dropdown now shows surah001–surah114 in the Surah names font',
                'Layer Order Fix pauses after every 5 files to keep Illustrator stable'
            ],
            fixed: [],
            improved: []
        },
        '3.2.0': {
            date: 'May 2026',
            new: [
                'Fix Layer Order buttons — fix current document or batch-fix entire riwayah',
                'Recheck folder support — file finder checks Recheck/Ajza when locating targets'
            ],
            fixed: [],
            improved: []
        }
    };

    function showChangelog(version) {
        var modal = document.getElementById('changelogModal');
        var versionEl = document.getElementById('changelogVersion');
        var bodyEl = document.getElementById('changelogBody');
        var closeBtn = document.getElementById('changelogCloseBtn');
        if (!modal || !bodyEl) return;

        var data = CHANGELOG[version];
        if (!data) return;

        function esc(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        function renderItems(items) {
            if (!items || !items.length) return '';
            var out = '';
            items.forEach(function(item) { out += '<li>' + esc(item) + '</li>'; });
            return out;
        }

        versionEl.textContent = 'v' + version;
        var html = '';
        var newItems = renderItems(data.new);
        if (newItems) {
            html += '<div class="changelog-section"><div class="changelog-section-title new">✨ New</div><ul class="changelog-list">' + newItems + '</ul></div>';
        }
        var fixedItems = renderItems(data.fixed);
        if (fixedItems) {
            html += '<div class="changelog-section"><div class="changelog-section-title fixed">🐛 Fixed</div><ul class="changelog-list">' + fixedItems + '</ul></div>';
        }
        var improvedItems = renderItems(data.improved);
        if (improvedItems) {
            html += '<div class="changelog-section"><div class="changelog-section-title improved">⚡ Improved</div><ul class="changelog-list">' + improvedItems + '</ul></div>';
        }
        bodyEl.innerHTML = html;
        modal.classList.remove('hidden');

        function handleClose() {
            modal.classList.add('hidden');
            closeBtn.removeEventListener('click', handleClose);
        }
        closeBtn.addEventListener('click', handleClose);
    }

    function init() {
        loadSettings();

        // Check for version change and show changelog
        var currentVersion = '3.4.0';
        if (appSettings.lastSeenVersion && appSettings.lastSeenVersion !== currentVersion) {
            setTimeout(function() {
                showChangelog(currentVersion);
            }, 800);
        }
        appSettings.lastSeenVersion = currentVersion;
        saveSettings();

        // Auto-detect from Google Drive if paths are missing
        if (!appSettings.mushafFilesFolder || !appSettings.mushafTasksFolder) {
            if (window.DriveScanner && hasNodeJs()) {
                console.log('ornamentReplacer: paths missing, trying auto-detect...');
                try {
                    var result = window.DriveScanner.autoDetectAndSave();
                    if (result && result.success) {
                        if (result.projectFolder) appSettings.mushafFilesFolder = result.projectFolder;
                        if (result.tasksFolder) appSettings.mushafTasksFolder = result.tasksFolder;
                        // Derive templates from project root
                        if (result.projectFolder && !appSettings.templatesFolder) {
                            var req = getNodeRequire();
                            var path = req('path');
                            var fs = req('fs');
                            var templatesPath = path.join(path.dirname(result.projectFolder), 'templates');
                            if (fs.existsSync(templatesPath)) {
                                appSettings.templatesFolder = templatesPath;
                                MY_TEMPLATES_FOLDER = templatesPath;
                                console.log('ornamentReplacer: auto-detected templates:', templatesPath);
                                loadSavedTemplates();
                            }
                        }
                        saveSettings();
                        console.log('ornamentReplacer: auto-detected paths saved');
                    } else {
                        console.log('ornamentReplacer: startup auto-detect failed, reason:', result ? result.reason : 'unknown');
                    }
                } catch (e) {
                    console.error('ornamentReplacer: startup auto-detect error:', e);
                }
            }
        }

        // Sync loaded settings to UI inputs
        var elTemplates = document.getElementById('templatesFolderPath');
        var elMushafFiles = document.getElementById('mushafFilesFolderPath');
        var elMushafTasks = document.getElementById('mushafTasksFolderPath');
        if (elTemplates) elTemplates.value = appSettings.templatesFolder;
        if (elMushafFiles) elMushafFiles.value = appSettings.mushafFilesFolder;
        if (elMushafTasks) elMushafTasks.value = appSettings.mushafTasksFolder;
        if (appSettings.templatesFolder) {
            MY_TEMPLATES_FOLDER = appSettings.templatesFolder;
            loadSavedTemplates();
        }

        bindEvents();
        setupSaveModeToggle();
        setupTabNavigation();
        toggleModeSection();
        populateRiwayahDropdown();
        // If a riwayah was saved, scan it to populate Juz/Surah filters
        if (appSettings.selectedRiwayah) {
            setTimeout(function() {
                scanAndPopulateBatchFilters(appSettings.selectedRiwayah);
            }, 50);
        }
        loadCheckboxSettings();
        toggleReplacementModeSection();
        updateStatus('Ready');
        updateOrnamentsHeader();
        
        // Expose functions to global scope for HTML onclick attributes
        window.closeStatusBar = closeStatusBar;
        window.closeScanModal = closeScanModal;
        window.openScanModal = openScanModal;
        window.closeProcessModal = closeProcessModal;
        window.openProcessModal = openProcessModal;
        window.closeJuzFilterModal = closeJuzFilterModal;
        window.openJuzFilterModal = openJuzFilterModal;
        window.closeSurahFilterModal = closeSurahFilterModal;
        window.openSurahFilterModal = openSurahFilterModal;
        window.applyJuzFilter = applyJuzFilter;
        window.applySurahFilter = applySurahFilter;
        window.clearJuzFilter = clearJuzFilter;
        window.clearSurahFilter = clearSurahFilter;
        window.setJuzMode = setJuzMode;
        window.setSurahMode = setSurahMode;
        window.toggleOrnaments = toggleOrnaments;
    }

    function bindEvents() {
        if (elements.browseTemplateBtn) {
            elements.browseTemplateBtn.addEventListener('click', browseTemplate);
        }
        if (elements.saveTemplateBtn) {
            elements.saveTemplateBtn.addEventListener('click', saveCurrentTemplate);
        }
        if (elements.refreshTemplatesBtn) {
            elements.refreshTemplatesBtn.addEventListener('click', loadSavedTemplates);
        }
        if (elements.refreshDesignsBtn) {
            elements.refreshDesignsBtn.addEventListener('click', refreshDesigns);
        }
        if (elements.refreshRiwayahsBtn) {
            elements.refreshRiwayahsBtn.addEventListener('click', function() {
                populateRiwayahDropdown();
                setTimeout(function() {
                    var riwayahSelect = document.getElementById('riwayahSelect');
                    if (riwayahSelect && riwayahSelect.value) {
                        scanAndPopulateBatchFilters(riwayahSelect.value);
                    }
                }, 50);
            });
        }
        if (elements.selectAllBtn) {
            elements.selectAllBtn.addEventListener('click', toggleSelectAll);
        }
        if (elements.scanBtn) {
            elements.scanBtn.addEventListener('click', scanDocument);
        }
        if (elements.processBtn) {
            elements.processBtn.addEventListener('click', processDocument);
        }
        
        // Status bar close button
        var statusCloseBtn = document.querySelector('.status-close-btn');
        if (statusCloseBtn) {
            statusCloseBtn.addEventListener('click', closeStatusBar);
        }
        
        // Save options events
        if (elements.browseOutputBtn) {
            elements.browseOutputBtn.addEventListener('click', browseOutputFolder);
        }
        
        // Replacement mode toggle
        document.querySelectorAll('input[name="replacementMode"]').forEach(function(radio) {
            radio.addEventListener('change', toggleReplacementMode);
        });
        
        // Action toggles
        var ayahAlignAction = document.getElementById('ayahAlignAction');
        var ornamentReplacementAction = document.getElementById('ornamentReplacementAction');
        if (ayahAlignAction) {
            ayahAlignAction.addEventListener('change', saveActionSettings);
        }
        if (ornamentReplacementAction) {
            ornamentReplacementAction.addEventListener('change', function() {
                toggleReplacementModeSection();
                saveActionSettings();
            });
        }
        
        if (elements.selectAllSwatchesBtn) {
            elements.selectAllSwatchesBtn.addEventListener('click', toggleSelectAllSwatches);
        }
        
        // Settings folder browse buttons
        var btnBrowseTemplates = document.getElementById('btnBrowseTemplatesFolder');
        var btnBrowseMushafFiles = document.getElementById('btnBrowseMushafFilesFolder');
        var btnBrowseMushafTasks = document.getElementById('btnBrowseMushafTasksFolder');
        
        if (btnBrowseTemplates) {
            btnBrowseTemplates.addEventListener('click', function() {
                browseSettingFolder('templatesFolderPath', 'templatesFolder');
            });
        }
        if (btnBrowseMushafFiles) {
            btnBrowseMushafFiles.addEventListener('click', function() {
                browseSettingFolder('mushafFilesFolderPath', 'mushafFilesFolder');
            });
        }
        if (btnBrowseMushafTasks) {
            btnBrowseMushafTasks.addEventListener('click', function() {
                browseSettingFolder('mushafTasksFolderPath', 'mushafTasksFolder');
            });
        }
        
        // Auto-detect from Google Drive
        var btnAutoDetect = document.getElementById('btnAutoDetectFolders');
        if (btnAutoDetect) {
            btnAutoDetect.addEventListener('click', autoDetectFolders);
        }

        // Test path button
        var btnTestPath = document.getElementById('btnTestPath');
        if (btnTestPath) {
            btnTestPath.addEventListener('click', testMushafPath);
        }
        var testPathInput = document.getElementById('testPathInput');
        if (testPathInput) {
            testPathInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') testMushafPath();
            });
        }

        // Update buttons
        var btnCheckUpdates = document.getElementById('btnCheckUpdates');
        var btnInstallUpdate = document.getElementById('btnInstallUpdate');
        var updateStatusEl = document.getElementById('updateStatus');
        if (btnCheckUpdates) {
            btnCheckUpdates.addEventListener('click', function() {
                if (!window.OrnamentUpdater) {
                    if (updateStatusEl) updateStatusEl.textContent = 'Updater not loaded.';
                    return;
                }
                if (updateStatusEl) updateStatusEl.textContent = 'Checking...';
                btnCheckUpdates.disabled = true;
                window.OrnamentUpdater.checkForUpdates().then(function(result) {
                    btnCheckUpdates.disabled = false;
                    if (result.hasUpdate) {
                        if (updateStatusEl) updateStatusEl.textContent = 'Update available: v' + result.remoteVersion + ' (current: v' + result.currentVersion + ')';
                        if (btnInstallUpdate) btnInstallUpdate.classList.remove('hidden');
                    } else if (result.error) {
                        if (updateStatusEl) updateStatusEl.textContent = 'Error: ' + result.error;
                    } else {
                        if (updateStatusEl) updateStatusEl.textContent = 'You have the latest version (v' + result.currentVersion + ').';
                        if (btnInstallUpdate) btnInstallUpdate.classList.add('hidden');
                    }
                });
            });
        }
        if (btnInstallUpdate) {
            btnInstallUpdate.addEventListener('click', function() {
                if (!window.OrnamentUpdater) return;
                if (updateStatusEl) updateStatusEl.textContent = 'Installing...';
                btnInstallUpdate.disabled = true;
                window.OrnamentUpdater.installUpdate(function(progress) {
                    if (updateStatusEl) updateStatusEl.textContent = progress.message + ' (' + progress.percent + '%)';
                }).then(function(result) {
                    if (updateStatusEl) updateStatusEl.textContent = 'Installed! Please restart Illustrator.';
                    btnInstallUpdate.disabled = false;
                }).catch(function(err) {
                    if (updateStatusEl) updateStatusEl.textContent = 'Install failed: ' + err.message;
                    btnInstallUpdate.disabled = false;
                });
            });
        }
        
        // Riwayah select
        var riwayahSelect = document.getElementById('riwayahSelect');
        if (riwayahSelect) {
            riwayahSelect.addEventListener('change', function(e) {
                appSettings.selectedRiwayah = e.target.value;
                saveSettings();
                scanAndPopulateBatchFilters(e.target.value);
            });
        }

        // Filter grid cards
        var juzFilterCard = document.getElementById('juzFilterCard');
        var surahFilterCard = document.getElementById('surahFilterCard');
        if (juzFilterCard) {
            juzFilterCard.addEventListener('click', openJuzFilterModal);
        }
        if (surahFilterCard) {
            surahFilterCard.addEventListener('click', openSurahFilterModal);
        }

        // Mode toggle
        document.querySelectorAll('input[name="mode"]').forEach(function(radio) {
            radio.addEventListener('change', toggleModeSection);
        });
        
        // Layer Copy tab events
        if (elements.refreshLayersBtn) {
            elements.refreshLayersBtn.addEventListener('click', scanCurrentLayers);
        }
        if (elements.unifyLayersBtn) {
            elements.unifyLayersBtn.addEventListener('click', runUnifyLayerNames);
        }
        if (elements.browseSourceFileBtn) {
            elements.browseSourceFileBtn.addEventListener('click', browseSourceFile);
        }
        if (elements.copyLayersBtn) {
            elements.copyLayersBtn.addEventListener('click', copyLayersFromFile);
        }
        if (elements.refreshSourceLayersBtn) {
            elements.refreshSourceLayersBtn.addEventListener('click', scanSourceLayers);
        }
        if (elements.modeSingleFile) {
            elements.modeSingleFile.addEventListener('click', function() { switchLayerCopyMode('single'); });
        }
        if (elements.modeRiwayah) {
            elements.modeRiwayah.addEventListener('click', function() { switchLayerCopyMode('riwayah'); });
        }
        if (elements.sourceRiwayahSelect) {
            elements.sourceRiwayahSelect.addEventListener('change', onSourceRiwayahSelected);
        }
        if (elements.targetRiwayahSelect) {
            elements.targetRiwayahSelect.addEventListener('change', onTargetRiwayahSelected);
        }
        if (elements.refreshLayerCopyRiwayahsBtn) {
            elements.refreshLayerCopyRiwayahsBtn.addEventListener('click', loadRiwayahsFromMushafFiles);
        }
        if (elements.startRiwayahCopyBtn) {
            elements.startRiwayahCopyBtn.addEventListener('click', startRiwayahBatchCopy);
        }
        if (elements.cancelRiwayahCopyBtn) {
            elements.cancelRiwayahCopyBtn.addEventListener('click', cancelRiwayahBatch);
        }
        if (elements.cancelBatchBtn) {
            elements.cancelBatchBtn.addEventListener('click', cancelBatch);
        }
        if (elements.fixCurrentLayerOrderBtn) {
            elements.fixCurrentLayerOrderBtn.addEventListener('click', fixCurrentLayerOrder);
        }
        if (elements.fixRiwayahLayerOrderBtn) {
            elements.fixRiwayahLayerOrderBtn.addEventListener('click', fixRiwayahLayerOrder);
        }
        if (elements.exportLogBtn) {
            elements.exportLogBtn.addEventListener('click', exportBatchLog);
        }
    }

    function toggleReplacementModeSection() {
        var section = document.getElementById('replacementModeSection');
        var ornamentAction = document.getElementById('ornamentReplacementAction');
        if (section && ornamentAction) {
            section.style.display = ornamentAction.checked ? 'block' : 'none';
        }
    }

    function toggleModeSection() {
        var mode = document.querySelector('input[name="mode"]:checked').value;
        var riwayahSection = document.getElementById('riwayahSection');
        if (riwayahSection) {
            riwayahSection.style.display = (mode === 'batch') ? 'block' : 'none';
        }
    }

    function toggleReplacementMode() {
        var mode = document.querySelector('input[name="replacementMode"]:checked').value;
        
        if (mode === 'ornaments') {
            elements.ornamentsOptions.style.display = 'block';
            elements.swatchesOptions.style.display = 'none';
            // Enable ornament checkboxes, disable swatch checkboxes
            document.querySelectorAll('.ornament-type').forEach(function(cb) {
                cb.disabled = false;
            });
            document.querySelectorAll('.swatch-type').forEach(function(cb) {
                cb.disabled = true;
            });
        } else {
            elements.ornamentsOptions.style.display = 'none';
            elements.swatchesOptions.style.display = 'block';
            // Disable ornament checkboxes, enable swatch checkboxes
            document.querySelectorAll('.ornament-type').forEach(function(cb) {
                cb.disabled = true;
            });
            document.querySelectorAll('.swatch-type').forEach(function(cb) {
                cb.disabled = false;
            });
            // Scan for swatches if template selected
            if (currentTemplate) {
                scanTemplateSwatches();
            }
        }
    }

    function toggleSelectAllSwatches() {
        var checkboxes = document.querySelectorAll('.swatch-type:not(:disabled)');
        var allChecked = Array.from(checkboxes).every(function(cb) {
            return cb.checked;
        });

        checkboxes.forEach(function(cb) {
            cb.checked = !allChecked;
        });

        if (elements.selectAllSwatchesBtn) {
            elements.selectAllSwatchesBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
        }
    }

    // Scan template for swatches 001, 002, 003
    function scanTemplateSwatches() {
        if (!currentTemplate) return;
        
        updateStatus('Scanning template swatches...', 'processing');
        
        var script = 'scanTemplateSwatches("' + currentTemplate.path.replace(/\\/g, '\\\\') + '")';
        
        csInterface.evalScript(script, function(result) {
            try {
                var response = JSON.parse(result);
                updateSwatchUI(response);
                updateStatus('Swatches scanned', 'success');
            } catch(e) {
                console.error('Swatch scan error:', e);
                updateStatus('Error scanning swatches', 'error');
            }
        });
    }

    // Update UI with swatch scan results
    function updateSwatchUI(data) {
    ['001', '002', '003'].forEach(function(num) {
        var statusEl = document.getElementById('swatch' + num + 'Status');
        var checkbox = document.querySelector('.swatch-type[value="' + num + '"]');
        
        if (statusEl && checkbox) {
            if (data[num] && data[num].found) {
                var fullName = data[num].name || num;
                var colorInfo = data[num].color || '';
                
                // Show color code in UI (e.g., "001-Red rgb(255,0,0)")
                statusEl.textContent = fullName + (colorInfo ? ' ' + colorInfo : '');
                statusEl.style.color = '#4caf50';
                checkbox.disabled = false;
                checkbox.dataset.foundName = fullName;
                
                // Show color preview
                if (data[num].color) {
                    var icon = checkbox.closest('.ornament-checkbox').querySelector('.ornament-icon');
                    if (icon) {
                        icon.style.background = data[num].color;
                        icon.title = 'Template color: ' + data[num].color; // Tooltip shows code
                    }
                }
            } else {
                statusEl.textContent = 'Not in template';
                statusEl.style.color = '#f44336';
                checkbox.checked = false;
                checkbox.disabled = true;
                delete checkbox.dataset.foundName;
            }
        }
    });
}

    function setupSaveModeToggle() {
        var radios = document.getElementsByName('saveMode');
        if (!radios.length) return;
        
        function updateSaveOptions() {
            var selectedRadio = document.querySelector('input[name="saveMode"]:checked');
            if (!selectedRadio) return;
            
            var mode = selectedRadio.value;
            var newFileOptions = document.getElementById('newFileOptions');
            var customOptions = document.getElementById('customFileOptions');
            var templatePreview = document.getElementById('sameAsTemplatePreview');
            
            if (!newFileOptions) return;
            
            if (mode === 'overwrite' || mode === 'dontSave') {
                newFileOptions.style.display = 'none';
            } else if (mode === 'newFile') {
                newFileOptions.style.display = 'block';
                if (customOptions) customOptions.style.display = 'block';
                if (templatePreview) templatePreview.style.display = 'none';
            } else if (mode === 'sameAsTemplate') {
                newFileOptions.style.display = 'block';
                if (customOptions) customOptions.style.display = 'none';
                if (templatePreview) {
                    templatePreview.style.display = 'block';
                    if (currentTemplate) {
                        var name = currentTemplate.name.replace(/\.ai$/i, '');
                        var capitalized = name.charAt(0).toUpperCase() + name.slice(1);
                        document.getElementById('templateSuffixDisplay').textContent = capitalized;
                    }
                }
            }
        }
        
        radios.forEach(function(radio) {
            radio.addEventListener('change', updateSaveOptions);
        });
        
        updateSaveOptions();
    }

    function browseOutputFolder() {
        csInterface.evalScript('browseForOutputFolder()', function(result) {
            try {
                var data = JSON.parse(result);
                if (data.success && elements.outputPath) {
                    elements.outputPath.textContent = data.path;
                    updateStatus('Output folder: ' + data.path, 'success');
                } else {
                    updateStatus(data.error || 'No folder selected', 'error');
                }
            } catch (e) {
                console.error('Browse output error:', e);
                updateStatus('Error selecting folder', 'error');
            }
        });
    }

    function toggleOrnamentsSection() {
        var section = elements.designsSection;
        if (section) {
            section.classList.toggle('collapsed');
        }
    }

    function updateOrnamentsHeader() {
        var header = document.getElementById('ornamentsHeader');
        if (header) {
            var foundCount = 0;
            var totalCount = 7;
            for (var key in detectedDesigns) {
                if (detectedDesigns[key] === true) foundCount++;
            }
            header.textContent = 'Ornaments (' + foundCount + '/' + totalCount + ')';
        }
    }

    function browseTemplate() {
        if (isBrowsing) return;
        isBrowsing = true;
        
        updateStatus('Opening template dialog...', 'processing');
        
        var script = 'browseForTemplate();';
        
        csInterface.evalScript(script, function(result) {
            isBrowsing = false;
            
            if (result && result !== 'null' && result !== 'undefined' && result !== '') {
                try {
                    var response = JSON.parse(result);
                    if (response.success && response.path) {
                        var exists = myTemplates.some(function(t) { return t.path === response.path; });
                        var existsAdditional = additionalTemplates.some(function(t) { return t.path === response.path; });
                        
                        if (!exists && !existsAdditional) {
                            additionalTemplates.push({
                                name: response.name,
                                path: response.path,
                                displayName: response.name.replace(/\.ai$/i, '')
                            });
                            renderSavedTemplates();
                        }
                        
                        setTemplate(response.path, response.name);
                        refreshDesigns();
                        updateStatus('Template loaded: ' + response.name, 'success');
                    } else {
                        updateStatus(response.error || 'No template selected', 'error');
                    }
                } catch(e) {
                    updateStatus('Error parsing template info', 'error');
                }
            } else {
                updateStatus('No template selected', 'error');
            }
        });
    }

    function setTemplate(path, name) {
        currentTemplate = { path: path, name: name };
        if (elements.templatePath) elements.templatePath.textContent = path;
        if (elements.templateName) elements.templateName.textContent = name;
        
        var escapedPath = path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        var script = "$.global.templateFilePath = '" + escapedPath + "';";
        csInterface.evalScript(script);
        
        // If in swatch mode, scan for swatches immediately
        var currentMode = document.querySelector('input[name="replacementMode"]:checked');
        if (currentMode && currentMode.value === 'swatches') {
            scanTemplateSwatches();
        }
    }

    function saveCurrentTemplate() {
        if (!currentTemplate) {
            updateStatus('No template to save', 'error');
            return;
        }
        if (!MY_TEMPLATES_FOLDER) {
            updateStatus('No templates folder set. Browse or Auto-Detect first.', 'error');
            return;
        }
        
        var exists = myTemplates.some(function(t) { return t.path === currentTemplate.path; });
        if (exists) {
            updateStatus('Template already in My Templates folder', 'error');
            return;
        }
        
        updateStatus('Copying to My Templates folder...', 'processing');
        
        var script = 'copyFileToFolder("' + currentTemplate.path.replace(/\\/g, '\\\\') + '", "' + MY_TEMPLATES_FOLDER.replace(/\\/g, '\\\\') + '\\\\' + currentTemplate.name + '")';
        
        csInterface.evalScript(script, function(result) {
            try {
                var data = JSON.parse(result);
                if (data.success) {
                    loadSavedTemplates();
                    updateStatus('Template saved to My Templates', 'success');
                } else {
                    updateStatus('Failed to copy: ' + data.error, 'error');
                }
            } catch (e) {
                updateStatus('Error saving template', 'error');
            }
        });
    }

    function loadSavedTemplates() {
        if (!MY_TEMPLATES_FOLDER) {
            myTemplates = [];
            renderSavedTemplates();
            return;
        }
        updateStatus('Scanning templates folder...', 'processing');
        
        var script = 'scanTemplateFolder("' + MY_TEMPLATES_FOLDER.replace(/\\/g, '\\\\') + '")';
        
        csInterface.evalScript(script, function(result) {
            try {
                var data = JSON.parse(result);
                if (data.success) {
                    myTemplates = data.templates || [];
                    renderSavedTemplates();
                    updateStatus('Found ' + myTemplates.length + ' templates', 'success');
                } else {
                    myTemplates = [];
                    renderSavedTemplates();
                    updateStatus(data.error || 'Folder not found', 'error');
                }
            } catch (e) {
                updateStatus('Error loading templates', 'error');
            }
        });
    }

    function renderSavedTemplates() {
        var container = elements.savedTemplatesList;
        if (!container) return;
        
        var allTemplates = [];
        myTemplates.forEach(function(t, i) {
            allTemplates.push({template: t, source: 'folder', index: i});
        });
        additionalTemplates.forEach(function(t, i) {
            allTemplates.push({template: t, source: 'additional', index: i});
        });
        
        if (allTemplates.length === 0) {
            var msg = MY_TEMPLATES_FOLDER 
                ? 'No .ai files found in<br>' + MY_TEMPLATES_FOLDER 
                : 'No templates folder set.<br>Use Auto-Detect or Browse to select mushafproject/templates/';
            container.innerHTML = '<div class="empty-state">' + msg + '</div>';
            return;
        }

        var html = '<div class="templates-grid">';
        
        allTemplates.forEach(function(item) {
            var template = item.template;
            var isActive = currentTemplate && currentTemplate.path === template.path;
            var displayName = escapeHtml(template.displayName || template.name);
            var isAdditional = item.source === 'additional';
            
            html += '<label class="template-radio-label ' + (isActive ? 'active' : '') + '">' +
                    '<input type="radio" name="templateSelect" data-source="' + item.source + '" data-index="' + item.index + '" ' + (isActive ? 'checked' : '') + '>' +
                    '<span class="radio-text" title="' + displayName + '">' + displayName + '</span>';
            
            if (isAdditional) {
                html += '<button class="remove-template-btn" data-index="' + item.index + '" title="Remove">×</button>';
            }
            
            html += '</label>';
        });
        
        html += '</div>';
        
        if (additionalTemplates.length > 0) {
            html += '<button id="clearAdditionalBtn" class="text-btn" style="margin-top: 8px; width: 100%; font-size: 10px; color: #666;">Clear Additional Templates</button>';
        }
        
        container.innerHTML = html;

        container.querySelectorAll('input[name="templateSelect"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                var source = this.dataset.source;
                var idx = parseInt(this.dataset.index);
                var template = (source === 'folder') ? myTemplates[idx] : additionalTemplates[idx];
                
                if (template) {
                    setTemplate(template.path, template.name);
                    refreshDesigns();
                    
                    container.querySelectorAll('.template-radio-label').forEach(function(label) {
                        label.classList.remove('active');
                    });
                    this.closest('.template-radio-label').classList.add('active');
                    
                    updateStatus('Loaded: ' + (template.displayName || template.name), 'success');
                }
            });
        });
        
        container.querySelectorAll('.remove-template-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var idx = parseInt(this.dataset.index);
                additionalTemplates.splice(idx, 1);
                
                if (currentTemplate && additionalTemplates.length > 0) {
                    var stillExists = additionalTemplates.some(function(t) { 
                        return t.path === currentTemplate.path; 
                    });
                    if (!stillExists && !myTemplates.some(function(t) { 
                        return t.path === currentTemplate.path; 
                    })) {
                        currentTemplate = null;
                        elements.templatePath.textContent = 'No template selected';
                        elements.templateName.textContent = '-';
                    }
                }
                
                renderSavedTemplates();
                updateStatus('Template removed', 'success');
            });
        });
        
        var clearBtn = document.getElementById('clearAdditionalBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                additionalTemplates = [];
                
                if (currentTemplate && !myTemplates.some(function(t) { 
                    return t.path === currentTemplate.path; 
                })) {
                    currentTemplate = null;
                    elements.templatePath.textContent = 'No template selected';
                    elements.templateName.textContent = '-';
                }
                
                renderSavedTemplates();
                updateStatus('Additional templates cleared', 'success');
            });
        }
    }

    function refreshDesigns() {
        if (!currentTemplate) {
            updateStatus('Select a template first', 'error');
            return;
        }

        var cacheKey = currentTemplate.path;
        if (cachedTemplateDesigns[cacheKey]) {
            detectedDesigns = cachedTemplateDesigns[cacheKey];
            renderDesigns();
            updateOrnamentsHeader();
            updateStatus('Ornaments restored from cache', 'success');
            return;
        }

        updateStatus('Scanning template for ornaments...', 'processing');

        var script = 'scanTemplateForDesigns("' + currentTemplate.path.replace(/\\/g, '\\\\') + '")';
        
        csInterface.evalScript(script, function(result) {
            if (result && result !== 'null' && result !== 'undefined') {
                try {
                    var response = JSON.parse(result);
                    detectedDesigns = {
                        ayah: response.ayah,
                        sajdah: response.sajdah,
                        ruba: response.ruba,
                        hizb: response.hizb,
                        hizbx: response.hizbx,
                        surah: response.surah,
                        border: response.border
                    };
                    cachedTemplateDesigns[cacheKey] = detectedDesigns;
                    renderDesigns();
                    updateOrnamentsHeader();
                    updateStatus('Ornaments refreshed', 'success');
                } catch(e) {
                    updateStatus('Error parsing ornaments', 'error');
                }
            } else {
                updateStatus('No ornaments found in template', 'error');
            }
        });
    }

    function renderDesigns() {
        var designTypes = [
            { key: 'ayah', name: 'Ayah', icon: 'آية', size: '4-5 × 5-7 mm' },
            { key: 'sajdah', name: 'Sajdah', icon: 'سجدة', size: '12-15 × 21-22 mm' },
            { key: 'ruba', name: 'Ruba', icon: 'ربع', size: '12-15 × 25-26 mm' },
            { key: 'hizb', name: 'Hizb', icon: 'حزب', size: '12-15 × 38-40 mm' },
            { key: 'hizbx', name: 'HizbX', icon: 'حزبx', size: '12-15 × 41-45 mm' },
            { key: 'surah', name: 'Surah', icon: 'سورة', size: '87-88 × 9-10 mm' },
            { key: 'border', name: 'Border', icon: 'زخرفة', size: '102-104 × 157-159 mm' }
        ];

        var html = '';
        designTypes.forEach(function(type) {
            var found = detectedDesigns[type.key];
            var statusClass = found ? 'found' : 'not-found';
            var statusText = found ? 'Found' : 'Not Found';
            
            html += '<div class="design-item ' + statusClass + '">' +
                    '<span class="design-icon" style="font-size: 11px; font-weight: bold;">' + type.icon + '</span>' +
                    '<div class="design-info">' +
                    '<div class="design-name">' + type.name + '</div>' +
                    '<div class="design-type">' + type.size + '</div>' +
                    '</div>' +
                    '<span class="design-status ' + statusClass + '">' + statusText + '</span>' +
                    '</div>';
        });

        if (elements.designsList) {
            elements.designsList.innerHTML = html;
        }
    }

    function toggleSelectAll() {
        var checkboxes = document.querySelectorAll('.ornament-type');
        var allChecked = Array.from(checkboxes).every(function(cb) {
            return cb.checked;
        });

        checkboxes.forEach(function(cb) {
            cb.checked = !allChecked;
        });

        if (elements.selectAllBtn) {
            elements.selectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
        }
    }

    function scanDocument() {
        updateStatus('Scanning document...', 'processing');

        var script = 'scanCurrentDocument();';
        
        csInterface.evalScript(script, function(result) {
            if (result && result !== 'null' && result !== 'undefined') {
                try {
                    var response = JSON.parse(result);
                    if (response._success || response.success) {
                        displayScanResults(response);
                        var total = response.found ? response.found.reduce(function(sum, item) { return sum + item.count; }, 0) : 0;
                        updateStatus('Scan complete: ' + total + ' ornaments found', 'success');
                    } else {
                        updateStatus(response._error || response.error || 'Scan failed', 'error');
                    }
                } catch(e) {
                    console.error('Scan parse error:', e, result);
                    updateStatus('Error parsing scan results', 'error');
                }
            } else {
                updateStatus('No document open or scan failed', 'error');
            }
        });
    }

    function closeStatusBar() {
        var statusBar = document.getElementById('statusBar');
        if (statusBar) {
            statusBar.classList.add('hidden');
        }
    }

    function updateStatus(text, type) {
        var statusBar = document.getElementById('statusBar');
        var statusText = document.getElementById('statusText');
        
        if (!statusBar || !statusText) return;
        
        statusBar.classList.remove('hidden');
        statusText.textContent = text;
        statusBar.className = 'status-bar';
        
        if (type) {
            statusBar.classList.add(type);
        }
        
        if (type === 'success') {
            setTimeout(function() {
                if (statusText.textContent === text) {
                    closeStatusBar();
                }
            }, 3000);
        }
    }

    function openScanModal() {
        var modal = document.getElementById('scanModal');
        if (modal) modal.classList.remove('hidden');
    }

    function closeScanModal() {
        var modal = document.getElementById('scanModal');
        if (modal) modal.classList.add('hidden');
    }

    function openProcessModal() {
        var modal = document.getElementById('processModal');
        if (modal) modal.classList.remove('hidden');
    }

    function closeProcessModal() {
        var modal = document.getElementById('processModal');
        if (modal) modal.classList.add('hidden');
    }

    function toggleOrnaments() {
        var section = document.querySelector('.ornaments-section');
        if (section) {
            section.classList.toggle('collapsed');
        }
    }

    function displayScanResults(data) {
        var foundList = document.getElementById('scanFoundList');
        var notFoundList = document.getElementById('scanNotFoundList');
        
        if (!foundList || !notFoundList) return;
        
        foundList.innerHTML = '';
        notFoundList.innerHTML = '';
        
        if (data.found && data.found.length > 0) {
            data.found.forEach(function(item) {
                var div = document.createElement('div');
                div.className = 'mini-item';
                div.innerHTML = '<span class="name">' + capitalize(item.type) + '</span><span class="count">' + item.count + ' found</span>';
                foundList.appendChild(div);
            });
        } else {
            foundList.innerHTML = '<div class="mini-item"><span class="name" style="color:#666">No ornaments found</span></div>';
        }
        
        if (data.notFound && data.notFound.length > 0) {
            data.notFound.forEach(function(item) {
                var div = document.createElement('div');
                div.className = 'mini-item';
                div.innerHTML = '<span class="name">' + capitalize(item.type) + '</span><span class="status">not found</span>';
                notFoundList.appendChild(div);
            });
        }
        
        openScanModal();
    }

    function displayProcessResults(data) {
        var successList = document.getElementById('processSuccessList');
        var errorsList = document.getElementById('processErrorsList');
        
        if (!successList || !errorsList) return;
        
        successList.innerHTML = '';
        errorsList.innerHTML = '';
        
        if (data.processed && data.processed.length > 0) {
            data.processed.forEach(function(item) {
                var div = document.createElement('div');
                div.className = 'mini-item';
                var label = item.label || (item.count > 0 ? item.count + ' replaced' : 'Done');
                div.innerHTML = '<span class="name">' + capitalize(item.type) + '</span><span class="status">' + label + '</span>';
                successList.appendChild(div);
            });
        } else {
            successList.innerHTML = '<div class="mini-item"><span class="name" style="color:#666">None processed</span></div>';
        }
        
        if (data.errors && data.errors.length > 0) {
            data.errors.forEach(function(err) {
                var div = document.createElement('div');
                div.className = 'mini-item error';
                div.innerHTML = '<span class="name">' + capitalize(err.type) + '</span><span class="status">' + err.reason + '</span>';
                errorsList.appendChild(div);
            });
        } else {
            errorsList.innerHTML = '<div class="mini-item"><span class="name" style="color:var(--success)">No errors</span></div>';
        }
        
        if (data.savedAs) {
            updateStatus('Saved as: ' + data.savedAs.split(/[\\/]/).pop(), 'success');
        }
        
        openProcessModal();
    }

    /* ==================== BATCH FOLDER-BY-FOLDER PROCESSING ==================== */

    function collectFilesRecursivelySync(dirPath, result) {
        var req = getNodeRequire();
        var fs = req('fs');
        var path = req('path');
        try {
            var entries = fs.readdirSync(dirPath);
            entries.forEach(function(name) {
                if (name.startsWith('.')) return;
                var fullPath = path.join(dirPath, name);
                try {
                    var stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        collectFilesRecursivelySync(fullPath, result);
                    } else if (name.match(/\.(ai|pdf|eps)$/i)) {
                        result.push(fullPath);
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }

    function groupFilesByFolder(files, basePath) {
        var path = getNodeRequire()('path');
        var groups = {};
        files.forEach(function(filePath) {
            var rel = filePath.replace(basePath, '').replace(/^\\|\//, '');
            var folder = rel.indexOf(path.sep) !== -1 ? rel.substring(0, rel.lastIndexOf(path.sep)) : '(root)';
            if (!groups[folder]) groups[folder] = [];
            groups[folder].push(filePath);
        });
        var result = [];
        Object.keys(groups).sort().forEach(function(folder) {
            result.push({ folder: folder, files: groups[folder] });
        });
        return result;
    }

    function processBatchFolderByFolder(options) {
        if (!hasNodeJs()) {
            updateStatus('Node.js not available for batch scan', 'error');
            return;
        }

        var fs = getNodeRequire()('fs');
        var batchFolder = options.batchFolder;

        if (!fs.existsSync(batchFolder)) {
            updateStatus('Batch folder not found: ' + batchFolder, 'error');
            return;
        }

        // 1. Collect all files via Node.js (scans ALL subfolders: Ajza, Review Task, Completed, etc.)
        var allFiles = [];
        collectFilesRecursivelySync(batchFolder, allFiles);

        // Exclude template file
        var templatePathNorm = (options.templatePath || '').replace(/\\/g, '/');
        var filesToProcess = allFiles.filter(function(f) {
            return f.replace(/\\/g, '/') !== templatePathNorm;
        });

        // Apply page filter if set (distinguish "no filter" null from "filter returned empty" [])
        if (Array.isArray(options.allowedPages)) {
            filesToProcess = filesToProcess.filter(function(f) {
                var name = f.replace(/\\/g, '/').split('/').pop();
                var match = name.match(/^(\d+)-/);
                if (!match) return false;
                var pageNum = parseInt(match[1], 10);
                return options.allowedPages.indexOf(pageNum) !== -1;
            });
        }

        if (filesToProcess.length === 0) {
            updateStatus('No files to process after filtering', 'error');
            return;
        }

        // 2. Flatten into chunks of 5 files (across all folders)
        var chunkSize = 5;
        var chunks = [];
        for (var i = 0; i < filesToProcess.length; i += chunkSize) {
            chunks.push(filesToProcess.slice(i, i + chunkSize));
        }

        // 3. Process chunks with 2s rest between each
        var current = 0;
        var totalProcessed = 0;
        var totalErrors = 0;
        var allDetails = [];

        if (elements.batchControls) elements.batchControls.style.display = 'block';
        if (elements.exportLogBtn) elements.exportLogBtn.disabled = true;

        function finishBatch() {
            if (elements.batchControls) elements.batchControls.style.display = 'none';
            if (elements.exportLogBtn) elements.exportLogBtn.disabled = false;
        }

        function processNext() {
            if (batchCancelled) {
                updateStatus('Ornament batch cancelled — ' + totalProcessed + ' processed, ' + totalErrors + ' errors', 'warning');
                batchCancelled = false;
                lastBatchLog = allDetails;
                finishBatch();
                return;
            }
            if (current >= chunks.length) {
                var msg = 'Batch complete — ' + totalProcessed + ' files processed';
                if (totalErrors > 0) msg += ', ' + totalErrors + ' errors';
                updateStatus(msg, totalErrors > 0 ? 'warning' : 'success');
                lastBatchLog = allDetails;
                finishBatch();
                return;
            }

            var chunk = chunks[current];
            var startFile = chunk[0].replace(/\\/g, '/').split('/').pop();
            var endFile = chunk[chunk.length - 1].replace(/\\/g, '/').split('/').pop();
            updateStatus('[' + (current + 1) + '/' + chunks.length + '] ' + startFile + ' → ' + endFile + ' (' + chunk.length + ' files)', 'processing');

            var chunkOptions = Object.assign({}, options, {
                chunkFiles: chunk,
                chunkIndex: current + 1,
                totalChunks: chunks.length
            });

            var script = 'processBatchChunk(' + JSON.stringify(JSON.stringify(chunkOptions)) + ');';
            csInterface.evalScript(script, function(result) {
                try {
                    var data = JSON.parse(result);
                    totalProcessed += data.processedCount || 0;
                    totalErrors += data.errorCount || 0;
                    if (data.details) {
                        data.details.forEach(function(d) { allDetails.push(d); });
                    }
                } catch (e) {
                    console.error('Chunk result error:', e, result);
                    totalErrors++;
                }

                current++;
                if (current < chunks.length) {
                    if (batchCancelled) {
                        updateStatus('Ornament batch cancelled — ' + totalProcessed + ' processed, ' + totalErrors + ' errors', 'warning');
                        batchCancelled = false;
                        lastBatchLog = allDetails;
                        finishBatch();
                        return;
                    }
                    updateStatus('Resting 2s before next chunk...', 'processing');
                    setTimeout(processNext, 2000);
                } else {
                    processNext();
                }
            });
        }

        processNext();
    }

    function cancelBatch() {
        batchCancelled = true;
        updateStatus('Cancelling batch...', 'processing');
    }

    function cancelRiwayahBatch() {
        riwayahCopyInProgress = false;
        updateStatus('Cancelling riwayah copy...', 'processing');
        if (elements.cancelRiwayahCopyBtn) elements.cancelRiwayahCopyBtn.style.display = 'none';
        if (elements.startRiwayahCopyBtn) elements.startRiwayahCopyBtn.disabled = false;
    }

    function exportBatchLog() {
        var nreq = getNodeRequire();
        if (!nreq) {
            updateStatus('Node.js not available for log export', 'error');
            return;
        }
        if (!lastBatchLog || lastBatchLog.length === 0) {
            updateStatus('No batch log to export. Run a batch first.', 'error');
            return;
        }
        try {
            var fs = nreq('fs');
            var os = nreq('os');
            var path = nreq('path');
            var homeDir = os.homedir ? os.homedir() : (process.env.HOME || process.env.USERPROFILE);
            var logDir = path.join(homeDir, 'Documents', 'MushafTaskManager', 'logs');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            var logPath = path.join(logDir, 'batch-log-' + timestamp + '.txt');
            var lines = ['Batch Log - ' + new Date().toString(), '====================', ''];
            lastBatchLog.forEach(function(entry) {
                lines.push('File: ' + (entry.file || 'unknown'));
                lines.push('  Processed: ' + (entry.processed ? entry.processed.join(', ') : 'none'));
                lines.push('  Errors:    ' + (entry.errors ? entry.errors.join(', ') : 'none'));
                lines.push('');
            });
            fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
            updateStatus('Log exported to ' + logPath, 'success');
        } catch (e) {
            updateStatus('Log export failed: ' + e.message, 'error');
        }
    }

    function processDocument() {
        var runAyahAlign = document.getElementById('ayahAlignAction') ? document.getElementById('ayahAlignAction').checked : false;
        var runOrnamentReplacement = document.getElementById('ornamentReplacementAction') ? document.getElementById('ornamentReplacementAction').checked : false;

        if (!runAyahAlign && !runOrnamentReplacement) {
            csInterface.evalScript('showAlert("Please select at least one action to run.", "No Selection")');
            updateStatus('Please select at least one action to run', 'error');
            return;
        }

        var replacementMode = document.querySelector('input[name="replacementMode"]:checked');
        var mode = replacementMode ? replacementMode.value : 'ornaments';
        
        var selectedTypes = [];
        if (runOrnamentReplacement && mode === 'ornaments') {
            document.querySelectorAll('.ornament-type:checked').forEach(function(cb) {
                selectedTypes.push(cb.value);
            });
        }
        
        var isAyahAlignOnly = (runAyahAlign && !runOrnamentReplacement);

        if (!currentTemplate && !isAyahAlignOnly) {
            csInterface.evalScript('showAlert("Please select a template first.", "No Template")');
            updateStatus('Please select a template first', 'error');
            return;
        }

        var options = {
            mode: document.querySelector('input[name="mode"]:checked').value || 'single',
            saveMode: document.querySelector('input[name="saveMode"]:checked').value || 'overwrite',
            silentMode: elements.silentMode ? elements.silentMode.checked : true,
            fitArtboard: elements.fitArtboard ? elements.fitArtboard.checked : true,
            autoSave: true,
            replacementMode: mode,
            runAyahAlign: runAyahAlign
        };

        if (currentTemplate) {
            options.templatePath = currentTemplate.path;
        }

        if (runOrnamentReplacement) {
            if (mode === 'ornaments') {
                if (selectedTypes.length === 0) {
                    csInterface.evalScript('showAlert("Please select at least one ornament type.", "No Selection")');
                    updateStatus('Please select at least one ornament type', 'error');
                    return;
                }
                options.selectedTypes = selectedTypes;
            } else {
                // Swatches mode - collect selected prefixes and their actual found names
                var selectedSwatches = [];
                document.querySelectorAll('.swatch-type:checked').forEach(function(cb) {
                    var prefix = cb.value;
                    var foundName = cb.dataset.foundName;
                    
                    if (foundName) {
                        selectedSwatches.push({
                            prefix: prefix,
                            templateName: foundName
                        });
                    }
                });

                if (selectedSwatches.length === 0) {
                    csInterface.evalScript('showAlert("Please select at least one swatch to replace.", "No Selection")');
                    updateStatus('Please select at least one swatch', 'error');
                    return;
                }

                options.selectedSwatches = selectedSwatches;
            }
        }

        // Setup output folder for save-as modes (must happen BEFORE batch check)
        if (options.saveMode === 'sameAsTemplate' || options.saveMode === 'newFile') {
            var outputPath = elements.outputPath ? elements.outputPath.textContent : '';
            if (!outputPath || outputPath === 'No folder selected') {
                csInterface.evalScript('showAlert("Please select an output folder.", "Missing Folder")');
                updateStatus('Select output folder', 'error');
                return;
            }
            options.outputFolder = outputPath;
            
            if (options.saveMode === 'sameAsTemplate') {
                if (!currentTemplate) {
                    csInterface.evalScript('showAlert("Please select a template first for Same as Template save mode.", "No Template")');
                    updateStatus('Please select a template first', 'error');
                    return;
                }
                options.nameSeparator = "-";
                var templateName = currentTemplate.name.replace(/\.ai$/i, '');
                options.nameSuffix = templateName.charAt(0).toUpperCase() + templateName.slice(1);
            } else if (options.saveMode === 'newFile') {
                options.nameSeparator = elements.nameSeparator ? elements.nameSeparator.value : '_';
                options.nameSuffix = elements.nameSuffix ? elements.nameSuffix.value : 'Fixed';
            }
        } else if (options.saveMode === 'dontSave') {
            options.dontSave = true;
        }

        // Add riwayah batch folder and filters if applicable
        var selectedRiwayah = document.getElementById('riwayahSelect') ? document.getElementById('riwayahSelect').value : '';
        if (options.mode === 'batch') {
            if (!selectedRiwayah) {
                updateStatus('Please select a riwayah for batch mode', 'error');
                return;
            }
            if (!appSettings.mushafFilesFolder) {
                updateStatus('Please set Mushaf Files folder in Settings', 'error');
                return;
            }
            if (!hasNodeJs()) {
                updateStatus('Node.js not available', 'error');
                return;
            }
            var path = getNodeRequire()('path');
            options.batchFolder = path.join(appSettings.mushafFilesFolder, selectedRiwayah).replace(/\\/g, '/');
            var allowed = computeAllowedPages();
            if (allowed) {
                options.allowedPages = allowed;
            }
            // Process folder-by-folder to avoid freezing
            processBatchFolderByFolder(options);
            return;
        }

        var statusMsg;
        if (!runOrnamentReplacement) {
            statusMsg = 'Running ayah align...';
        } else if (mode === 'swatches') {
            statusMsg = 'Replacing swatches...';
        } else {
            statusMsg = 'Processing ornaments...';
        }
        updateStatus(statusMsg, 'processing');

        var script = 'processWithOptions(' + JSON.stringify(JSON.stringify(options)) + ');';
        
        csInterface.evalScript(script, function(result) {
            try {
                var data = JSON.parse(result);
                displayProcessResults(data);
                if (data.success) {
                    var successMsg;
                    if (!runOrnamentReplacement) {
                        successMsg = 'Ayah align complete';
                    } else if (mode === 'swatches') {
                        successMsg = 'Swatches replaced';
                    } else {
                        successMsg = 'Processing complete';
                    }
                    updateStatus(data.message || successMsg, 'success');
                } else {
                    updateStatus(data.message || 'Processing failed', 'error');
                }
            } catch(e) {
                console.error('Process result error:', e, result);
                updateStatus('Processing complete', 'success');
            }
        });
    }

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function loadCheckboxSettings() {
        try {
            var stored = localStorage.getItem(SETTINGS_KEY);
            if (stored) {
                var settings = JSON.parse(stored);
                if (elements.silentMode) elements.silentMode.checked = settings.silentMode !== false;
                if (elements.fitArtboard) elements.fitArtboard.checked = settings.fitArtboard !== false;
                
                var ayahAlignAction = document.getElementById('ayahAlignAction');
                var ornamentReplacementAction = document.getElementById('ornamentReplacementAction');
                if (ayahAlignAction && settings.ayahAlignAction !== undefined) {
                    ayahAlignAction.checked = settings.ayahAlignAction;
                }
                if (ornamentReplacementAction && settings.ornamentReplacementAction !== undefined) {
                    ornamentReplacementAction.checked = settings.ornamentReplacementAction;
                }
            }
        } catch(e) {}
    }

    function saveCheckboxSettings() {
        var settings = {
            silentMode: elements.silentMode ? elements.silentMode.checked : true,
            fitArtboard: elements.fitArtboard ? elements.fitArtboard.checked : true
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
    
    function saveActionSettings() {
        try {
            var stored = localStorage.getItem(SETTINGS_KEY);
            var settings = stored ? JSON.parse(stored) : {};
            var ayahAlignAction = document.getElementById('ayahAlignAction');
            var ornamentReplacementAction = document.getElementById('ornamentReplacementAction');
            if (ayahAlignAction) settings.ayahAlignAction = ayahAlignAction.checked;
            if (ornamentReplacementAction) settings.ornamentReplacementAction = ornamentReplacementAction.checked;
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch(e) {}
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    if (elements.silentMode) elements.silentMode.addEventListener('change', saveCheckboxSettings);
    if (elements.fitArtboard) elements.fitArtboard.addEventListener('change', saveCheckboxSettings);

    /* ==================== TAB NAVIGATION ==================== */

    function setupTabNavigation() {
        window.switchTab = switchTab;
    }

    function switchTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(function(tab) {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.bottom-tab-btn').forEach(function(btn) {
            btn.classList.remove('active');
        });

        var selectedTab = document.getElementById(tabName + 'Tab');
        if (selectedTab) selectedTab.classList.add('active');

        var selectedBtn = document.querySelector('.bottom-tab-btn[data-tab="' + tabName + '"]');
        if (selectedBtn) selectedBtn.classList.add('active');

        // Populate settings fields when switching to settings
        if (tabName === 'settings') {
            var elTemplates = document.getElementById('templatesFolderPath');
            var elMushafFiles = document.getElementById('mushafFilesFolderPath');
            var elMushafTasks = document.getElementById('mushafTasksFolderPath');
            if (elTemplates) elTemplates.value = appSettings.templatesFolder || '';
            if (elMushafFiles) elMushafFiles.value = appSettings.mushafFilesFolder || '';
            if (elMushafTasks) elMushafTasks.value = appSettings.mushafTasksFolder || '';
        }
        
        // Scan layers when switching to layer copy tab
        if (tabName === 'layerCopy') {
            scanCurrentLayers();
            if (availableRiwayahs.length === 0) {
                loadRiwayahsFromMushafFiles();
            }
        }
    }

    /* ==================== LAYER COPY FUNCTIONS ==================== */
    
    var currentSourceFile = null;
    var layerCopyScriptLoaded = false;
    
    function getLayerCopyScriptPath() {
        try {
            var href = window.location.href;
            href = href.replace(/^file:\/+/, '').replace(/^\//, '').replace(/\\/g, '/');
            href = href.replace(/\/index\.html.*$/, '');
            return href + '/jsx/layercopy.jsx';
        } catch (e) {
            return '';
        }
    }
    
    function ensureLayerCopyScriptLoaded(callback) {
        if (layerCopyScriptLoaded) {
            if (callback) callback(true);
            return;
        }
        var scriptPath = getLayerCopyScriptPath();
        if (!scriptPath) {
            updateStatus('Cannot find layer copy script path', 'error');
            if (callback) callback(false);
            return;
        }
        var escapedPath = scriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        csInterface.evalScript('$.evalFile("' + escapedPath + '")', function(result) {
            if (result && result.indexOf('Error') !== -1) {
                updateStatus('Failed to load layer copy script: ' + result, 'error');
                if (callback) callback(false);
                return;
            }
            layerCopyScriptLoaded = true;
            if (callback) callback(true);
        });
    }
    
    function scanCurrentLayers() {
        if (!elements.currentLayersList) return;
        elements.currentLayersList.innerHTML = '<div class="empty-state">Scanning layers...</div>';
        
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) {
                elements.currentLayersList.innerHTML = '<div class="empty-state">Script load failed</div>';
                return;
            }
            csInterface.evalScript('scanCurrentLayers()', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (data.success && data.layers) {
                        renderLayersList(data.layers);
                    } else {
                        elements.currentLayersList.innerHTML = '<div class="empty-state">' + (data.error || 'No document open') + '</div>';
                    }
                } catch (e) {
                    elements.currentLayersList.innerHTML = '<div class="empty-state">Error scanning layers</div>';
                }
            });
        });
    }
    
    function renderLayersList(layers) {
        if (!elements.currentLayersList) return;
        if (!layers || layers.length === 0) {
            elements.currentLayersList.innerHTML = '<div class="empty-state">No layers found</div>';
            return;
        }
        
        var html = '';
        layers.forEach(function(layer) {
            var isMatched = !!layer.matched;
            var itemClass = isMatched ? 'layer-item matched' : 'layer-item unmatched';
            var badgeClass = isMatched ? 'layer-badge matched' : 'layer-badge unmatched';
            var badgeText = isMatched ? layer.standard : 'Unmatched';
            
            html += '<div class="' + itemClass + '">' +
                    '<span class="layer-name">' + escapeHtml(layer.name) + '</span>' +
                    '<span class="layer-badge ' + badgeClass + '">' + badgeText + '</span>' +
                    '</div>';
        });
        
        elements.currentLayersList.innerHTML = html;
    }
    
    function runUnifyLayerNames() {
        updateStatus('Unifying layer names...', 'processing');
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) return;
            csInterface.evalScript('runUnifyLayerNames()', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (data.success) {
                        scanCurrentLayers();
                        updateStatus(data.message || 'Layer names unified', 'success');
                    } else {
                        updateStatus(data.message || 'Unify failed', 'error');
                    }
                } catch (e) {
                    updateStatus('Error unifying layers', 'error');
                }
            });
        });
    }
    
    function browseSourceFile() {
        updateStatus('Opening source file dialog...', 'processing');
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) return;
            csInterface.evalScript('browseForSourceFile()', function(result) {
                try {
                    if (!result || result === 'null' || result === 'undefined') {
                        updateStatus('No result from file dialog', 'error');
                        return;
                    }
                    var data = JSON.parse(result);
                    if (data.success && data.path) {
                        currentSourceFile = { path: data.path, name: data.name };
                        if (elements.sourceFilePath) elements.sourceFilePath.textContent = data.path;
                        if (elements.sourceFileName) elements.sourceFileName.textContent = data.name;
                        scanSourceLayers();
                    } else {
                        updateStatus(data.error || 'No file selected', 'error');
                    }
                } catch (e) {
                    updateStatus('Error: ' + (result || e.message), 'error');
                }
            });
        });
    }
    
    function scanSourceLayers() {
        if (!currentSourceFile) return;
        if (elements.sourceLayersList) {
            elements.sourceLayersList.innerHTML = '<div class="empty-state" style="font-size: 11px; padding: 12px;">Scanning source layers...</div>';
        }
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) return;
            csInterface.evalScript('scanSourceLayers("' + currentSourceFile.path.replace(/\\/g, '\\\\') + '")', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (data.success && data.layers) {
                        renderSourceLayers(data.layers);
                        updateStatus('Found ' + data.layers.length + ' layer(s) in source', 'success');
                    } else {
                        if (elements.sourceLayersList) {
                            elements.sourceLayersList.innerHTML = '<div class="empty-state" style="font-size: 11px; padding: 12px;">' + (data.error || 'No layers found') + '</div>';
                        }
                    }
                } catch (e) {
                    if (elements.sourceLayersList) {
                        elements.sourceLayersList.innerHTML = '<div class="empty-state" style="font-size: 11px; padding: 12px;">Error scanning source</div>';
                    }
                }
            });
        });
    }
    
    function renderSourceLayers(layers) {
        if (!elements.sourceLayersList) return;
        if (!layers || layers.length === 0) {
            elements.sourceLayersList.innerHTML = '<div class="empty-state" style="font-size: 11px; padding: 12px;">No layers found</div>';
            return;
        }
        
        var html = '';
        layers.forEach(function(layer, idx) {
            var isMatched = !!layer.matched;
            var displayName = escapeHtml(layer.name);
            var badge = isMatched ? '<span style="font-size: 10px; color: var(--success);">' + escapeHtml(layer.standard) + '</span>' : '';
            var isChecked = isMatched ? 'checked' : '';
            
            html += '<label class="action-checkbox" style="margin-bottom: 0;">' +
                    '<input type="checkbox" class="source-layer-check" value="' + escapeHtml(layer.name) + '" data-index="' + idx + '" ' + isChecked + '>' +
                    '<span class="action-box ornament-replace">' +
                    '<span class="action-icon">' + (isMatched ? '✓' : '?') + '</span>' +
                    '<span class="action-name">' + displayName + '</span>' +
                    badge +
                    '</span>' +
                    '</label>';
        });
        
        elements.sourceLayersList.innerHTML = html;
        if (elements.refreshSourceLayersBtn) {
            elements.refreshSourceLayersBtn.style.display = 'inline-block';
        }
    }
    
    function copyLayersFromFile() {
        if (!currentSourceFile) {
            updateStatus('Please select a source file first', 'error');
            return;
        }
        
        var layersToCopy = [];
        document.querySelectorAll('.source-layer-check:checked').forEach(function(cb) {
            layersToCopy.push(cb.value);
        });
        
        if (layersToCopy.length === 0) {
            updateStatus('Please select at least one layer to copy', 'error');
            return;
        }
        
        var options = {
            layers: layersToCopy
        };
        
        updateStatus('Copying layers...', 'processing');
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) return;
            var script = 'copyLayersFromFile("' + currentSourceFile.path.replace(/\\/g, '\\\\') + '", ' + JSON.stringify(JSON.stringify(options)) + ')';
            
            csInterface.evalScript(script, function(result) {
                try {
                    var data = JSON.parse(result);
                    if (data.success) {
                        scanCurrentLayers();
                        var msg = data.message || 'Layers copied successfully';
                        if (data.deleted && data.deleted.length > 0) {
                            msg += ' (deleted old: ' + data.deleted.join(', ') + ')';
                        }
                        updateStatus(msg, 'success');
                    } else {
                        updateStatus(data.message || 'Copy failed', 'error');
                    }
                } catch (e) {
                    updateStatus('Error copying layers', 'error');
                }
            });
        });
    }
    
    // ==================== RIWAYAH TO RIWAYAH MODE ====================
    var currentSourceRiwayah = null;
    var currentTargetRiwayah = null;
    var riwayahCopyInProgress = false;
    var mushafProjectFolder = null;
    var availableRiwayahs = [];

    function switchLayerCopyMode(mode) {
        if (mode === 'single') {
            if (elements.singleFileSection) elements.singleFileSection.style.display = 'block';
            if (elements.layerCopyRiwayahSection) elements.layerCopyRiwayahSection.style.display = 'none';
            if (elements.modeSingleFile) {
                elements.modeSingleFile.style.background = 'var(--accent)';
                elements.modeSingleFile.style.color = 'white';
            }
            if (elements.modeRiwayah) {
                elements.modeRiwayah.style.background = 'var(--card-bg)';
                elements.modeRiwayah.style.color = 'var(--text-secondary)';
            }
        } else {
            if (elements.singleFileSection) elements.singleFileSection.style.display = 'none';
            if (elements.layerCopyRiwayahSection) elements.layerCopyRiwayahSection.style.display = 'block';
            if (elements.modeSingleFile) {
                elements.modeSingleFile.style.background = 'var(--card-bg)';
                elements.modeSingleFile.style.color = 'var(--text-secondary)';
            }
            if (elements.modeRiwayah) {
                elements.modeRiwayah.style.background = 'var(--accent)';
                elements.modeRiwayah.style.color = 'white';
            }
        }
    }

    function getMushafTaskSettingsPath() {
        var nreq = getNodeRequire();
        if (!nreq) return null;
        var os = nreq('os');
        var path = nreq('path');
        var homeDir = os.homedir ? os.homedir() : (process.env.HOME || process.env.USERPROFILE);
        return path.join(homeDir, 'Documents', 'MushafTaskManager', 'settings.json');
    }

    function readMushafTaskSettings() {
        var nreq = getNodeRequire();
        if (!nreq) return null;
        var fs = nreq('fs');
        var path = nreq('path');
        var settingsPath = getMushafTaskSettingsPath();
        if (!settingsPath) return null;
        try {
            var data = fs.readFileSync(settingsPath, 'utf8');
            var settings = JSON.parse(data);
            
            // Backward-compat: if projectFolder points to mushafproject root
            // instead of mushaffiles, derive the correct path
            if (settings && settings.projectFolder) {
                var projectRoot = settings.projectFolder;
                var hasDirectRiwayah = false;
                try {
                    var items = fs.readdirSync(projectRoot, { withFileTypes: true });
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].isDirectory()) {
                            var ajzaPath = path.join(projectRoot, items[i].name, 'Ajza');
                            var recheckPath = path.join(projectRoot, items[i].name, 'Recheck', 'Ajza');
                            if ((fs.existsSync(ajzaPath) && fs.statSync(ajzaPath).isDirectory()) ||
                                (fs.existsSync(recheckPath) && fs.statSync(recheckPath).isDirectory())) {
                                hasDirectRiwayah = true;
                                break;
                            }
                        }
                    }
                } catch (e) {}
                
                if (!hasDirectRiwayah) {
                    var nestedPath = path.join(projectRoot, 'mushaffiles');
                    try {
                        if (fs.existsSync(nestedPath) && fs.statSync(nestedPath).isDirectory()) {
                            var nestedItems = fs.readdirSync(nestedPath, { withFileTypes: true });
                            for (var j = 0; j < nestedItems.length; j++) {
                                if (nestedItems[j].isDirectory()) {
                                    var nestedAjza = path.join(nestedPath, nestedItems[j].name, 'Ajza');
                                    var nestedRecheck = path.join(nestedPath, nestedItems[j].name, 'Recheck', 'Ajza');
                                    if ((fs.existsSync(nestedAjza) && fs.statSync(nestedAjza).isDirectory()) ||
                                        (fs.existsSync(nestedRecheck) && fs.statSync(nestedRecheck).isDirectory())) {
                                        settings.projectFolder = nestedPath;
                                        console.log('ornamentReplacer: derived mushaffiles path from mushafproject root:', nestedPath);
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (e) {}
                }
            }
            
            return settings;
        } catch (e) { return null; }
    }

    function scanRiwayahFolders(projectPath) {
        var nreq = getNodeRequire();
        if (!nreq || !projectPath) return [];
        var fs = nreq('fs');
        var path = nreq('path');
        try {
            var items = fs.readdirSync(projectPath, { withFileTypes: true });
            var riwayahs = [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].isDirectory()) {
                    var ajzaPath = path.join(projectPath, items[i].name, 'Ajza');
                    var recheckPath = path.join(projectPath, items[i].name, 'Recheck', 'Ajza');
                    try {
                        if ((fs.existsSync(ajzaPath) && fs.statSync(ajzaPath).isDirectory()) ||
                            (fs.existsSync(recheckPath) && fs.statSync(recheckPath).isDirectory())) {
                            riwayahs.push(items[i].name);
                        }
                    } catch (e) {}
                }
            }
            return riwayahs.sort();
        } catch (e) { return []; }
    }

    function populateRiwayahDropdowns() {
        if (!elements.sourceRiwayahSelect || !elements.targetRiwayahSelect) return;
        elements.sourceRiwayahSelect.innerHTML = '<option value="">Select source riwayah...</option>';
        elements.targetRiwayahSelect.innerHTML = '<option value="">Select target riwayah...</option>';
        availableRiwayahs.forEach(function(name) {
            var opt1 = document.createElement('option');
            opt1.value = name;
            opt1.textContent = name;
            elements.sourceRiwayahSelect.appendChild(opt1);
            var opt2 = document.createElement('option');
            opt2.value = name;
            opt2.textContent = name;
            elements.targetRiwayahSelect.appendChild(opt2);
        });
    }

    function loadRiwayahsFromMushafFiles() {
        var settings = readMushafTaskSettings();
        if (!settings || !settings.projectFolder) {
            updateStatus('MushafTask settings not found. Please browse manually.', 'error');
            if (elements.mushafProjectPath) elements.mushafProjectPath.textContent = 'MushafTask settings not found';
            return;
        }
        mushafProjectFolder = settings.projectFolder.replace(/\\/g, '/');
        if (elements.mushafProjectPath) elements.mushafProjectPath.textContent = mushafProjectFolder;
        if (elements.mushafProjectName) {
            var parts = mushafProjectFolder.split('/');
            elements.mushafProjectName.textContent = parts[parts.length - 1] || 'Mushaf Files';
        }
        availableRiwayahs = scanRiwayahFolders(mushafProjectFolder);
        populateRiwayahDropdowns();
        populateFixOrderRiwayahDropdown();
        if (availableRiwayahs.length > 0) {
            updateStatus('Found ' + availableRiwayahs.length + ' riwayah(s)', 'success');
        } else {
            updateStatus('No riwayahs found in mushaf files location', 'error');
        }
    }

    function onSourceRiwayahSelected() {
        var name = elements.sourceRiwayahSelect ? elements.sourceRiwayahSelect.value : '';
        if (!name || !mushafProjectFolder) {
            currentSourceRiwayah = null;
            return;
        }
        var nreq = getNodeRequire();
        if (nreq) {
            var path = nreq('path');
            currentSourceRiwayah = { path: path.join(mushafProjectFolder, name).replace(/\\/g, '/'), name: name };
        } else {
            currentSourceRiwayah = { path: mushafProjectFolder + '/' + name, name: name };
        }
        scanRiwayahFirstFileLayers();
    }

    function onTargetRiwayahSelected() {
        var name = elements.targetRiwayahSelect ? elements.targetRiwayahSelect.value : '';
        if (!name || !mushafProjectFolder) {
            currentTargetRiwayah = null;
            return;
        }
        var nreq = getNodeRequire();
        if (nreq) {
            var path = nreq('path');
            currentTargetRiwayah = { path: path.join(mushafProjectFolder, name).replace(/\\/g, '/'), name: name };
        } else {
            currentTargetRiwayah = { path: mushafProjectFolder + '/' + name, name: name };
        }
        updateStatus('Target riwayah: ' + name, 'success');
    }

    function scanRiwayahFirstFileLayers() {
        if (!currentSourceRiwayah) return;
        var cacheKey = currentSourceRiwayah.path;
        if (cachedRiwayahLayers[cacheKey]) {
            renderRiwayahLayers(cachedRiwayahLayers[cacheKey]);
            updateStatus('Restored ' + cachedRiwayahLayers[cacheKey].length + ' layer(s) from cache', 'success');
            return;
        }
        if (elements.riwayahLayersList) {
            elements.riwayahLayersList.innerHTML = '<div class="empty-state" style="font-size: 11px; padding: 12px;">Scanning source riwayah for layers...</div>';
        }
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) return;
            var escapedPath = currentSourceRiwayah.path.replace(/\\/g, '\\\\');
            csInterface.evalScript('scanRiwayahFolderForLayers("' + escapedPath + '")', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (data.success && data.layers) {
                        cachedRiwayahLayers[cacheKey] = data.layers;
                        renderRiwayahLayers(data.layers);
                        updateStatus('Found ' + data.layers.length + ' layer(s) in source riwayah', 'success');
                    } else {
                        if (elements.riwayahLayersList) {
                            elements.riwayahLayersList.innerHTML = '<div class="empty-state" style="font-size: 11px; padding: 12px;">' + (data.error || 'No layers found') + '</div>';
                        }
                    }
                } catch (e) {
                    if (elements.riwayahLayersList) {
                        elements.riwayahLayersList.innerHTML = '<div class="empty-state" style="font-size: 11px; padding: 12px;">Error scanning riwayah</div>';
                    }
                }
            });
        });
    }

    function renderRiwayahLayers(layers) {
        if (!elements.riwayahLayersList) return;
        if (!layers || layers.length === 0) {
            elements.riwayahLayersList.innerHTML = '<div class="empty-state" style="font-size: 11px; padding: 12px;">No layers found</div>';
            return;
        }
        var html = '';
        layers.forEach(function(layer, idx) {
            var isMatched = !!layer.matched;
            var displayName = escapeHtml(layer.name);
            var badge = isMatched ? '<span style="font-size: 10px; color: var(--success);">' + escapeHtml(layer.standard) + '</span>' : '';
            var isChecked = isMatched ? 'checked' : '';
            html += '<label class="action-checkbox" style="margin-bottom: 0;">' +
                    '<input type="checkbox" class="riwayah-layer-check" value="' + escapeHtml(layer.name) + '" data-index="' + idx + '" ' + isChecked + '>' +
                    '<span class="action-box ornament-replace">' +
                    '<span class="action-icon">' + (isMatched ? '✓' : '?') + '</span>' +
                    '<span class="action-name">' + displayName + '</span>' +
                    badge +
                    '</span>' +
                    '</label>';
        });
        elements.riwayahLayersList.innerHTML = html;
    }

    function fixCurrentLayerOrder() {
        updateStatus('Fixing layer order...', 'processing');
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) return;
            csInterface.evalScript('fixLayerOrder()', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (data.success) {
                        scanCurrentLayers();
                        updateStatus(data.message || 'Layer order fixed', 'success');
                    } else {
                        updateStatus(data.message || 'Fix failed', 'error');
                    }
                } catch (e) {
                    updateStatus('Error fixing layer order', 'error');
                }
            });
        });
    }

    function fixRiwayahLayerOrder() {
        var select = elements.fixOrderRiwayahSelect;
        if (!select || !select.value) {
            updateStatus('Please select a riwayah first', 'error');
            return;
        }
        var riwayahName = select.value;
        if (!mushafProjectFolder) {
            updateStatus('Mushaf project folder not loaded', 'error');
            return;
        }
        var nreq = getNodeRequire();
        if (!nreq) {
            updateStatus('Node.js not available', 'error');
            return;
        }
        var path = nreq('path');
        var riwayahPath = path.join(mushafProjectFolder, riwayahName).replace(/\\/g, '/');

        if (elements.fixOrderProgressArea) elements.fixOrderProgressArea.style.display = 'block';
        if (elements.fixOrderProgressBar) elements.fixOrderProgressBar.style.width = '0%';
        if (elements.fixOrderProgressText) elements.fixOrderProgressText.textContent = 'Preparing...';
        if (elements.fixRiwayahLayerOrderBtn) elements.fixRiwayahLayerOrderBtn.disabled = true;

        updateStatus('Scanning riwayah files for layer order fix...', 'processing');
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) {
                if (elements.fixRiwayahLayerOrderBtn) elements.fixRiwayahLayerOrderBtn.disabled = false;
                return;
            }
            csInterface.evalScript('fixLayerOrderForRiwayah("' + riwayahPath.replace(/\\/g, '\\\\') + '")', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (elements.fixOrderProgressBar) elements.fixOrderProgressBar.style.width = '100%';
                    if (elements.fixOrderProgressText) {
                        elements.fixOrderProgressText.textContent = (data.processed || 0) + ' files processed';
                    }
                    if (data.success) {
                        updateStatus(data.message || 'Layer order fix complete', 'success');
                    } else {
                        updateStatus(data.message || 'Fix failed', 'error');
                    }
                } catch (e) {
                    updateStatus('Error fixing riwayah layer order', 'error');
                }
                if (elements.fixRiwayahLayerOrderBtn) elements.fixRiwayahLayerOrderBtn.disabled = false;
            });
        });
    }

    function populateFixOrderRiwayahDropdown() {
        if (!elements.fixOrderRiwayahSelect) return;
        elements.fixOrderRiwayahSelect.innerHTML = '<option value="">Select riwayah...</option>';
        availableRiwayahs.forEach(function(name) {
            var opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            elements.fixOrderRiwayahSelect.appendChild(opt);
        });
    }

    function startRiwayahBatchCopy() {
        if (!currentSourceRiwayah) {
            updateStatus('Please select a source riwayah folder first', 'error');
            return;
        }
        if (!currentTargetRiwayah) {
            updateStatus('Please select a target riwayah folder first', 'error');
            return;
        }

        var layersToCopy = [];
        document.querySelectorAll('.riwayah-layer-check:checked').forEach(function(cb) {
            layersToCopy.push(cb.value);
        });

        if (layersToCopy.length === 0) {
            updateStatus('Please select at least one layer to copy', 'error');
            return;
        }

        if (riwayahCopyInProgress) {
            updateStatus('Riwayah copy already in progress', 'error');
            return;
        }

        riwayahCopyInProgress = true;
        if (elements.riwayahProgressArea) elements.riwayahProgressArea.style.display = 'block';
        if (elements.startRiwayahCopyBtn) elements.startRiwayahCopyBtn.disabled = true;
        if (elements.cancelRiwayahCopyBtn) elements.cancelRiwayahCopyBtn.style.display = 'block';
        if (elements.riwayahProgressBar) elements.riwayahProgressBar.style.width = '0%';
        if (elements.riwayahProgressText) elements.riwayahProgressText.textContent = 'Preparing...';

        updateStatus('Scanning source riwayah files...', 'processing');
        ensureLayerCopyScriptLoaded(function(ok) {
            if (!ok) {
                riwayahCopyInProgress = false;
                if (elements.startRiwayahCopyBtn) elements.startRiwayahCopyBtn.disabled = false;
                if (elements.cancelRiwayahCopyBtn) elements.cancelRiwayahCopyBtn.style.display = 'none';
                return;
            }
            var escapedSource = currentSourceRiwayah.path.replace(/\\/g, '\\\\');
            csInterface.evalScript('getRiwayahFileList("' + escapedSource + '")', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (!data.success || !data.files || data.files.length === 0) {
                        riwayahCopyInProgress = false;
                        if (elements.startRiwayahCopyBtn) elements.startRiwayahCopyBtn.disabled = false;
                        if (elements.cancelRiwayahCopyBtn) elements.cancelRiwayahCopyBtn.style.display = 'none';
                        updateStatus(data.error || 'No source files found', 'error');
                        return;
                    }

                    var allFiles = data.files;
                    var chunkSize = 5;
                    var chunks = [];
                    for (var i = 0; i < allFiles.length; i += chunkSize) {
                        chunks.push(allFiles.slice(i, i + chunkSize));
                    }
                    var totalFiles = allFiles.length;
                    var totalCopied = 0;
                    var totalSkipped = [];
                    var totalErrors = [];
                    var processedCount = 0;

                    function processChunk(chunkIndex) {
                        if (!riwayahCopyInProgress) {
                            if (elements.startRiwayahCopyBtn) elements.startRiwayahCopyBtn.disabled = false;
                            if (elements.cancelRiwayahCopyBtn) elements.cancelRiwayahCopyBtn.style.display = 'none';
                            updateStatus('Riwayah copy cancelled', 'warning');
                            return;
                        }
                        if (chunkIndex >= chunks.length) {
                            riwayahCopyInProgress = false;
                            if (elements.startRiwayahCopyBtn) elements.startRiwayahCopyBtn.disabled = false;
                            if (elements.cancelRiwayahCopyBtn) elements.cancelRiwayahCopyBtn.style.display = 'none';
                            if (elements.riwayahProgressBar) elements.riwayahProgressBar.style.width = '100%';
                            var msg = 'Riwayah copy complete: ' + totalCopied + ' / ' + totalFiles + ' pages copied';
                            if (totalSkipped.length > 0) msg += ', ' + totalSkipped.length + ' skipped';
                            if (totalErrors.length > 0) msg += ', ' + totalErrors.length + ' errors';
                            updateStatus(msg, 'success');
                            return;
                        }

                        var chunk = chunks[chunkIndex];
                        var filePaths = chunk.map(function(f) { return f.path; });
                        var options = {
                            layers: layersToCopy,
                            filePaths: filePaths
                        };
                        var escapedTarget = currentTargetRiwayah.path.replace(/\\/g, '\\\\');
                        var script = 'copyLayersForFileList("' + escapedTarget + '", ' + JSON.stringify(JSON.stringify(options)) + ')';

                        updateStatus('Processing chunk ' + (chunkIndex + 1) + ' / ' + chunks.length + '...', 'processing');
                        csInterface.evalScript(script, function(chunkResult) {
                            try {
                                var chunkData = JSON.parse(chunkResult);
                                if (chunkData.copied) totalCopied += chunkData.copied;
                                if (chunkData.skipped) totalSkipped = totalSkipped.concat(chunkData.skipped);
                                if (chunkData.errors) totalErrors = totalErrors.concat(chunkData.errors);
                                processedCount += chunk.length;

                                var pct = Math.round((processedCount / totalFiles) * 100);
                                if (elements.riwayahProgressBar) elements.riwayahProgressBar.style.width = pct + '%';
                                if (elements.riwayahProgressText) {
                                    elements.riwayahProgressText.textContent = processedCount + ' / ' + totalFiles + ' (copied ' + totalCopied + ')';
                                }
                            } catch (e) {
                                updateStatus('Chunk ' + (chunkIndex + 1) + ' error', 'error');
                            }

                            if (chunkIndex + 1 < chunks.length) {
                                updateStatus('Resting 2s before next chunk...', 'processing');
                                setTimeout(function() {
                                    processChunk(chunkIndex + 1);
                                }, 2000);
                            } else {
                                processChunk(chunkIndex + 1);
                            }
                        });
                    }

                    processChunk(0);
                } catch (e) {
                    riwayahCopyInProgress = false;
                    if (elements.startRiwayahCopyBtn) elements.startRiwayahCopyBtn.disabled = false;
                    if (elements.cancelRiwayahCopyBtn) elements.cancelRiwayahCopyBtn.style.display = 'none';
                    updateStatus('Error scanning files', 'error');
                }
            });
        });
    }

    /* ==================== APP SETTINGS (file-based) ==================== */



    function browseSettingFolder(inputId, settingKey) {
        csInterface.evalScript('selectFolderDialog("Select Folder")', function(result) {
            if (result && result !== 'null' && !result.startsWith('ERROR')) {
                var input = document.getElementById(inputId);
                if (input) input.value = result;
                appSettings[settingKey] = result;
                saveSettings();
                updateStatus('Folder saved', 'success');

                // If templates folder changed, reload templates
                if (settingKey === 'templatesFolder') {
                    MY_TEMPLATES_FOLDER = result;
                    loadSavedTemplates();
                }
                // If mushaf folders changed, refresh riwayahs
                if (settingKey === 'mushafFilesFolder' || settingKey === 'mushafTasksFolder') {
                    populateRiwayahDropdown();
                }
            }
        });
    }

    /* ==================== RIWAYAH DROPDOWN ==================== */

    function safeListDirs(dirPath) {
        var req = getNodeRequire();
        var fs = req('fs');
        var path = req('path');
        var dirs = [];
        if (!fs.existsSync(dirPath)) return dirs;
        try {
            var entries = fs.readdirSync(dirPath);
            entries.forEach(function(name) {
                if (name.startsWith('.')) return;
                try {
                    var stat = fs.statSync(path.join(dirPath, name));
                    if (stat.isDirectory()) dirs.push(name);
                } catch (e) {}
            });
        } catch (e) {}
        return dirs;
    }

    function populateRiwayahDropdown() {
        var select = document.getElementById('riwayahSelect');
        if (!select) { updateStatus('Riwayah select not found', 'error'); return; }
        if (!hasNodeJs()) { updateStatus('Node.js not available', 'error'); return; }

        var currentVal = select.value;
        var fs = getNodeRequire()('fs');
        var path = getNodeRequire()('path');
        var riwayahs = [];

        // Only scan mushaftasks/riwayah-tasks
        if (appSettings.mushafTasksFolder) {
            var tasksPath = path.join(appSettings.mushafTasksFolder, 'riwayah-tasks');
            if (fs.existsSync(tasksPath)) {
                var dirs = safeListDirs(tasksPath);
                dirs.forEach(function(name) {
                    if (riwayahs.indexOf(name) === -1) riwayahs.push(name);
                });
            } else {
                updateStatus('riwayah-tasks folder not found: ' + tasksPath, 'error');
            }
        }

        riwayahs.sort();

        // Rebuild options
        select.innerHTML = '<option value="">All Riwayahs</option>';
        riwayahs.forEach(function(r) {
            var opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            select.appendChild(opt);
        });

        if (riwayahs.length === 0) {
            updateStatus('No riwayahs found in riwayah-tasks', 'error');
        } else {
            updateStatus('Found ' + riwayahs.length + ' riwayah(s)', 'success');
        }

        // Restore selection
        if (appSettings.selectedRiwayah) {
            var found = Array.from(select.options).some(function(o) { return o.value === appSettings.selectedRiwayah; });
            if (found) select.value = appSettings.selectedRiwayah;
        } else if (currentVal) {
            var found = Array.from(select.options).some(function(o) { return o.value === currentVal; });
            if (found) select.value = currentVal;
        }
    }

    var juzSelectMode = 'range';
    var surahSelectMode = 'range';

    function setJuzMode(mode) {
        juzSelectMode = mode;
        document.getElementById('juzModeRange').classList.toggle('active', mode === 'range');
        document.getElementById('juzModeMulti').classList.toggle('active', mode === 'multi');
        document.getElementById('juzRangeContainer').classList.toggle('hidden', mode !== 'range');
        document.getElementById('juzCheckboxes').classList.toggle('hidden', mode !== 'multi');
        if (mode === 'range') renderJuzRange();
        else renderJuzCheckboxes();
    }

    function setSurahMode(mode) {
        surahSelectMode = mode;
        document.getElementById('surahModeRange').classList.toggle('active', mode === 'range');
        document.getElementById('surahModeMulti').classList.toggle('active', mode === 'multi');
        document.getElementById('surahRangeContainer').classList.toggle('hidden', mode !== 'range');
        document.getElementById('surahCheckboxes').classList.toggle('hidden', mode !== 'multi');
        if (mode === 'range') renderSurahRange();
        else renderSurahCheckboxes();
    }

    function renderJuzRange() {
        var fromSel = document.getElementById('juzFrom');
        var toSel = document.getElementById('juzTo');
        if (!fromSel || !toSel) return;
        fromSel.innerHTML = '<option value="">—</option>';
        toSel.innerHTML = '<option value="">—</option>';

        var fromVal = '', toVal = '';
        if (appSettings.selectedJuzs && appSettings.selectedJuzs.length > 0) {
            fromVal = Math.min.apply(null, appSettings.selectedJuzs);
            toVal = Math.max.apply(null, appSettings.selectedJuzs);
        }
        for (var j = 1; j <= 30; j++) {
            var optFrom = document.createElement('option');
            optFrom.value = j; optFrom.textContent = j;
            if (j === fromVal) optFrom.selected = true;
            fromSel.appendChild(optFrom);

            var optTo = document.createElement('option');
            optTo.value = j; optTo.textContent = j;
            if (j === toVal) optTo.selected = true;
            toSel.appendChild(optTo);
        }
    }

    function renderSurahRange() {
        var fromSel = document.getElementById('surahFrom');
        var toSel = document.getElementById('surahTo');
        if (!fromSel || !toSel) return;
        fromSel.innerHTML = '<option value="">—</option>';
        toSel.innerHTML = '<option value="">—</option>';
        loadMushafData();

        var fromVal = '', toVal = '';
        if (appSettings.selectedSurahs && appSettings.selectedSurahs.length > 0) {
            fromVal = Math.min.apply(null, appSettings.selectedSurahs);
            toVal = Math.max.apply(null, appSettings.selectedSurahs);
        }
        for (var s = 1; s <= 114; s++) {
            var surahLabel = 'surah' + String(s).padStart(3, '0');
            var optFrom = document.createElement('option');
            optFrom.value = s; optFrom.textContent = surahLabel;
            if (s === fromVal) optFrom.selected = true;
            fromSel.appendChild(optFrom);

            var optTo = document.createElement('option');
            optTo.value = s; optTo.textContent = surahLabel;
            if (s === toVal) optTo.selected = true;
            toSel.appendChild(optTo);
        }
    }

    function openJuzFilterModal() {
        setJuzMode(juzSelectMode);
        var modal = document.getElementById('juzFilterModal');
        if (modal) modal.classList.remove('hidden');
    }

    function closeJuzFilterModal() {
        var modal = document.getElementById('juzFilterModal');
        if (modal) modal.classList.add('hidden');
    }

    function openSurahFilterModal() {
        setSurahMode(surahSelectMode);
        var modal = document.getElementById('surahFilterModal');
        if (modal) modal.classList.remove('hidden');
    }

    function closeSurahFilterModal() {
        var modal = document.getElementById('surahFilterModal');
        if (modal) modal.classList.add('hidden');
    }

    function renderJuzCheckboxes() {
        var container = document.getElementById('juzCheckboxes');
        if (!container) return;
        container.innerHTML = '';
        var selected = appSettings.selectedJuzs || [];
        for (var j = 1; j <= 30; j++) {
            var div = document.createElement('div');
            var isChecked = selected.indexOf(j) !== -1;
            div.className = 'cb-item' + (isChecked ? ' checked' : '');
            div.innerHTML = '<input type="checkbox" id="juzCb' + j + '" value="' + j + '"' + (isChecked ? ' checked' : '') + '><label for="juzCb' + j + '">' + j + '</label>';
            div.onclick = function(cb) {
                return function(e) {
                    if (e.target.tagName !== 'INPUT') cb.checked = !cb.checked;
                    cb.parentElement.classList.toggle('checked', cb.checked);
                };
            }(div.querySelector('input'));
            container.appendChild(div);
        }
    }

    function renderSurahCheckboxes() {
        var container = document.getElementById('surahCheckboxes');
        if (!container) return;
        container.innerHTML = '';
        loadMushafData();
        var selected = appSettings.selectedSurahs || [];
        for (var s = 1; s <= 114; s++) {
            var div = document.createElement('div');
            var isChecked = selected.indexOf(s) !== -1;
            div.className = 'cb-item' + (isChecked ? ' checked' : '');
            div.innerHTML = '<input type="checkbox" id="surahCb' + s + '" value="' + s + '"' + (isChecked ? ' checked' : '') + '><label for="surahCb' + s + '" class="surah-select">surah' + String(s).padStart(3, '0') + '</label>';
            div.onclick = function(cb) {
                return function(e) {
                    if (e.target.tagName !== 'INPUT') cb.checked = !cb.checked;
                    cb.parentElement.classList.toggle('checked', cb.checked);
                };
            }(div.querySelector('input'));
            container.appendChild(div);
        }
    }

    function applyJuzFilter() {
        if (juzSelectMode === 'range') {
            var fromVal = parseInt(document.getElementById('juzFrom').value, 10);
            var toVal = parseInt(document.getElementById('juzTo').value, 10);
            if (!isNaN(fromVal) && !isNaN(toVal) && fromVal > 0 && toVal > 0) {
                var start = Math.min(fromVal, toVal);
                var end = Math.max(fromVal, toVal);
                var range = [];
                for (var j = start; j <= end; j++) range.push(j);
                appSettings.selectedJuzs = range;
                appSettings.selectedSurahs = [];
                appSettings.filterMode = 'juz';
            } else {
                appSettings.selectedJuzs = [];
                appSettings.filterMode = '';
            }
        } else {
            var checked = [];
            document.querySelectorAll('#juzCheckboxes input:checked').forEach(function(cb) {
                checked.push(parseInt(cb.value, 10));
            });
            appSettings.selectedJuzs = checked;
            appSettings.selectedSurahs = [];
            appSettings.filterMode = checked.length > 0 ? 'juz' : '';
        }
        saveSettings();
        updateFilterGridUI();
        closeJuzFilterModal();
    }

    function applySurahFilter() {
        if (surahSelectMode === 'range') {
            var fromVal = parseInt(document.getElementById('surahFrom').value, 10);
            var toVal = parseInt(document.getElementById('surahTo').value, 10);
            if (!isNaN(fromVal) && !isNaN(toVal) && fromVal > 0 && toVal > 0) {
                var start = Math.min(fromVal, toVal);
                var end = Math.max(fromVal, toVal);
                var range = [];
                for (var s = start; s <= end; s++) range.push(s);
                appSettings.selectedSurahs = range;
                appSettings.selectedJuzs = [];
                appSettings.filterMode = 'surah';
            } else {
                appSettings.selectedSurahs = [];
                appSettings.filterMode = '';
            }
        } else {
            var checked = [];
            document.querySelectorAll('#surahCheckboxes input:checked').forEach(function(cb) {
                checked.push(parseInt(cb.value, 10));
            });
            appSettings.selectedSurahs = checked;
            appSettings.selectedJuzs = [];
            appSettings.filterMode = checked.length > 0 ? 'surah' : '';
        }
        saveSettings();
        updateFilterGridUI();
        closeSurahFilterModal();
    }

    function clearJuzFilter() {
        var fromSel = document.getElementById('juzFrom');
        var toSel = document.getElementById('juzTo');
        if (fromSel) fromSel.value = '';
        if (toSel) toSel.value = '';
        document.querySelectorAll('#juzCheckboxes input').forEach(function(cb) {
            cb.checked = false;
            cb.parentElement.classList.remove('checked');
        });
    }

    function clearSurahFilter() {
        var fromSel = document.getElementById('surahFrom');
        var toSel = document.getElementById('surahTo');
        if (fromSel) fromSel.value = '';
        if (toSel) toSel.value = '';
        document.querySelectorAll('#surahCheckboxes input').forEach(function(cb) {
            cb.checked = false;
            cb.parentElement.classList.remove('checked');
        });
    }

    function updateFilterGridUI() {
        var grid = document.getElementById('filterGrid');
        var juzCard = document.getElementById('juzFilterCard');
        var surahCard = document.getElementById('surahFilterCard');
        var juzCount = document.getElementById('juzFilterCount');
        var surahCount = document.getElementById('surahFilterCount');

        if (juzCard) {
            juzCard.classList.toggle('active', appSettings.filterMode === 'juz' && appSettings.selectedJuzs.length > 0);
        }
        if (surahCard) {
            surahCard.classList.toggle('active', appSettings.filterMode === 'surah' && appSettings.selectedSurahs.length > 0);
        }
        if (juzCount) {
            var count = (appSettings.selectedJuzs || []).length;
            juzCount.textContent = count > 0 ? count + ' selected' : '';
        }
        if (surahCount) {
            var count = (appSettings.selectedSurahs || []).length;
            surahCount.textContent = count > 0 ? count + ' selected' : '';
        }
    }

    function scanAndPopulateBatchFilters(riwayah) {
        var grid = document.getElementById('filterGrid');

        if (!riwayah || !appSettings.mushafFilesFolder || !hasNodeJs()) {
            if (grid) grid.style.display = 'none';
            return;
        }

        var fs = getNodeRequire()('fs');
        var path = getNodeRequire()('path');
        var riwayahPath = path.join(appSettings.mushafFilesFolder, riwayah);
        if (!fs.existsSync(riwayahPath)) {
            if (grid) grid.style.display = 'none';
            return;
        }

        updateFilterGridUI();
        if (grid) grid.style.display = 'block';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();