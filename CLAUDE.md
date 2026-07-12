# CLAUDE.md

Guidance for working in this repo. This is **our fork** of the `@quartz-community/canvas-page`
plugin for [Quartz v5](https://quartz.jzhao.xyz). Quartz turns Obsidian vaults into static
websites; this plugin adds a page type that renders Obsidian `.canvas` files (the
[JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) format) as interactive, pannable/zoomable pages.

## What this plugin does

A `.canvas` file is JSON describing `nodes` and `edges`. This plugin:

1. Discovers `.canvas` files at build time and emits a **virtual page** for each.
2. Renders nodes (text/file/link/group) and edges (SVG paths) into HTML.
3. Ships a client script that adds pan, zoom, fullscreen, and a collapsible sidebar.

Node types: **text** (Markdown, rendered via micromark+GFM at build time), **file** (transcludes
another vault page's HTML, or shows an image, with popover-hover links), **link** (external URL in
a sandboxed iframe with fallback), **group** (labeled visual container). Edges are Bézier SVG paths
with optional arrowheads, labels, and colors (presets `1`–`6` or `#hex`).

## Repo layout

| Path                                      | Role                                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                            | Public entry — re-exports plugin, component, frame, types                                                                                                                  |
| `src/pageType.ts`                         | `CanvasPage` plugin: matcher + `generate()` that reads `.canvas` files → virtual pages; pre-renders text nodes' Markdown                                                   |
| `src/components/CanvasBody.tsx`           | The main renderer (Preact). `renderNode`, `renderEdge`, and `resolveEmbeddedHtml` (transclusion of other pages, incl. `#heading`, `#^block`, and `.base` `#view` subpaths) |
| `src/components/scripts/canvas.inline.ts` | Client-side pan/zoom/fullscreen/sidebar logic. Runs in a `<script>` tag, **not** as a module                                                                               |
| `src/components/styles/canvas.scss`       | Canvas styles (compiled to a CSS string at build)                                                                                                                          |
| `src/frames/CanvasFrame.tsx`              | Full-viewport page frame (`data-frame="canvas"`) with sidebar + stage layout                                                                                               |
| `src/types.ts`                            | JSON Canvas 1.0 types, `CanvasPageOptions`, `CANVAS_PRESET_COLORS`                                                                                                         |
| `src/util/lang.ts`                        | Re-exports `classNames` from `@quartz-community/utils`                                                                                                                     |
| `test/`                                   | Vitest tests (`canvas-page.test.ts`, `helpers.ts`)                                                                                                                         |
| `dist/`                                   | **Committed** pre-built output (see below) — do not hand-edit                                                                                                              |

User-facing strings are hardcoded in English. There is **no i18n layer** (the unused `src/i18n/`
scaffolding was removed — if a string needs to change, edit it in place).

## Build / bundling

- Bundler is **tsup** (`tsup.config.ts`), producing ESM in `dist/`.
- `.inline.ts` scripts and `.scss` files are handled by a custom esbuild plugin
  (`inlineScriptPlugin` in `tsup.config.ts`): inline TS is transpiled+bundled+minified into a
  browser-ready **string**; SCSS is compiled to a CSS string. Both are imported as text and
  attached via `Component.afterDOMLoaded` / `Component.css`.
- Preact and `@jackyzha0/quartz` (and a few others) are kept **external** as singletons; everything
  else is bundled in (`noExternal: [/.*/]`). This is deliberate — see the git history around
  "bundle dependencies" — so the plugin works without runtime subpath-resolution of the
  `@quartz-community/*` deps.
- `dist/` is committed and CI **fails if it is stale**. After any source change, run
  `npm run build` and commit the regenerated `dist/`.

## Commands

```bash
npm run build       # tsup → dist/
npm run dev         # tsup --watch
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint, zero warnings allowed
npm run format      # prettier --check
npm run check       # typecheck + lint + format + test (what CI runs)
```

CI (`.github/workflows`): runs `npm run check`, `npm run build`, and verifies `dist/` is not stale
and that externals are correct.

## Testing changes in the real site (fast local loop)

The consuming site is the sibling repo `../quartz` (`/Users/fredrik.madsen/git/quartz`). Quartz's
plugin loader (`quartz/plugins/loader/gitLoader.ts`) treats a source that starts with `./`, `../`,
or `/` as a **local path and symlinks it** into `.quartz/plugins/<name>` instead of cloning from
GitHub. We exploit that to skip the push/re-add round-trip entirely.

**One-time setup** (already done): in `../quartz/quartz.config.yaml`, the canvas-page source is set
to a local path so it links to this working directory:

```yaml
# ../quartz/quartz.config.yaml — LOCAL DEV ONLY, do not commit/deploy
- source: ../canvas-page # was: github:FredrikMadness/canvas-page
```

Running the plugin install once creates the symlink
(`.quartz/plugins/canvas-page -> /Users/fredrik.madsen/git/canvas-page`). After that the loop is:

1. Edit `src/` here.
2. `npm run build` (regenerates `dist/`).
3. Rebuild/serve Quartz in `../quartz` — it reads our fresh `dist/` through the symlink. **No push,
   no re-add.**

**Node version:** Quartz requires **Node ≥ 22** (it uses `util.styleText`, added in 20.12/22). This
machine's default `node` is v20.11.1, which fails; use nvm's v22 for any quartz command:
`nvm use 22` (or prefix PATH with `~/.nvm/versions/node/v22.21.1/bin`). Building _this_ plugin works
on either version.

**Before deploying the site**, revert the source line back to `github:FredrikMadness/canvas-page`
(the `../canvas-page` path only resolves on this machine) and make sure any plugin changes are
actually pushed. The old GitHub-based loop (build → push `origin` → `quartz plugin remove/add
canvas-page` → build) is the fallback when the symlink isn't set up.

## Git / remotes

- `origin` → `github.com/FredrikMadness/canvas-page.git` (our fork; the site pulls from here for
  non-local builds).
- `upstream` → `github.com/quartz-community/canvas-page.git` (the community original).
- Default branch is `main`. Start new work on a dedicated branch, not `main`.

## Conventions & gotchas

- **Preact, not React.** JSX is `automatic` with `jsxImportSource: "preact"`. Use `class=`, not
  `className=`, in JSX.
- Inline script (`canvas.inline.ts`) runs in a plain `<script>` tag: no ES module imports survive,
  `export` is stripped by the bundler, and it must be self-contained. It listens for Quartz's
  `nav`/`render` events and registers cleanup via `window.addCleanup`.
- Text-node Markdown is rendered at **build time** in `pageType.ts` (`renderedTexts` map keyed by
  node id), not in the browser.
- Transclusion (`resolveEmbeddedHtml`) reads other pages' `htmlAst` from `allFiles` and rebases
  relative links to the canvas slug via `normalizeHastElement`. It guards against cycles with a
  `visited` set.

```

```
