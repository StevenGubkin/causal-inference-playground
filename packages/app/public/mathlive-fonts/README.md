Math fonts (KaTeX `.woff2` files) copied verbatim from `mathlive`'s own
`fonts/` directory (see `mathlive` in `package.json`), so `MathField.tsx` can
point `MathfieldElement.fontsDirectory` at a stable app-served path instead
of MathLive's default (relative to wherever Vite's dev-dependency
pre-bundling relocates the module, which 404s). Regenerate by re-copying
from `node_modules/mathlive/fonts/` after any `mathlive` version bump.
