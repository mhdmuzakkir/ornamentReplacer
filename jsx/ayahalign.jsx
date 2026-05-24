// Ayah Align Script
// Aligns Ayah numbers with their corresponding ornament markers
(function () {
    if (!app.documents.length) {
        alert("No document open.");
        return;
    }
    var doc = app.activeDocument;
    
    // Ornament layer can be "Ornament" OR "Ornaments"
    var ORNAMENT_LAYER_NAMES = ["Ornament", "Ornaments"];
    var AYAHNO_LAYER_NAME = ["Aya No.", "Ayah No."];
    var ORNAMENT_NAME = "ayah";
    
    // --- find first existing layer from a list of names ---
    function findLayerFromList(names) {
        for (var n = 0; n < names.length; n++) {
            var name = names[n];
            for (var i = 0; i < doc.layers.length; i++) {
                if (doc.layers[i].name === name) return doc.layers[i];
            }
        }
        return null;
    }
    
    var ornamentLayer = findLayerFromList(ORNAMENT_LAYER_NAMES);
    var ayahnoLayer = findLayerFromList(AYAHNO_LAYER_NAME);
    
    if (!ornamentLayer) {
        alert('Layer "Ornament" or "Ornaments" not found.');
        return;
    }
    if (!ayahnoLayer) {
        alert('Layer "' + AYAHNO_LAYER_NAME + '" not found.');
        return;
    }
    
    // --- collect ornaments (named "ayah") in ornament layer ---
    function collectOrnaments(layer) {
        var out = [];
        function walk(container) {
            var items = container.pageItems;
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (it.name === ORNAMENT_NAME) {
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
    
    // --- collect all ayah numbers in Aya No. layer ---
    function collectAyahNumbers(layer) {
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
    
    function getCenter(item) {
        return {
            cx: item.left + item.width / 2,
            cy: item.top - item.height / 2
        };
    }
    
    function distanceSquared(a, b) {
        var dx = a.cx - b.cx;
        var dy = a.cy - b.cy;
        return dx * dx + dy * dy;
    }
    
    var ornaments = collectOrnaments(ornamentLayer);
    var ayahNumbers = collectAyahNumbers(ayahnoLayer);
    
    if (!ornaments.length) {
        alert('No ornament objects named "' + ORNAMENT_NAME + '" found on Ornament/Ornaments layer.');
        return;
    }
    if (!ayahNumbers.length) {
        alert('No ayah number objects found on layer "' + AYAHNO_LAYER_NAME + '".');
        return;
    }
    
    var MM_TO_PT = 2.834645;
    var OFFSET_DOWN_MM = 0.1;
    var offsetDownPt = OFFSET_DOWN_MM * MM_TO_PT;
    
    // --- for each ayah number, find nearest ornament and align ---
    for (var i = 0; i < ayahNumbers.length; i++) {
        var ayahItem = ayahNumbers[i];
        var ayahCenter = getCenter(ayahItem);
        var bestOrn = null;
        var bestDist2 = Number.MAX_VALUE;
        
        for (var j = 0; j < ornaments.length; j++) {
            var orn = ornaments[j];
            var ornCenter = getCenter(orn);
            var d2 = distanceSquared(ayahCenter, ornCenter);
            if (d2 < bestDist2) {
                bestDist2 = d2;
                bestOrn = orn;
            }
        }
        
        if (!bestOrn) continue;
        var targetC = getCenter(bestOrn);
        
        // 1) center ayah number on ornament
        var dx = targetC.cx - ayahCenter.cx;
        var dy = targetC.cy - ayahCenter.cy;
        ayahItem.translate(dx, dy);
        
        // 2) move ayah number 0.1 mm DOWN
        ayahItem.translate(0, -offsetDownPt);
    }
})();
