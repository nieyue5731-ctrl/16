# Risk Register

## Active Risks

### R1: Script Load Order Sensitivity (HIGH)

**Description:** The original monolith relies on scripts executing in exact order with shared global scope. Splitting into external files must preserve this order exactly.

**Mitigation:** 
- Script tags in index.html follow the exact same order as in the original file
- No `defer` or `async` attributes used
- All modules continue to use `window.*` globals

**Status:** Mitigated by design

### R2: CSS Specificity Changes (MEDIUM)

**Description:** Moving CSS to external files could theoretically change specificity if the cascade order changes.

**Mitigation:**
- CSS files loaded in the same order as original `<style>` blocks
- All selectors preserved verbatim
- No specificity modifications made

**Status:** Mitigated

### R3: Missing DOM Elements at Script Load Time (MEDIUM)

**Description:** Some scripts (between `</head>` and `<body>`) in the original file executed before body elements existed. Moving them to body-end could change timing.

**Mitigation:**
- `js/core/defensive.js` remains in `<head>` (matches original)
- EventManager, ParticlePool, etc. that were between head/body are now in body but still before the scripts that depend on them
- These modules don't access DOM on load, only define classes/objects

**Status:** Mitigated

### R4: Large Merged Files (LOW)

**Description:** Some patch files (render-patches.js, weather-patch.js, world-patches.js) are very large because multiple patch blocks were merged into them.

**Mitigation:**
- Content is verbatim from original - no logic changes
- Future phases can further decompose these files
- Merge boundaries marked with comments

**Status:** Accepted for Phase 1; decomposition planned for future work

### R5: Worker Inline String (LOW)

**Description:** TileLogicEngine contains an inline Worker source as a string literal. This is preserved as-is.

**Mitigation:**
- Worker source string unchanged
- Future phases could extract to separate worker file

**Status:** Accepted

## Resolved Risks

| ID | Description | Resolution |
|----|-------------|------------|
| R0 | File rename breaking git history | Original file preserved as `_original_backup.html` |
