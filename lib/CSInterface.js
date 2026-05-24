/*
CSInterface.js - Adobe CEP Interface
For Mushaf-Warsh Extension
*/

function CSInterface() {
    this.hostEnvironment = {
        appName: "ILST",
        appVersion: "24.0",
        appLocale: "en_US"
    };
}

CSInterface.prototype.evalScript = function(script, callback) {
    try {
        if (typeof callback === 'function') {
            // Use the CEP evalScript with callback
            if (window.__adobe_cep__) {
                window.__adobe_cep__.evalScript(script, callback);
            } else {
                // Fallback for testing outside CEP
                console.log('CEP not available, script:', script);
                callback(null);
            }
        } else {
            // Synchronous call
            if (window.__adobe_cep__) {
                return window.__adobe_cep__.evalScript(script);
            }
        }
    } catch(e) {
        console.error("CSInterface evalScript error:", e);
        if (typeof callback === 'function') {
            callback(null);
        }
    }
};

CSInterface.prototype.getHostEnvironment = function() {
    return this.hostEnvironment;
};

CSInterface.prototype.closeExtension = function() {
    try {
        if (window.__adobe_cep__) {
            window.__adobe_cep__.closeExtension();
        }
    } catch(e) {
        console.error("Close extension error:", e);
    }
};

// Event handling
CSInterface.prototype.addEventListener = function(type, listener) {
    if (window.__adobe_cep__) {
        window.__adobe_cep__.addEventListener(type, listener);
    }
};

CSInterface.prototype.removeEventListener = function(type, listener) {
    if (window.__adobe_cep__) {
        window.__adobe_cep__.removeEventListener(type, listener);
    }
};

CSInterface.prototype.dispatchEvent = function(event) {
    if (window.__adobe_cep__) {
        window.__adobe_cep__.dispatchEvent(event);
    }
};

// Storage
CSInterface.prototype.getSystemPath = function(pathType) {
    try {
        if (window.__adobe_cep__) {
            return window.__adobe_cep__.getSystemPath(pathType);
        }
    } catch(e) {}
    return "";
};

// CEP event object
function CSEvent(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope || "GLOBAL";
    this.appId = appId || "";
    this.extensionId = extensionId || "";
    this.data = "";
}

// Make available globally
window.CSInterface = CSInterface;
window.CSEvent = CSEvent;
