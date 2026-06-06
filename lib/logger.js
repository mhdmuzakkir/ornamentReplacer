/**
 * Mushaf Logger - Unified logging module for all CEP extensions.
 * Can be toggled off in production to reduce noise.
 *
 * Usage:
 *   Logger.log('debug', 'Scanning folder:', path);
 *   Logger.warn('Folder not found:', path);
 *   Logger.error('Export failed:', err);
 *
 *   // Toggle levels
 *   Logger.setLevel('warn');   // only warn + error
 *   Logger.disable();          // silence everything
 *   Logger.enable();           // restore default
 */

(function() {
    'use strict';

    var LEVELS = { debug: 0, log: 1, info: 2, warn: 3, error: 4 };
    var currentLevel = 0; // debug = most verbose
    var enabled = true;

    function shouldLog(level) {
        if (!enabled) return false;
        return (LEVELS[level] || 0) >= currentLevel;
    }

    function format(args) {
        var parts = ['[Mushaf]', new Date().toLocaleTimeString()];
        for (var i = 0; i < args.length; i++) {
            parts.push(args[i]);
        }
        return parts;
    }

    window.Logger = {
        setLevel: function(level) {
            if (LEVELS.hasOwnProperty(level)) {
                currentLevel = LEVELS[level];
            }
        },
        getLevel: function() {
            for (var k in LEVELS) {
                if (LEVELS[k] === currentLevel) return k;
            }
            return 'debug';
        },
        disable: function() {
            enabled = false;
        },
        enable: function() {
            enabled = true;
        },
        isEnabled: function() {
            return enabled;
        },
        debug: function() {
            if (shouldLog('debug')) console.debug.apply(console, format(arguments));
        },
        log: function() {
            if (shouldLog('log')) console.log.apply(console, format(arguments));
        },
        info: function() {
            if (shouldLog('info')) console.info.apply(console, format(arguments));
        },
        warn: function() {
            if (shouldLog('warn')) console.warn.apply(console, format(arguments));
        },
        error: function() {
            if (shouldLog('error')) console.error.apply(console, format(arguments));
        }
    };
})();
