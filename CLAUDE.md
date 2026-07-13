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

The consuming site is the sibling repo `../quartz` (`/Users/fredrik.madsen/git/quartz`). Its
committed `quartz.config.yaml` uses `source: github:FredrikMadness/canvas-page` — this **must stay
GitHub** so the Cloudflare CD pipeline (`npx quartz plugin install --from-config`, on a fresh
checkout with no symlink) can clone the latest published plugin. A committed `../canvas-page` path
would break CI, since that path only exists on this machine.

Local dev still uses this working directory directly, via a **symlink** that the installer keeps:
`.quartz/plugins/canvas-page -> /Users/fredrik.madsen/git/canvas-page`. The plugin installer skips a
plugin whose dir already exists (`quartz/cli/plugin-git-handlers.js` — "directory already exists"),
so with the symlink present it never re-clones over it. `.quartz/plugins/` is gitignored, so the
symlink never leaks into CI. Net effect: **local = symlink, CI = GitHub clone**, from the same
committed config.

Once the symlink exists, the loop is:

1. Edit `src/` here.
2. `npm run build` (regenerates `dist/`).
3. Rebuild/serve Quartz in `../quartz` — it reads our fresh `dist/` through the symlink. **No push,
   no re-add.**

**Re-creating the symlink** (after a clean checkout / `.quartz/plugins` wipe removes it):

```bash
ln -sfn /Users/fredrik.madsen/git/canvas-page ../quartz/.quartz/plugins/canvas-page
```

(Or temporarily point the config at `../canvas-page`, run the plugin install once to create the
link, then set it back to `github:` before committing.)

**Node version:** Quartz requires **Node ≥ 22** (it uses `util.styleText`, added in 20.12/22). This
machine's default `node` is v20.11.1, which fails; use nvm's v22 for any quartz command:
`nvm use 22` (or prefix PATH with `~/.nvm/versions/node/v22.21.1/bin`). Building _this_ plugin works
on either version.

**Deploying:** just push this repo's `main` — CI clones the latest `main`, so make sure plugin
changes are pushed (and `dist/` committed) before the site rebuilds.

## Git / remotes

- `origin` → `github.com/FredrikMadness/canvas-page.git` (our fork; the site pulls from here for
  non-local builds).
- `upstream` → `github.com/quartz-community/canvas-page.git` (the community original).
- Default branch is `main`. This is a solo repo — working directly on `main` is fine (this
  overrides the global "always branch first" preference).
- **No pre-push review.** This repo does not use the pre-push-review workflow — commit and push
  directly, don't run `/pre-push-review` here.

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
- **Keep the README in sync.** When you add or change a user-facing feature, update `README.md` in
  the same change — the _What this fork changes_ list (this is our fork's headline diff from
  upstream), plus the _Features_ list and _Configuration_ table where relevant.
