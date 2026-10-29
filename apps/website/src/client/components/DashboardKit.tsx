import type { AppDto, OncallPersonDto } from "@hark/contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { signOut, useSession } from "../lib/auth";
import { Brand, SITE_FRAME } from "./SiteChrome";
import { closeButton } from "./ui";

/**
 * Pieces shared by the dashboard and the team pages: list panels, empty
 * states, switches, a dialog shell, form fields and time formatting.
 */

/** Glass panel that holds a list; rows are separated by hairlines. */
export const LIST_PANEL = "hark-glass divide-y divide-line rounded-3xl px-4 sm:px-5";

/** Top-level dashboard section spacing. */
export const SECTION = "mt-10 border-t border-line pt-8";

export const INPUT = "hark-field px-3 py-2.5 text-base sm:text-[15px]";

export function SectionHeading({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-4">
        <h2
          id={id}
          className="min-w-0 text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-white"
        >
          {title}
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {description ? <p className="mt-1.5 text-ink-muted">{description}</p> : null}
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-white/8 px-1 py-px font-mono text-[0.86em] text-white">
      {children}
    </code>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-line bg-white/[0.03] px-6 py-9 text-center">
      <p className="font-medium text-white">{title}</p>
      {children ? <p className="mx-auto mt-1.5 max-w-sm text-ink-muted">{children}</p> : null}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-3 text-sm text-danger" role="alert">
      {children}
    </p>
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Small pill label. `strong` is the white-on-green "current" style. */
export function Badge({
  children,
  tone = "quiet",
}: {
  children: React.ReactNode;
  tone?: "quiet" | "outline" | "strong" | "danger" | "warn" | "ok";
}) {
  const tones = {
    quiet: "bg-white/12 text-white",
    outline: "border border-line text-ink-muted",
    strong: "bg-white font-medium text-green",
    danger: "bg-danger-soft text-danger ring-1 ring-danger-line ring-inset",
    warn: "bg-warn/14 text-warn ring-1 ring-warn/45 ring-inset",
    ok: "bg-mint/12 text-mint ring-1 ring-mint/40 ring-inset",
  } as const;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[13px] leading-5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Accessible on/off control styled as an iOS switch. */
export function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      className="group inline-flex items-center gap-2 text-sm text-ink-muted disabled:opacity-50"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-[22px] w-9 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-white" : "bg-white/18 group-hover:bg-white/24"
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] size-4 rounded-full shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-[14px] bg-green" : "bg-white"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

export function AppIcon({ app }: { app: Pick<AppDto, "iconUrl" | "name"> }) {
  if (app.iconUrl) {
    return (
      <img
        alt=""
        className="size-10 shrink-0 rounded-[11px] object-cover ring-1 ring-white/15"
        src={app.iconUrl}
      />
    );
  }
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-white font-medium text-green">
      {app.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Round avatar for a person: their photo, or initials on glass. */
export function PersonAvatar({
  person,
  size = "md",
}: {
  person: Pick<OncallPersonDto, "name" | "image">;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-6 text-[11px]" : "size-9 text-sm";
  if (person.image) {
    return (
      <img
        alt=""
        className={`${box} shrink-0 rounded-full object-cover ring-1 ring-white/15`}
        referrerPolicy="no-referrer"
        src={person.image}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} grid shrink-0 place-items-center rounded-full bg-white/14 font-medium text-white ring-1 ring-white/15`}
    >
      {initials(person.name)}
    </span>
  );
}

/** Square team mark with the team's first letter. */
export function TeamMark({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center bg-white font-medium text-green ${
        size === "lg" ? "size-12 rounded-[14px] text-xl" : "size-9 rounded-[10px] text-[15px]"
      }`}
    >
      {name.trim().slice(0, 1).toUpperCase() || "T"}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
  return (
    letters
      .map((part) => part?.slice(0, 1) ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/** Labelled form row. */
export function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children and nested inside
    <label className="block">
      <span className="mb-1.5 block text-sm text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[13px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

/** Native select in the field style, with a drawn chevron. */
export function Select({
  className = "",
  compact = false,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <span className={`relative block ${className}`}>
      <select
        {...props}
        className={`hark-field appearance-none pr-9 disabled:opacity-60 ${
          compact
            ? "h-8 rounded-full py-0 pl-3 text-[13px]"
            : "px-3 py-2.5 text-base sm:text-[15px]"
        }`}
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-ink-muted"
        fill="none"
        viewBox="0 0 16 16"
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}

/** Pill radio group, e.g. Open / All. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="inline-flex rounded-full border border-line bg-panel p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          className={`relative cursor-pointer rounded-full px-3 py-1 text-[13px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white ${
            value === option.value ? "bg-white text-green" : "text-ink-muted hover:text-white"
          }`}
          key={option.value}
        >
          <input
            checked={value === option.value}
            className="sr-only"
            name={name}
            onChange={() => onChange(option.value)}
            type="radio"
            value={option.value}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Dialog shell matching the service and plan dialogs: glass panel over a
 * blurred backdrop, Escape and backdrop close, and focus moved to the first
 * `[data-autofocus]` element (or the panel) on open.
 */
export function Modal({
  title,
  description,
  busy = false,
  wide = false,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  busy?: boolean;
  wide?: boolean;
  onClose: () => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  const close = useCallback(() => {
    if (closing || busy) return;
    setClosing(true);
    window.setTimeout(onClose, 120);
  }, [busy, closing, onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      (target ?? panelRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const header = (
    <div className="mb-6 flex items-start justify-between gap-6">
      <div>
        <h2 id={titleId} className="text-xl font-medium text-white">
          {title}
        </h2>
        {description ? <p className="mt-1 text-[15px] text-ink-muted">{description}</p> : null}
      </div>
      <button
        aria-label="Close"
        className={closeButton}
        disabled={busy}
        onClick={close}
        type="button"
      >
        ×
      </button>
    </div>
  );

  const panelClass = `hark-modal-panel hark-glass hark-glass-strong outline-none ${
    wide ? "hark-plan-panel" : "max-h-[calc(100dvh-2rem)] overflow-y-auto"
  }`;

  return (
    <div className={`hark-modal-backdrop ${closing ? "is-closing" : ""}`}>
      <button
        aria-label={`Close ${title}`}
        className="hark-modal-dismiss"
        disabled={busy}
        onClick={close}
        type="button"
      />
      {onSubmit ? (
        <form
          aria-labelledby={titleId}
          aria-modal="true"
          className={panelClass}
          onSubmit={onSubmit}
          ref={(element) => {
            panelRef.current = element;
          }}
          role="dialog"
          tabIndex={-1}
        >
          {header}
          {children}
        </form>
      ) : (
        <section
          aria-labelledby={titleId}
          aria-modal="true"
          className={panelClass}
          ref={(element) => {
            panelRef.current = element;
          }}
          role="dialog"
          tabIndex={-1}
        >
          {header}
          {children}
        </section>
      )}
    </div>
  );
}

/**
 * Header shared by the dashboard and team pages. Same frame, mark and link
 * positions as the public `SiteHeader`, with an account menu in place of the
 * "Open dashboard" link, so moving between the site and the dashboard never
 * shifts. `children` go before the account menu.
 */
export function DashboardHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className={`${SITE_FRAME} flex h-16 items-center justify-between`}>
      <Brand />
      <nav
        aria-label="Primary"
        className="flex items-center gap-4 text-[14px] sm:gap-[22px] sm:text-[15px]"
      >
        <Link className="text-ink-muted transition-colors duration-150 hover:text-white" to="/docs">
          Docs
        </Link>
        <Link
          className="text-ink-muted transition-colors duration-150 hover:text-white"
          to="/pricing"
        >
          Pricing
        </Link>
        {children}
        <AccountMenu />
      </nav>
    </header>
  );
}

/** Avatar button that opens a small glass menu with the account email and Sign out. */
function AccountMenu() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!session) return null;
  const { user } = session;
  const label = user.name || user.email;

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={`Account: ${user.email}`}
        className="flex items-center rounded-full transition-[filter] hover:brightness-110"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {user.image ? (
          <img
            alt=""
            className="size-8 shrink-0 rounded-full ring-1 ring-white/20"
            referrerPolicy="no-referrer"
            src={user.image}
          />
        ) : (
          <PersonAvatar person={{ name: label, image: null }} size="md" />
        )}
      </button>
      {open ? (
        <div
          className="hark-glass hark-glass-strong absolute top-[calc(100%+12px)] right-0 z-50 w-64 rounded-3xl p-2"
          id={menuId}
        >
          <div className="px-3 pt-2 pb-2.5">
            {user.name ? <p className="truncate font-medium text-white">{user.name}</p> : null}
            <p className="truncate text-sm text-ink-faint">{user.email}</p>
          </div>
          <div className="border-t border-line pt-1.5">
            <button
              className="flex h-10 w-full items-center rounded-2xl px-3 text-left text-[15px] text-ink transition-colors hover:bg-surface-hover hover:text-white"
              onClick={() => void signOut().then(() => navigate("/"))}
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function relativeTime(iso: string): string {
  const deltaMinutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes} minute${deltaMinutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(deltaMinutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "in 5 minutes", "in 3 hours", "in 2 days". */
export function relativeFuture(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} days`;
}

const shiftFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "Thu, Oct 8, 9:00 AM" in the viewer's zone. */
export function formatDateTime(iso: string): string {
  return shiftFormat.format(new Date(iso));
}

/** "9:00 AM" today, otherwise the full date and time. */
export function formatTimeOrDate(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? timeFormat.format(date)
    : shiftFormat.format(date);
}
