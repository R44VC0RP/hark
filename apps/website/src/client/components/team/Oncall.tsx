import type {
  CriticalAlertState,
  OncallEscalationStep,
  OncallGroupDto,
  OncallOverrideDto,
  OncallSettingsDto,
  OncallSettingsUpdateInput,
  TeamDto,
  TeamMemberDto,
} from "@hark/contracts";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ApiRequestError, api } from "../../lib/api";
import {
  canManage,
  MAX_ESCALATION_STEPS,
  ONCALL_RING_INTERVAL_DEFAULT_SECONDS,
  ONCALL_RING_INTERVAL_MAX_SECONDS,
  ONCALL_RING_INTERVAL_MIN_SECONDS,
  ONCALL_RING_MAX_REPEATS_DEFAULT,
  ONCALL_RING_MAX_REPEATS_LIMIT,
  TEAM_NAME_MAX_CHARS,
} from "../../lib/teams";
import { useConfirm } from "../ConfirmDialog";
import {
  Badge,
  EmptyState,
  ErrorText,
  errorMessage,
  Field,
  formatDateTime,
  INPUT,
  Modal,
  PersonAvatar,
  relativeFuture,
  SECTION,
  SectionHeading,
  Segmented,
  Select,
  Switch,
} from "../DashboardKit";
import { primaryButtonSmall, rowButton, rowDangerButton, secondaryButton, textLink } from "../ui";

export function escalationSummary(steps: OncallEscalationStep[]): string {
  if (steps.length === 0) return "No escalation: only the person on call is paged.";
  const parts = steps.map((step, index) => {
    const target = step.target === "next" ? "the next person" : "the whole group";
    return index === 0
      ? `${target} after ${step.afterMinutes} min`
      : `${target} ${step.afterMinutes} min later`;
  });
  const text = parts.join(", then ");
  return `If nobody acknowledges: ${text}.`;
}

/** "30 s", "1 min", "90 s", "5 min". */
function intervalLabel(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

function ringSummary(group: OncallGroupDto): string | null {
  if (group.ringIntervalSeconds === undefined || group.ringMaxRepeats === undefined) return null;
  if (group.ringMaxRepeats === 0) return "Each person paged gets one alert; it doesn't repeat.";
  return `Until someone acknowledges, alerts repeat every ${intervalLabel(
    group.ringIntervalSeconds,
  )}, up to ${group.ringMaxRepeats} ${group.ringMaxRepeats === 1 ? "time" : "times"}.`;
}

function rotationSummary(group: OncallGroupDto): string {
  const count = group.rotation.members.length;
  return `${group.rotation.period === "daily" ? "Daily" : "Weekly"} rotation · ${count} ${
    count === 1 ? "person" : "people"
  } · hands off at ${group.rotation.handoffAt} ${group.rotation.timezone.replaceAll("_", " ")}`;
}

export function OncallSection({
  team,
  members,
  viewerName,
  onPaged,
}: {
  team: TeamDto;
  members: TeamMemberDto[];
  viewerName: string;
  onPaged: () => void;
}) {
  const [groups, setGroups] = useState<OncallGroupDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OncallGroupDto | "new" | null>(null);
  const manage = canManage(team.role);

  const load = useCallback(async () => {
    try {
      setGroups((await api.listOncallGroups(team.id)).groups);
    } catch (err) {
      setError(errorMessage(err, "Could not load on-call groups"));
      setGroups((current) => current ?? []);
    }
  }, [team.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (group: OncallGroupDto) =>
    setGroups((current) =>
      current?.some((item) => item.id === group.id)
        ? current.map((item) => (item.id === group.id ? group : item))
        : [...(current ?? []), group],
    );

  return (
    <section aria-labelledby="oncall-heading" className={SECTION}>
      <SectionHeading
        id="oncall-heading"
        title="On-call"
        description="Rotations decide who gets paged. Unacknowledged pages escalate on their own."
        action={
          manage ? (
            <button className={rowButton} onClick={() => setEditing("new")} type="button">
              New group
            </button>
          ) : null
        }
      />
      {groups === null ? <p className="py-4 text-ink-faint">Loading on-call groups…</p> : null}
      {groups?.length === 0 ? (
        <EmptyState title="No on-call groups yet">
          {manage
            ? "Create a group, choose who's in the rotation and how pages escalate."
            : "A team admin can create one."}
        </EmptyState>
      ) : null}
      {groups && groups.length > 0 ? (
        <div className="space-y-4">
          {groups.map((group) => (
            <GroupCard
              group={group}
              key={group.id}
              manage={manage}
              members={members}
              onDeleted={() =>
                setGroups((current) => current?.filter((item) => item.id !== group.id) ?? null)
              }
              onEdit={() => setEditing(group)}
              onPaged={() => {
                onPaged();
                void load();
              }}
              onUpdated={replace}
              viewerName={viewerName}
            />
          ))}
        </div>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <PagingSettings />
      {editing ? (
        <GroupModal
          group={editing === "new" ? null : editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={(group) => {
            setEditing(null);
            replace(group);
          }}
          teamId={team.id}
        />
      ) : null}
    </section>
  );
}

function GroupCard({
  group,
  members,
  manage,
  viewerName,
  onEdit,
  onUpdated,
  onDeleted,
  onPaged,
}: {
  group: OncallGroupDto;
  members: TeamMemberDto[];
  manage: boolean;
  viewerName: string;
  onEdit: () => void;
  onUpdated: (group: OncallGroupDto) => void;
  onDeleted: () => void;
  onPaged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const detailId = useId();
  const current = group.current;
  const next = group.upcoming.find((shift) => shift.startsAt !== current?.startsAt);
  const ring = ringSummary(group);

  const sendTest = async () => {
    const target = current?.person.name ?? "the first person in the rotation";
    const confirmed = await confirm({
      title: "Send test page",
      message: `Page ${target} now? It rings like a real page and escalates if nobody acknowledges it.`,
      confirmLabel: "Send test page",
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await api.createOncallPage(group.id, {
        title: `Test page from ${viewerName}`,
        body: "This is a test. Acknowledge it to confirm on-call works.",
      });
      const notified = response.page.notified[0]?.name ?? target;
      setStatus(
        response.deduplicated
          ? "Merged into the open test page."
          : `Test page sent to ${notified}. Acknowledge it from the iPhone or below.`,
      );
      onPaged();
    } catch (err) {
      setError(errorMessage(err, "Could not send the test page"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = await confirm({
      title: "Delete on-call group",
      message: `Delete ${group.name}? Its rotation, overrides and page history are removed. Agents paging this group start getting errors.`,
      confirmLabel: "Delete group",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteOncallGroup(group.id);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "Could not delete this group"));
      setBusy(false);
    }
  };

  return (
    <article aria-labelledby={`${detailId}-title`} className="hark-glass rounded-3xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h3
            className="flex items-center gap-2 text-[17px] font-medium text-white"
            id={`${detailId}-title`}
          >
            <span className="truncate">{group.name}</span>
            {group.openPageCount > 0 ? (
              <Badge tone="danger">
                {group.openPageCount} open {group.openPageCount === 1 ? "page" : "pages"}
              </Badge>
            ) : null}
          </h3>
          <p className="mt-0.5 text-[13px] text-ink-faint">{rotationSummary(group)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={rowButton}
            disabled={busy}
            onClick={() => void sendTest()}
            type="button"
          >
            Send test page
          </button>
          {manage ? (
            <button className={rowButton} disabled={busy} onClick={onEdit} type="button">
              Edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-panel p-3.5">
          <p className="text-[13px] text-ink-faint">On call now</p>
          {current ? (
            <div className="mt-2 flex items-center gap-2.5">
              <PersonAvatar person={current.person} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-medium text-white">
                  {current.person.name}
                  {current.override ? <Badge tone="outline">Override</Badge> : null}
                </p>
                <p className="text-[13px] text-ink-faint">until {formatDateTime(current.endsAt)}</p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[15px] text-ink-muted">Nobody yet</p>
          )}
        </div>
        <div className="rounded-2xl bg-panel p-3.5">
          <p className="text-[13px] text-ink-faint">Next handoff</p>
          {next ? (
            <div className="mt-2 flex items-center gap-2.5">
              <PersonAvatar person={next.person} />
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{next.person.name}</p>
                <p className="text-[13px] text-ink-faint">
                  {formatDateTime(next.startsAt)} · {relativeFuture(next.startsAt)}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[15px] text-ink-muted">No handoff scheduled</p>
          )}
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        {escalationSummary(group.escalation)}
        {ring ? ` ${ring}` : null}
      </p>

      {status ? (
        <p className="mt-3 rounded-2xl bg-white/12 px-4 py-2.5 text-sm text-white" role="status">
          {status}
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>

      <button
        aria-controls={`${detailId}-detail`}
        aria-expanded={open}
        className={`${textLink} mt-4 text-sm`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? "Hide schedule" : "Schedule and overrides"}{" "}
        <span aria-hidden="true" className={open ? "rotate-90" : ""}>
          →
        </span>
      </button>

      {open ? (
        <div className="mt-4 space-y-5 border-t border-line pt-4" id={`${detailId}-detail`}>
          <Schedule group={group} />
          <Overrides group={group} members={members} onUpdated={onUpdated} />
          {manage ? (
            <div className="border-t border-line pt-4">
              <button
                className={rowDangerButton}
                disabled={busy}
                onClick={() => void remove()}
                type="button"
              >
                Delete group
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {dialog}
    </article>
  );
}

function Schedule({ group }: { group: OncallGroupDto }) {
  return (
    <div>
      <h4 className="text-[15px] font-medium text-white">Upcoming shifts</h4>
      {group.upcoming.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No shifts scheduled.</p>
      ) : (
        <ol className="mt-2 divide-y divide-line">
          {group.upcoming.map((shift, index) => (
            <li
              className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 py-2"
              key={`${shift.startsAt}-${shift.person.userId}`}
            >
              <PersonAvatar person={shift.person} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-white">
                {shift.person.name}
              </span>
              {shift.override ? <Badge tone="outline">Override</Badge> : null}
              {index === 0 && group.current ? <Badge tone="ok">Now</Badge> : null}
              <span className="w-full pl-[34px] text-[13px] text-ink-faint tabular-nums sm:w-auto sm:pl-0 sm:text-right">
                {formatDateTime(shift.startsAt)} – {formatDateTime(shift.endsAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** `YYYY-MM-DDTHH:MM` in local time, for datetime-local inputs. */
function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function Overrides({
  group,
  members,
  onUpdated,
}: {
  group: OncallGroupDto;
  members: TeamMemberDto[];
  onUpdated: (group: OncallGroupDto) => void;
}) {
  const overrides = group.overrides ?? null;
  const [userId, setUserId] = useState(members[0]?.userId ?? "");
  const [startsAt, setStartsAt] = useState(() => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    return toLocalInput(start);
  });
  const [endsAt, setEndsAt] = useState(() => {
    const end = new Date();
    end.setMinutes(0, 0, 0);
    end.setHours(end.getHours() + 25);
    return toLocalInput(end);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!(end > start)) {
      setError("The override must end after it starts.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { group: next } = await api.addOncallOverride(group.id, {
        userId,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });
      onUpdated(next);
    } catch (err) {
      setError(errorMessage(err, "Could not add the override"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (override: OncallOverrideDto) => {
    setBusy(true);
    setError(null);
    try {
      onUpdated((await api.removeOncallOverride(group.id, override.id)).group);
    } catch (err) {
      setError(errorMessage(err, "Could not remove the override"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h4 className="text-[15px] font-medium text-white">Overrides</h4>
      <p className="mt-0.5 text-[13px] text-ink-faint">
        Put someone on call for a stretch of time, like covering a shift.
      </p>
      {overrides && overrides.length > 0 ? (
        <ul className="mt-2 divide-y divide-line">
          {overrides.map((override) => (
            <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2" key={override.id}>
              <PersonAvatar person={override.person} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-white">
                {override.person.name}
              </span>
              <span className="order-last w-full pl-[34px] text-[13px] text-ink-faint tabular-nums sm:order-none sm:w-auto sm:pl-0">
                {formatDateTime(override.startsAt)} – {formatDateTime(override.endsAt)}
              </span>
              <button
                className={rowDangerButton}
                disabled={busy}
                onClick={() => void remove(override)}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        aria-label={`Add an override to ${group.name}`}
        className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]"
        id={formId}
        onSubmit={add}
      >
        <Field label="Who">
          <Select onChange={(event) => setUserId(event.target.value)} value={userId}>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <input
            className={`${INPUT} [color-scheme:dark]`}
            onChange={(event) => setStartsAt(event.target.value)}
            required
            type="datetime-local"
            value={startsAt}
          />
        </Field>
        <Field label="To">
          <input
            className={`${INPUT} [color-scheme:dark]`}
            onChange={(event) => setEndsAt(event.target.value)}
            required
            type="datetime-local"
            value={endsAt}
          />
        </Field>
        <div className="sm:col-span-3">
          <button className={secondaryButton} disabled={busy} type="submit">
            {busy ? "Adding…" : "Add override"}
          </button>
        </div>
      </form>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

const DEFAULT_ESCALATION: OncallEscalationStep[] = [
  { afterMinutes: 5, target: "next" },
  { afterMinutes: 10, target: "group" },
];

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

function GroupModal({
  teamId,
  group,
  members,
  onClose,
  onSaved,
}: {
  teamId: string;
  group: OncallGroupDto | null;
  members: TeamMemberDto[];
  onClose: () => void;
  onSaved: (group: OncallGroupDto) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [rotation, setRotation] = useState<string[]>(
    group
      ? group.rotation.members
          .map((person) => person.userId)
          .filter((id) => members.some((member) => member.userId === id))
      : members.map((member) => member.userId),
  );
  const [period, setPeriod] = useState<"daily" | "weekly">(group?.rotation.period ?? "weekly");
  const [handoffAt, setHandoffAt] = useState(group?.rotation.handoffAt ?? "09:00");
  const [timezone, setTimezone] = useState(group?.rotation.timezone ?? browserTimeZone());
  const [steps, setSteps] = useState<OncallEscalationStep[]>(
    group?.escalation ?? DEFAULT_ESCALATION,
  );
  // Strings so a half-typed number isn't clamped; the inputs' min/max validate on submit.
  const [ringInterval, setRingInterval] = useState(
    String(group?.ringIntervalSeconds ?? ONCALL_RING_INTERVAL_DEFAULT_SECONDS),
  );
  const [ringRepeats, setRingRepeats] = useState(
    String(group?.ringMaxRepeats ?? ONCALL_RING_MAX_REPEATS_DEFAULT),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(timezone), [timezone]);
  const byId = new Map(members.map((member) => [member.userId, member]));
  const available = members.filter((member) => !rotation.includes(member.userId));

  const move = (index: number, delta: -1 | 1) =>
    setRotation((current) => {
      const next = [...current];
      const target = index + delta;
      const a = next[index];
      const b = next[target];
      if (a === undefined || b === undefined) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });

  const updateStep = (index: number, patch: Partial<OncallEscalationStep>) =>
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...patch } : step)),
    );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (rotation.length === 0) {
      setError("Add at least one person to the rotation.");
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      name: name.trim(),
      rotation: { memberIds: rotation, period, handoffAt, timezone },
      escalation: steps,
      ringIntervalSeconds: Number(ringInterval),
      ringMaxRepeats: Number(ringRepeats),
    };
    try {
      const response = group
        ? await api.updateOncallGroup(group.id, input)
        : await api.createOncallGroup(teamId, input);
      onSaved(response.group);
    } catch (err) {
      setError(errorMessage(err, `Could not ${group ? "save" : "create"} this group`));
      setBusy(false);
    }
  };

  return (
    <Modal
      busy={busy}
      description="Who gets paged, when shifts change, and how pages escalate."
      onClose={onClose}
      onSubmit={submit}
      title={group ? `Edit ${group.name}` : "New on-call group"}
      wide
    >
      <div className="space-y-6">
        <Field label="Name">
          <input
            className={INPUT}
            data-autofocus
            maxLength={TEAM_NAME_MAX_CHARS}
            onChange={(event) => setName(event.target.value)}
            placeholder="Platform on-call"
            required
            value={name}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm text-ink-muted">Rotation order</legend>
          {rotation.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-3 text-sm text-ink-muted">
              Nobody in the rotation yet.
            </p>
          ) : (
            <ol className="divide-y divide-line rounded-2xl bg-panel px-3">
              {rotation.map((userId, index) => {
                const member = byId.get(userId);
                const label = member?.name ?? "Former member";
                return (
                  <li className="flex items-center gap-2.5 py-2" key={userId}>
                    <span className="w-5 text-right text-[13px] text-ink-faint tabular-nums">
                      {index + 1}
                    </span>
                    {member ? <PersonAvatar person={member} size="sm" /> : null}
                    <span className="min-w-0 flex-1 truncate text-[15px] text-white">{label}</span>
                    <div className="flex gap-1">
                      <IconButton
                        disabled={index === 0}
                        label={`Move ${label} up`}
                        onClick={() => move(index, -1)}
                      >
                        <path d="m4 10 4-4 4 4" />
                      </IconButton>
                      <IconButton
                        disabled={index === rotation.length - 1}
                        label={`Move ${label} down`}
                        onClick={() => move(index, 1)}
                      >
                        <path d="m4 6 4 4 4-4" />
                      </IconButton>
                      <IconButton
                        label={`Remove ${label} from the rotation`}
                        onClick={() =>
                          setRotation((current) => current.filter((id) => id !== userId))
                        }
                      >
                        <path d="m4.5 4.5 7 7m0-7-7 7" />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {available.length > 0 ? (
            <div className="mt-2 w-full sm:w-64">
              <Select
                aria-label="Add a person to the rotation"
                compact
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) setRotation((current) => [...current, value]);
                }}
                value=""
              >
                <option value="">Add a person…</option>
                {available.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[auto_8.5rem_minmax(0,1fr)]">
          <div>
            <span className="mb-1.5 block text-sm text-ink-muted">Shift length</span>
            <div className="flex h-[46px] items-center">
              <Segmented
                label="Shift length"
                onChange={setPeriod}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                ]}
                value={period}
              />
            </div>
          </div>
          <Field label="Handoff time">
            <input
              className={`${INPUT} [color-scheme:dark]`}
              onChange={(event) => setHandoffAt(event.target.value)}
              pattern="[0-2][0-9]:[0-5][0-9]"
              required
              type="time"
              value={handoffAt}
            />
          </Field>
          <Field label="Time zone">
            <Select onChange={(event) => setTimezone(event.target.value)} value={timezone}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm text-ink-muted">Escalation</legend>
          <p className="mb-2 text-[13px] text-ink-faint">
            The person on call is paged first. Each step waits for an acknowledgement before it
            runs.
          </p>
          {steps.length > 0 ? (
            <ol className="space-y-2">
              {steps.map((step, index) => (
                <li
                  className="flex flex-wrap items-center gap-2 rounded-2xl bg-panel px-3 py-2 text-[15px] text-ink"
                  // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional and have no identity
                  key={index}
                >
                  <span className="text-ink-muted">{index === 0 ? "After" : "Then after"}</span>
                  <input
                    aria-label={`Minutes before step ${index + 1}`}
                    className="hark-field h-8 w-16 rounded-full px-3 text-center text-[15px] tabular-nums"
                    max={1440}
                    min={1}
                    onChange={(event) =>
                      updateStep(index, {
                        afterMinutes: Math.max(1, Math.min(1440, Number(event.target.value) || 1)),
                      })
                    }
                    required
                    type="number"
                    value={step.afterMinutes}
                  />
                  <span className="text-ink-muted">min, page</span>
                  <Select
                    aria-label={`Who step ${index + 1} pages`}
                    className="w-40"
                    compact
                    onChange={(event) =>
                      updateStep(index, { target: event.target.value as "next" | "group" })
                    }
                    value={step.target}
                  >
                    <option value="next">the next person</option>
                    <option value="group">the whole group</option>
                  </Select>
                  <span className="flex-1" />
                  <IconButton
                    label={`Remove step ${index + 1}`}
                    onClick={() =>
                      setSteps((current) => current.filter((_, position) => position !== index))
                    }
                  >
                    <path d="m4.5 4.5 7 7m0-7-7 7" />
                  </IconButton>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-3 text-sm text-ink-muted">
              No escalation. Only the person on call is paged.
            </p>
          )}
          {steps.length < MAX_ESCALATION_STEPS ? (
            <button
              className={`${rowButton} mt-2`}
              onClick={() =>
                setSteps((current) => [
                  ...current,
                  { afterMinutes: 10, target: current.length === 0 ? "next" : "group" },
                ])
              }
              type="button"
            >
              Add step
            </button>
          ) : (
            <p className="mt-2 text-[13px] text-ink-faint">Up to {MAX_ESCALATION_STEPS} steps.</p>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm text-ink-muted">Repeat alerts</legend>
          <p className="mb-2 text-[13px] text-ink-faint">
            Whoever is being paged gets the alert again until someone acknowledges. Repeats replace
            the alert instead of stacking. 0 alerts once.
          </p>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-panel px-3 py-2 text-[15px] text-ink">
            <span className="text-ink-muted">Repeat every</span>
            <input
              aria-label="Seconds between repeat alerts"
              className="hark-field h-8 w-20 rounded-full px-3 text-center text-[15px] tabular-nums"
              max={ONCALL_RING_INTERVAL_MAX_SECONDS}
              min={ONCALL_RING_INTERVAL_MIN_SECONDS}
              onChange={(event) => setRingInterval(event.target.value)}
              required
              step={1}
              type="number"
              value={ringInterval}
            />
            <span className="text-ink-muted">seconds, up to</span>
            <input
              aria-label="Repeat alerts per person"
              className="hark-field h-8 w-16 rounded-full px-3 text-center text-[15px] tabular-nums"
              max={ONCALL_RING_MAX_REPEATS_LIMIT}
              min={0}
              onChange={(event) => setRingRepeats(event.target.value)}
              required
              step={1}
              type="number"
              value={ringRepeats}
            />
            <span className="text-ink-muted">times</span>
          </div>
          <p className="mt-2 text-[13px] text-ink-faint">
            {ONCALL_RING_INTERVAL_MIN_SECONDS}–{ONCALL_RING_INTERVAL_MAX_SECONDS} seconds, up to{" "}
            {ONCALL_RING_MAX_REPEATS_LIMIT} repeats. Each person can turn ringing off or pick their
            own interval.
          </p>
        </fieldset>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <button className={secondaryButton} disabled={busy} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={primaryButtonSmall}
          disabled={busy || name.trim().length === 0 || rotation.length === 0}
          type="submit"
        >
          {busy ? "Saving…" : group ? "Save changes" : "Create group"}
        </button>
      </div>
    </Modal>
  );
}

const PERSONAL_INTERVALS = [30, 60, 120, 300] as const;

const CRITICAL_ALERTS: Record<
  CriticalAlertState | "unknown",
  { label: string; tone: "ok" | "outline"; detail: string }
> = {
  authorized: {
    label: "Critical Alerts on",
    tone: "ok",
    detail: "Pages ring through silent mode and Focus.",
  },
  denied: {
    label: "Critical Alerts off",
    tone: "outline",
    detail:
      "Turned off in iOS Settings. Pages are time-sensitive with the alarm sound, so keep the ringer on.",
  },
  notDetermined: {
    label: "Not set up",
    tone: "outline",
    detail: "Hark hasn't asked yet. Pages are time-sensitive with the alarm sound.",
  },
  unavailable: {
    label: "Not available",
    tone: "outline",
    detail:
      "This build doesn't have Critical Alerts yet. Pages are time-sensitive with the alarm sound.",
  },
  unknown: {
    label: "Unknown",
    tone: "outline",
    detail:
      "Update Hark on this iPhone to report it. Pages are time-sensitive with the alarm sound.",
  },
};

/** The viewer's own ringing preferences and each iPhone's Critical Alerts status. */
function PagingSettings() {
  const [settings, setSettings] = useState<OncallSettingsDto | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    api
      .getOncallSettings()
      .then((response) => {
        if (!cancelled) setSettings(response.settings);
      })
      .catch((err) => {
        if (cancelled) return;
        // Servers without ringing have no settings route.
        if (err instanceof ApiRequestError && err.status === 404) setHidden(true);
        else setError(errorMessage(err, "Could not load your paging settings"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = async (input: OncallSettingsUpdateInput) => {
    setBusy(true);
    setError(null);
    try {
      setSettings((await api.updateOncallSettings(input)).settings);
    } catch (err) {
      setError(errorMessage(err, "Could not save your paging settings"));
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;
  const interval = settings?.ringIntervalSeconds ?? null;
  const intervals =
    interval !== null && !PERSONAL_INTERVALS.some((value) => value === interval)
      ? [...PERSONAL_INTERVALS, interval].sort((a, b) => a - b)
      : PERSONAL_INTERVALS;

  return (
    <article aria-labelledby={headingId} className="hark-glass mt-4 rounded-3xl p-4 sm:p-5">
      <h3 className="text-[17px] font-medium text-white" id={headingId}>
        Your paging
      </h3>
      <p className="mt-0.5 text-[13px] text-ink-faint">
        How pages reach you, in every on-call group.
      </p>
      {settings === null ? (
        error ? null : (
          <p className="mt-3 text-sm text-ink-faint">Loading your paging settings…</p>
        )
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
            <Switch
              checked={settings.ringUntilAcknowledged}
              disabled={busy}
              label="Ring until acknowledged"
              onChange={(value) => void update({ ringUntilAcknowledged: value })}
            />
            <div className="w-full sm:w-48">
              <Select
                aria-label="Repeat interval"
                compact
                disabled={busy || !settings.ringUntilAcknowledged}
                onChange={(event) =>
                  void update({
                    ringIntervalSeconds: event.target.value ? Number(event.target.value) : null,
                  })
                }
                value={interval === null ? "" : String(interval)}
              >
                <option value="">Group default</option>
                {intervals.map((value) => (
                  <option key={value} value={value}>
                    Every {intervalLabel(value)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="mt-2 text-[13px] text-ink-faint">
            {settings.ringUntilAcknowledged
              ? "Pages repeat until someone acknowledges, up to each group's limit."
              : "You get one alert per page. Escalation still moves on if nobody acknowledges."}
          </p>

          <h4 className="mt-5 text-[15px] font-medium text-white">Critical Alerts</h4>
          {settings.devices.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              No iPhone yet. Install Hark and sign in to get pages.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {settings.devices.map((device) => {
                const state = CRITICAL_ALERTS[device.criticalAlerts ?? "unknown"];
                return (
                  <li className="py-2" key={device.id}>
                    <div className="flex items-center gap-2.5">
                      <span className="min-w-0 flex-1 truncate text-[15px] text-white">
                        {device.deviceName ?? "iPhone"}
                      </span>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-faint">{state.detail}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </article>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-hover hover:text-white disabled:opacity-35 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 16 16"
      >
        {children}
      </svg>
    </button>
  );
}
