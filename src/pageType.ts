import type {
  QuartzPageTypePlugin,
  PageMatcher,
  FullSlug,
  FilePath,
  VirtualPage,
} from "@quartz-community/types";
import { slugifyFilePath, resolveRelative } from "@quartz-community/utils/path";
import { readFileSync } from "fs";
import { join } from "path";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import GithubSlugger from "github-slugger";
import CanvasBody from "./components/CanvasBody";
import type { CanvasData, CanvasPageOptions } from "./types";

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;

/**
 * Resolve an Obsidian embed target to a vault file path, mirroring Obsidian's
 * lookup: an exact/suffix path match wins, otherwise a bare filename resolves to
 * the canvas file's own folder first, then to a matching basename anywhere in the
 * vault (so a dedicated image folder just works). Returns undefined if unresolved.
 */
function findVaultFile(
  target: string,
  canvasPath: string,
  allFiles: readonly FilePath[],
): FilePath | undefined {
  const norm = target.replace(/^\.?\//, "");

  if (allFiles.includes(norm as FilePath)) return norm as FilePath;
  if (norm.includes("/")) {
    const suffix = allFiles.find((f) => f === norm || f.endsWith(`/${norm}`));
    if (suffix) return suffix;
  }

  const dir = canvasPath.split("/").slice(0, -1).join("/");
  const sameFolder = (dir ? `${dir}/${norm}` : norm) as FilePath;
  if (allFiles.includes(sameFolder)) return sameFolder;

  const base = norm.split("/").pop()?.toLowerCase();
  return allFiles.find((f) => f.toLowerCase().split("/").pop() === base);
}

/**
 * Convert Obsidian image embeds (`![[image.png]]`, `![[image.png|alt]]`) into
 * standard Markdown images with a URL resolved relative to the canvas page, so
 * micromark can render them (it has no `![[...]]` syntax, so otherwise the embed
 * survives as literal text). Non-image or unresolved embeds are left untouched.
 */
function resolveWikiImageEmbeds(
  text: string,
  canvasPath: string,
  canvasSlug: FullSlug,
  allFiles: readonly FilePath[],
): string {
  return text.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (whole, rawTarget, alias) => {
    const target = (rawTarget as string).trim();
    if (!IMAGE_EXT.test(target)) return whole;

    const vaultPath = findVaultFile(target, canvasPath, allFiles);
    if (!vaultPath) return whole;

    const url = resolveRelative(canvasSlug, slugifyFilePath(vaultPath));
    const altText = ((alias as string | undefined) ?? target).trim().replace(/[[\]]/g, "");
    return `![${altText}](${url})`;
  });
}

/**
 * Resolve an Obsidian link target (a note name, usually without extension) to a
 * vault Markdown file: exact path, suffix, the canvas's own folder, then a
 * matching basename anywhere (preferring `.md`). Returns undefined if unresolved.
 */
function findVaultPage(
  target: string,
  canvasPath: string,
  allFiles: readonly FilePath[],
): FilePath | undefined {
  const stripExt = (f: string) => f.replace(/\.md$/i, "");
  const norm = stripExt(target.replace(/^\.?\//, ""));
  const lower = norm.toLowerCase();

  const exact = allFiles.find((f) => stripExt(f).toLowerCase() === lower);
  if (exact) return exact;
  if (norm.includes("/")) {
    const suffix = allFiles.find((f) => stripExt(f).toLowerCase().endsWith(`/${lower}`));
    if (suffix) return suffix;
  }

  const dir = canvasPath.split("/").slice(0, -1).join("/");
  if (dir) {
    const sameFolder = `${dir}/${norm}`.toLowerCase();
    const hit = allFiles.find((f) => stripExt(f).toLowerCase() === sameFolder);
    if (hit) return hit;
  }

  const wantBase = lower.split("/").pop();
  const matches = allFiles.filter(
    (f) => stripExt(f.split("/").pop() ?? "").toLowerCase() === wantBase,
  );
  return matches.find((f) => /\.md$/i.test(f)) ?? matches[0];
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Convert Obsidian internal links (`[[Note]]`, `[[Note|alias]]`, `[[Note#heading]]`)
 * into Quartz internal anchors resolved against the vault, so they render and get
 * hover popovers like file-node links. micromark has no `[[...]]` syntax, so
 * otherwise they survive as literal text. Run *after* image embeds so `![[...]]`
 * is already handled; unresolved links are left untouched.
 */
function resolveWikiLinks(
  text: string,
  canvasPath: string,
  canvasSlug: FullSlug,
  allFiles: readonly FilePath[],
): string {
  return text.replace(
    /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]*))?\]\]/g,
    (whole, rawTarget, rawSub, rawAlias) => {
      const target = (rawTarget as string).trim();
      const page = findVaultPage(target, canvasPath, allFiles);
      if (!page) return whole;

      const slug = slugifyFilePath(page);
      let href = resolveRelative(canvasSlug, slug) as string;
      const sub = (rawSub as string | undefined)?.trim();
      if (sub) href += sub.startsWith("^") ? `#${sub}` : `#${new GithubSlugger().slug(sub)}`;

      const label = (
        ((rawAlias as string | undefined)?.trim() ||
          (sub ? `${target} › ${sub}` : target)) as string
      ).trim();
      return `<a href="${escapeAttr(href)}" class="internal" data-slug="${escapeAttr(slug)}">${escapeText(label)}</a>`;
    },
  );
}

function renderMarkdown(
  text: string,
  canvasPath: string,
  canvasSlug: FullSlug,
  allFiles: readonly FilePath[],
): string {
  const withEmbeds = resolveWikiImageEmbeds(text, canvasPath, canvasSlug, allFiles);
  const withLinks = resolveWikiLinks(withEmbeds, canvasPath, canvasSlug, allFiles);
  const html = micromark(withLinks, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
  // micromark separates block elements with newlines. Text nodes render with
  // `white-space: pre-wrap` (to preserve intentional line breaks), which turns
  // those inter-block newlines into phantom empty lines — inflating the node's
  // height and causing spurious scrollbars. Strip newlines that sit *between*
  // tags; newlines inside text (soft breaks) and code (entity-escaped) are kept.
  return html.replace(/>\n+</g, "><").trim();
}

function preprocessCanvasData(
  data: CanvasData,
  canvasPath: string,
  canvasSlug: FullSlug,
  allFiles: readonly FilePath[],
): CanvasData & { renderedTexts: Record<string, string> } {
  const renderedTexts: Record<string, string> = {};

  for (const node of data.nodes ?? []) {
    if (node.type === "text" && node.text) {
      renderedTexts[node.id] = renderMarkdown(node.text, canvasPath, canvasSlug, allFiles);
    }
  }

  return { ...data, renderedTexts };
}

const canvasMatcher: PageMatcher = ({ fileData }) => {
  return "canvasData" in fileData;
};

export const CanvasPage: QuartzPageTypePlugin<CanvasPageOptions> = (opts) => ({
  name: "CanvasPage",
  priority: 20,
  fileExtensions: [".canvas"],
  match: canvasMatcher,
  generate({ ctx }) {
    const canvasFiles = ctx.allFiles.filter((fp) => fp.endsWith(".canvas"));

    const virtualPages: VirtualPage[] = [];

    for (const filePath of canvasFiles) {
      const fullPath = join(ctx.argv.directory, filePath);
      let canvasData: CanvasData;

      try {
        const raw = readFileSync(fullPath, "utf-8");
        canvasData = JSON.parse(raw) as CanvasData;
      } catch {
        continue;
      }

      const baseName =
        filePath
          .replace(/\.canvas$/, "")
          .split("/")
          .pop() ?? "Canvas";
      const slug = slugifyFilePath(filePath) as FullSlug;
      const processedData = preprocessCanvasData(canvasData, filePath, slug, ctx.allFiles);

      virtualPages.push({
        slug,
        title: baseName,
        data: {
          frontmatter: { title: baseName, tags: [] },
          canvasData: processedData,
          canvasOptions: opts,
        },
      });
    }

    return virtualPages;
  },
  layout: "canvas",
  frame: "canvas",
  body: CanvasBody,
});
