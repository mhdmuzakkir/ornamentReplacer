/**
 * Ornament Replacer - Self Updater (Batch-based)
 */
(function(window) {
    'use strict';

    // Get Node.js require — CEP exposes it globally OR via window.cep_node.require
    function getNodeRequire() {
        if (typeof require !== 'undefined') return require;
        if (typeof window !== 'undefined' && window.cep_node && window.cep_node.require) {
            return window.cep_node.require;
        }
        return null;
    }

    var nreq = getNodeRequire();
    var fs   = nreq ? nreq('fs')   : null;
    var path = nreq ? nreq('path') : null;
    var os   = nreq ? nreq('os')   : null;

    // If Node.js is not available, expose a stub so the UI doesn't show "not loaded"
    if (!fs || !path || !os) {
        console.log('OrnamentReplacer updater: Node.js not available. Updater disabled.');
        window.OrnamentUpdater = {
            checkForUpdates: function() { return Promise.resolve({ hasUpdate: false, error: 'Node.js not available in this CEP context. Restart Illustrator.' }); },
            installUpdate: function() { return Promise.reject(new Error('Node.js not available')); },
            getUpdateStatus: function() { return 'error'; },
            getLastCheckResult: function() { return null; },
            CURRENT_VERSION: '3.5.0',
            isUserInstall: function() { return false; },
            getExtensionPath: function() { return null; }
        };
        return;
    }

    var REPO_OWNER = 'mhdmuzakkir';
    var REPO_NAME = 'ornamentReplacer';
    var CURRENT_VERSION = '3.5.0';

    var UPDATE_STATUS = {
        idle: 'idle',
        checking: 'checking',
        available: 'available',
        downloading: 'downloading',
        installing: 'installing',
        done: 'done',
        error: 'error'
    };

    var status = UPDATE_STATUS.idle;
    var lastCheckResult = null;
    var UPDATE_DIR = path.join(os.tmpdir(), 'ornamentreplacer-update');
    var STATUS_FILE = path.join(UPDATE_DIR, 'status.json');
    var REMOTE_VERSION_FILE = path.join(UPDATE_DIR, 'remote-version.json');

    function getExtensionPath() {
        try {
            var home = os.homedir();
            var candidates = [
                path.join(home, 'AppData', 'Roaming', 'Adobe', 'CEP', 'extensions', 'ornamentReplacer'),
                path.join(home, 'AppData', 'Local', 'Adobe', 'CEP', 'extensions', 'ornamentReplacer'),
                'C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\ornamentReplacer',
                'C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions\\ornamentReplacer'
            ];
            for (var i = 0; i < candidates.length; i++) {
                var manifestPath = path.join(candidates[i], 'CSXS', 'manifest.xml');
                if (fs.existsSync(manifestPath)) {
                    return candidates[i];
                }
            }
        } catch (e) {
            console.error('Error finding extension path:', e);
        }
        return null;
    }

    function isUserInstall(extensionPath) {
        if (!extensionPath) return false;
        return extensionPath.toLowerCase().indexOf('appdata') !== -1;
    }

    function compareVersions(a, b) {
        var pa = a.split('.').map(Number);
        var pb = b.split('.').map(Number);
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var na = pa[i] || 0;
            var nb = pb[i] || 0;
            if (na > nb) return 1;
            if (na < nb) return -1;
        }
        return 0;
    }

    function ensureUpdateDir() {
        try {
            if (!fs.existsSync(UPDATE_DIR)) {
                fs.mkdirSync(UPDATE_DIR, { recursive: true });
            }
        } catch (e) {
            console.error('Error creating update dir:', e);
        }
    }

    function readStatusFile() {
        try {
            if (fs.existsSync(STATUS_FILE)) {
                return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('Error reading status file:', e);
        }
        return null;
    }

    function getFileAgeMinutes(filePath) {
        try {
            var stats = fs.statSync(filePath);
            return (Date.now() - stats.mtime.getTime()) / 60000;
        } catch (e) {
            return Infinity;
        }
    }

    function getBatchPath(batchName) {
        var extPath = getExtensionPath();
        if (extPath) {
            var batchInExt = path.join(extPath, batchName);
            if (fs.existsSync(batchInExt)) {
                return batchInExt;
            }
        }
        return batchName;
    }

    function runBatch(batchName, args, onProgress, timeoutMs) {
        return new Promise(function(resolve, reject) {
            try {
                var child_process = nreq('child_process');
                var batchPath = getBatchPath(batchName);
                var cmd = '"' + batchPath + '"';
                if (args && args.length > 0) {
                    cmd += ' ' + args.map(function(a) {
                        return '"' + a.replace(/"/g, '\"') + '"';
                    }).join(' ');
                }
                console.log('Running batch:', cmd);
                var pollInterval = setInterval(function() {
                    var st = readStatusFile();
                    if (st && onProgress) {
                        onProgress(st);
                    }
                }, 500);
                var opts = {
                    timeout: timeoutMs || 300000,
                    windowsHide: true
                };
                child_process.exec(cmd, opts, function(error, stdout, stderr) {
                    clearInterval(pollInterval);
                    var finalStatus = readStatusFile();
                    if (error) {
                        console.error('Batch error:', error.message, stderr);
                    }
                    if (stdout) {
                        console.log('Batch stdout:', stdout);
                    }
                    if (finalStatus && finalStatus.status === 'error') {
                        reject(new Error(finalStatus.message || 'Batch failed'));
                    } else if (error && (!finalStatus || finalStatus.status !== 'done')) {
                        reject(new Error(finalStatus ? finalStatus.message : (stderr || error.message)));
                    } else {
                        resolve(finalStatus || { status: 'done', message: 'Batch completed' });
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function checkForUpdates() {
        return new Promise(function(resolve) {
            status = UPDATE_STATUS.checking;
            ensureUpdateDir();
            var extensionPath = getExtensionPath();
            var remoteVersionAge = getFileAgeMinutes(REMOTE_VERSION_FILE);
            var cachedResult = null;
            if (fs.existsSync(REMOTE_VERSION_FILE) && remoteVersionAge < 60) {
                try {
                    var remote = JSON.parse(fs.readFileSync(REMOTE_VERSION_FILE, 'utf8'));
                    cachedResult = {
                        hasUpdate: compareVersions(remote.version, CURRENT_VERSION) > 0,
                        currentVersion: CURRENT_VERSION,
                        remoteVersion: remote.version,
                        isUserInstall: isUserInstall(extensionPath),
                        extensionPath: extensionPath,
                        fromCache: true
                    };
                    console.log('Using cached remote version (age: ' + Math.round(remoteVersionAge) + ' min)');
                } catch (e) {
                    console.log('Cached version file corrupt, will re-download');
                }
            }
            runBatch('check-update.bat', [], function(progress) {
                console.log('Check progress:', progress.status, progress.message);
            }).then(function(result) {
                if (fs.existsSync(REMOTE_VERSION_FILE)) {
                    try {
                        var remote = JSON.parse(fs.readFileSync(REMOTE_VERSION_FILE, 'utf8'));
                        var hasUpdate = compareVersions(remote.version, CURRENT_VERSION) > 0;
                        lastCheckResult = {
                            hasUpdate: hasUpdate,
                            currentVersion: CURRENT_VERSION,
                            remoteVersion: remote.version,
                            isUserInstall: isUserInstall(extensionPath),
                            extensionPath: extensionPath,
                            fromCache: false
                        };
                        status = hasUpdate ? UPDATE_STATUS.available : UPDATE_STATUS.idle;
                        resolve(lastCheckResult);
                    } catch (e) {
                        status = UPDATE_STATUS.error;
                        resolve({ hasUpdate: false, error: 'Failed to parse version info', details: e.message });
                    }
                } else {
                    if (cachedResult) {
                        console.log('Batch failed, falling back to cached version');
                        status = cachedResult.hasUpdate ? UPDATE_STATUS.available : UPDATE_STATUS.idle;
                        resolve(cachedResult);
                    } else {
                        status = UPDATE_STATUS.error;
                        var st = readStatusFile();
                        resolve({
                            hasUpdate: false,
                            error: st ? st.message : 'Update check failed. Firewall may block Illustrator. Run check-update.bat manually, then try again.'
                        });
                    }
                }
            }).catch(function(err) {
                if (cachedResult) {
                    console.log('Batch exec failed, falling back to cached version');
                    status = cachedResult.hasUpdate ? UPDATE_STATUS.available : UPDATE_STATUS.idle;
                    resolve(cachedResult);
                } else {
                    status = UPDATE_STATUS.error;
                    var msg = err.message || '';
                    if (msg.indexOf('run this batch file manually') !== -1 || msg.indexOf('Network download failed') !== -1) {
                        resolve({ hasUpdate: false, error: msg });
                    } else {
                        resolve({ hasUpdate: false, error: 'Could not run update checker. ' + msg + ' Try running check-update.bat manually from Windows Explorer.' });
                    }
                }
            });
        });
    }

    function installUpdate(onProgress) {
        return new Promise(function(resolve, reject) {
            if (!lastCheckResult || !lastCheckResult.hasUpdate) {
                reject(new Error('No update available'));
                return;
            }
            var extensionPath = getExtensionPath();
            if (!extensionPath) {
                reject(new Error('Could not locate extension installation folder'));
                return;
            }
            if (!isUserInstall(extensionPath)) {
                reject(new Error('Extension is installed in Program Files. Please run install.bat to reinstall to AppData\\Roaming\\Adobe\\CEP\\extensions\\'));
                return;
            }
            ensureUpdateDir();
            status = UPDATE_STATUS.downloading;
            runBatch('update.bat', [extensionPath], function(progress) {
                if (onProgress) {
                    var percent = 0;
                    if (progress.stage === 'git') percent = 30;
                    else if (progress.stage === 'download') percent = 25;
                    else if (progress.stage === 'extract') percent = 60;
                    else if (progress.stage === 'copy') percent = 85;
                    else if (progress.status === 'done') percent = 100;
                    onProgress({ stage: progress.stage || progress.status, percent: percent, message: progress.message });
                }
            }, 600000).then(function(result) {
                status = UPDATE_STATUS.done;
                if (onProgress) onProgress({ stage: 'done', percent: 100, message: result.message });
                resolve({ success: true, extensionPath: extensionPath, version: lastCheckResult.remoteVersion });
            }).catch(function(err) {
                status = UPDATE_STATUS.error;
                reject(err);
            });
        });
    }

    function getUpdateStatus() {
        return status;
    }

    function getLastCheckResult() {
        return lastCheckResult;
    }

    window.OrnamentUpdater = {
        checkForUpdates: checkForUpdates,
        installUpdate: installUpdate,
        getUpdateStatus: getUpdateStatus,
        getLastCheckResult: getLastCheckResult,
        CURRENT_VERSION: CURRENT_VERSION,
        isUserInstall: function() { return isUserInstall(getExtensionPath()); },
        getExtensionPath: getExtensionPath
    };

    console.log('Ornament Replacer updater loaded. Version:', CURRENT_VERSION);
})(window);
