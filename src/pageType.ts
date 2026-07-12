import type {
  QuartzPageTypePlugin,
  PageMatcher,
  FullSlug,
  VirtualPage,
} from "@quartz-community/types";
import { slugifyFilePath } from "@quartz-community/utils/path";
import { readFileSync } from "fs";
import { join } from "path";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import CanvasBody from "./components/CanvasBody";
import type { CanvasData, CanvasPageOptions } from "./types";

function renderMarkdown(text: string): string {
  const html = micromark(text, {
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
): CanvasData & { renderedTexts: Record<string, string> } {
  const renderedTexts: Record<string, string> = {};

  for (const node of data.nodes ?? []) {
    if (node.type === "text" && node.text) {
      renderedTexts[node.id] = renderMarkdown(node.text);
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
      const processedData = preprocessCanvasData(canvasData);

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
