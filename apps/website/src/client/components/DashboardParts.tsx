import type { EventDto } from "@hark/contracts";
import { CopyField } from "./CopyField";

/** Pieces shared by the dashboard's Overview and its other tabs. */

export const numberFormat = new Intl.NumberFormat("en-US");

export function curlExample(webhookUrl: string): string {
  return [
    `curl -X POST ${webhookUrl} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Idempotency-Key: unique-event-id' \\`,
    `  -d '{ "body": "Deploy finished ✅" }'`,
  ].join("\n");
}

/** A one-line command or URL on a dark code panel with a copy button. */
export function CopyLine({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-code py-0.5 pr-0.5 pl-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
      <CopyField label={label} value={value} />
    </div>
  );
}

/** Notifications used vs the monthly allowance, as a bar. */
export function UsageMeter({
  used,
  limit,
  unlimited,
}: {
  used: number;
  limit: number;
  unlimited: boolean;
}) {
  const ratio = unlimited || limit <= 0 ? 0 : Math.min(1, used / limit);
  const fill = ratio >= 1 ? "bg-danger-strong" : ratio >= 0.8 ? "bg-warn" : "bg-mint";
  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-[26px] leading-none font-medium tracking-[-0.015em] text-white tabular-nums">
          {numberFormat.format(used)}
        </span>
        <span className="text-[15px] text-ink-muted">
          {unlimited ? "sent · unlimited" : `of ${numberFormat.format(limit)}`}
        </span>
      </p>
      {unlimited ? null : (
        <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-white/12">
          <div
            className={`h-full rounded-full ${fill} transition-[width] duration-500 ease-out motion-reduce:transition-none`}
            style={{ width: `${Math.max(ratio * 100, used > 0 ? 1.5 : 0)}%` }}
          />
        </div>
      )}
      {unlimited ? null : (
        <p className="mt-2 text-[13px] text-ink-faint tabular-nums">
          {numberFormat.format(Math.max(0, limit - used))} left this month
        </p>
      )}
    </div>
  );
}

/** Circular progress for the setup checklist. */
export function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const progress = total === 0 ? 0 : done / total;
  return (
    <span className="relative grid size-16 shrink-0 place-items-center">
      <svg aria-hidden="true" className="absolute inset-0 -rotate-90" viewBox="0 0 64 64">
        <circle
          cx="32"
          cy="32"
          fill="none"
          r={radius}
          stroke="rgb(255 255 255 / 0.14)"
          strokeWidth="5"
        />
        <circle
          className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
          cx="32"
          cy="32"
          fill="none"
          r={radius}
          stroke="var(--color-mint)"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          strokeWidth="5"
        />
      </svg>
      <span className="text-[15px] font-medium text-white tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "accepted" || status === "delivered"
      ? "bg-mint"
      : status === "withdrawn"
        ? "bg-info"
        : status === "failed"
          ? "bg-danger-strong"
          : status === "partial" || status === "withdraw_partial"
            ? "bg-warn"
            : status === "processing"
              ? "bg-info"
              : "bg-idle";
  return <span className={`${color} size-2 rounded-full`} aria-hidden="true" />;
}

function ActivityAvatar({ activityEvent }: { activityEvent: EventDto }) {
  return (
    <span className="relative size-9 shrink-0">
      {activityEvent.imageUrl ? (
        <img
          alt=""
          className="size-9 rounded-full object-cover ring-1 ring-white/15"
          src={activityEvent.imageUrl}
        />
      ) : (
        <span className="grid size-9 place-items-center rounded-full bg-white/12 text-sm font-medium text-white">
          {activityEvent.serviceTitle.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute -right-0.5 -bottom-0.5 grid size-3.5 place-items-center rounded-full bg-paper">
        <StatusDot status={activityEvent.status} />
      </span>
    </span>
  );
}

export function isFailedEvent(activityEvent: EventDto): boolean {
  return activityEvent.status === "failed" || activityEvent.status === "no_devices";
}

export function activityLabel(activityEvent: EventDto): string {
  if (activityEvent.status === "accepted" || activityEvent.status === "delivered") {
    return `Accepted for ${activityEvent.deliveredCount} ${activityEvent.deliveredCount === 1 ? "device" : "devices"}`;
  }
  if (activityEvent.status === "withdrawn") return "Withdrawal requested";
  if (activityEvent.status === "withdraw_partial") return "Withdrawal partially accepted";
  if (activityEvent.status === "partial") {
    return `Partially accepted for ${activityEvent.deliveredCount} devices`;
  }
  if (activityEvent.status === "no_devices") return "No active devices";
  if (activityEvent.status === "processing") return "Processing";
  return "Failed";
}

/** One webhook delivery attempt in an activity list. */
export function ActivityItem({ activityEvent }: { activityEvent: EventDto }) {
  return (
    <li className="flex gap-3 py-3.5">
      <ActivityAvatar activityEvent={activityEvent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <p className="truncate leading-5 font-medium text-white">
            {activityEvent.serviceTitle} · {activityEvent.title}
          </p>
          <time
            className="shrink-0 text-[13px] text-ink-faint"
            dateTime={activityEvent.createdAt}
            title={new Date(activityEvent.createdAt).toLocaleString()}
          >
            {new Date(activityEvent.createdAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </div>
        <p className="mt-0.5 truncate text-sm leading-5 text-ink-muted">{activityEvent.body}</p>
        <p
          className={`mt-0.5 text-[13px] leading-5 ${isFailedEvent(activityEvent) ? "text-danger" : "text-ink-faint"}`}
        >
          {activityLabel(activityEvent)}
          {activityEvent.error ? ` · ${activityEvent.error}` : ""}
        </p>
      </div>
    </li>
  );
}
