#!/usr/bin/env node
// Decide which Live Activity styles a change touches.
//
// Usage: node affected-styles.mjs <base-sha> <head-sha>
// Prints JSON: { "styles": ["standard", ...], "reason": "..." }. An empty list
// means nothing that renders a Live Activity changed.
//
// A style file also affects every style that reuses it (ring reads
// `standard.compactLeading`, verdict reads `approval.expandedBottom`, ...), so
// dependents are found by scanning each style file for `standard.` and
// `approval.` references. Shared widget code, the contracts package, the
// expo-widgets patch and this tooling affect every style.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error("usage: affected-styles.mjs <base-sha> <head-sha>");
  process.exit(2);
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const stylesDir = "apps/expo/src/widgets/live-activities";

const contracts = readFileSync(join(root, "packages/contracts/src/index.ts"), "utf8");
const listMatch = contracts.match(/LIVE_ACTIVITY_STYLES\s*=\s*\[([^\]]*)\]/);
if (!listMatch) throw new Error("LIVE_ACTIVITY_STYLES not found in packages/contracts");
const allStyles = [...listMatch[1].matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]);

// Which styles each style reuses, read from its source.
const reuses = new Map();
for (const style of allStyles) {
  const file = join(root, stylesDir, `${style}.tsx`);
  const source = existsSync(file) ? readFileSync(file, "utf8") : "";
  const deps = new Set();
  for (const candidate of allStyles) {
    if (candidate !== style && new RegExp(`\\b${candidate}\\.\\w`).test(source)) deps.add(candidate);
  }
  reuses.set(style, deps);
}

function withDependents(start) {
  const out = new Set(start);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [style, deps] of reuses) {
      if (!out.has(style) && [...deps].some((d) => out.has(d))) {
        out.add(style);
        grew = true;
      }
    }
  }
  return out;
}

const changed = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const everything = [
  /^apps\/expo\/src\/widgets\/(?!live-activities\/)[^/]+\.tsx?$/, // registry, shared types
  /^apps\/expo\/src\/widgets\/live-activities\/types\.ts$/,
  /^packages\/contracts\/src\//,
  /^patches\/expo-widgets@/,
  /^apps\/expo\/package\.json$/,
  /^scripts\/live-activity-previews\//,
  /^\.github\/workflows\/live-activity-previews/,
];

let reason = "";
const direct = new Set();
for (const file of changed) {
  if (file.endsWith(".test.ts") || file.endsWith(".md")) continue;
  if (everything.some((re) => re.test(file))) {
    reason = `${file} affects every style`;
    for (const s of allStyles) direct.add(s);
    break;
  }
  const m = file.match(new RegExp(`^${stylesDir}/([a-z][a-z0-9-]*)\\.tsx$`));
  if (m && allStyles.includes(m[1])) direct.add(m[1]);
}

const styles = allStyles.filter((s) => withDependents(direct).has(s));
if (!reason && styles.length) {
  reason = `changed: ${[...direct].join(", ")}`;
  const extra = styles.filter((s) => !direct.has(s));
  if (extra.length) reason += `; they are reused by ${extra.join(", ")}`;
}
console.log(JSON.stringify({ styles, reason }));
