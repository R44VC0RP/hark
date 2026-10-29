import { DOC_CONTENT, DOCS_TITLE } from "../../shared/docs/content";
import { DocsSidebar } from "../components/DocsSidebar";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { DocSectionView } from "./docs/blocks";

/** Docs are wider than the page column: a sidebar plus the 48rem reading measure. */
const DOCS_FRAME = "mx-auto w-full max-w-[66rem] px-6";

export function Docs() {
  return (
    /* `hark-docs` scopes the smooth anchor scrolling in index.css to this page. */
    <div className="hark-docs flex min-h-dvh flex-col">
      <div className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
        <SiteHeader current="docs" />
      </div>

      <div className={`${DOCS_FRAME} flex flex-1 flex-col lg:flex-row lg:gap-14`}>
        <DocsSidebar />

        <main className="min-w-0 max-w-3xl flex-1 pt-8 pb-20 lg:pt-10">
          <h1 className="max-w-[20ch] text-[clamp(32px,5vw,44px)] leading-[1.1] font-medium tracking-[-0.02em] text-balance text-white">
            {DOCS_TITLE}
          </h1>

          <div className="mt-10 space-y-16">
            {DOC_CONTENT.map((section) => (
              <DocSectionView key={section.id} section={section} />
            ))}
          </div>
        </main>
      </div>

      <SiteFooter className={DOCS_FRAME} />
    </div>
  );
}
