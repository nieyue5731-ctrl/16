# Behavior Changes

## Summary

This refactoring targets **100% behavioral equivalence** with the original `index (92).html`. No intentional behavior changes were introduced.

## CSS Changes (Visual)

### Shimmer Animation (css/hud.css)
- **Old**: `left: -100%` to `left: 100%` (triggers layout on every frame)
- **New**: `transform: translateX(-100%)` to `transform: translateX(100%)` (GPU-composited, no layout thrashing)
- **Visual Impact**: Identical appearance, smoother animation on low-end devices
- **Verification**: Compare health/mana bar shimmer effect

### Reduced Motion (css/performance.css)
- **Old**: `animation-duration: 0.01ms !important; transition-duration: 0.01ms !important`
- **New**: Same, plus also disables `backdrop-filter` on panels for truly reduced compositing
- **Visual Impact**: Users with `prefers-reduced-motion` will see opaque panels instead of frosted glass
- **Verification**: Toggle reduced-motion in OS settings, verify panels are readable

## HTML Changes (Structural)

### Script Placement
- **Old**: Some scripts between `</head>` and `<body>` (invalid HTML)
- **New**: All scripts inside `<body>` after HTML elements
- **Behavioral Impact**: None (scripts execute the same way)

### Accessibility Additions
- **New**: `role="progressbar"` on loading screen
- **New**: `aria-live="polite"` on load status text
- **Behavioral Impact**: None for sighted users; improved screen reader experience

## No Intentional JS Behavior Changes

All JavaScript was extracted from the original file without modification. The `js/core/constants.js` and `js/core/utils.js` files are new unified implementations but expose the same APIs with identical behavior to the deduplicated originals.
