// Ruba Ornament Replacement Script
// Replaces Ruba markers (12-15mm x 25-26mm) with template objects
(function () {
    var silentMode = $.global.silentMode || false;
    var MM_TO_PT = 2.83464567;
    
    function logMessage(msg) {
        try {
            var logFile = new File(Folder.userData + "/MushafWarsh/log.txt");
            if (!logFile.parent.exists) logFile.parent.create();
            logFile.encoding = "UTF-8";
            logFile.open("a");
            logFile.writeln(new Date().toString() + " [Ruba] " + msg);
            logFile.close();
        } catch(e) {}
    }
    
    var templatePath = $.global.templateFilePath;
    if (!templatePath) {
        if (!silentMode) alert("No template file specified.");
        return;
    }
    
    var warshFile = new File(templatePath);
    if (!warshFile.exists) {
        if (!silentMode) alert("Template file not found at: " + warshFile.fsName);
        return;
    }
    
    if (!app.documents.length) return;
    var mainDoc = app.activeDocument;
    
    var warshDoc = app.open(warshFile);
    var rubaItem = null;
    var warshItems = warshDoc.pageItems;
    
    for (var i = 0; i < warshItems.length; i++) {
        if (warshItems[i].name.toLowerCase() === "ruba") {
            rubaItem = warshItems[i];
            break;
        }
    }
    
    if (!rubaItem) {
        logMessage("No object named 'ruba' found in template.");
        warshDoc.close(SaveOptions.DONOTSAVECHANGES);
        return;
    }
    
    app.selection = null;
    rubaItem.selected = true;
    app.copy();
    warshDoc.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = mainDoc;
    
    function unlockAllLayers(layers) {
        for (var i = 0; i < layers.length; i++) {
            layers[i].locked = false;
            layers[i].visible = true;
            if (layers[i].layers && layers[i].layers.length) {
                unlockAllLayers(layers[i].layers);
            }
        }
    }
    unlockAllLayers(mainDoc.layers);
    
    var layer = null;
    try {
        layer = mainDoc.layers.getByName("Ornaments");
    } catch (e1) {
        try {
            layer = mainDoc.layers.getByName("Ornament");
        } catch (e2) {}
    }
    if (!layer) {
        if (!silentMode) alert('Layer "Ornament/Ornaments" not found.');
        return;
    }
    
    var layerWasLocked = layer.locked;
    layer.locked = false;
    
    var MIN_W = 12 * MM_TO_PT, MAX_W = 15 * MM_TO_PT;
    var MIN_H = 25 * MM_TO_PT, MAX_H = 26 * MM_TO_PT;
    var NAME_RUBA = "ربع";
    
    function inRange(it) {
        var b = it.visibleBounds || it.geometricBounds;
        if (!b) return false;
        var w = Math.abs(b[2] - b[0]);
        var h = Math.abs(b[1] - b[3]);
        return (w >= MIN_W && w <= MAX_W && h >= MIN_H && h <= MAX_H);
    }
    
    var MARK = "old_ruba";
    var allItems = layer.pageItems;
    var total = 0;
    
    for (var k = 0; k < allItems.length; k++) {
        var it = allItems[k];
        if (!it.editable) continue;
        var n = it.name || "";
        if (n === NAME_RUBA || inRange(it)) {
            it.note = MARK;
            total++;
        }
    }
    
    if (total === 0) {
        logMessage(mainDoc.name + " : No Ruba objects found.");
        layer.locked = layerWasLocked;
        return;
    }
    
    mainDoc.activeLayer = layer;
    
    for (var n = 0; n < total; n++) {
        var targetItem = null;
        var itemsNow = layer.pageItems;
        for (var j = 0; j < itemsNow.length; j++) {
            if (itemsNow[j].note === MARK) {
                targetItem = itemsNow[j];
                break;
            }
        }
        if (!targetItem) break;
        
        app.selection = null;
        targetItem.selected = true;
        app.executeMenuCommand("pasteFront");
        
        if (!mainDoc.selection.length) break;
        
        var newObj = mainDoc.selection[0];
        var ob = targetItem.visibleBounds || targetItem.geometricBounds;
        var nb = newObj.visibleBounds || newObj.geometricBounds;
        var oldCx = (ob[0] + ob[2]) / 2;
        var oldCy = (ob[1] + ob[3]) / 2;
        var newCx = (nb[0] + nb[2]) / 2;
        var newCy = (nb[1] + nb[3]) / 2;
        
        newObj.translate(oldCx - newCx, oldCy - newCy);
        newObj.move(layer, ElementPlacement.PLACEATBEGINNING);
        targetItem.remove();
    }
    
    layer.locked = layerWasLocked;
    logMessage("Replaced " + total + " Ruba objects in " + mainDoc.name);
})();
