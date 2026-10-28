import type {
  DocFieldRow,
  DocPlanRow,
  DocRouteRow,
  DocStylePreview,
} from "../../../shared/docs/content";
import { type DocAnchorId, type DocSectionId, docLabel } from "../../../shared/docs/nav";
import { Inlines } from "./inlines";

/** A top-level docs chapter. Its heading text comes from the sidebar nav. */
export function DocSection({ id, children }: { id: DocSectionId; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} id={id}>
      <h2
        className="border-t border-line pt-8 text-[clamp(24px,3.2vw,28px)] leading-[1.15] font-medium tracking-[-0.015em] text-white"
        id={`${id}-heading`}
      >
        {docLabel(id)}
      </h2>
      {children}
    </section>
  );
}

/** A nested, individually linkable subsection. */
export function DocSub({ id, children }: { id: DocAnchorId; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-10" id={id}>
      <h3 className="text-lg font-medium text-white" id={`${id}-heading`}>
        {docLabel(id)}
      </h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-[1.7] text-ink-muted">{children}</p>;
}

export function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 max-w-[36rem] text-[17px] leading-[1.6] text-pretty text-ink-muted">
      {children}
    </p>
  );
}

export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-[15px] leading-[1.7] text-ink-muted marker:text-ink-faint">
      {children}
    </ol>
  );
}

export function Bullets({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-[15px] leading-[1.7] text-ink-muted marker:text-ink-faint">
      {children}
    </ul>
  );
}

/** Aside for a caveat that would otherwise get lost in a paragraph. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-r-xl border-l-2 border-white/70 bg-white/6 py-2.5 pr-4 pl-4 text-[15px] leading-[1.7] text-ink">
      {children}
    </p>
  );
}

function TableShell({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-lg text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

function HeadRow({ headers }: { headers: string[] }) {
  return (
    <thead className="text-[13px] text-ink-faint">
      <tr>
        {headers.map((header) => (
          <th className="pb-3 font-medium" key={header} scope="col">
            {header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function FieldTable({
  caption,
  rows,
  nameHeader = "Field",
}: {
  caption: string;
  rows: DocFieldRow[];
  nameHeader?: string;
}) {
  return (
    <TableShell caption={caption}>
      <HeadRow headers={[nameHeader, "Type", "Description"]} />
      <tbody className="divide-y divide-line border-y border-line">
        {rows.map((row) => (
          <tr key={row.name}>
            <th
              className="py-3 pr-5 align-top font-mono text-[13px] font-normal whitespace-nowrap text-white"
              scope="row"
            >
              {row.name}
            </th>
            <td className="py-3 pr-5 align-top text-[13px] whitespace-nowrap text-ink-faint">
              {row.type}
            </td>
            <td className="py-3 align-top text-sm leading-relaxed text-ink-muted">
              <Inlines source={row.detail} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function RouteTable({ caption, rows }: { caption: string; rows: DocRouteRow[] }) {
  return (
    <TableShell caption={caption}>
      <HeadRow headers={["Route", "Purpose"]} />
      <tbody className="divide-y divide-line border-y border-line">
        {rows.map((row) => (
          <tr key={`${row.method} ${row.path}`}>
            <th
              className="py-3 pr-5 align-top font-mono text-[13px] font-normal text-white"
              scope="row"
            >
              <span className="text-mint">{row.method}</span> {row.path}
            </th>
            <td className="py-3 align-top text-sm leading-relaxed text-ink-muted">
              <Inlines source={row.detail} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/** Free-versus-legacy-Pro comparison, used for the rate-limit table. */
/* ------------------------------------------------------------------------ */
/* Live Activity style previews                                             */
/* ------------------------------------------------------------------------ */

/** Palette and sample state mirror the shipping widget; illustration only. */
const LA = {
  base: "#0B1512",
  primary: "#F4FBF9",
  secondary: "#B8C9C4",
  accent: "#5ED8B7",
  track: "rgba(255,255,255,0.16)",
  progress: 0.65,
} as const;

function LaGear({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      height={size}
      stroke={LA.accent}
      strokeLinecap="round"
      strokeWidth="2.1"
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
    </svg>
  );
}

function LaBar({ fullBleed }: { fullBleed?: boolean }) {
  return (
    <div
      className={fullBleed ? "h-[5px] w-full" : "h-1 w-full rounded-full"}
      style={{ background: LA.track }}
    >
      <div
        className={fullBleed ? "h-full" : "h-full rounded-full"}
        style={{ width: `${LA.progress * 100}%`, background: LA.accent }}
      />
    </div>
  );
}

function LaCard({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-2xl shadow-lg"
      style={{ background: LA.base, color: LA.primary }}
      role="img"
      aria-label={`The ${name} Live Activity layout`}
    >
      {children}
    </div>
  );
}

function LaPreviewCard({ name }: { name: string }) {
  switch (name) {
    case "ring": {
      const r = 18;
      const c = 2 * Math.PI * r;
      return (
        <LaCard name={name}>
          <div className="flex items-center gap-3.5 px-4 py-3.5">
            <span className="relative inline-flex shrink-0">
              <svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44">
                <circle cx="22" cy="22" r={r} stroke={LA.track} strokeWidth="4" fill="none" />
                <circle
                  cx="22"
                  cy="22"
                  r={r}
                  stroke={LA.accent}
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={c}
                  strokeDashoffset={c * (1 - LA.progress)}
                  transform="rotate(-90 22 22)"
                />
              </svg>
              <span
                className="absolute inset-0 grid place-items-center text-[10px] font-semibold"
                style={{ color: LA.accent }}
              >
                65%
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">Deploy #184</span>
              <span className="block text-xs font-medium" style={{ color: LA.accent }}>
                Building
              </span>
              <span className="block truncate text-[11px]" style={{ color: LA.secondary }}>
                apps/website · main
              </span>
            </span>
          </div>
        </LaCard>
      );
    }
    case "hero":
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-0.5 px-4 pt-3 pb-2.5">
            <span className="flex items-center gap-2">
              <LaGear size={13} />
              <span className="flex-1" />
              <span className="text-xs font-semibold" style={{ color: LA.accent }}>
                65%
              </span>
            </span>
            <span className="text-xl font-bold tracking-tight">Building</span>
          </div>
          <LaBar fullBleed />
        </LaCard>
      );
    case "terminal":
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-1.5 px-4 py-3.5 font-mono">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold">hark-deploy</span>
              <span className="flex-1" />
              <span
                className="size-[7px] rounded-full"
                style={{ background: LA.accent, boxShadow: `0 0 8px ${LA.accent}` }}
              />
            </span>
            <span className="text-xs">
              <span style={{ color: LA.accent }}>❯</span> building
            </span>
            <span className="text-[10px]" style={{ color: LA.secondary }}>
              # apps/website · main
            </span>
            <LaBar />
          </div>
        </LaCard>
      );
    case "steps":
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-2.5 px-4 py-3.5">
            <span className="flex items-center gap-2.5">
              <LaGear size={18} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">Deploy #184</span>
              <span className="text-xs font-semibold" style={{ color: LA.accent }}>
                Building
              </span>
            </span>
            <span className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((step) => (
                <span
                  className="h-[5px] flex-1 rounded-full"
                  key={step}
                  style={{ background: step / 5 <= LA.progress ? LA.accent : LA.track }}
                />
              ))}
            </span>
          </div>
        </LaCard>
      );
    case "shell":
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-2.5 px-4 py-3.5 font-mono">
            <span className="text-xs leading-relaxed">
              <span className="font-bold text-[#3fdd78]">$</span> Deploy build #184?
            </span>
            <span className="text-[10px] text-[#4e5c52]"># reply required to continue</span>
            <span className="flex gap-2 text-center text-[10px] font-bold">
              <span className="flex-1 rounded bg-[#173d26] py-2 text-[#3fdd78]">approve ↵</span>
              <span className="flex-1 rounded bg-[#172019] py-2 text-[#8e9c92]">deny</span>
            </span>
          </div>
        </LaCard>
      );
    case "verdict":
      return (
        <LaCard name={name}>
          <div className="flex flex-col items-center gap-2.5 bg-[#1c1c1e] px-4 py-3.5">
            <span className="text-xs font-semibold">“Hark” requests approval</span>
            <span className="w-full border-b border-white/10 pb-2 text-center text-xs text-[#ebebf5]">
              Deploy build #184?
            </span>
            <span className="flex w-full gap-2 text-center text-[11px] font-semibold">
              <span className="flex-1 rounded-lg bg-[#0a84ff] py-2 text-white">Allow</span>
              <span className="flex-1 rounded-lg bg-[#303033] py-2 text-[#ebebf0]">
                Don’t Allow
              </span>
            </span>
          </div>
        </LaCard>
      );
    case "signal":
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-2.5 bg-[#141518] px-4 py-3.5">
            <span className="text-[10px] font-semibold tracking-wide text-[#7d8087]">
              ◐ Guarded action
            </span>
            <span className="text-xs font-medium text-[#f2f3f5]">Deploy build #184?</span>
            <span className="flex gap-2 text-center text-[11px] font-semibold">
              <span className="flex-1 rounded-lg bg-[#248a3d] py-2 text-[#eafbef]">Approve</span>
              <span className="flex-1 rounded-lg bg-[#5b211f] py-2 text-[#ff6961]">Deny</span>
            </span>
          </div>
        </LaCard>
      );
    default:
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <span className="flex items-center gap-2.5">
              <LaGear size={19} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">Deploy #184</span>
                <span className="block text-xs font-medium" style={{ color: LA.accent }}>
                  Building
                </span>
              </span>
              <span className="text-xs font-semibold" style={{ color: LA.accent }}>
                65%
              </span>
            </span>
            <LaBar />
          </div>
        </LaCard>
      );
  }
}

export function StylePreviews({ styles }: { styles: DocStylePreview[] }) {
  return (
    <div className="mt-5 grid gap-x-5 gap-y-7 sm:grid-cols-2">
      {styles.map((style) => (
        <figure key={style.name} className="m-0">
          {style.nativeScreenshot === false ? (
            <LaPreviewCard name={style.name} />
          ) : (
            <div className="overflow-hidden rounded-2xl bg-black shadow-[0_10px_30px_rgb(0_16_12/0.28),inset_0_0_0_1px_rgb(255_255_255/0.1)]">
              <img
                alt={`${style.name} Live Activity on the Lock Screen and Dynamic Island`}
                className="block h-auto w-full"
                decoding="async"
                height={867}
                loading="lazy"
                src={`/live-activities/${style.name}.webp`}
                width={900}
              />
            </div>
          )}
          <figcaption className="mt-2.5 text-sm leading-relaxed text-ink-muted">
            <code className="font-mono text-white">{style.name}</code> — {style.description}
          </figcaption>
          {style.nativeScreenshot === false ? null : (
            <details className="mt-2 text-[13px] text-ink-faint">
              <summary className="cursor-pointer select-none">Layout illustration</summary>
              <div className="mt-2">
                <LaPreviewCard name={style.name} />
              </div>
            </details>
          )}
        </figure>
      ))}
    </div>
  );
}

export function PlanTable({ caption, rows }: { caption: string; rows: DocPlanRow[] }) {
  return (
    <TableShell caption={caption}>
      <HeadRow headers={["Limit", "Free", "Legacy Pro"]} />
      <tbody className="divide-y divide-line border-y border-line">
        {rows.map((row) => (
          <tr key={row.limit}>
            <th className="py-3 pr-5 text-sm font-normal text-ink-muted" scope="row">
              {row.limit}
            </th>
            <td className="py-3 pr-5 font-mono text-[13px] text-white">{row.free}</td>
            <td className="py-3 font-mono text-[13px] text-white">{row.pro}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
