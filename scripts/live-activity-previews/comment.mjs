#!/usr/bin/env node
// Build the PR comment for Live Activity previews.
//
// Usage: node comment.mjs <capture-dir> <image-base-url> <run-url>
// Prints Markdown. Runs in the trusted comment workflow on files produced by a
// pull request's capture job, so it accepts only known style names, booleans
// and PNG files; no other text from the artifact reaches the comment.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, imageBase, runUrl] = process.argv.slice(2);
if (!dir || !imageBase || !runUrl) {
  console.error("usage: comment.mjs <capture-dir> <image-base-url> <run-url>");
  process.exit(2);
}

export const MARKER = "<!-- live-activity-previews -->";
const STYLE = /^[a-z][a-z0-9-]{0,31}$/;
const SHA = /^[0-9a-f]{40}$/;

const isPng = (file) =>
  existsSync(file) && readFileSync(file).subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
if (!SHA.test(manifest.base ?? "") || !SHA.test(manifest.head ?? "")) throw new Error("bad shas");
if (!Array.isArray(manifest.styles) || manifest.styles.length > 20) throw new Error("bad styles");

const rows = [];
for (const entry of manifest.styles) {
  if (!STYLE.test(entry?.style ?? "")) throw new Error("bad style name");
  const cell = (phase) => {
    const file = `${entry.style}-${phase}.png`;
    if (!isPng(join(dir, file))) return phase === "before" ? "_new style_" : "_not captured_";
    return `<img src="${imageBase}/${file}" width="300" alt="${entry.style} ${phase}">`;
  };
  rows.push(`| \`${entry.style}\` | ${cell("before")} | ${cell("after")} |`);
}

const short = (sha) => sha.slice(0, 7);
console.log(
  [
    MARKER,
    "### Live Activity previews",
    "",
    `Rendered on an iPhone 17 Pro simulator (iOS 27): Lock Screen, minimized Dynamic Island, expanded Dynamic Island. Before is \`${short(manifest.base)}\`, after is \`${short(manifest.head)}\`.`,
    "",
    "| Style | Before | After |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `<sub>[Capture run](${runUrl}). Both columns use this PR's native build; only the widget code differs.</sub>`,
  ].join("\n"),
);
