import { Hono } from "hono";
import { docsMarkdown, llmsTxt } from "../../shared/docs/markdown";

/**
 * Plain-text views of the docs for agents, crawlers, and `curl`.
 *
 * Both bodies are derived from the same content model the React page renders, so
 * they can never fall behind `/docs`. They are generated once per process: the
 * content is a compile-time constant, so there is nothing to invalidate.
 */
const markdown = docsMarkdown();
const llms = llmsTxt();

/** Long, because these change only when the app is redeployed. */
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

export const docsTextRoute = new Hono();

for (const path of ["/docs.md", "/agents.md"]) {
  docsTextRoute.get(path, (c) => {
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Cache-Control", CACHE_CONTROL);
    c.header("Link", '<https://hark.fyi/docs>; rel="canonical"');
    c.header("X-Robots-Tag", "noindex, follow");
    return c.body(markdown);
  });
}

docsTextRoute.get("/llms.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", CACHE_CONTROL);
  c.header("X-Robots-Tag", "noindex, follow");
  return c.body(llms);
});
