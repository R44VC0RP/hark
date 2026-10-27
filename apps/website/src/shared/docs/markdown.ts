/**
 * Serialises the docs content model to markdown for `/docs.md` and `/agents.md`,
 * and writes the `/llms.txt` pointer file.
 *
 * There is no prose in this module: every sentence comes from `./content.ts` and
 * every heading from `./nav.ts`, which is what keeps the markdown and the HTML
 * page from drifting.
 */
import {
  DOC_CONTENT,
  DOCS_MARKDOWN_URL,
  DOCS_TITLE,
  DOCS_URL,
  type DocBlock,
  type DocTableBlock,
} from "./content";
import { docLabel } from "./nav";

const PRO_LINE = "**Hark Pro** — requires a paid plan.";

/** Pipe tables cannot contain a raw `|` or a newline. */
function cell(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replaceAll("|", "\\|");
}

function table(headers: string[], rows: string[][]): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function tableBlock(block: DocTableBlock): string {
  switch (block.variant) {
    case "field":
      return table(
        ["Field", "Type", "Description"],
        block.rows.map((row) => [`\`${row.name}\``, row.type, row.detail]),
      );
    case "flag":
      return table(
        ["Flag", "Type", "Description"],
        block.rows.map((row) => [`\`${row.name}\``, row.type, row.detail]),
      );
    case "route":
      return table(
        ["Route", "Purpose"],
        block.rows.map((row) => [`\`${row.method} ${row.path}\``, row.detail]),
      );
    case "plan":
      return table(
        ["Limit", "Free", "Pro"],
        block.rows.map((row) => [row.limit, row.free, row.pro]),
      );
  }
}

function blockToMarkdown(block: DocBlock): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "note":
      return `> ${block.text}`;
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "bullets":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "code":
      return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    case "copy":
      return `${block.label}:\n\n\`\`\`text\n${block.value}\n\`\`\``;
    case "stylePreviews":
      return block.styles.map((style) => `- \`${style.name}\` — ${style.description}`).join("\n");
    case "table":
      return tableBlock(block);
  }
}

/** The full documentation as markdown, mirroring the `/docs` page exactly. */
export function docsMarkdown(): string {
  const parts: string[] = [
    `# Hark — ${DOCS_TITLE}`,
    `Hark documentation. HTML version: ${DOCS_URL}`,
  ];

  for (const section of DOC_CONTENT) {
    parts.push(`## ${docLabel(section.id)}`);
    if (section.pro) parts.push(PRO_LINE);
    parts.push(section.lead);

    for (const subsection of section.subsections) {
      parts.push(`### ${docLabel(subsection.id)}`);
      if (subsection.pro) parts.push(PRO_LINE);
      for (const block of subsection.blocks) parts.push(blockToMarkdown(block));
    }
  }

  return `${parts.join("\n\n")}\n`;
}

/** The /llms.txt pointer file: what Hark is, and where the docs live. */
export function llmsTxt(): string {
  return `# Hark

> Hark turns an HTTP request into a source-branded iPhone notification. Create a service in the
> dashboard, then POST JSON to its secret webhook URL. A Notification API sends one-shot pushes and
> optional approval prompts; an Activity API drives a stateful Live Activity on the Lock Screen and
> in the Dynamic Island.

## Docs

- [Documentation](${DOCS_URL}): ${DOCS_TITLE} — quickstart, Notification API, Activity API, CLI, and coding-agent permissions.
- [Documentation as markdown](${DOCS_MARKDOWN_URL}): the same content as plain markdown.
- [Agent documentation](https://hark.fyi/agents.md): agent-oriented alias of the complete Markdown docs.
- [Coding-agent permission setup](https://hark.fyi/docs#cli-permissions): Claude Code, Codex, OpenCode V1, and OpenCode V2.
- [Agent API OpenAPI document](https://hark.fyi/api/agent/openapi.json): every token-authenticated route with its scopes and schemas.

## Product

- [Home](https://hark.fyi/): product overview and webhook example.
- [Pricing](https://hark.fyi/pricing): current Free and Pro capabilities.
- [Hark for iPhone](https://apps.apple.com/us/app/hark-developer-notifications/id6794121509): required iOS app.
- [Source](https://github.com/R44VC0RP/hark): Hark website, iOS app, CLI, and agent skill.

## Agent tools

- [Hark agent skill](https://skills.sh/r44vc0rp/hark/hark): install Hark for compatible coding agents.
- [harkctl](https://www.npmjs.com/package/harkctl): CLI for notifications, approvals, replies, Live Activities, and webhook services.

## Notes

- Webhook API requests are authenticated by the token in the URL; harkctl uses a scoped agent token. Treat both as credentials.
- Interactive responses, response callbacks, and Live Activities work on every plan, on both the webhook and agent APIs.
- Hark Pro adds more than one active iPhone, \`deviceIds\` / \`--device\` routing, higher per-minute rate limits, and a larger monthly allowance.
`;
}
