/*
Mushaf-Warsh Extension - Host Script (host.jsx)
Main backend script for Adobe Illustrator
Handles template scanning, document scanning, and ornament replacement
*/

// ========== JSON POLYFILL ==========
if (typeof JSON === 'undefined') {
    JSON = {
        stringify: function(obj) {
            if (obj === null) return 'null';
            if (typeof obj === 'undefined') return '""';
            if (typeof obj === 'string') return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
            if (typeof obj === 'number' || typeof obj === 'boolean') return obj.toString();
            if (obj instanceof Array) {
                var arr = [];
                for (var i = 0; i < obj.length; i++) arr.push(JSON.stringify(obj[i]));
                return '[' + arr.join(',') + ']';
            }
            if (typeof obj === 'object') {
                var pairs = [];
                for (var key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        pairs.push(JSON.stringify(key) + ':' + JSON.stringify(obj[key]));
                    }
                }
                return '{' + pairs.join(',') + '}';
            }
            return '""';
        },
        parse: function(text) {
            try {
                return eval('(' + text + ')');
            } catch(e) {
                return {};
            }
        }
    };
}

// ========== GLOBAL STATE ==========
var isBrowsing = false;  // Prevents double-opening file browsers

// ========== UI HELPERS ==========
function showAlert(message, title) {
    title = title || "Mushaf-Warsh";
    try {
        var w = new Window("dialog", title);
        w.orientation = "column";
        w.alignChildren = "fill";
        w.spacing = 10;
        w.margins = 16;
        
        var msgText = w.add("statictext", undefined, message, {multiline: true});
        msgText.preferredSize.width = 350;
        msgText.alignment = "fill";
        
        var btnGroup = w.add("group");
        btnGroup.alignment = "center";
        var closeBtn = btnGroup.add("button", undefined, "Close", {name: "ok"});
        closeBtn.preferredSize.width = 80;
        
        closeBtn.onClick = function() { w.close(); };
        w.show();
    } catch (e) {
        alert(message);
    }
}

function collectFilesRecursively(folder, extension, resultArray) {
    if (!folder || !folder.exists) return;
    
    try {
        var items = folder.getFiles();
        
        if (!items) return;
        if (!(items instanceof Array)) {
            items = [items];
        }
        
        for (var i = 0; i < items.length; i++) {
            try {
                var item = items[i];
                if (!item) continue;
                
                if (item instanceof Folder) {
                    collectFilesRecursively(item, extension, resultArray);
                } else if (item instanceof File && item.name.match(new RegExp("\\." + extension + "$", "i"))) {
                    resultArray.push(item);
                }
            } catch (e) {
                continue;
            }
        }
    } catch (e) {}
}


// ========== CONFIGURATION ==========
var MM_TO_PT = 2.83464567;

var ORNAMENT_RANGES = {
    ayah: { minW: 4, maxW: 5, minH: 5, maxH: 7, arabicName: "آية" },
    sajdah: { minW: 12, maxW: 15, minH: 16, maxH: 23, arabicName: "سجدة" },
    ruba: { minW: 12, maxW: 15, minH: 25, maxH: 26, arabicName: "ربع" },
    hizb: { minW: 12, maxW: 15, minH: 38, maxH: 40, arabicName: "حزب" },
    hizbx: { minW: 12, maxW: 15, minH: 41, maxH: 45, arabicName: "حزبx" },
    surah: { minW: 87, maxW: 88, minH: 9, maxH: 10, arabicName: "سورة" },
    border: { minW: 102, maxW: 104, minH: 157, maxH: 159, arabicName: "إطار" }
};

function mm(v) { return v * MM_TO_PT; }
function between(v, a, b) { return v >= a && v <= b; }

function unlockAllLayers(layers) {
    for (var i = 0; i < layers.length; i++) {
        layers[i].locked = false;
        layers[i].visible = true;
        if (layers[i].layers && layers[i].layers.length > 0) {
            unlockAllLayers(layers[i].layers);
        }
    }
}

function getOrnamentLayer(doc) {
    try { return doc.layers.getByName("Ornaments"); } catch (e) {
        try { return doc.layers.getByName("Ornament"); } catch (e2) {}
    }
    return null;
}

function getOpenDocumentByPath(filePath) {
    for (var i = 0; i < app.documents.length; i++) {
        try {
            if (app.documents[i].fullName.fsName === filePath) {
                return app.documents[i];
            }
        } catch (e) {}
    }
    return null;
}

function sanitizePath(path) {
    if (!path) return "";
    return path.replace(/\\/g, '/');
}

function getScriptPath() {
    try {
        if ($.fileName) {
            var file = new File($.fileName);
            if (file.exists) return file.parent.fsName;
        }
    } catch (e) {}
    return "";
}

// ========== JUZ / PAGE HELPERS ==========
var HOST_PAGE_TO_JUZ = {
    1: [1,21], 2: [22,41], 3: [42,61], 4: [62,81], 5: [82,101],
    6: [102,121], 7: [122,141], 8: [142,161], 9: [162,181], 10: [182,201],
    11: [202,221], 12: [222,241], 13: [242,261], 14: [262,281], 15: [282,301],
    16: [302,321], 17: [322,341], 18: [342,361], 19: [362,381], 20: [382,401],
    21: [402,421], 22: [422,441], 23: [442,461], 24: [462,481], 25: [482,501],
    26: [502,521], 27: [522,541], 28: [542,561], 29: [562,581], 30: [582,604]
};

function hostGetJuzFromPage(page) {
    for (var j = 1; j <= 30; j++) {
        var range = HOST_PAGE_TO_JUZ[j];
        if (page >= range[0] && page <= range[1]) return j;
    }
    return 1;
}

function hostEnsureFolder(pathStr) {
    var f = new Folder(pathStr);
    if (f.exists) return true;
    var parent = f.parent;
    if (parent && !parent.exists) {
        hostEnsureFolder(parent.fsName);
    }
    try { f.create(); } catch (e) { return false; }
    return true;
}

// ========== FILE NAMING HELPERS ==========
function getNewFilePath(originalFile, options) {
    if (!options.outputFolder) return null;
    
    var outputFolder = new Folder(options.outputFolder);
    if (!outputFolder.exists) {
        try {
            outputFolder.create();
        } catch (e) {
            showAlert("Failed to create output folder:\n" + options.outputFolder, "Folder Error");
            return null;
        }
    }
    
    var origName = originalFile.name.replace(/\.ai$/i, '');
    var newName = origName;
    
    if (options.saveMode === "sameAsTemplate" || options.sameAsTemplate) {
        var separator = "-";
        var suffix = options.nameSuffix || "Template";
        
        var idx = origName.indexOf(separator);
        if (idx !== -1) {
            var baseName = origName.substring(0, idx);
            newName = baseName + separator + suffix;
        } else {
            newName = origName + separator + suffix;
        }
        
    } else if (options.nameSeparator) {
        var separator = options.nameSeparator;
        var idx = origName.indexOf(separator);
        var suffix = options.nameSuffix || "Replaced";
        
        if (idx !== -1) {
            var baseName = origName.substring(0, idx);
            newName = baseName + separator + suffix;
        } else {
            newName = origName + separator + suffix;
        }
    } else if (options.nameSuffix) {
        newName = origName + "_" + options.nameSuffix;
    } else {
        newName = origName + "_Replaced";
    }
    
    // Compute juz from page number and build {nameSuffix}/Ajza/{juz}/ path
    // Only for saveAs / sameAsTemplate modes; overwrite/dontSave don't create folders
    var pageMatch = origName.match(/^(\d+)/);
    if (pageMatch) {
        var pageNum = parseInt(pageMatch[1], 10);
        var juz = hostGetJuzFromPage(pageNum);
        var juzFolder = ("0" + juz).slice(-2);
        var basePath = outputFolder.fsName.replace(/\\/g, '/');
        var folderName = options.nameSuffix || '';
        if (folderName) {
            basePath = basePath + "/" + folderName;
            hostEnsureFolder(basePath);
        }
        var ajzaPath = basePath + "/Ajza";
        hostEnsureFolder(ajzaPath);
        var juzPath = ajzaPath + "/" + juzFolder;
        hostEnsureFolder(juzPath);
        return new File(juzPath + "/" + newName + ".ai");
    }
    
    return new File(outputFolder + "/" + newName + ".ai");
}

// ========== SWATCH FUNCTIONS ==========
function deleteDocumentSwatches(doc) {
    var protectedNames = ['[none]', '[registration]', '[paper]', '[black]', 'white', 'none'];
    var removed = 0;
    if (!doc) return removed;
    try {
        for (var i = doc.swatches.length - 1; i >= 0; i--) {
            var swatch = doc.swatches[i];
            var name = swatch.name.toString().toLowerCase();
            var isProtected = false;
            for (var p = 0; p < protectedNames.length; p++) {
                if (name === protectedNames[p]) {
                    isProtected = true;
                    break;
                }
            }
            if (!isProtected) {
                try {
                    swatch.remove();
                    removed++;
                } catch (e) {}
            }
        }
    } catch (e) {}
    return removed;
}

function scanTemplateSwatches(templatePath) {
    var result = {
        success: true,
        "001": { found: false },
        "002": { found: false },
        "003": { found: false }
    };
    
    try {
        var templateDoc = app.open(File(templatePath));
        
        for (var i = 0; i < templateDoc.swatches.length; i++) {
            var swatch = templateDoc.swatches[i];
            var name = swatch.name;
            var prefix = name.substring(0, 3);
            
            if (prefix === "001" && !result["001"].found) {
                result["001"].found = true;
                result["001"].name = name;
                result["001"].colorType = swatch.color.typename;
                
                // Extract actual color values
                if (swatch.color.typename === "RGBColor") {
                    result["001"].color = "rgb(" + Math.round(swatch.color.red) + "," + 
                                         Math.round(swatch.color.green) + "," + 
                                         Math.round(swatch.color.blue) + ")";
                    result["001"].red = swatch.color.red;
                    result["001"].green = swatch.color.green;
                    result["001"].blue = swatch.color.blue;
                } else if (swatch.color.typename === "CMYKColor") {
                    result["001"].color = "cmyk(" + Math.round(swatch.color.cyan) + "," + 
                                         Math.round(swatch.color.magenta) + "," + 
                                         Math.round(swatch.color.yellow) + "," + 
                                         Math.round(swatch.color.black) + ")";
                    result["001"].cyan = swatch.color.cyan;
                    result["001"].magenta = swatch.color.magenta;
                    result["001"].yellow = swatch.color.yellow;
                    result["001"].black = swatch.color.black;
                } else if (swatch.color.typename === "GrayColor") {
                    result["001"].color = "gray(" + Math.round(swatch.color.gray) + ")";
                    result["001"].gray = swatch.color.gray;
                } else if (swatch.color.typename === "SpotColor") {
                    result["001"].color = "spot(" + swatch.color.spot.name + ")";
                    result["001"].spotName = swatch.color.spot.name;
                    result["001"].tint = swatch.color.tint;
                }
            }
            else if (prefix === "002" && !result["002"].found) {
                result["002"].found = true;
                result["002"].name = name;
                result["002"].colorType = swatch.color.typename;
                
                if (swatch.color.typename === "RGBColor") {
                    result["002"].color = "rgb(" + Math.round(swatch.color.red) + "," + 
                                         Math.round(swatch.color.green) + "," + 
                                         Math.round(swatch.color.blue) + ")";
                    result["002"].red = swatch.color.red;
                    result["002"].green = swatch.color.green;
                    result["002"].blue = swatch.color.blue;
                } else if (swatch.color.typename === "CMYKColor") {
                    result["002"].color = "cmyk(" + Math.round(swatch.color.cyan) + "," + 
                                         Math.round(swatch.color.magenta) + "," + 
                                         Math.round(swatch.color.yellow) + "," + 
                                         Math.round(swatch.color.black) + ")";
                    result["002"].cyan = swatch.color.cyan;
                    result["002"].magenta = swatch.color.magenta;
                    result["002"].yellow = swatch.color.yellow;
                    result["002"].black = swatch.color.black;
                } else if (swatch.color.typename === "GrayColor") {
                    result["002"].color = "gray(" + Math.round(swatch.color.gray) + ")";
                    result["002"].gray = swatch.color.gray;
                } else if (swatch.color.typename === "SpotColor") {
                    result["002"].color = "spot(" + swatch.color.spot.name + ")";
                    result["002"].spotName = swatch.color.spot.name;
                    result["002"].tint = swatch.color.tint;
                }
            }
            else if (prefix === "003" && !result["003"].found) {
                result["003"].found = true;
                result["003"].name = name;
                result["003"].colorType = swatch.color.typename;
                
                if (swatch.color.typename === "RGBColor") {
                    result["003"].color = "rgb(" + Math.round(swatch.color.red) + "," + 
                                         Math.round(swatch.color.green) + "," + 
                                         Math.round(swatch.color.blue) + ")";
                    result["003"].red = swatch.color.red;
                    result["003"].green = swatch.color.green;
                    result["003"].blue = swatch.color.blue;
                } else if (swatch.color.typename === "CMYKColor") {
                    result["003"].color = "cmyk(" + Math.round(swatch.color.cyan) + "," + 
                                         Math.round(swatch.color.magenta) + "," + 
                                         Math.round(swatch.color.yellow) + "," + 
                                         Math.round(swatch.color.black) + ")";
                    result["003"].cyan = swatch.color.cyan;
                    result["003"].magenta = swatch.color.magenta;
                    result["003"].yellow = swatch.color.yellow;
                    result["003"].black = swatch.color.black;
                } else if (swatch.color.typename === "GrayColor") {
                    result["003"].color = "gray(" + Math.round(swatch.color.gray) + ")";
                    result["003"].gray = swatch.color.gray;
                } else if (swatch.color.typename === "SpotColor") {
                    result["003"].color = "spot(" + swatch.color.spot.name + ")";
                    result["003"].spotName = swatch.color.spot.name;
                    result["003"].tint = swatch.color.tint;
                }
            }
        }
        
        templateDoc.close(SaveOptions.DONOTSAVECHANGES);
        
    } catch(e) {
        result.error = e.toString();
    }
    
    return JSON.stringify(result);
}

// ========== PROCESSING ==========
function processWithOptions(options) {
    var result = {
        success: false,
        message: "",
        processed: [],
        errors: [],
        ayahAlign: { ran: false, error: "" }
    };
    
    try {
        if (typeof options === 'string') {
            options = JSON.parse(options);
        }
        
        var isAyahAlignOnly = (options.replacementMode === 'ornaments' && 
                               (!options.selectedTypes || options.selectedTypes.length === 0) && 
                               options.runAyahAlign);
        
        if (!options || (!options.templatePath && !isAyahAlignOnly)) {
            result.message = "No template path";
            return JSON.stringify(result);
        }
        
        $.global.templateFilePath = options.templatePath || "";
        $.global.silentMode = options.silentMode || false;
        
        if (options.fitArtboard && app.documents.length > 0) {
            try { app.executeMenuCommand("fitin"); } catch (e) {}
        }
        
        if (options.replacementMode === 'swatches') {
            result = processSwatchReplacement(options);
        } else {
            if (options.mode === 'single') {
                result = processSingleFile(options);
            } else {
                result = processBatch(options);
            }
        }
        
    } catch (e) {
        result.message = "Critical error: " + e.message;
    }
    
    return JSON.stringify(result);
}

function processSwatchReplacement(options) {
    var result = {
        success: true,
        message: "",
        processed: [],
        errors: []
    };
    
    try {
        if (app.documents.length === 0) {
            result.message = "No document open";
            result.success = false;
            return result;
        }
        
        var targetDoc = app.activeDocument;
        var templateDoc = app.open(File(options.templatePath));
        var replaced = 0;
        
        // Process each selected prefix (001, 002, 003)
        for (var j = 0; j < options.selectedSwatches.length; j++) {
            var prefix = options.selectedSwatches[j].prefix || options.selectedSwatches[j];
            
            try {
                // Find template swatch by prefix
                var templateSwatch = null;
                for (var t = 0; t < templateDoc.swatches.length; t++) {
                    if (templateDoc.swatches[t].name.substring(0, 3) === prefix) {
                        templateSwatch = templateDoc.swatches[t];
                        break;
                    }
                }
                
                if (!templateSwatch) {
                    result.errors.push({type: prefix, reason: 'Not found in template'});
                    continue;
                }
                
                // Find target swatch by prefix (first 3 chars)
                var targetSwatch = null;
                for (var k = 0; k < targetDoc.swatches.length; k++) {
                    if (targetDoc.swatches[k].name.substring(0, 3) === prefix) {
                        targetSwatch = targetDoc.swatches[k];
                        break;
                    }
                }
                
                if (!targetSwatch) {
                    result.errors.push({type: prefix, reason: 'Not found in target'});
                    continue;
                }
                
                // COPY COLOR PROPERTIES (your working logic)
                copyColorProperties(targetSwatch.color, templateSwatch.color);
                replaced++;
                
                result.processed.push({
                    type: prefix,
                    label: targetSwatch.name + ' ← ' + templateSwatch.name
                });
                
            } catch (e) {
                result.errors.push({type: prefix, reason: e.toString()});
            }
        }
        
        templateDoc.close(SaveOptions.DONOTSAVECHANGES);
        app.redraw(); // Force refresh like in your script
        
        // Run ayah align if requested
        if (options.runAyahAlign) {
            var alignResult = runAyahAlign();
            if (alignResult.success) {
                result.processed.push({type: "ayahAlign", label: "Aligned"});
            } else {
                result.errors.push({type: "ayahAlign", reason: alignResult.error});
            }
        }
        
        // Handle saving
        if ((replaced > 0 || (options.runAyahAlign && result.processed.some(function(p){return p.type==='ayahAlign'}))) && !options.dontSave) {
            if (options.saveMode === "newFile" || options.saveMode === "sameAsTemplate") {
                if (targetDoc.fullName) {
                    var outFile = getNewFilePath(targetDoc.fullName, options);
                    if (outFile) {
                        try {
                            outFile.parent.create();
                            targetDoc.saveAs(outFile);
                            result.savedAs = outFile.fsName;
                        } catch (e) {}
                    }
                }
            } else if (options.saveMode !== "dontSave") {
                try { targetDoc.save(); } catch (e) {}
            }
        }
        
        result.message = "✅ Replaced " + replaced + " swatches! Gradients and artwork updated.";
        
    } catch (e) {
        result.success = false;
        result.message = "Error: " + e.message;
    }
    
    return result;
}

// Helper function to copy color properties by type (from your working code)
function copyColorProperties(targetColor, sourceColor) {
    if (targetColor.typename !== sourceColor.typename) {
        // If types differ, convert target to match source type first
        $.writeln("Warning: Color type mismatch " + targetColor.typename + " vs " + sourceColor.typename);
    }
    
    switch (sourceColor.typename) {
        case "RGBColor":
            targetColor.red = sourceColor.red;
            targetColor.green = sourceColor.green;
            targetColor.blue = sourceColor.blue;
            break;
            
        case "CMYKColor":
            targetColor.cyan = sourceColor.cyan;
            targetColor.magenta = sourceColor.magenta;
            targetColor.yellow = sourceColor.yellow;
            targetColor.black = sourceColor.black;
            break;
            
        case "SpotColor":
            targetColor.tint = sourceColor.tint;
            // Copy spot color definition if possible
            if (sourceColor.spot && targetColor.spot) {
                copyColorProperties(targetColor.spot.color, sourceColor.spot.color);
            }
            break;
            
        case "GrayColor":
            targetColor.gray = sourceColor.gray;
            break;
            
        case "LabColor":
            targetColor.l = sourceColor.l;
            targetColor.a = sourceColor.a;
            targetColor.b = sourceColor.b;
            break;
            
        case "GradientColor":
            // Gradients need special handling - copy stops
            if (sourceColor.gradient && targetColor.gradient) {
                var srcGradient = sourceColor.gradient;
                var tgtGradient = targetColor.gradient;
                tgtGradient.name = srcGradient.name;
                tgtGradient.type = srcGradient.type;
                
                // Copy gradient stops
                for (var i = 0; i < srcGradient.gradientStops.length; i++) {
                    if (i < tgtGradient.gradientStops.length) {
                        var srcStop = srcGradient.gradientStops[i];
                        var tgtStop = tgtGradient.gradientStops[i];
                        tgtStop.rampPoint = srcStop.rampPoint;
                        tgtStop.midPoint = srcStop.midPoint;
                        tgtStop.opacity = srcStop.opacity;
                        copyColorProperties(tgtStop.color, srcStop.color);
                    }
                }
            }
            break;
            
        default:
            // Fallback - shouldn't happen often
            targetColor = sourceColor;
    }
}

// Helper function to copy color properties by type (from your working code)
function copyColorProperties(targetColor, sourceColor) {
    if (targetColor.typename !== sourceColor.typename) {
        // If types differ, convert target to match source type first
        $.writeln("Warning: Color type mismatch " + targetColor.typename + " vs " + sourceColor.typename);
    }
    
    switch (sourceColor.typename) {
        case "RGBColor":
            targetColor.red = sourceColor.red;
            targetColor.green = sourceColor.green;
            targetColor.blue = sourceColor.blue;
            break;
            
        case "CMYKColor":
            targetColor.cyan = sourceColor.cyan;
            targetColor.magenta = sourceColor.magenta;
            targetColor.yellow = sourceColor.yellow;
            targetColor.black = sourceColor.black;
            break;
            
        case "SpotColor":
            targetColor.tint = sourceColor.tint;
            // Copy spot color definition if possible
            if (sourceColor.spot && targetColor.spot) {
                copyColorProperties(targetColor.spot.color, sourceColor.spot.color);
            }
            break;
            
        case "GrayColor":
            targetColor.gray = sourceColor.gray;
            break;
            
        case "LabColor":
            targetColor.l = sourceColor.l;
            targetColor.a = sourceColor.a;
            targetColor.b = sourceColor.b;
            break;
            
        case "GradientColor":
            // Gradients need special handling - copy stops
            if (sourceColor.gradient && targetColor.gradient) {
                var srcGradient = sourceColor.gradient;
                var tgtGradient = targetColor.gradient;
                tgtGradient.name = srcGradient.name;
                tgtGradient.type = srcGradient.type;
                
                // Copy gradient stops
                for (var i = 0; i < srcGradient.gradientStops.length; i++) {
                    if (i < tgtGradient.gradientStops.length) {
                        var srcStop = srcGradient.gradientStops[i];
                        var tgtStop = tgtGradient.gradientStops[i];
                        tgtStop.rampPoint = srcStop.rampPoint;
                        tgtStop.midPoint = srcStop.midPoint;
                        tgtStop.opacity = srcStop.opacity;
                        copyColorProperties(tgtStop.color, srcStop.color);
                    }
                }
            }
            break;
            
        default:
            // Fallback - shouldn't happen often
            targetColor = sourceColor;
    }
}

function browseForOutputFolder() {
    var result = { success: false, path: "", error: "" };
    
    try {
        var folder = Folder.selectDialog("Select output folder for new files:");
        if (folder && folder.exists) {
            result.success = true;
            result.path = sanitizePath(folder.fsName);
        } else {
            result.error = "No folder selected";
        }
    } catch (e) {
        result.error = "Exception: " + e.message;
    }
    
    return JSON.stringify(result);
}

// ========== TEMPLATE BROWSING ==========
function browseForTemplate() {
    if (isBrowsing) {
        return JSON.stringify({success: false, path: "", name: "", error: "Browser already open"});
    }
    
    isBrowsing = true;
    var result = { success: false, path: "", name: "", error: "" };
    
    try {
        var file = File.openDialog("Select Template .ai file", "*.ai", false);
        
        if (file && file.exists) {
            $.global.templateFilePath = file.fsName.replace(/\\/g, '/');
            result.success = true;
            result.path = sanitizePath(file.fsName);
            result.name = file.name;
        } else {
            result.error = "No file selected";
        }
    } catch (e) {
        result.error = "Exception: " + e.message;
    }
    
    isBrowsing = false;
    return JSON.stringify(result);
}

// ========== TEMPLATE SCANNING ==========
function scanTemplateForDesigns(templatePath) {
    var result = {
        ayah: false, sajdah: false, ruba: false, hizb: false,
        hizbx: false, surah: false, border: false,
        _success: false, _error: "", _path: ""
    };
    
    try {
        if (!templatePath) {
            result._error = "No template path";
            return JSON.stringify(result);
        }
        
        var normalizedPath = templatePath.replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\');
        var templateFile = new File(normalizedPath);
        result._path = templatePath;
        
        if (!templateFile.exists) {
            result._error = "Template not found";
            return JSON.stringify(result);
        }
        
        var templateDoc = getOpenDocumentByPath(templateFile.fsName);
        var wasAlreadyOpen = !!templateDoc;
        
        if (!templateDoc) {
            templateDoc = app.open(templateFile);
        }
        
        if (!templateDoc) {
            result._error = "Failed to open template";
            return JSON.stringify(result);
        }
        
        var items = templateDoc.pageItems;
        
        for (var type in ORNAMENT_RANGES) {
            if (ORNAMENT_RANGES.hasOwnProperty(type)) {
                result[type] = false;
                var searchName = type.toLowerCase();
                
                for (var i = 0; i < items.length; i++) {
                    try {
                        var it = items[i];
                        if (!it.name) continue;
                        
                        var itemName = it.name.toString().toLowerCase().replace(/^\s+|\s+$/g, '');
                        
                        if (itemName === searchName) {
                            result[type] = true;
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
        }
        
        result._success = true;
        
        if (!wasAlreadyOpen) {
            templateDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    } catch (e) {
        result._error = "Scan error: " + e.message;
    }
    
    return JSON.stringify(result);
}


// ========== DOCUMENT SCANNING ==========
function scanCurrentDocument() {
    var result = {
        found: [],
        notFound: [],
        _success: false,
        _error: "",
        _total: 0
    };
    
    try {
        if (app.documents.length === 0) {
            result._error = "No document open";
            return JSON.stringify(result);
        }
        
        var doc = app.activeDocument;
        var layer = getOrnamentLayer(doc);
        
        if (!layer) {
            result._error = "No Ornament layer found";
            return JSON.stringify(result);
        }
        
        var items = layer.pageItems;
        var counts = {};
        
        for (var type in ORNAMENT_RANGES) {
            counts[type] = 0;
        }
        
        for (var i = 0; i < items.length; i++) {
            try {
                var item = items[i];
                if (!item.editable) continue;
                
                var bounds = item.visibleBounds || item.geometricBounds;
                if (!bounds) continue;
                
                var w = Math.abs(bounds[2] - bounds[0]);
                var h = Math.abs(bounds[1] - bounds[3]);
                
                for (var type in ORNAMENT_RANGES) {
                    if (ORNAMENT_RANGES.hasOwnProperty(type)) {
                        var range = ORNAMENT_RANGES[type];
                        if (between(w, mm(range.minW), mm(range.maxW)) && 
                            between(h, mm(range.minH), mm(range.maxH))) {
                            counts[type]++;
                            result._total++;
                            break;
                        }
                    }
                }
            } catch (e) {}
        }
        
        for (var type in counts) {
            if (counts[type] > 0) {
                result.found.push({type: type, count: counts[type]});
            } else {
                result.notFound.push({type: type, count: 0});
            }
        }
        
        result._success = true;
    } catch (e) {
        result._error = "Scan error: " + e.message;
    }
    
    return JSON.stringify(result);
}

// ========== ORNAMENT REPLACEMENT FUNCTION ==========
function doReplaceOrnament(ornamentType, arabicName, minW, maxW, minH, maxH) {
    var silentMode = $.global.silentMode || false;
    var templatePath = $.global.templateFilePath;
    
    if (!templatePath) {
        return { success: false, error: "No template", count: 0 };
    }
    
    var templateFile = new File(templatePath.replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\'));
    if (!templateFile.exists) {
        return { success: false, error: "Template not found", count: 0 };
    }
    
    if (app.documents.length === 0) {
        return { success: false, error: "No document", count: 0 };
    }
    
    var mainDoc = app.activeDocument;
    var templateDoc = getOpenDocumentByPath(templateFile.fsName);
    var wasAlreadyOpen = !!templateDoc;
    
    try {
        if (!templateDoc) {
            templateDoc = app.open(templateFile);
        }
        
        if (!templateDoc) {
            return { success: false, error: "Failed to open template", count: 0 };
        }
        
        var ornamentItem = null;
        var items = templateDoc.pageItems;
        var searchType = ornamentType.toLowerCase();
        
        for (var i = 0; i < items.length; i++) {
            try {
                var it = items[i];
                if (!it.name) continue;
                
                var itemName = it.name.toString().toLowerCase().replace(/^\s+|\s+$/g, '');
                
                if (itemName === searchType) {
                    ornamentItem = it;
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!ornamentItem) {
            if (!wasAlreadyOpen) templateDoc.close(SaveOptions.DONOTSAVECHANGES);
            return { success: false, error: "Ornament '" + ornamentType + "' not found in template", count: 0 };
        }
        
        app.selection = null;
        ornamentItem.selected = true;
        app.copy();
        
        if (!wasAlreadyOpen) {
            templateDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
        
        app.activeDocument = mainDoc;
        unlockAllLayers(mainDoc.layers);
        
        var layer = getOrnamentLayer(mainDoc);
        if (!layer) {
            return { success: false, error: "No ornament layer", count: 0 };
        }
        
        var layerWasLocked = layer.locked;
        layer.locked = false;
        
        var MARK = "old_" + ornamentType;
        var allItems = layer.pageItems;
        var total = 0;
        
        for (var k = 0; k < allItems.length; k++) {
            try {
                var item = allItems[k];
                if (!item.editable) continue;
                
                var itemName = item.name || "";
                var bounds = item.visibleBounds || item.geometricBounds;
                
                if (bounds) {
                    var w = Math.abs(bounds[2] - bounds[0]);
                    var h = Math.abs(bounds[1] - bounds[3]);
                    
                    if (itemName === arabicName || 
                        (between(w, mm(minW), mm(maxW)) && between(h, mm(minH), mm(maxH)))) {
                        item.note = MARK;
                        total++;
                    }
                }
            } catch (e) {}
        }
        
        if (total === 0) {
            layer.locked = layerWasLocked;
            return { success: false, error: "No ornaments found", count: 0 };
        }
        
        mainDoc.activeLayer = layer;
        var replaced = 0;
        
        for (var n = 0; n < total; n++) {
            var targetItem = null;
            var currentItems = layer.pageItems;
            
            for (var j = 0; j < currentItems.length; j++) {
                if (currentItems[j].note === MARK) {
                    targetItem = currentItems[j];
                    break;
                }
            }
            
            if (!targetItem) break;
            
            app.selection = null;
            targetItem.selected = true;
            app.executeMenuCommand("pasteFront");
            
            if (mainDoc.selection.length === 0) break;
            
            var newObj = mainDoc.selection[0];
            var oldBounds = targetItem.visibleBounds || targetItem.geometricBounds;
            var newBounds = newObj.visibleBounds || newObj.geometricBounds;
            
            var oldCx = (oldBounds[0] + oldBounds[2]) / 2;
            var oldCy = (oldBounds[1] + oldBounds[3]) / 2;
            var newCx = (newBounds[0] + newBounds[2]) / 2;
            var newCy = (newBounds[1] + newBounds[3]) / 2;
            
            newObj.translate(oldCx - newCx, oldCy - newCy);
            newObj.move(layer, ElementPlacement.PLACEATBEGINNING);
            targetItem.remove();
            replaced++;
        }
        
        layer.locked = layerWasLocked;
        
        return { success: replaced > 0, count: replaced, total: total };
        
    } catch (e) {
        if (templateDoc && !wasAlreadyOpen) {
            try { templateDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        }
        return { success: false, error: e.message, count: 0 };
    }
}
// ===== AYAH + BORDER ALIGN (inlined from ayahalign.jsx) =====

var AYAH_ORNAMENT_LAYER_NAMES = ["Ornament", "Ornaments"];
var AYAHNO_LAYER_NAMES        = ["Aya No.", "Ayah No."];
var AYAH_ORNAMENT_NAME        = "ayah";

// 0.6644 pt extra downward shift
var AYAH_SHIFT_DY_PT = -0.6644;

// Border alignment constants (same as ayahalign.jsx)
var BORDER_NAME        = "border";
var BORDER_WIDTH_MM    = 103.285;
var BORDER_HEIGHT_MM   = 158.466;
var SIZE_TOLERANCE_MM  = 1.0; // ±1mm tolerance

function ayah_getCenter(item) {
    return {
        cx: item.left + item.width / 2,
        cy: item.top - item.height / 2
    };
}

function ayah_getBottomEdge(item) {
    return item.top - item.height;
}

function ayah_distanceSquared(a, b) {
    var dx = a.cx - b.cx;
    var dy = a.cy - b.cy;
    return dx * dx + dy * dy;
}

function ayah_findLayerFromList(doc, names) {
    for (var n = 0; n < names.length; n++) {
        var targetName = names[n].toLowerCase();
        for (var i = 0; i < doc.layers.length; i++) {
            if (doc.layers[i].name.toLowerCase() === targetName) return doc.layers[i];
        }
    }
    return null;
}

function ayah_collectOrnaments(layer) {
    var out = [];
    function walk(container) {
        var items = container.pageItems;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.name === AYAH_ORNAMENT_NAME) {
                out.push(it);
            }
        }
        if (container.groupItems) {
            for (var g = 0; g < container.groupItems.length; g++) {
                walk(container.groupItems[g]);
            }
        }
    }
    walk(layer);
    return out;
}

function ayah_collectAyahNumbers(layer) {
    var out = [];
    function walk(container) {
        var items = container.pageItems;
        for (var i = 0; i < items.length; i++) {
            out.push(items[i]);
        }
        if (container.groupItems) {
            for (var g = 0; g < container.groupItems.length; g++) {
                walk(container.groupItems[g]);
            }
        }
    }
    walk(layer);
    return out;
}

// Border helpers
function ayah_collectBorders(layer) {
    var out       = [];
    var targetW   = BORDER_WIDTH_MM  * MM_TO_PT;
    var targetH   = BORDER_HEIGHT_MM * MM_TO_PT;
    var tolerance = SIZE_TOLERANCE_MM * MM_TO_PT;

    function walk(container) {
        var items = container.pageItems;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var isBorder = false;

            if (it.name.toLowerCase().indexOf(BORDER_NAME) !== -1) {
                isBorder = true;
            } else {
                var w = Math.abs(it.width);
                var h = Math.abs(it.height);

                var matchesNormal  = (Math.abs(w - targetW) < tolerance && Math.abs(h - targetH) < tolerance);
                var matchesRotated = (Math.abs(w - targetH) < tolerance && Math.abs(h - targetW) < tolerance);

                if (matchesNormal || matchesRotated) {
                    isBorder = true;
                }
            }

            if (isBorder) {
                out.push(it);
            }
        }
        if (container.groupItems) {
            for (var g = 0; g < container.groupItems.length; g++) {
                walk(container.groupItems[g]);
            }
        }
    }
    walk(layer);
    return out;
}

function ayah_collectHeaderObjects(doc) {
    var out = [];
    var headerLayers = [];
    for (var L = 0; L < doc.layers.length; L++) {
        var layerName = doc.layers[L].name;
        if (layerName.toLowerCase().indexOf("header") !== -1) {
            headerLayers.push(doc.layers[L]);
        }
    }
    if (!headerLayers.length) return { layers: [], objects: [] };

    function walk(container) {
        var items = container.pageItems;
        for (var i = 0; i < items.length; i++) {
            out.push(items[i]);
        }
        if (container.groupItems) {
            for (var g = 0; g < container.groupItems.length; g++) {
                walk(container.groupItems[g]);
            }
        }
    }

    for (var idx = 0; idx < headerLayers.length; idx++) {
        walk(headerLayers[idx]);
    }

    return { layers: headerLayers, objects: out };
}

// Main combined function
function runAyahAlignInline() {
    if (!app.documents.length) {
        return { success: false, error: "No document open." };
    }
    var doc = app.activeDocument;

    // ===== AYAH ALIGN =====
    var ornamentLayer = ayah_findLayerFromList(doc, AYAH_ORNAMENT_LAYER_NAMES);
    var ayahnoLayer   = ayah_findLayerFromList(doc, AYAHNO_LAYER_NAMES);

    if (!ornamentLayer) {
        return { success: false, error: 'Layer "Ornament" or "Ornaments" not found.' };
    }
    if (!ayahnoLayer) {
        return { success: false, error: 'Layer "Aya No." or "Ayah No." not found.' };
    }

    var ornaments   = ayah_collectOrnaments(ornamentLayer);
    var ayahNumbers = ayah_collectAyahNumbers(ayahnoLayer);

    if (!ornaments.length) {
        return { success: false, error: 'No ornament objects named "ayah" found on Ornament/Ornaments layer.' };
    }
    if (!ayahNumbers.length) {
        return { success: false, error: 'No ayah number objects found on Aya No./Ayah No. layer.' };
    }

    var OFFSET_DOWN_MM = 0.1;
    var offsetDownPt   = OFFSET_DOWN_MM * MM_TO_PT; // uses global MM_TO_PT from host.jsx

    for (var i = 0; i < ayahNumbers.length; i++) {
        var ayahItem   = ayahNumbers[i];
        var ayahCenter = ayah_getCenter(ayahItem);
        var bestOrn    = null;
        var bestDist2  = Number.MAX_VALUE;

        for (var j = 0; j < ornaments.length; j++) {
            var orn       = ornaments[j];
            var ornCenter = ayah_getCenter(orn);
            var d2        = ayah_distanceSquared(ayahCenter, ornCenter);
            if (d2 < bestDist2) {
                bestDist2 = d2;
                bestOrn   = orn;
            }
        }

        if (!bestOrn) continue;

        var targetC = ayah_getCenter(bestOrn);

        // 1) center ayah number on ornament
        var dx = targetC.cx - ayahCenter.cx;
        var dy = targetC.cy - ayahCenter.cy;
        ayahItem.translate(dx, dy);

        // 2) move ayah number 0.1 mm DOWN
        ayahItem.translate(0, -offsetDownPt);

        // 3) extra 0.6644 pt DOWN (relative)
        ayahItem.translate(0, AYAH_SHIFT_DY_PT);
    }

    // ===== BORDER ALIGN =====
    var borders = ayah_collectBorders(ornamentLayer);
    var headerData = ayah_collectHeaderObjects(doc);
    var headerObjects = headerData.objects;

    if (!borders.length) {
        // keep ayah success but report border info
        return { success: true, borderWarning: "No borders found in Ornament layer." };
    }
    if (!headerData.layers.length || !headerObjects.length) {
        return { success: true, borderWarning: "No header layers/objects found." };
    }

    for (var b = 0; b < borders.length; b++) {
        var border       = borders[b];
        var borderCenter = ayah_getCenter(border);
        var borderBottom = ayah_getBottomEdge(border);

        var candidates = [];

        for (var h = 0; h < headerObjects.length; h++) {
            var ho       = headerObjects[h];
            var hoCenter = ayah_getCenter(ho);

            // header center strictly below border bottom
            if (hoCenter.cy < borderBottom - 0.1) {
                var distY = borderBottom - hoCenter.cy;
                candidates.push({
                    item: ho,
                    center: hoCenter,
                    dist: distY
                });
            }
        }

        if (!candidates.length) continue;

        var nearest = candidates[0];
        for (var c = 1; c < candidates.length; c++) {
            if (candidates[c].dist < nearest.dist) {
                nearest = candidates[c];
            }
        }

        var dxBorder = nearest.center.cx - borderCenter.cx;
        border.translate(dxBorder, 0);
    }

    return { success: true };
}

// Run AyahAlign script
function runAyahAlign() {
    try {
        var res = runAyahAlignInline();
        if (res && res.success) {
            return { success: true, borderWarning: res.borderWarning || "" };
        }
        return { success: false, error: res && res.error ? res.error : "Unknown error in runAyahAlignInline" };
    } catch (e) {
        return { success: false, error: e.message };
    }
}


function processSingleFile(options) {
    var result = {
        success: false,
        message: "",
        processed: [],
        errors: [],
        savedAs: "",
        ayahAlign: { ran: false, error: "" }
    };
    
    try {
        if (app.documents.length === 0) {
            result.message = "No document open";
            return result;
        }
        
        var doc = app.activeDocument;
        
        if (options.deleteOldSwatches) {
            deleteDocumentSwatches(doc);
        }
        
        if ((options.saveMode === "newFile" || options.saveMode === "sameAsTemplate") && !doc.fullName) {
            result.message = "Document not saved";
            return result;
        }
        
        var scanResult = scanDocument(doc);
        var ayahWasProcessed = false;
        
        if (options.selectedTypes && options.selectedTypes.length > 0) {
            for (var i = 0; i < options.selectedTypes.length; i++) {
                var type = options.selectedTypes[i];
                
                if (type === 'ayahAlign') continue;
                
                var range = ORNAMENT_RANGES[type];
                
                if (!range) {
                    result.errors.push({type: type, reason: "unknown type"});
                    continue;
                }
                
                if (scanResult[type] === 0) {
                    result.errors.push({type: type, reason: "not found"});
                    continue;
                }
                
                var replaceResult = doReplaceOrnament(
                    type, 
                    range.arabicName, 
                    range.minW, range.maxW, 
                    range.minH, range.maxH
                );
                
                if (replaceResult.success) {
                    result.processed.push({type: type, count: replaceResult.count});
                    if (type === 'ayah') ayahWasProcessed = true;
                } else {
                    result.errors.push({type: type, reason: replaceResult.error || "failed"});
                }
            }
        }
        
        if (options.runAyahAlign) {
            var alignResult = runAyahAlign();
            result.ayahAlign.ran = true;
            if (!alignResult.success) {
                result.ayahAlign.error = alignResult.error;
                result.errors.push({type: "ayahAlign", reason: alignResult.error});
            } else {
                result.processed.push({type: "ayahAlign", count: 0, label: "Aligned"});
            }
        }
        
        if (result.processed.length > 0) {
            if (options.saveMode === "newFile" || options.saveMode === "sameAsTemplate") {
                var outFile = getNewFilePath(doc.fullName, options);
                if (outFile) {
                    try {
                        outFile.parent.create();
                        doc.saveAs(outFile);
                        result.savedAs = outFile.fsName;
                        
                        if (options.saveMode === "sameAsTemplate") {
                            result.message = "Saved with template name: " + outFile.name;
                        } else {
                            result.message = "Saved as: " + outFile.name;
                        }
                    } catch (e) {
                        result.errors.push({type: "saveAs", reason: e.message});
                    }
                }
            } else if (options.autoSave && options.saveMode !== "dontSave" && !options.dontSave) {
                try { 
                    doc.save(); 
                    result.message = "File overwritten successfully";
                } catch (e) {
                    result.errors.push({type: "save", reason: "failed"});
                }
            }
        }
        
        if (result.processed.length === 0) {
            result.message = "No ornaments processed";
        } else if (result.errors.length > 0 && result.message === "") {
            result.message = "Completed with " + result.errors.length + " errors";
        }
        
        result.success = result.processed.length > 0;
        
    } catch (e) {
        result.message = "Error: " + e.message;
    }
    
    return result;
}

function processBatch(options) {
    var result = {
        success: false,
        message: "",
        processedCount: 0,
        errorCount: 0,
        details: [],
        totalFiles: 0,
        skippedCount: 0
    };
    
    try {
        if ((options.saveMode === "newFile" || options.saveMode === "sameAsTemplate") && !options.outputFolder) {
            showAlert("Please select an output folder for 'Save as New File' or 'Same as Template' mode.", "Configuration Error");
            result.message = "No output folder selected";
            return result;
        }
        
        var folder;
        if (options.batchFolder) {
            folder = new Folder(options.batchFolder);
            if (!folder.exists) {
                result.message = "Riwayah folder not found: " + options.batchFolder;
                return result;
            }
        } else {
            folder = Folder.selectDialog("Select root folder with .ai files (includes subfolders):");
            if (!folder) {
                result.message = "No folder selected";
                return result;
            }
        }
        
        var files = [];
        collectFilesRecursively(folder, "ai", files);
        result.totalFiles = files.length;
        
        if (files.length === 0) {
            showAlert("No .ai files found in the selected folder or its subfolders.", "No Files");
            result.message = "No .ai files found";
            return result;
        }
        
        var filesToProcess = [];
        var templatePathNorm = $.global.templateFilePath;
        var allowedPages = options.allowedPages || null;
        
        for (var f = 0; f < files.length; f++) {
            if (files[f].fsName.replace(/\\/g, '/') === templatePathNorm) {
                continue;
            }
            // Apply Juz/Surah page filter if provided
            if (allowedPages && allowedPages.length > 0) {
                var pageMatch = files[f].name.match(/^(\d+)-/);
                if (pageMatch) {
                    var pageNum = parseInt(pageMatch[1], 10);
                    var isAllowed = false;
                    for (var ap = 0; ap < allowedPages.length; ap++) {
                        if (allowedPages[ap] === pageNum) {
                            isAllowed = true;
                            break;
                        }
                    }
                    if (!isAllowed) continue;
                }
            }
            filesToProcess.push(files[f]);
        }
        
        result.skippedCount = files.length - filesToProcess.length;
        
        if (filesToProcess.length === 0) {
            showAlert("No files to process (template file was excluded).", "No Files");
            result.message = "No files to process";
            return result;
        }
        
        // PRE-LOAD TEMPLATE DATA FOR SWATCH MODE
        var templateSwatches = {};
        if (options.replacementMode === 'swatches') {
            var templateDoc = app.open(File(options.templatePath));
            for (var t = 0; t < templateDoc.swatches.length; t++) {
                var name = templateDoc.swatches[t].name;
                var prefix = name.substring(0, 3);
                if ((prefix === "001" || prefix === "002" || prefix === "003") && !templateSwatches[prefix]) {
                    templateSwatches[prefix] = templateDoc.swatches[t];
                }
            }
            templateDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
        
        var logMessages = [];
        
        for (var i = 0; i < filesToProcess.length; i++) {
            var file = filesToProcess[i];
            var doc = null;
            var relativePath = file.fsName.replace(folder.fsName, "");
            var fileProcessed = [];
            var fileErrors = [];
            
            try {
                doc = app.open(file);
                
                if (options.fitArtboard) {
                    try { app.executeMenuCommand("fitin"); } catch (e) {}
                }
                
                if (options.deleteOldSwatches && options.replacementMode !== 'swatches') {
                    deleteDocumentSwatches(doc);
                }
                
                // HANDLE SWATCH REPLACEMENT MODE
                if (options.replacementMode === 'swatches') {
                    var replaced = 0;
                    
                    for (var s = 0; s < options.selectedSwatches.length; s++) {
                        var prefix = options.selectedSwatches[s].prefix || options.selectedSwatches[s];
                        
                        var tplSw = templateSwatches[prefix];
                        if (!tplSw) {
                            fileErrors.push(prefix + ": not in template");
                            continue;
                        }
                        
                        // Find target swatch
                        var tgtSw = null;
                        for (var ts = 0; ts < doc.swatches.length; ts++) {
                            if (doc.swatches[ts].name.substring(0, 3) === prefix) {
                                tgtSw = doc.swatches[ts];
                                break;
                            }
                        }
                        
                        if (!tgtSw) {
                            fileErrors.push(prefix + ": not in file");
                            continue;
                        }
                        
                        // Copy color
                        try {
                            copyColorProperties(tgtSw.color, tplSw.color);
                            replaced++;
                            fileProcessed.push(prefix);
                        } catch (e) {
                            fileErrors.push(prefix + ": " + e.toString());
                        }
                    }
                    
                    if (replaced > 0) {
                        result.processedCount++;
                    }
                    
                    if (options.runAyahAlign) {
                        var alignResult = runAyahAlign();
                        if (alignResult.success) {
                            fileProcessed.push("ayahAlign");
                        } else {
                            fileErrors.push("ayahAlign: " + alignResult.error);
                        }
                    }
                    
                    if (fileProcessed.length > 0) {
                        result.processedCount++;
                    }
                } 
                // HANDLE ORNAMENT MODE (original code)
                else {
                    var scanResult = scanDocument(doc);
                    var ayahWasProcessed = false;
                    
                    if (options.selectedTypes && options.selectedTypes.length > 0) {
                        for (var j = 0; j < options.selectedTypes.length; j++) {
                            var type = options.selectedTypes[j];
                            if (type === 'ayahAlign') continue;
                            
                            var range = ORNAMENT_RANGES[type];
                            
                            if (scanResult[type] > 0) {
                                var replaceResult = doReplaceOrnament(
                                    type, 
                                    range.arabicName, 
                                    range.minW, range.maxW, 
                                    range.minH, range.maxH
                                );
                                if (replaceResult.success) {
                                    fileProcessed.push(type + "(" + replaceResult.count + ")");
                                    if (type === 'ayah') ayahWasProcessed = true;
                                } else {
                                    fileErrors.push(type + ": " + replaceResult.error);
                                }
                            } else {
                                fileErrors.push(type + ": not found");
                            }
                        }
                    }
                    
                    if (options.runAyahAlign) {
                        var alignResult = runAyahAlign();
                        if (alignResult.success) {
                            fileProcessed.push("ayahAlign");
                        } else {
                            fileErrors.push("ayahAlign: " + alignResult.error);
                        }
                    }
                    
                    if (fileProcessed.length > 0) {
                        result.processedCount++;
                    }
                }
                
                // Save handling
                if (options.saveMode === "newFile" || options.saveMode === "sameAsTemplate") {
                    var outFile = getNewFilePath(file, options);
                    if (outFile) {
                        try {
                            doc.saveAs(outFile);
                        } catch (e) {
                            result.errorCount++;
                            fileErrors.push("save failed: " + e.message);
                        }
                    }
                } else if (options.saveMode !== "dontSave") {
                    try {
                        doc.save();
                    } catch (e) {
                        result.errorCount++;
                        fileErrors.push("save failed: " + e.message);
                    }
                }
                
                doc.close(SaveOptions.DONOTSAVECHANGES);
                
                result.details.push({
                    file: relativePath,
                    folder: file.parent.name,
                    processed: fileProcessed,
                    errors: fileErrors
                });
                logMessages.push((fileProcessed.length > 0 ? "OK" : "FAIL") + ": " + relativePath + " [" + fileProcessed.join(", ") + "]");
                
            } catch (e) {
                result.errorCount++;
                logMessages.push("ERR: " + relativePath + " - " + e.message);
                if (doc) try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
            }
        }
        
        // Save log
        try {
            var logFile = new File(folder.fsName + "/batch_log.txt");
            logFile.encoding = "UTF-8";
            logFile.open("w");
            logFile.writeln("Batch Log - " + new Date().toString());
            logFile.writeln("Mode: " + (options.replacementMode === 'swatches' ? "Swatch Replacement" : "Ornament Replacement"));
            var saveModeLabel = "Overwrite";
            if (options.saveMode === "newFile") saveModeLabel = "Save as New";
            else if (options.saveMode === "sameAsTemplate") saveModeLabel = "Same as Template";
            logFile.writeln("Save Mode: " + saveModeLabel);
            logFile.writeln("Root: " + folder.fsName);
            logFile.writeln("Files: " + result.totalFiles + " found, " + result.skippedCount + " skipped, " + result.processedCount + " processed, " + result.errorCount + " errors");
            logFile.writeln("====================");
            for (var l = 0; l < logMessages.length; l++) {
                logFile.writeln(logMessages[l]);
            }
            logFile.close();
        } catch (e) {}
        
        result.success = true;
        result.message = "Complete: " + result.processedCount + " files processed, " + result.errorCount + " errors";
        
        showAlert(
            "Batch Complete\n\n" +
            "Total: " + result.totalFiles + "\n" +
            "Processed: " + result.processedCount + "\n" +
            "Errors: " + result.errorCount + "\n\n" +
            "Log: batch_log.txt",
            "Batch Complete"
        );
        
    } catch (e) {
        result.message = "Batch error: " + e.message;
        showAlert("Batch processing error:\n" + e.message, "Error");
    }
    
    return result;
}

// Process a chunk of files (one folder) — called from panel for folder-by-folder batch
function processBatchChunk(options) {
    if (typeof options === 'string') options = JSON.parse(options);

    var result = {
        success: true,
        processedCount: 0,
        errorCount: 0,
        details: []
    };

    if (!options.chunkFiles || options.chunkFiles.length === 0) {
        return JSON.stringify(result);
    }

    // Set globals needed by doReplaceOrnament and runAyahAlign
    $.global.templateFilePath = options.templatePath || "";
    $.global.silentMode = options.silentMode || false;

    // Pre-load template swatches for swatch mode
    var templateSwatches = {};
    if (options.replacementMode === 'swatches' && options.templatePath) {
        try {
            var templateDoc = app.open(File(options.templatePath));
            for (var t = 0; t < templateDoc.swatches.length; t++) {
                var name = templateDoc.swatches[t].name;
                var prefix = name.substring(0, 3);
                if ((prefix === "001" || prefix === "002" || prefix === "003") && !templateSwatches[prefix]) {
                    templateSwatches[prefix] = templateDoc.swatches[t];
                }
            }
            templateDoc.close(SaveOptions.DONOTSAVECHANGES);
        } catch (e) {}
    }

    for (var i = 0; i < options.chunkFiles.length; i++) {
        var filePath = options.chunkFiles[i];
        var file = new File(filePath);
        if (!file.exists) continue;

        var doc = null;
        var fileProcessed = [];
        var fileErrors = [];
        var relativePath = file.fsName;

        try {
            doc = app.open(file);

            if (options.fitArtboard) {
                try { app.executeMenuCommand("fitin"); } catch (e) {}
            }

            if (options.deleteOldSwatches && options.replacementMode !== 'swatches') {
                deleteDocumentSwatches(doc);
            }

            // Swatch mode
            if (options.replacementMode === 'swatches') {
                var replaced = 0;
                for (var s = 0; s < options.selectedSwatches.length; s++) {
                    var prefix = options.selectedSwatches[s].prefix || options.selectedSwatches[s];
                    var tplSw = templateSwatches[prefix];
                    if (!tplSw) { fileErrors.push(prefix + ": not in template"); continue; }
                    var tgtSw = null;
                    for (var ts = 0; ts < doc.swatches.length; ts++) {
                        if (doc.swatches[ts].name.substring(0, 3) === prefix) { tgtSw = doc.swatches[ts]; break; }
                    }
                    if (!tgtSw) { fileErrors.push(prefix + ": not in file"); continue; }
                    try { copyColorProperties(tgtSw.color, tplSw.color); replaced++; fileProcessed.push(prefix); } catch (e) { fileErrors.push(prefix + ": " + e.toString()); }
                }
                if (replaced > 0) result.processedCount++;

                if (options.runAyahAlign) {
                    var alignResult = runAyahAlign();
                    if (alignResult.success) fileProcessed.push("ayahAlign");
                    else fileErrors.push("ayahAlign: " + alignResult.error);
                }
                if (fileProcessed.length > 0) result.processedCount++;
            }
            // Ornament mode
            else {
                var scanResult = scanDocument(doc);
                if (options.selectedTypes && options.selectedTypes.length > 0) {
                    for (var j = 0; j < options.selectedTypes.length; j++) {
                        var type = options.selectedTypes[j];
                        if (type === 'ayahAlign') continue;
                        var range = ORNAMENT_RANGES[type];
                        if (scanResult[type] > 0) {
                            var replaceResult = doReplaceOrnament(type, range.arabicName, range.minW, range.maxW, range.minH, range.maxH);
                            if (replaceResult.success) fileProcessed.push(type + "(" + replaceResult.count + ")");
                            else fileErrors.push(type + ": " + replaceResult.error);
                        } else {
                            fileErrors.push(type + ": not found");
                        }
                    }
                }
                if (options.runAyahAlign) {
                    var alignResult = runAyahAlign();
                    if (alignResult.success) fileProcessed.push("ayahAlign");
                    else fileErrors.push("ayahAlign: " + alignResult.error);
                }
                if (fileProcessed.length > 0) result.processedCount++;
            }

            // Save
            var saveSucceeded = false;
            if (options.saveMode === "newFile" || options.saveMode === "sameAsTemplate") {
                var outFile = getNewFilePath(file, options);
                if (outFile) {
                    try {
                        doc.saveAs(outFile);
                        saveSucceeded = true;
                    } catch (e) {
                        fileErrors.push("saveAs failed: " + e.message);
                        // Fallback: try saving to original location
                        try { doc.save(); saveSucceeded = true; } catch (e2) { fileErrors.push("fallback save failed: " + e2.message); }
                    }
                } else {
                    fileErrors.push("output path null (no outputFolder?)");
                }
            } else if (options.saveMode !== "dontSave") {
                try {
                    doc.save();
                    saveSucceeded = true;
                } catch (e) {
                    fileErrors.push("save failed: " + e.message);
                }
            }
            
            if (!saveSucceeded) {
                result.errorCount++;
            }

            // Close (already saved above, so no changes to discard)
            try {
                doc.close(SaveOptions.DONOTSAVECHANGES);
            } catch (e) {
                fileErrors.push("close warning: " + e.message);
            }

            result.details.push({
                file: relativePath,
                processed: fileProcessed,
                errors: fileErrors
            });

            // Yield to prevent freeze
            try { app.redraw(); } catch (e) {}

        } catch (e) {
            result.errorCount++;
            fileErrors.push("FATAL: " + (e.message || e.toString()));
            // Re-push details with the fatal error included
            result.details.push({
                file: relativePath,
                processed: fileProcessed,
                errors: fileErrors
            });
            if (doc) try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        }
    }

    return JSON.stringify(result);
}

function scanDocument(doc) {
    var result = { ayah: 0, sajdah: 0, ruba: 0, hizb: 0, hizbx: 0, surah: 0, border: 0 };
    try {
        var layer = getOrnamentLayer(doc);
        if (!layer) return result;
        
        var items = layer.pageItems;
        for (var i = 0; i < items.length; i++) {
            try {
                var item = items[i];
                if (!item.editable) continue;
                var bounds = item.visibleBounds || item.geometricBounds;
                if (!bounds) continue;
                
                var w = Math.abs(bounds[2] - bounds[0]);
                var h = Math.abs(bounds[1] - bounds[3]);
                
                for (var type in ORNAMENT_RANGES) {
                    if (ORNAMENT_RANGES.hasOwnProperty(type)) {
                        var range = ORNAMENT_RANGES[type];
                        if (between(w, mm(range.minW), mm(range.maxW)) && 
                            between(h, mm(range.minH), mm(range.maxH))) {
                            result[type]++;
                            break;
                        }
                    }
                }
            } catch (e) {}
        }
    } catch (e) {}
    return result;
}

function scanTemplateFolder(folderPath) {
    var result = { success: false, templates: [], error: "" };
    
    try {
        if (!folderPath) {
            result.error = "No folder path provided";
            return JSON.stringify(result);
        }
        
        var normalizedPath = folderPath.replace(/\//g, Folder.fs === "Macintosh" ? '/' : '\\');
        var folder = new Folder(normalizedPath);
        
        if (!folder.exists) {
            result.error = "Folder not found: " + folderPath;
            return JSON.stringify(result);
        }
        
        var files = [];
        collectFilesRecursively(folder, "ai", files);
        
        if (!files || !(files instanceof Array)) {
            files = [];
        }
        
        files.sort(function(a, b) {
            if (a.name < b.name) return -1;
            if (a.name > b.name) return 1;
            return 0;
        });
        
        var templates = [];
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (file && file.name) {
                templates.push({
                    name: file.name,
                    path: file.fsName.replace(/\\/g, '/'),
                    displayName: file.name.replace(/\.ai$/i, '')
                });
            }
        }
        
        result.templates = templates;
        result.success = true;
        result.count = templates.length;
        
    } catch (e) {
        result.error = "Scan error: " + e.message;
        $.writeln("DEBUG ERROR: " + e.message);
    }
    
    return JSON.stringify(result);
}

function copyFileToFolder(sourcePath, destPath) {
    var result = { success: false, error: "" };
    
    try {
        var sourceFile = new File(sourcePath);
        if (!sourceFile.exists) {
            result.error = "Source file not found";
            return JSON.stringify(result);
        }
        
        var destFile = new File(destPath);
        var destFolder = destFile.parent;
        if (!destFolder.exists) {
            destFolder.create();
        }
        
        if (sourceFile.copy(destFile)) {
            result.success = true;
        } else {
            result.error = "Copy failed (file may be in use)";
        }
        
    } catch (e) {
        result.error = e.message;
    }
    
    return JSON.stringify(result);
}

// Individual functions for direct calling
function replaceAyah() { 
    var r = doReplaceOrnament("ayah", "آية", 4, 5, 5, 7);
    return JSON.stringify(r);
}
function replaceSajdah() { 
    var r = doReplaceOrnament("sajdah", "سجدة", 12, 15, 20, 23);
    return JSON.stringify(r);
}
function replaceRuba() { 
    var r = doReplaceOrnament("ruba", "ربع", 12, 15, 25, 26);
    return JSON.stringify(r);
}
function replaceHizb() { 
    var r = doReplaceOrnament("hizb", "حزب", 12, 15, 38, 40);
    return JSON.stringify(r);
}
function replaceHizbX() { 
    var r = doReplaceOrnament("hizbx", "حزبx", 12, 15, 41, 45);
    return JSON.stringify(r);
}
function replaceSurah() { 
    var r = doReplaceOrnament("surah", "سورة", 87, 88, 9, 10);
    return JSON.stringify(r);
}
function replaceBorder() { 
    var r = doReplaceOrnament("border", "إطار", 102, 104, 157, 159);
    return JSON.stringify(r);
}

function selectFolderDialog(promptText) {
    promptText = promptText || "Select folder:";
    try {
        var folder = Folder.selectDialog(promptText);
        if (folder && folder.exists) {
            return folder.fsName.replace(/\\/g, '/');
        }
    } catch (e) {}
    return "null";
}
