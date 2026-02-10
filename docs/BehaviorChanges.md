# Behavior Changes

## Overview

This refactoring aims for **100% behavioral equivalence** with the original single-file version. The changes are purely structural (file organization) and do not alter game logic.

## Changes

### 1. HTML Text Content (Cosmetic)

**Old behavior:** Chinese text in loading screen and UI overlays
**New behavior:** Same Chinese text preserved in extracted JS modules; HTML template uses English placeholders for overlay structure which are overwritten by JS at runtime.

**Impact:** None - JS modules contain the original Chinese text and write it to DOM on init.

### 2. Script Loading Order

**Old behavior:** All scripts inline in a single HTML file, executing sequentially
**New behavior:** Scripts loaded via `<script src="...">` tags in the same sequential order

**Impact:** None - load order preserved exactly. All scripts use global scope (`window.*`) just as before.

### 3. CSS Load Timing

**Old behavior:** CSS embedded in `<style>` tags, parsed before body
**New behavior:** CSS loaded via `<link>` tags, parsed before body (same timing)

**Impact:** None - external stylesheets in `<head>` block rendering just like inline styles.

### 4. `TU_Defensive` Script Placement

**Old behavior:** Loaded in `<head>` as inline script
**New behavior:** Loaded in `<head>` as external script (`js/core/defensive.js`)

**Impact:** None - still loads before body parsing. Global error handlers registered at same timing.

## Verification

All changes verified via static analysis:
- No function signatures altered
- No conditional logic changed
- No variable names changed
- No algorithm modifications
- Load order preserved
