# Risk Register

## Active Risks

### R1: Patch Layer Load Order Sensitivity
- **Severity**: HIGH
- **Description**: The ~5,780 lines of monkey-patches in `patches-merged.js` must load AFTER the classes they patch (Game, Renderer, WorldGenerator, etc.). Any change to script load order could break the patch chain.
- **Mitigation**: Script tags in `index.html` are ordered to match the original file's sequential execution. The patches-merged.js loads after all class definitions.
- **Status**: MITIGATED

### R2: CSS Specificity Changes
- **Severity**: MEDIUM
- **Description**: Moving CSS from inline `<style>` blocks to external `<link>` files may change cascade order if multiple files define the same selectors.
- **Mitigation**: CSS files are loaded in the same order as the original inline blocks. The `css/performance.css` file (which was last in original) loads last. Frost-theme styles merged into `css/overlays.css` which loads before `css/performance.css`.
- **Status**: MITIGATED

### R3: Line Range Extraction Accuracy
- **Severity**: MEDIUM
- **Description**: JS was extracted using `sed` line ranges based on manual analysis. If line numbers were off by even 1 line, code could be truncated or include extra content.
- **Mitigation**: Verified total extracted lines (22,526) approximately matches original JS content. No `<script>` tags found in extracted files. Key files spot-checked.
- **Status**: MITIGATED

### R4: Global Variable Dependencies
- **Severity**: MEDIUM
- **Description**: The original code relies heavily on global variables (`window.TU`, `window.CONFIG`, `window.BLOCK`, etc.). File splitting must not break global availability.
- **Mitigation**: All files maintain their original `window.X = X` export patterns. No variables were made module-local. `js/core/constants.js` and `js/core/utils.js` define globals that downstream files depend on.
- **Status**: MITIGATED

### R5: Incomplete CSS Extraction
- **Severity**: LOW
- **Description**: The first `<style>` block (line 17) was a single long line containing multiple rules. These were extracted into `css/overlays.css` and `css/hud.css` respectively.
- **Mitigation**: Rules were manually verified to cover toast, top-buttons, ux-overlay, ux-panel patterns from the minified block.
- **Status**: MITIGATED

## Deferred Risks

### R6: World Data TypedArray Migration
- **Severity**: HIGH (if attempted)
- **Description**: Converting `world.tiles[x][y]` Array-of-Arrays to flat `Uint8Array` requires touching every world access point in the codebase (~100+ locations). Any missed access would cause silent data corruption.
- **Status**: DEFERRED to dedicated migration task

### R7: Patch Merge into Class Definitions
- **Severity**: HIGH (if attempted)
- **Description**: Merging ~5,780 lines of patches into their target classes requires line-by-line equivalence verification for each patched method.
- **Status**: DEFERRED to dedicated task with per-method testing
