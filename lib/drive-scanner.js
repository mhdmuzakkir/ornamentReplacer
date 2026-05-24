/**
 * Drive Scanner Module
 * ====================
 * Auto-discovers the mushafproject folder across all Google Drive mounts,
 * Windows shortcuts (.lnk), and multiple drive accounts.
 *
 * Designed to be reusable across all Mushaf tools:
 *   - mushaftask (CEP extension)
 *   - mushafweb  (web viewer)
 *   - mushafwebp exporter
 *   - symbol palette
 *
 * Exposes: window.DriveScanner
 */

(function() {
    'use strict';

    // ------------------------------------------------------------------
    // CONFIGURATION
    // ------------------------------------------------------------------
    var PROJECT_FOLDER_NAME = 'mushafproject';
    var EXPECTED_SUBFOLDERS = ['mushaftasks', 'mushaffiles'];
    var GOOGLE_DRIVE_NAMES  = ['My Drive', 'Google Drive'];

    // ------------------------------------------------------------------
    // UTILITIES
    // ------------------------------------------------------------------
    function isNodeAvailable() {
        return typeof require !== 'undefined';
    }

    function execSync(cmd, timeoutMs) {
        try {
            var child_process = require('child_process');
            return child_process.execSync(cmd, {
                encoding: 'utf8',
                timeout: timeoutMs || 10000,
                windowsHide: true
            }).trim();
        } catch (e) {
            console.log('DriveScanner execSync failed:', cmd, e.message);
            return '';
        }
    }

    function pathExists(p) {
        try {
            if (typeof fs === 'undefined' || !p) return false;
            return fs.existsSync(p);
        } catch (e) {
            return false;
        }
    }

    function isAccessibleFolder(p) {
        try {
            if (typeof fs === 'undefined' || !p) return false;
            if (!fs.existsSync(p)) return false;
            fs.readdirSync(p);
            return true;
        } catch (e) {
            return false;
        }
    }

    function joinPath() {
        if (typeof path !== 'undefined' && path.join) {
            return path.join.apply(path, arguments);
        }
        // Fallback for non-Node contexts
        return Array.prototype.slice.call(arguments).join('\\').replace(/\\+/g, '\\');
    }

    // ------------------------------------------------------------------
    // 1. DISCOVER ALL DRIVE LETTERS
    // ------------------------------------------------------------------
    function getAllDrives() {
        var drives = [];
        if (!isNodeAvailable()) {
            // Browser fallback: can't scan drives
            return drives;
        }

        try {
            // Method 1: wmic (fastest)
            var wmicOutput = execSync('wmic logicaldisk get name /format:csv 2>nul', 5000);
            var wmicLines = wmicOutput.split(/\r?\n/);
            wmicLines.forEach(function(line) {
                var parts = line.split(',');
                var last = parts[parts.length - 1].trim();
                if (/^[A-Z]:$/.test(last)) {
                    drives.push(last + '\\');
                }
            });
        } catch (e) {
            console.log('DriveScanner: wmic failed, trying PowerShell');
        }

        if (drives.length === 0) {
            try {
                // Method 2: PowerShell
                var psOutput = execSync(
                    'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"',
                    5000
                );
                var psLines = psOutput.split(/\r?\n/);
                psLines.forEach(function(line) {
                    line = line.trim();
                    if (/^[A-Z]:\\$/.test(line) && drives.indexOf(line) === -1) {
                        drives.push(line);
                    }
                });
            } catch (e) {
                console.log('DriveScanner: PowerShell drive enumeration failed');
            }
        }

        // Always include common defaults even if enumeration failed
        var defaults = ['C:\\', 'G:\\', 'H:\\', 'D:\\'];
        defaults.forEach(function(d) {
            if (drives.indexOf(d) === -1) drives.push(d);
        });

        console.log('DriveScanner: discovered drives:', drives);
        return drives;
    }

    // ------------------------------------------------------------------
    // 2. RESOLVE WINDOWS SHORTCUT (.lnk)
    // ------------------------------------------------------------------
    function resolveShortcut(lnkPath) {
        if (!isNodeAvailable()) return null;
        try {
            var psCmd = 'powershell -NoProfile -Command "$shell = New-Object -ComObject WScript.Shell; ' +
                '$s = $shell.CreateShortcut(\'' + lnkPath.replace(/'/g, "''") + '\'); ' +
                'Write-Output $s.TargetPath"';
            var target = execSync(psCmd, 5000).trim();
            if (target && pathExists(target)) {
                console.log('DriveScanner: resolved shortcut', lnkPath, '→', target);
                return target;
            }
        } catch (e) {
            console.log('DriveScanner: shortcut resolution failed for', lnkPath, e.message);
        }
        return null;
    }

    // ------------------------------------------------------------------
    // 3. FIND GOOGLE DRIVE ROOTS
    // ------------------------------------------------------------------
    function findGoogleDriveRoots() {
        var roots = [];
        var drives = getAllDrives();
        console.log('DriveScanner: checking drives for Google Drive roots:', drives);

        // Pattern A: X:\My Drive\  or  X:\Google Drive\
        // Use pathExists (lighter) instead of isAccessibleFolder because
        // fs.readdirSync can fail on Google Drive roots when offline/syncing
        drives.forEach(function(drive) {
            GOOGLE_DRIVE_NAMES.forEach(function(gdName) {
                var candidate = joinPath(drive, gdName);
                if (pathExists(candidate)) {
                    console.log('DriveScanner: found Google Drive root:', candidate);
                    roots.push({ path: candidate, type: 'direct', drive: drive });
                } else {
                    console.log('DriveScanner: not found:', candidate);
                }
            });
        });

        // Pattern B: User-profile legacy paths
        var profilePaths = [];
        if (typeof os !== 'undefined' && os.homedir) {
            var home = os.homedir();
            profilePaths.push(joinPath(home, 'Google Drive'));
            profilePaths.push(joinPath(home, 'My Drive'));
            profilePaths.push(joinPath(home, 'Drive'));
        }
        profilePaths.forEach(function(candidate) {
            if (pathExists(candidate) && !roots.some(function(r) { return r.path === candidate; })) {
                console.log('DriveScanner: found Google Drive root (profile):', candidate);
                roots.push({ path: candidate, type: 'direct', drive: 'profile' });
            }
        });

        // Pattern C: Google Drive FS mount points (newer Drive for Desktop)
        if (typeof os !== 'undefined' && os.homedir) {
            var localAppData = (typeof process !== 'undefined' && process.env && process.env.LOCALAPPDATA)
                ? process.env.LOCALAPPDATA
                : joinPath(os.homedir(), 'AppData', 'Local');
            var driveFSRoot = joinPath(localAppData, 'Google', 'DriveFS');
            if (pathExists(driveFSRoot)) {
                try {
                    var accounts = fs.readdirSync(driveFSRoot);
                    accounts.forEach(function(acc) {
                        var accPath = joinPath(driveFSRoot, acc);
                        console.log('DriveScanner: found DriveFS account:', acc);
                    });
                } catch (e) {}
            }
        }

        console.log('DriveScanner: total roots found:', roots.length);
        return roots;
    }

    // ------------------------------------------------------------------
    // 4. SCAN A SINGLE DRIVE ROOT FOR PROJECT FOLDER
    // ------------------------------------------------------------------
    function scanDriveRoot(rootPath) {
        var candidates = [];
        if (!isAccessibleFolder(rootPath)) return candidates;

        var entries = [];
        try {
            entries = fs.readdirSync(rootPath, { withFileTypes: true });
        } catch (e) {
            return candidates;
        }

        entries.forEach(function(entry) {
            var entryPath = joinPath(rootPath, entry.name);

            // Direct folder match
            if (entry.isDirectory() && entry.name.toLowerCase() === PROJECT_FOLDER_NAME.toLowerCase()) {
                candidates.push({
                    path: entryPath,
                    type: 'direct',
                    source: rootPath,
                    name: entry.name
                });
            }

            // Shortcut (.lnk) match
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
                var target = resolveShortcut(entryPath);
                if (target) {
                    var targetName = target.split('\\').pop() || '';
                    if (targetName.toLowerCase() === PROJECT_FOLDER_NAME.toLowerCase() ||
                        target.toLowerCase().indexOf(PROJECT_FOLDER_NAME.toLowerCase()) !== -1) {
                        candidates.push({
                            path: target,
                            type: 'shortcut',
                            shortcutPath: entryPath,
                            source: rootPath,
                            name: targetName
                        });
                    }
                }
            }

            // Google Drive shortcut files (.gshortcut, .desktop) — rare but possible
            if (entry.isFile() && (entry.name.endsWith('.gshortcut') || entry.name.endsWith('.desktop'))) {
                try {
                    var content = fs.readFileSync(entryPath, 'utf8');
                    if (content.toLowerCase().indexOf(PROJECT_FOLDER_NAME.toLowerCase()) !== -1) {
                        console.log('DriveScanner: found possible Google Drive shortcut:', entryPath);
                    }
                } catch (e) {}
            }
        });

        // GOOGLE DRIVE SHARED FOLDER SHORTCUTS
        // Shortcuts to shared folders store real contents in .shortcut-targets-by-id\{fileId}\
        // The visible shortcut in My Drive may not be traversable via fs.readdirSync.
        var shortcutTargetsPath = joinPath(rootPath, '.shortcut-targets-by-id');
        if (isAccessibleFolder(shortcutTargetsPath)) {
            console.log('DriveScanner: found .shortcut-targets-by-id, scanning inside...');
            try {
                var idFolders = fs.readdirSync(shortcutTargetsPath, { withFileTypes: true });
                idFolders.forEach(function(idEntry) {
                    if (!idEntry.isDirectory()) return;
                    var idPath = joinPath(shortcutTargetsPath, idEntry.name);
                    // Each ID folder contains the actual shared folder contents
                    // Look for mushafproject directly inside
                    var projectInShortcut = joinPath(idPath, PROJECT_FOLDER_NAME);
                    if (isAccessibleFolder(projectInShortcut)) {
                        console.log('DriveScanner: found', PROJECT_FOLDER_NAME, 'inside shortcut target:', idEntry.name);
                        candidates.push({
                            path: projectInShortcut,
                            type: 'gd-shortcut',
                            source: rootPath,
                            shortcutId: idEntry.name,
                            name: PROJECT_FOLDER_NAME
                        });
                    }
                    // Also scan one level deeper — sometimes the ID folder IS the project
                    if (idEntry.name.toLowerCase() === PROJECT_FOLDER_NAME.toLowerCase() &&
                        isAccessibleFolder(idPath)) {
                        candidates.push({
                            path: idPath,
                            type: 'gd-shortcut-root',
                            source: rootPath,
                            shortcutId: idEntry.name,
                            name: PROJECT_FOLDER_NAME
                        });
                    }
                    // Scan all subfolders inside this ID folder
                    try {
                        var idContents = fs.readdirSync(idPath, { withFileTypes: true });
                        idContents.forEach(function(sub) {
                            if (!sub.isDirectory()) return;
                            if (sub.name.toLowerCase() === PROJECT_FOLDER_NAME.toLowerCase()) {
                                var deepPath = joinPath(idPath, sub.name);
                                console.log('DriveScanner: found', PROJECT_FOLDER_NAME, 'deep inside shortcut target');
                                candidates.push({
                                    path: deepPath,
                                    type: 'gd-shortcut-deep',
                                    source: rootPath,
                                    shortcutId: idEntry.name,
                                    name: sub.name
                                });
                            }
                        });
                    } catch (e) {}
                });
            } catch (e) {
                console.log('DriveScanner: error reading .shortcut-targets-by-id:', e.message);
            }
        }

        return candidates;
    }

    // ------------------------------------------------------------------
    // 5. VALIDATE A CANDIDATE PROJECT PATH
    // ------------------------------------------------------------------
    function validateProjectPath(projectPath) {
        var result = {
            path: projectPath,
            isValid: false,
            score: 0,
            foundSubfolders: [],
            tasksFolder: null,
            projectFolder: null
        };

        if (!isAccessibleFolder(projectPath)) return result;

        EXPECTED_SUBFOLDERS.forEach(function(sub) {
            var subPath = joinPath(projectPath, sub);
            if (isAccessibleFolder(subPath)) {
                result.foundSubfolders.push(sub);
                result.score += 10;
                if (sub === 'mushaftasks') result.tasksFolder = subPath;
                if (sub === 'mushaffiles') result.projectFolder = subPath;
            }
        });

        // Bonus: check for config.json inside mushaftasks (strong signal)
        if (result.tasksFolder && pathExists(joinPath(result.tasksFolder, 'config.json'))) {
            result.score += 20;
        }

        // Bonus: check for riwayah folders inside mushaffiles
        if (result.projectFolder) {
            try {
                var riwayahs = fs.readdirSync(result.projectFolder);
                var hasRiwayah = riwayahs.some(function(r) {
                    return isAccessibleFolder(joinPath(result.projectFolder, r, 'Ajza')) ||
                           isAccessibleFolder(joinPath(result.projectFolder, r, 'Review Task')) ||
                           isAccessibleFolder(joinPath(result.projectFolder, r, 'Recheck', 'Ajza'));
                });
                if (hasRiwayah) result.score += 15;
            } catch (e) {}
        }

        result.isValid = result.foundSubfolders.length >= 1;
        return result;
    }

    // ------------------------------------------------------------------
    // 6. FULL SCAN — all drives, all methods
    // ------------------------------------------------------------------
    function scanForProject() {
        var allCandidates = [];
        var seenPaths = {};

        console.log('DriveScanner: starting full scan for', PROJECT_FOLDER_NAME);

        // Find all Google Drive roots
        var driveRoots = findGoogleDriveRoots();
        console.log('DriveScanner: scanning', driveRoots.length, 'drive roots');

        // Scan each root
        driveRoots.forEach(function(rootInfo) {
            var found = scanDriveRoot(rootInfo.path);
            found.forEach(function(candidate) {
                var normalized = candidate.path.toLowerCase();
                if (seenPaths[normalized]) return;
                seenPaths[normalized] = true;

                var validated = validateProjectPath(candidate.path);
                validated.type = candidate.type;
                validated.source = candidate.source;
                if (candidate.shortcutPath) validated.shortcutPath = candidate.shortcutPath;

                allCandidates.push(validated);
            });
        });

        // Also scan all drive letters directly (in case Drive is mounted at root)
        var allDrives = getAllDrives();
        console.log('DriveScanner: scanning', allDrives.length, 'drives for direct', PROJECT_FOLDER_NAME);
        allDrives.forEach(function(drive) {
            var directPath = joinPath(drive, PROJECT_FOLDER_NAME);
            if (pathExists(directPath)) {
                console.log('DriveScanner: found direct path:', directPath);
                var normalized = directPath.toLowerCase();
                if (!seenPaths[normalized]) {
                    seenPaths[normalized] = true;
                    var validated = validateProjectPath(directPath);
                    validated.type = 'direct';
                    validated.source = drive;
                    allCandidates.push(validated);
                }
            }
        });

        // Sort by score descending (best match first)
        allCandidates.sort(function(a, b) { return b.score - a.score; });

        console.log('DriveScanner: scan complete. Candidates:', allCandidates.map(function(c) {
            return { path: c.path, score: c.score, type: c.type };
        }));

        return allCandidates;
    }

    // ------------------------------------------------------------------
    // 7. AUTO-DETECT AND SAVE SETTINGS
    // ------------------------------------------------------------------
    function autoDetectAndSave() {
        console.log('DriveScanner: autoDetectAndSave starting');
        var candidates = scanForProject();

        if (candidates.length === 0) {
            console.log('DriveScanner: no candidates found');
            return { success: false, reason: 'no_candidates', candidates: [] };
        }

        var best = candidates[0];
        if (!best.isValid) {
            console.log('DriveScanner: best candidate is not valid:', best.path);
            return { success: false, reason: 'invalid_candidate', candidates: candidates };
        }

        console.log('DriveScanner: best candidate:', best.path, 'score:', best.score);

        // Save to state and settings (defensive: state/saveSettings may not exist in other tools)
        if (typeof state !== 'undefined' && state) {
            if (best.tasksFolder) {
                state.tasksFolder = best.tasksFolder;
                console.log('DriveScanner: set tasksFolder =', best.tasksFolder);
            }
            if (best.projectFolder) {
                state.projectFolder = best.projectFolder;
                console.log('DriveScanner: set projectFolder =', best.projectFolder);
            }
            if (!best.tasksFolder || !best.projectFolder) {
                state.projectRootPath = best.path;
            }
        }

        // Persist to settings.json
        if (typeof saveSettings === 'function') {
            try {
                saveSettings();
                console.log('DriveScanner: settings saved');
            } catch (e) {
                console.log('DriveScanner: saveSettings failed (non-critical):', e.message);
            }
        }

        return {
            success: true,
            tasksFolder: best.tasksFolder,
            projectFolder: best.projectFolder,
            projectRoot: best.path,
            candidateCount: candidates.length,
            candidates: candidates
        };
    }

    // ------------------------------------------------------------------
    // 8. TOOL-SPECIFIC SCANS (for other Mushaf tools)
    // ------------------------------------------------------------------

    /**
     * Scan for a specific tool folder inside mushafproject.
     * Useful for mushafweb, webp exporter, symbol palette, etc.
     *
     * @param {string} toolName — e.g. 'mushafweb', 'mushafwebp', 'symbol-palette'
     * @param {string[]} expectedFiles — files that confirm it's the right folder
     * @returns {object} result with path, success, candidates
     */
    function scanForTool(toolName, expectedFiles) {
        var projectResults = scanForProject();
        if (projectResults.length === 0) {
            return { success: false, reason: 'no_project', toolPath: null };
        }

        var bestProject = projectResults[0];
        var toolPath = joinPath(bestProject.path, toolName);

        if (!isAccessibleFolder(toolPath)) {
            return {
                success: false,
                reason: 'tool_not_found',
                projectPath: bestProject.path,
                toolPath: toolPath
            };
        }

        // Validate with expected files
        var foundFiles = [];
        if (expectedFiles && expectedFiles.length > 0) {
            expectedFiles.forEach(function(f) {
                if (pathExists(joinPath(toolPath, f))) {
                    foundFiles.push(f);
                }
            });
        }

        return {
            success: foundFiles.length > 0 || !expectedFiles || expectedFiles.length === 0,
            path: toolPath,
            projectPath: bestProject.path,
            foundFiles: foundFiles,
            expectedFiles: expectedFiles || []
        };
    }

    /**
     * Auto-detect and save a tool-specific path to localStorage (browser)
     * or settings.json (Node/CEP).
     */
    function autoDetectToolAndSave(toolName, expectedFiles, storageKey) {
        var result = scanForTool(toolName, expectedFiles);
        if (!result.success) {
            console.log('DriveScanner: tool auto-detect failed:', toolName, result.reason);
            return result;
        }

        // CEP / Node context: save to settings
        if (typeof saveSettings === 'function' && state) {
            state[storageKey || toolName + 'Path'] = result.path;
            saveSettings();
        }

        // Browser context: save to localStorage
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(storageKey || toolName + 'Path', result.path);
            } catch (e) {}
        }

        console.log('DriveScanner: tool path saved:', toolName, '→', result.path);
        return result;
    }

    // ------------------------------------------------------------------
    // 9. EXPOSE PUBLIC API
    // ------------------------------------------------------------------
    window.DriveScanner = {
        PROJECT_FOLDER_NAME: PROJECT_FOLDER_NAME,
        EXPECTED_SUBFOLDERS: EXPECTED_SUBFOLDERS,
        GOOGLE_DRIVE_NAMES: GOOGLE_DRIVE_NAMES,

        // Core scanning
        getAllDrives: getAllDrives,
        findGoogleDriveRoots: findGoogleDriveRoots,
        resolveShortcut: resolveShortcut,
        scanDriveRoot: scanDriveRoot,
        scanForProject: scanForProject,
        validateProjectPath: validateProjectPath,

        // Auto-save integration
        autoDetectAndSave: autoDetectAndSave,

        // Tool-specific
        scanForTool: scanForTool,
        autoDetectToolAndSave: autoDetectToolAndSave,

        // Utility
        isNodeAvailable: isNodeAvailable
    };

    console.log('DriveScanner module loaded');
})();
