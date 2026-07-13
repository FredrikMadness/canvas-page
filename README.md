# @quartz-community/canvas-page

A page type plugin that renders [JSON Canvas](https://jsoncanvas.org) (`.canvas`) files as interactive, pannable and zoomable canvas pages. Supports the full JSON Canvas 1.0 spec, including text nodes with Markdown rendering, file nodes that link to other pages, link nodes for external URLs, group nodes for visual organization, and edges between nodes rendered as SVG paths with optional labels, arrow markers, and colors.

> **This is a fork** of [`quartz-community/canvas-page`](https://github.com/quartz-community/canvas-page) with a set of interaction and rendering changes that bring canvas pages closer to how they behave in Obsidian. See [What this fork changes](#what-this-fork-changes).

## Installation

```bash
npx quartz plugin add github:FredrikMadness/canvas-page
```

## Usage

```yaml title="quartz.config.yaml"
plugins:
  - source: github:FredrikMadness/canvas-page
    enabled: true
```

For advanced use cases, you can override in TypeScript:

```ts title="quartz.ts (override)"
import * as ExternalPlugin from "./.quartz/plugins";

ExternalPlugin.CanvasPage({
  enableInteraction: true,
  defaultFullscreen: false,
});
```

## Features

- **Text nodes**: Render Markdown content including headings, bold, italic, strikethrough, lists, links, and code blocks via GFM support, plus embedded images (`![[image]]`) and internal links (`[[note]]`) via Obsidian syntax.
- **File nodes**: Link to or transclude other pages in your vault, with popover previews on hover. Standalone image files render as images.
- **Link nodes**: Reference external URLs.
- **Group nodes**: Visual grouping containers with optional labels and background colors.
- **Edges**: Curved SVG connections that leave and enter nodes from the correct side, with optional labels, arrow markers, and colors. Supports all four sides and both preset colors (1–6) and custom hex colors.
- **Pan & zoom**: Trackpad two-finger swipe to pan and pinch to zoom; mouse wheel zooms at the cursor.
- **Sidebar**: A collapsible sidebar (shown by default) alongside the canvas stage.
- **Fullscreen mode**: Configurable default via `defaultFullscreen`; embedded canvases also get a fullscreen toggle button.
- **Preset colors**: Six preset colors (red, orange, yellow, green, cyan, purple) plus custom hex colors for nodes and edges.

## What this fork changes

Compared to upstream [`quartz-community/canvas-page`](https://github.com/quartz-community/canvas-page):

- **Obsidian-like pan & zoom.** A trackpad two-finger swipe pans and a pinch zooms; a mouse wheel zooms at the cursor. A wheel or swipe over a card scrolls that card's content and no longer "escapes" to pan or zoom the whole canvas once the card reaches its scroll edge.
- **Curved edges.** Edges route as side-aware cubic Béziers — the curve leaves and enters each node perpendicular to its connection side (so the arrowhead points the right way) with a pronounced, Obsidian-like sweep — instead of the original side-agnostic curve that could arrive from the wrong direction. Edge labels sit on a text halo that fits any label length or script, replacing a background box sized by character count.
- **Embedded images in text nodes.** Obsidian embeds (`![[image.png]]`, `![[image.png|alt]]`) inside text nodes are rendered, with the target resolved anywhere in the vault (exact path, then the canvas's own folder, then a matching filename). Upstream only rendered standalone image file nodes.
- **Obsidian internal links.** `[[Note]]`, `[[Note|alias]]`, and `[[Note#heading]]` links inside text nodes render as Quartz internal links — resolved across the vault, styled like other internal links, and with hover popovers. Upstream left them as literal text.
- **Sidebar shown by default, and a working `defaultFullscreen`.** Upstream documented `defaultFullscreen` but never implemented it. Here `false` (the default) shows the sidebar; `true` starts fullscreen with the canvas filling the viewport.
- **Cleaner image file nodes.** A standalone image fills its node and is clipped to the rounded border, fixing an offset that left a strip of node background above the image.
- **The view keeps up with layout changes.** Resizing the window, toggling the sidebar, or entering fullscreen re-fits an untouched view to the new space, while a view you've panned or zoomed stays visually anchored in place. `initialZoom` works (upstream read it and then immediately overwrote it) and now acts as a multiplier on the fitted view.
- **No phantom scrollbars.** Text-node Markdown no longer overflows its card from stray inter-block newlines, so cards don't show scrollbars they can't scroll; a genuinely scrollable card gets a thin scrollbar that looks the same on macOS, Windows, and Linux — and only shows while the pointer is over the card, like Obsidian.
- **Obsidian-like headings and group labels.** Headings inside cards use a compact, graduated scale (with `h5`/`h6` as small-caps) instead of Quartz's full-page heading sizes, and a group's label renders as a filled, color-matched pill above its box — matching how canvases look in Obsidian.
- **No i18n layer.** User-facing strings are hardcoded in English (the unused i18n scaffolding was removed).

## Configuration

| Option              | Type      | Default | Description                                                                |
| ------------------- | --------- | ------- | -------------------------------------------------------------------------- |
| `enableInteraction` | `boolean` | `true`  | Whether to enable pan and zoom interaction on the canvas.                  |
| `initialZoom`       | `number`  | `1`     | Zoom multiplier applied on top of the fitted view (`1` = fit to view).     |
| `minZoom`           | `number`  | `0.1`   | The minimum zoom level allowed when zooming out.                           |
| `maxZoom`           | `number`  | `5`     | The maximum zoom level allowed when zooming in.                            |
| `defaultFullscreen` | `boolean` | `false` | Start canvas pages fullscreen — sidebar hidden, canvas fills the viewport. |

## Documentation

See the [Quartz documentation](https://quartz.jzhao.xyz/plugins/CanvasPage) for more information.

## License

MIT
