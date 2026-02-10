/**
 * @file utils.js
 * @description Unified utility functions. Deduplicated from multiple copies
 * of clamp/lerp/safeGet that existed in the original codebase.
 * 
 * Phase 1 cleanup: Single authoritative implementation of each utility.
 */
'use strict';

// ═══════════════════ Core Utils (single authoritative copy) ═══════════════════
const Utils = {
    clamp(v, min, max) {
        return v < min ? min : v > max ? max : v;
    },
    lerp(a, b, t) {
        return a + (b - a) * t;
    },
    rand(min, max) {
        return Math.random() * (max - min) + min;
    },
    randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
};
window.Utils = Utils;

// Global convenience (backward compat - single versions)
window.clamp = Utils.clamp;
window.lerp = Utils.lerp;

window.safeGet = function(arr, index, defaultValue) {
    if (!arr || index < 0 || index >= arr.length) return defaultValue;
    return arr[index];
};

window.safeGetProp = function(obj, prop, defaultValue) {
    if (!obj || typeof obj !== 'object') return defaultValue;
    return obj[prop] !== undefined ? obj[prop] : defaultValue;
};

window.safeJSONParse = function(str, defaultValue) {
    try { return JSON.parse(str); } catch (e) { return defaultValue; }
};

// ═══════════════════ DOM Utilities ═══════════════════
const UI_IDS = Object.freeze({
    game: 'game',
    loading: 'loading',
    loadProgress: 'load-progress',
    loadStatus: 'load-status',
    hotbar: 'hotbar',
    healthFill: 'health-fill',
    manaFill: 'mana-fill',
    healthValue: 'health-value',
    manaValue: 'mana-value',
    fps: 'fps',
    timeDisplay: 'time-display',
    minimap: 'minimap',
    mobileControls: 'mobile-controls',
    info: 'info'
});

const DOM = {
    _cache: new Map(),
    byId(id) {
        let el = this._cache.get(id);
        if (el && el.isConnected) return el;
        el = document.getElementById(id);
        if (el) this._cache.set(id, el);
        return el;
    },
    clearCache() {
        this._cache.clear();
    }
};

window.UI_IDS = UI_IDS;
window.DOM = DOM;

// ═══════════════════ Event Utilities ═══════════════════
const EventUtils = {
    throttle(fn, delay) {
        let last = 0;
        let timer = null;
        return function (...args) {
            const now = Date.now();
            if (now - last >= delay) {
                last = now;
                fn.apply(this, args);
            } else if (!timer) {
                timer = setTimeout(() => {
                    timer = null;
                    last = Date.now();
                    fn.apply(this, args);
                }, delay - (now - last));
            }
        };
    },
    debounce(fn, delay) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },
    rafThrottle(fn) {
        if (typeof fn !== 'function') return () => {};
        let scheduled = false;
        let lastArgs = null;
        return function (...args) {
            lastArgs = args;
            if (!scheduled) {
                scheduled = true;
                requestAnimationFrame(() => {
                    scheduled = false;
                    try { fn.apply(this, lastArgs); } catch (e) { console.error('[EventUtils.rafThrottle]', e); }
                    lastArgs = null;
                });
            }
        };
    }
};
window.EventUtils = EventUtils;
