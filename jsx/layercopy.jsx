// Layer Copy functions - self-contained, loaded dynamically

var LC_STANDARD_DEFS = {
    quranText: { standard: "Quran Text", patterns: ["qurantext", "quran"] },
    ayaNo:     { standard: "Aya No.",    patterns: ["ayano", "ayahno", "ayano.", "ayahno.", "aya.no", "ayah.no", "aya no", "ayah no"] },
    ornaments: { standard: "Ornaments",  patterns: ["ornament", "zakhrafah", "zakhrafa", "decoration", "decorations"] }
};

function lcNormalizeName(name) {
    if (!name) return "";
    return name.toString().replace(/^\s+|\s+$/g, '').toLowerCase().replace(/[_\-\.]/g, '').replace(/\s+/g, '');
}

function lcMatchName(name) {
    var normalized = lcNormalizeName(name);
    if (!normalized) return null;
    for (var key in LC_STANDARD_DEFS) {
        if (!LC_STANDARD_DEFS.hasOwnProperty(key)) continue;
        var def = LC_STANDARD_DEFS[key];
        var stdNorm = lcNormalizeName(def.standard);
        if (normalized === stdNorm) return def.standard;
        for (var p = 0; p < def.patterns.length; p++) {
            if (normalized.indexOf(def.patterns[p]) !== -1) return def.standard;
        }
    }
    return null;
}

function lcFindLayer(doc, standardName) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (lcMatchName(doc.layers[i].name) === standardName) return doc.layers[i];
    }
    return null;
}

function lcUnifyNames(doc) {
    var result = { success: true, renamed: [], skipped: [], errors: [] };
    try {
        for (var i = 0; i < doc.layers.length; i++) {
            var layer = doc.layers[i];
            var matched = lcMatchName(layer.name);
            if (matched && layer.name !== matched) {
                try {
                    var oldName = layer.name;
                    layer.name = matched;
                    result.renamed.push({ "old": oldName, "new": matched });
                } catch (e) {
                    result.errors.push({ name: layer.name, error: e.toString() });
                }
            } else if (!matched) {
                result.skipped.push(layer.name);
            }
        }
    } catch (e) {
        result.success = false;
        result.errors.push({ error: e.toString() });
    }
    return result;
}

function lcCopyContents(sourceLayer, sourceDoc, targetDoc, targetLayerName, sendToBack) {
    var result = { copied: 0, error: "" };
    try {
        sourceLayer.locked = false;
        sourceLayer.visible = true;
        var topItems = [];
        for (var i = 0; i < sourceLayer.pageItems.length; i++) {
            topItems.push(sourceLayer.pageItems[i]);
        }
        if (topItems.length === 0) return result;
        
        var prevDoc = app.activeDocument;
        
        app.activeDocument = sourceDoc;
        app.selection = null;
        for (var j = 0; j < topItems.length; j++) {
            try {
                topItems[j].locked = false;
                topItems[j].hidden = false;
                topItems[j].selected = true;
            } catch (e) {}
        }
        if (app.selection.length === 0) {
            app.activeDocument = prevDoc;
            return result;
        }
        app.copy();
        
        app.activeDocument = targetDoc;
        var targetLayer = null;
        try { targetLayer = targetDoc.layers.getByName(targetLayerName); } catch (e) {
            targetLayer = targetDoc.layers.add();
            targetLayer.name = targetLayerName;
        }
        targetLayer.locked = false;
        targetLayer.visible = true;
        targetDoc.activeLayer = targetLayer;
        app.executeMenuCommand("pasteFront");
        var pasted = app.selection;
        result.copied = pasted.length;
        for (var k = 0; k < pasted.length; k++) {
            try { pasted[k].move(targetLayer, ElementPlacement.PLACEATBEGINNING); } catch (e) {}
        }
        
        // Send to back if requested (when Quran Text is not being copied)
        if (sendToBack) {
            try {
                var lastLayer = targetDoc.layers[targetDoc.layers.length - 1];
                if (lastLayer !== targetLayer) {
                    targetLayer.move(lastLayer, ElementPlacement.PLACEAFTER);
                }
            } catch (e) {}
        }
        
        app.activeDocument = prevDoc;
    } catch (e) {
        result.error = e.toString();
    }
    return result;
}

function lcDeleteLayer(doc, standardName) {
    try {
        var layer = lcFindLayer(doc, standardName);
        if (layer) { layer.locked = false; layer.visible = true; layer.remove(); return true; }
    } catch (e) {}
    return false;
}

function lcGetOpenDocByPath(filePath) {
    for (var i = 0; i < app.documents.length; i++) {
        try { if (app.documents[i].fullName.fsName === filePath) return app.documents[i]; } catch (e) {}
    }
    return null;
}

function lcLayerPriority(standardName) {
    var order = { "Ornaments": 1, "Aya No.": 2, "Quran Text": 3 };
    return order[standardName] || 99;
}

function copyLayersFromFile(sourcePath, options) {
    var result = { success: false, copied: [], deleted: [], errors: [], message: "" };
    try {
        if (typeof options === 'string') options = JSON.parse(options);
        if (!options) options = {};
        if (app.documents.length === 0) { result.message = "No target document open"; return JSON.stringify(result); }
        var targetDoc = app.activeDocument;
        var sourceFile = new File(sourcePath.replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\'));
        if (!sourceFile.exists) { result.message = "Source file not found"; return JSON.stringify(result); }
        var sourceDoc = lcGetOpenDocByPath(sourceFile.fsName);
        var wasAlreadyOpen = !!sourceDoc;
        if (!sourceDoc) sourceDoc = app.open(sourceFile);
        if (!sourceDoc) { result.message = "Failed to open source file"; return JSON.stringify(result); }
        var layersToCopy = options.layers || ["Aya No.", "Ornaments"];
        var hasQuranText = false;
        for (var q = 0; q < layersToCopy.length; q++) {
            if (layersToCopy[q] === "Quran Text") { hasQuranText = true; break; }
        }
        if (hasQuranText) {
            // Copy backmost first; each new layer sits at top, so topmost ends up highest
            layersToCopy.sort(function(a, b) {
                return lcLayerPriority(a) - lcLayerPriority(b);
            });
        } else {
            // Copy frontmost first; each gets moved to back, so backmost ends up lowest
            layersToCopy.sort(function(a, b) {
                return lcLayerPriority(b) - lcLayerPriority(a);
            });
        }
        for (var i = 0; i < layersToCopy.length; i++) {
            var standardName = layersToCopy[i];
            try {
                var sourceLayer = lcFindLayer(sourceDoc, standardName);
                if (!sourceLayer) { result.errors.push({ layer: standardName, error: "Not found in source" }); continue; }
                var deleted = lcDeleteLayer(targetDoc, standardName);
                if (deleted) result.deleted.push(standardName);
                var copyResult = lcCopyContents(sourceLayer, sourceDoc, targetDoc, standardName, !hasQuranText);
                if (copyResult.error) { result.errors.push({ layer: standardName, error: copyResult.error }); }
                else if (copyResult.copied > 0) { result.copied.push({ layer: standardName, count: copyResult.copied }); }
                else { result.errors.push({ layer: standardName, error: "Nothing to copy" }); }
            } catch (e) { result.errors.push({ layer: standardName, error: e.toString() }); }
        }
        if (!wasAlreadyOpen) { try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
        app.activeDocument = targetDoc;
        if (result.copied.length > 0) { result.success = true; result.message = "Copied " + result.copied.length + " layer(s)"; }
        else { result.message = "No layers copied"; }
    } catch (e) { result.message = "Error: " + e.toString(); }
    return JSON.stringify(result);
}

function scanCurrentLayers() {
    var result = { success: false, layers: [], error: "" };
    try {
        if (app.documents.length === 0) { result.error = "No document open"; return JSON.stringify(result); }
        var doc = app.activeDocument;
        for (var i = 0; i < doc.layers.length; i++) {
            var layer = doc.layers[i];
            var matched = lcMatchName(layer.name);
            result.layers.push({ name: layer.name, matched: matched || null, standard: matched || "\u2014" });
        }
        result.success = true;
    } catch (e) { result.error = e.toString(); }
    return JSON.stringify(result);
}

function runUnifyLayerNames() {
    var result = { success: false, renamed: [], skipped: [], errors: [], message: "" };
    try {
        if (app.documents.length === 0) { result.message = "No document open"; return JSON.stringify(result); }
        var doc = app.activeDocument;
        var unifyResult = lcUnifyNames(doc);
        result.success = unifyResult.success;
        result.renamed = unifyResult.renamed;
        result.skipped = unifyResult.skipped;
        result.errors = unifyResult.errors;
        result.message = "Renamed " + unifyResult.renamed.length + " layer(s)";
    } catch (e) { result.message = "Error: " + e.toString(); }
    return JSON.stringify(result);
}

function scanSourceLayers(sourcePath) {
    var result = { success: false, layers: [], error: "" };
    try {
        var sourceFile = new File(sourcePath.replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\'));
        if (!sourceFile.exists) { result.error = "File not found"; return JSON.stringify(result); }
        var sourceDoc = lcGetOpenDocByPath(sourceFile.fsName);
        var wasAlreadyOpen = !!sourceDoc;
        if (!sourceDoc) sourceDoc = app.open(sourceFile);
        if (!sourceDoc) { result.error = "Failed to open file"; return JSON.stringify(result); }
        for (var i = 0; i < sourceDoc.layers.length; i++) {
            var layer = sourceDoc.layers[i];
            var matched = lcMatchName(layer.name);
            result.layers.push({ name: layer.name, matched: matched || null, standard: matched || "\u2014" });
        }
        if (!wasAlreadyOpen) { try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
        result.success = true;
    } catch (e) { result.error = e.toString(); }
    return JSON.stringify(result);
}

function browseForSourceFile() {
    var result = { success: false, path: "", name: "", error: "" };
    try {
        var file = File.openDialog("Select source .ai file");
        if (file && file.exists) {
            result.success = true;
            result.path = file.fsName.replace(/\\/g, '/');
            result.name = file.name;
        } else { result.error = "No file selected"; }
    } catch (e) { result.error = "Exception: " + (e.message || e.toString()); }
    return JSON.stringify(result);
}


// ==================== RIWAYAH TO RIWAYAH FUNCTIONS ====================

var PAGE_TO_JUZ = {
    1: [1,21], 2: [22,41], 3: [42,61], 4: [62,81], 5: [82,101],
    6: [102,121], 7: [122,141], 8: [142,161], 9: [162,181], 10: [182,201],
    11: [202,221], 12: [222,241], 13: [242,261], 14: [262,281], 15: [282,301],
    16: [302,321], 17: [322,341], 18: [342,361], 19: [362,381], 20: [382,401],
    21: [402,421], 22: [422,441], 23: [442,461], 24: [462,481], 25: [482,501],
    26: [502,521], 27: [522,541], 28: [542,561], 29: [562,581], 30: [582,604]
};

function lcGetJuzFromPage(page) {
    for (var j = 1; j <= 30; j++) {
        var range = PAGE_TO_JUZ[j];
        if (page >= range[0] && page <= range[1]) return j;
    }
    return 1;
}

function lcGetFolderNameFromPath(folderPath) {
    var cleanPath = folderPath.replace(/\\/g, '/').replace(/\/$/, '');
    var lastSlash = cleanPath.lastIndexOf('/');
    return lastSlash >= 0 ? cleanPath.substring(lastSlash + 1) : cleanPath;
}

function lcGetAllAiFiles(folder) {
    var files = [];
    try {
        var allItems = folder.getFiles();
        for (var i = 0; i < allItems.length; i++) {
            if (allItems[i] instanceof Folder) {
                var subFiles = lcGetAllAiFiles(allItems[i]);
                for (var s = 0; s < subFiles.length; s++) {
                    files.push(subFiles[s]);
                }
            } else if (allItems[i] instanceof File && allItems[i].name.match(/\.ai$/i)) {
                files.push(allItems[i]);
            }
        }
    } catch (e) {}
    return files;
}

function lcFindTargetFile(targetFolder, pageNum, riwayahName) {
    var juz = lcGetJuzFromPage(pageNum);
    var paddedPage = ("00" + pageNum).slice(-3);
    var fileName = paddedPage + "-" + riwayahName + ".ai";
    var juzFolder = ("0" + juz).slice(-2);
    var basePath = targetFolder.replace(/\\/g, '/').replace(/\/$/, '');
    
    var locations = [
        new File(basePath + "/Review Task/" + fileName),
        new File(basePath + "/Ajza/" + juzFolder + "/" + fileName),
        new File(basePath + "/Recheck/Ajza/" + juzFolder + "/" + fileName),
        new File(basePath + "/Completed/Ajza/" + juzFolder + "/" + fileName)
    ];
    
    for (var i = 0; i < locations.length; i++) {
        if (locations[i].exists) return locations[i];
    }
    return null;
}

function fixLayerOrder() {
    var result = { success: false, reordered: [], error: "", message: "" };
    try {
        if (app.documents.length === 0) { result.error = "No document open"; result.message = result.error; return JSON.stringify(result); }
        var doc = app.activeDocument;
        var ornamentsLayer = lcFindLayer(doc, "Ornaments");
        var quranTextLayer = lcFindLayer(doc, "Quran Text");
        
        // Move Quran Text to top (frontmost) - index 0 in Illustrator layer stack
        if (quranTextLayer) {
            try {
                quranTextLayer.move(doc.layers[0], ElementPlacement.PLACEBEFORE);
                result.reordered.push({ layer: "Quran Text", position: "front" });
            } catch (e) {
                result.error += "Quran Text move error: " + e.toString() + "; ";
            }
        }
        
        // Move Ornaments to bottom (backmost)
        if (ornamentsLayer) {
            try {
                var lastLayer = doc.layers[doc.layers.length - 1];
                if (ornamentsLayer !== lastLayer) {
                    ornamentsLayer.move(lastLayer, ElementPlacement.PLACEAFTER);
                }
                result.reordered.push({ layer: "Ornaments", position: "back" });
            } catch (e) {
                result.error += "Ornaments move error: " + e.toString() + "; ";
            }
        }
        
        result.success = result.reordered.length > 0;
        if (result.success && !result.error) {
            result.message = "Reordered " + result.reordered.length + " layer(s)";
        } else if (result.success) {
            result.message = "Partially reordered with errors";
        } else {
            result.message = "No standard layers found to reorder";
        }
    } catch (e) {
        result.error = e.toString();
        result.message = "Error: " + e.toString();
    }
    return JSON.stringify(result);
}

function fixLayerOrderForRiwayah(riwayahFolderPath) {
    var result = { success: false, processed: 0, errors: [], message: "" };
    try {
        var folder = new Folder(riwayahFolderPath.replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\'));
        if (!folder.exists) { result.message = "Folder not found"; return JSON.stringify(result); }
        var aiFiles = lcGetAllAiFiles(folder);
        if (aiFiles.length === 0) { result.message = "No .ai files found"; return JSON.stringify(result); }
        
        for (var i = 0; i < aiFiles.length; i++) {
            var file = aiFiles[i];
            var doc = lcGetOpenDocByPath(file.fsName);
            var wasOpen = !!doc;
            if (!doc) doc = app.open(file);
            if (!doc) { result.errors.push({ file: file.name, error: "Failed to open" }); continue; }
            
            try {
                var ornamentsLayer = lcFindLayer(doc, "Ornaments");
                var quranTextLayer = lcFindLayer(doc, "Quran Text");
                var moved = 0;
                
                if (quranTextLayer) {
                    quranTextLayer.move(doc.layers[0], ElementPlacement.PLACEBEFORE);
                    moved++;
                }
                if (ornamentsLayer) {
                    var lastLayer = doc.layers[doc.layers.length - 1];
                    if (ornamentsLayer !== lastLayer) {
                        ornamentsLayer.move(lastLayer, ElementPlacement.PLACEAFTER);
                    }
                    moved++;
                }
                
                if (moved > 0) {
                    doc.save();
                    result.processed++;
                }
            } catch (e) {
                result.errors.push({ file: file.name, error: e.toString() });
            }
            
            if (!wasOpen) { try { doc.close(SaveOptions.SAVECHANGES); } catch (e) {} }
            
            // Pause after every 5 files to let Illustrator breathe
            if ((i + 1) % 5 === 0 && i < aiFiles.length - 1) {
                $.sleep(2000);
            }
        }
        
        result.success = true;
        result.message = "Processed " + result.processed + " files, " + result.errors.length + " errors";
    } catch (e) {
        result.message = "Error: " + e.toString();
    }
    return JSON.stringify(result);
}

function browseForRiwayahFolder() {
    var result = { success: false, path: "", name: "", error: "" };
    try {
        var folder = Folder.selectDialog("Select riwayah folder");
        if (folder && folder.exists) {
            result.success = true;
            result.path = folder.fsName.replace(/\\/g, '/');
            result.name = folder.name;
        } else { result.error = "No folder selected"; }
    } catch (e) { result.error = "Exception: " + (e.message || e.toString()); }
    return JSON.stringify(result);
}

function scanRiwayahFolderForLayers(riwayahFolderPath) {
    var result = { success: false, layers: [], error: "" };
    try {
        var folder = new Folder(riwayahFolderPath.replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\'));
        if (!folder.exists) { result.error = "Folder not found"; return JSON.stringify(result); }
        var aiFiles = lcGetAllAiFiles(folder);
        if (aiFiles.length === 0) { result.error = "No .ai files found in riwayah folder"; return JSON.stringify(result); }
        var firstFile = aiFiles[0];
        var sourceDoc = lcGetOpenDocByPath(firstFile.fsName);
        var wasAlreadyOpen = !!sourceDoc;
        if (!sourceDoc) sourceDoc = app.open(firstFile);
        if (!sourceDoc) { result.error = "Failed to open file for layer scan"; return JSON.stringify(result); }
        for (var i = 0; i < sourceDoc.layers.length; i++) {
            var layer = sourceDoc.layers[i];
            var matched = lcMatchName(layer.name);
            result.layers.push({ name: layer.name, matched: matched || null, standard: matched || "\u2014" });
        }
        if (!wasAlreadyOpen) { try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
        result.success = true;
    } catch (e) { result.error = e.toString(); }
    return JSON.stringify(result);
}

function getRiwayahFileList(sourceFolder) {
    var result = { success: false, files: [], error: "" };
    try {
        var folder = new Folder(sourceFolder.replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\'));
        if (!folder.exists) { result.error = "Folder not found"; return JSON.stringify(result); }
        var aiFiles = lcGetAllAiFiles(folder);
        for (var i = 0; i < aiFiles.length; i++) {
            var f = aiFiles[i];
            var pageMatch = f.name.match(/^(\d+)/);
            result.files.push({
                name: f.name,
                path: f.fsName.replace(/\\/g, '/'),
                page: pageMatch ? parseInt(pageMatch[1], 10) : 0
            });
        }
        result.files.sort(function(a, b) { return a.page - b.page; });
        result.success = true;
    } catch (e) { result.error = e.toString(); }
    return JSON.stringify(result);
}

function copyLayersForFileList(targetFolder, options) {
    var result = { success: false, copied: 0, skipped: [], errors: [], processed: 0, message: "" };
    try {
        if (typeof options === 'string') options = JSON.parse(options);
        if (!options) options = {};
        var filePaths = options.filePaths || [];
        var layersToCopy = options.layers || ["Aya No.", "Ornaments"];
        if (filePaths.length === 0) { result.message = "No files to process"; return JSON.stringify(result); }
        
        var targetRiwayahName = lcGetFolderNameFromPath(targetFolder);
        
        var hasQuranText = false;
        for (var q = 0; q < layersToCopy.length; q++) {
            if (layersToCopy[q] === "Quran Text") { hasQuranText = true; break; }
        }
        if (hasQuranText) {
            layersToCopy.sort(function(a, b) { return lcLayerPriority(a) - lcLayerPriority(b); });
        } else {
            layersToCopy.sort(function(a, b) { return lcLayerPriority(b) - lcLayerPriority(a); });
        }
        
        for (var i = 0; i < filePaths.length; i++) {
            var sourceFile = new File(filePaths[i].replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\'));
            if (!sourceFile.exists) { result.skipped.push({ file: sourceFile.name, reason: "Source file not found" }); continue; }
            try {
                var pageMatch = sourceFile.name.match(/^(\d+)/);
                if (!pageMatch) { result.skipped.push({ file: sourceFile.name, reason: "Could not parse page number" }); continue; }
                var pageNum = parseInt(pageMatch[1], 10);
                var targetFile = lcFindTargetFile(targetFolder, pageNum, targetRiwayahName);
                if (!targetFile) { result.skipped.push({ file: sourceFile.name, reason: "Target file not found" }); continue; }
                
                var sourceDoc = lcGetOpenDocByPath(sourceFile.fsName);
                var sourceWasOpen = !!sourceDoc;
                if (!sourceDoc) sourceDoc = app.open(sourceFile);
                if (!sourceDoc) { result.errors.push({ file: sourceFile.name, error: "Failed to open source" }); continue; }
                
                var targetDoc = lcGetOpenDocByPath(targetFile.fsName);
                var targetWasOpen = !!targetDoc;
                if (!targetDoc) targetDoc = app.open(targetFile);
                if (!targetDoc) { 
                    if (!sourceWasOpen) { try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
                    result.errors.push({ file: sourceFile.name, error: "Failed to open target" }); 
                    continue; 
                }
                
                var prevDoc = app.activeDocument;
                for (var l = 0; l < layersToCopy.length; l++) {
                    var standardName = layersToCopy[l];
                    try {
                        var sourceLayer = lcFindLayer(sourceDoc, standardName);
                        if (!sourceLayer) continue;
                        lcDeleteLayer(targetDoc, standardName);
                        lcCopyContents(sourceLayer, sourceDoc, targetDoc, standardName, !hasQuranText);
                    } catch (e) { result.errors.push({ file: sourceFile.name, layer: standardName, error: e.toString() }); }
                }
                
                app.activeDocument = targetDoc;
                targetDoc.save();
                
                if (!targetWasOpen) { try { targetDoc.close(SaveOptions.SAVECHANGES); } catch (e) {} }
                if (!sourceWasOpen) { try { sourceDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
                app.activeDocument = prevDoc;
                
                result.copied++;
            } catch (e) { result.errors.push({ file: sourceFile.name, error: e.toString() }); }
            result.processed++;
        }
        
        if (result.copied > 0 || result.processed > 0) { result.success = true; }
        result.message = "Processed " + result.processed + " files, copied " + result.copied;
    } catch (e) { result.message = "Error: " + e.toString(); }
    return JSON.stringify(result);
}
