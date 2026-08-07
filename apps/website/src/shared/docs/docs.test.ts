import { existsSync } from "node:fs";
import { join } from "node:path";
import { LIVE_ACTIVITY_STYLES } from "@hark/contracts";
import { describe, expect, it } from "vitest";
import { DOC_CONTENT } from "./content";
import { parseInline } from "./inline";
import { docsMarkdown, llmsTxt } from "./markdown";
import { DOC_NAV } from "./nav";

describe("docs content", () => {
  it("covers every nav entry, in nav order", () => {
    const navIds = DOC_NAV.map((section) => ({
      id: section.id,
      items: section.items.map((item) => item.id),
    }));
    const contentIds = DOC_CONTENT.map((section) => ({
      id: section.id,
      items: section.subsections.map((subsection) => subsection.id),
    }));
    expect(contentIds).toEqual(navIds);
  });

  it("has no empty subsection", () => {
    for (const section of DOC_CONTENT) {
      for (const subsection of section.subsections) {
        expect(subsection.blocks.length, subsection.id).toBeGreaterThan(0);
      }
    }
  });

  it("keeps blocks distinguishable within a subsection", () => {
    // blocks.tsx keys React children by block content, so duplicates inside one
    // subsection would collide.
    for (const section of DOC_CONTENT) {
      for (const subsection of section.subsections) {
        const fingerprints = subsection.blocks.map((block) => JSON.stringify(block));
        expect(new Set(fingerprints).size, subsection.id).toBe(fingerprints.length);
      }
    }
  });

  it("only uses inline markdown the renderer understands", () => {
    const strings = DOC_CONTENT.flatMap((section) => [
      section.lead,
      ...section.subsections.flatMap((subsection) =>
        subsection.blocks.flatMap((block) => {
          switch (block.kind) {
            case "p":
            case "note":
              return [block.text];
            case "steps":
            case "bullets":
              return block.items;
            case "table":
              return block.rows.flatMap((row) => Object.values(row));
            case "stylePreviews":
              return block.styles.map((style) => style.description);
            default:
              return [];
          }
        }),
      ),
    ]);

    for (const text of strings) {
      // Unbalanced backticks would render as literal ticks in HTML.
      expect((text.match(/`/g) ?? []).length % 2, text).toBe(0);
      // Round-tripping the parsed nodes must reproduce the visible text.
      const visible = parseInline(text)
        .map((node) => node.text)
        .join("");
      expect(visible.replace(/\s+/g, " ")).toBe(
        text
          .replaceAll("`", "")
          .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
          .replace(/\s+/g, " "),
      );
    }
  });

  it("has a native screenshot for every Live Activity preview", () => {
    const styles = DOC_CONTENT.flatMap((section) =>
      section.subsections.flatMap((subsection) =>
        subsection.blocks.flatMap((block) =>
          block.kind === "stylePreviews" ? block.styles.map((style) => style.name) : [],
        ),
      ),
    );
    expect(styles).toEqual([...LIVE_ACTIVITY_STYLES]);
    for (const style of DOC_CONTENT.flatMap((section) =>
      section.subsections.flatMap((subsection) =>
        subsection.blocks.flatMap((block) => (block.kind === "stylePreviews" ? block.styles : [])),
      ),
    )) {
      if (style.nativeScreenshot === false) continue;
      expect(
        existsSync(join(process.cwd(), "public", "live-activities", `${style.name}.webp`)),
        style.name,
      ).toBe(true);
    }
  });
});

describe("parseInline", () => {
  it("splits code, links, and text", () => {
    expect(parseInline("Only `body` is required.")).toEqual([
      { kind: "text", text: "Only " },
      { kind: "code", text: "body" },
      { kind: "text", text: " is required." },
    ]);
    expect(parseInline("Sign in at [hark.ryan.ceo](https://hark.ryan.ceo).")).toEqual([
      { kind: "text", text: "Sign in at " },
      { kind: "link", text: "hark.ryan.ceo", href: "https://hark.ryan.ceo" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves plain prose untouched", () => {
    expect(parseInline("A plain sentence.")).toEqual([{ kind: "text", text: "A plain sentence." }]);
  });
});

describe("docsMarkdown", () => {
  const markdown = docsMarkdown();

  it("emits a heading for every nav entry", () => {
    for (const section of DOC_NAV) {
      expect(markdown).toContain(`## ${section.label}`);
      for (const item of section.items) expect(markdown).toContain(`### ${item.label}`);
    }
  });

  it("emits fenced code with a language and pipe tables", () => {
    expect(markdown).toContain("```bash\ncurl -X POST https://hark.ryan.ceo/hooks/whk_your_token");
    expect(markdown).toContain('```json\n{\n  "ok": true,');
    expect(markdown).toContain("| Field | Type | Description |");
    expect(markdown).toContain("| Route | Purpose |");
    expect(markdown).toContain("| Limit | Free | Pro |");
  });

  it("keeps table cells on one line", () => {
    for (const line of markdown.split("\n")) {
      if (!line.startsWith("|")) continue;
      expect(line.endsWith("|"), line).toBe(true);
    }
  });

  it("preserves multiline shell examples", () => {
    expect(markdown).toContain(`harkctl notify ask "Send the prepared release email?" \\
  --approval --live-activity --style signal \\
  --primary-label Send --secondary-label Deny \\
  --wait --timeout 15m`);
  });

  it("documents app deep links and Shortcuts tap destinations", () => {
    expect(markdown).toContain("### Deep links and Shortcuts");
    expect(markdown).toContain('"url": "your-app://incidents/INC-42"');
    expect(markdown).toContain(
      "shortcuts://run-shortcut?name=Deployment%20Follow-up&input=text&text=production%20deployed",
    );
    expect(markdown).toContain("Hark cannot run a shortcut merely because a notification arrived");
  });

  it("flags Hark Pro sections", () => {
    expect(markdown).toContain("**Hark Pro**");
  });
});

describe("llmsTxt", () => {
  it("describes Hark and links its canonical machine-readable resources", () => {
    const text = llmsTxt();
    expect(text.startsWith("# Hark")).toBe(true);
    expect(text).toContain("https://hark.ryan.ceo/docs");
    expect(text).toContain("https://hark.ryan.ceo/docs.md");
    expect(text).toContain("https://hark.ryan.ceo/agents.md");
    expect(text).toContain("https://hark.ryan.ceo/docs#cli-permissions");
    expect(text).toContain("https://hark.ryan.ceo/pricing");
    expect(text).toContain("https://skills.sh/r44vc0rp/hark/hark");
    expect(text).toContain("https://www.npmjs.com/package/harkctl");
  });
});
