# Refactor Journal - Terraria Ultra Aesthetic Edition

## Overview

This document records the full refactoring of the Terraria Ultra single-file HTML game (24,674 lines) into a well-organized multi-file project structure.

## Phase 0: Baseline Snapshot

### Core Module Responsibilities
| Module | Lines | Responsibility |
|--------|-------|---------------|
| TU_Defensive | ~450 | TypeGuards, Assert, SafeMath, BoundaryChecks, InputValidator, WorldAccess |
| ParticlePool | ~55 | Object pool for particle instances (GC reduction) |
| PERF_MONITOR | ~5 | Delegate to PerfMonitor |
| Core Namespace | ~800 | ObjectPool, VecPool, ArrayPool, MemoryManager, EventUtils, PerfMonitor, TextureCache, BatchRenderer |
| GameSettings | ~180 | Settings persistence (localStorage), sanitization, document application |
| Toast | ~20 | Toast notifications |
| FullscreenManager | ~65 | Fullscreen API wrapper |
| AudioManager | ~135 | Web Audio API sound effects (beep, noise) |
| UX/UI Wiring | ~860 | SaveSystem, wireUXUI, applyInfoHintText |
| CONFIG/BLOCK | ~100 | Game constants and block type enum |
| BLOCK_DATA | ~1360 | Block properties, colors, hardness, solid/transparent/light lookup tables |
| WorldGenerator | ~2000 | Procedural world generation (terrain, biomes, caves, ores, structures) |
| ParticleSystem | ~185 | Canvas-based particle effects (mining, placement) |
| DroppedItem/Manager | ~415 | Physics-based dropped item entities with spatial hashing |
| AmbientParticles | ~230 | DOM-based firefly/weather particle effects |
| Player | ~505 | Player entity (movement, collision, sprint, animation, rendering) |
| TouchController | ~190 | Mobile joystick and button input |
| Renderer | ~1170 | World rendering, parallax mountains, sky, lighting, glow, textures |
| CraftingSystem | ~180 | Crafting recipes and UI |
| QualityManager | ~970 | Auto quality adjustment, UIFlush, UIManager |
| Minimap | ~210 | Minimap rendering |
| InventoryUI | ~795 | Inventory drag-and-drop UI |
| InputManager | ~370 | Keyboard/mouse input handling |
| Game | ~3500 | Core game loop, initialization, camera, mining, placement, save/load |
| Patch Layers | ~5780 | Weather, canvas FX, worker client, structures, biomes, sprint, postFX |
| TileLogicEngine | ~1665 | Water physics, wire/switch logic, requestIdleCallback scheduling |
| Bootstrap | ~35 | Window load -> new Game() -> init() |
| Final Patches | ~195 | drawTile skip dark tiles, spreadLight BFS optimization, health check |

### Dependency Graph Summary
- Boot order: CSS -> Defensive -> Utils -> Constants -> BlockData -> Pools -> Settings -> Audio -> UX -> WorldGen -> Renderer -> Entities -> UI -> Input -> Game -> Patches -> TileLogic -> Boot
- Global namespace: `window.TU`, `window.CONFIG`, `window.BLOCK`, `window.BLOCK_DATA`, `window.BLOCK_SOLID`, `window.BLOCK_LIGHT`, `window.BLOCK_COLOR`, `window.BLOCK_HARDNESS`
- Key patch chain endpoints:
  - `renderWorld`: Final version from worker-client patch (falls back to class version)
  - `_spreadLight`: Final version from `final-patches.js` (BFS with Uint32Array visited stamps)
  - `TouchController.getInput`: Class version (zero-alloc reuse pattern)
  - `Game.init`: Wrapped by worker-client patch (adds perf timing + light sync)
  - `Game.loop`: Class version (patches removed as no-ops)

### Behavior Baseline Checklist
- [x] Loading screen displays with progress bar
- [x] World generates with biomes and structures
- [x] Player spawns and can move/jump
- [x] Mining and block placement work
- [x] Lighting system (BFS spread + sunlight)
- [x] Water physics simulation
- [x] UI: Hotbar, health/mana bars, minimap
- [x] Crafting system
- [x] Inventory management
- [x] Save/Load (localStorage + IndexedDB)
- [x] Weather effects (rain, snow, DOM particles)
- [x] Audio feedback (beep, noise)
- [x] Mobile touch controls (joystick, buttons, crosshair)
- [x] Fullscreen toggle
- [x] Settings persistence
- [x] Auto quality adjustment
- [x] Toast notifications
- [x] Parallax mountain backgrounds
- [x] Console: No critical errors at startup

## Phase 1: Safe Cleanup

### Actions Taken
1. **File renamed**: `index (92).html` -> retained as original, new `index.html` created
2. **Dead code identification**: RingBuffer (defined but never used in game loop), BatchRenderer (defined but never called), PERF_MONITOR (thin delegate only)
3. **Utility deduplication**: Single authoritative `clamp`, `lerp`, `safeGet`, `safeGetProp`, `safeJSONParse` in `js/core/utils.js`
4. **VecPool/ArrayPool**: Already used tag-based O(1) double-release prevention (verified in source)
5. **PerfMonitor.getMinFPS**: Uses `Math.max(...validSamples)` - safe because `_maxSamples` is capped at 60 entries
6. **Window.TU initialization**: Consolidated in defensive.js

### Evidence
- `RingBuffer`: Defined at line 2590, `window.RingBuffer = RingBuffer` at line 2612. Search for `RingBuffer` usage: only definition + export. **0 consumers found.**
- `BatchRenderer`: Defined at line 3731, `window.BatchRenderer = BatchRenderer`. Search: only definition. **0 consumers found.**
- `PERF_MONITOR`: Thin delegate to `PerfMonitor`. Only called by `PERF_MONITOR.record()` which delegates. **Kept as compatibility shim.**

## Phase 2: CSS Consolidation

### Actions Taken
1. Extracted all `<style>` blocks (7 total) into 11 organized CSS files
2. Merged 4 `:root` blocks into single `css/variables.css`
3. Unified mobile rules under `html.is-mobile` pattern in `css/responsive.css`
4. Consolidated frost-theme glass morphism into `css/overlays.css`
5. Moved performance CSS (will-change, contain, backdrop-filter toggles) to `css/performance.css`
6. Fixed shimmer animation: `left` property -> `transform: translateX()` for GPU compositing
7. `prefers-reduced-motion` now also disables backdrop-filter on panels

### CSS File Structure
| File | Responsibility |
|------|---------------|
| `css/variables.css` | All CSS custom properties (unified :root) |
| `css/reset.css` | Box model reset, base body/html styles |
| `css/hud.css` | Stat bars, hotbar, slots, mining bar, FPS |
| `css/minimap.css` | Minimap holographic styles |
| `css/loading.css` | Loading screen animations |
| `css/mobile.css` | Joystick, action buttons, crosshair, rotate hint |
| `css/overlays.css` | Toast, top buttons, UX panels, info, time, item hint |
| `css/effects.css` | Ambient particles, weather (rain/snow), canvas filter |
| `css/crafting.css` | Crafting overlay and panel |
| `css/responsive.css` | Media queries and `html.is-mobile` overrides |
| `css/performance.css` | Low-power modes, reduced-motion, containment, no-backdrop fallback |

## Phase 3: Code Organization (Monkey-Patch Aware)

### Actions Taken
1. Extracted all JS from inline `<script>` blocks into 28 organized files
2. Maintained exact load order to preserve patch chain behavior
3. Patch layers kept in `js/systems/patches-merged.js` (preserves monkey-patch application order)
4. Final patches (spreadLight BFS, drawTile skip) in `js/boot/final-patches.js`
5. Bootstrap in `js/boot/boot.js`

### Key Decision: Patch Preservation
The original codebase contains ~5,780 lines of monkey-patches that override class methods after definition. These patches are **load-order dependent** and represent the "final effective version" of many critical methods. Rather than risk behavioral regression by attempting to merge all patches inline (which would require verifying equivalence for every method), we:
1. Preserved the patch application order exactly
2. Documented which methods are patched and their final versions
3. Future work: merge patches into class definitions with per-method equivalence testing

## Phases 4-8: Architecture Notes

### Phase 4 (World Data Structure): Foundation Laid
- The TileLogicEngine and worker code already use flat TypedArray internally (`Uint8Array` for tiles/water/marks)
- The main Game class still uses Array-of-Arrays for `world.tiles[x][y]`
- Migration path documented: introduce `WorldData` class with flat `Uint8Array` backing + `get(x,y)`/`set(x,y,v)` API
- Save format compatibility: need migration layer for old Array-of-Arrays saves

### Phase 5 (Render Pipeline): Optimizations Present
- Parallax mountains already cached per-chunk with Map-based LRU
- Texture cache uses O(1) Map LRU (delete+re-insert pattern)
- drawTile skip for near-black tiles (light <= 0.05) in final-patches.js

### Phase 6 (Architecture): Structure Established
- Game class remains monolithic but extracted to dedicated file
- EventBus pattern available via `window.TU.EventManager`
- Sub-system files established for future decomposition

### Phase 7 (HTML Validity): Improvements Made
- Scripts moved inside `<body>` (no more head/body gap)
- `role="progressbar"` added to loading screen
- `aria-live="polite"` on load status
- `role="dialog"` preserved on inventory panel

### Phase 8 (Tooling): Baseline Established
- File structure ready for ESLint/Stylelint/Prettier integration
- No build step required (plain script loading)
- Future: Vite/esbuild bundling for production optimization
