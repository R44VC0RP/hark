import type { AppDto, TeamDto } from "@hark/contracts";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { addedByViewer, canManage } from "../lib/teams";
import { useConfirm } from "./ConfirmDialog";
import {
  AppIcon,
  EmptyState,
  ErrorText,
  errorMessage,
  Field,
  InlineCode,
  LIST_PANEL,
  Modal,
  relativeTime,
  SECTION,
  SectionHeading,
  Select,
  Switch,
} from "./DashboardKit";
import { primaryButtonSmall, rowButton, rowDangerButton, secondaryButton, textLink } from "./ui";

interface AppGroup {
  key: string;
  title: string;
  team: TeamDto | null;
  teamId: string | null;
  apps: AppDto[];
}

/**
 * Web apps, grouped into the viewer's own apps and one group per team.
 * Sharing switches and sign-in consent are always the viewer's own, even for
 * team apps.
 */
export function AppsSection({
  apps,
  teams,
  viewerName,
  onChanged,
  onRemoved,
}: {
  apps: AppDto[] | null;
  /** `null` while loading or when the server has no teams support. */
  teams: TeamDto[] | null;
  viewerName: string | null | undefined;
  onChanged: (app: AppDto) => void;
  onRemoved: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<AppDto | null>(null);
  const { confirm, dialog } = useConfirm();

  const run = async (id: string, action: () => Promise<void>, failure: string) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, failure));
    } finally {
      setBusyId(null);
    }
  };

  const share = (app: AppDto, field: "shareName" | "shareEmail", value: boolean) =>
    run(
      app.id,
      async () => onChanged((await api.updateAppSharing(app.id, { [field]: value })).app),
      "Could not update sharing",
    );

  const revoke = async (app: AppDto) => {
    const confirmed = await confirm({
      title: "Stop signing in",
      message: `${app.name} stops receiving Hark sign-in passes. You can approve it again the next time you open it.`,
      confirmLabel: "Stop signing in",
    });
    if (!confirmed) return;
    await run(app.id, async () => onChanged((await api.revokeApp(app.id)).app), "Could not revoke");
  };

  const remove = async (app: AppDto) => {
    const confirmed = await confirm({
      title: "Remove app",
      message: app.team
        ? `Remove ${app.name} from ${app.team.name}? It disappears for everyone on the team and stops receiving sign-in passes.`
        : `Remove ${app.name} from Hark? It disappears from your iPhone and stops receiving sign-in passes.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    await run(
      app.id,
      async () => {
        await api.deleteApp(app.id);
        onRemoved(app.id);
      },
      "Could not remove this app",
    );
  };

  const moveToMine = async (app: AppDto) => {
    const confirmed = await confirm({
      title: "Move to my apps",
      message: `Move ${app.name} out of ${app.team?.name ?? "the team"}? Other members lose access to it.`,
      confirmLabel: "Move",
    });
    if (!confirmed) return;
    await run(
      app.id,
      async () => onChanged((await api.shareApp(app.id, { teamId: null })).app),
      "Could not move this app",
    );
  };

  const teamById = new Map((teams ?? []).map((team) => [team.id, team]));
  const groups: AppGroup[] = [];
  if (apps) {
    const personal = apps.filter((app) => !app.team);
    groups.push({ key: "personal", title: "Yours", team: null, teamId: null, apps: personal });
    const byTeam = new Map<string, AppGroup>();
    for (const app of apps) {
      if (!app.team) continue;
      let group = byTeam.get(app.team.id);
      if (!group) {
        group = {
          key: app.team.id,
          title: app.team.name,
          team: teamById.get(app.team.id) ?? null,
          teamId: app.team.id,
          apps: [],
        };
        byTeam.set(app.team.id, group);
      }
      group.apps.push(app);
    }
    groups.push(...[...byTeam.values()].sort((a, b) => a.title.localeCompare(b.title)));
  }
  const grouped = groups.length > 1 || (teams?.length ?? 0) > 0;
  const shareTargets = teams ?? [];

  const renderApp = (app: AppDto, group: AppGroup) => {
    const busy = busyId === app.id;
    const mine = addedByViewer(app, viewerName);
    const teamRole = group.team?.role;
    const canRemove = !app.team || mine || (teamRole ? canManage(teamRole) : false);
    const meta = [
      app.lastOpenedAt ? `Opened ${relativeTime(app.lastOpenedAt)}` : "Never opened",
      app.projectName,
      app.team
        ? app.addedBy
          ? `added by ${mine ? "you" : app.addedBy}`
          : null
        : app.createdBy
          ? `added by ${app.createdBy}`
          : null,
    ].filter(Boolean);
    return (
      <li className="py-4" key={app.id}>
        <div className="flex items-center gap-3">
          <AppIcon app={app} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-white">{app.name}</p>
            <p className="truncate font-mono text-[13px] text-ink-faint" title={app.url}>
              {app.origin}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] ${
              app.consentedAt ? "bg-white/12 text-white" : "border border-line text-ink-faint"
            }`}
          >
            {app.consentedAt ? "Signed in" : "Not signed in"}
          </span>
        </div>
        <p className="mt-2 text-[13px] text-ink-faint sm:pl-[52px]">{meta.join(" · ")}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 sm:pl-[52px]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Switch
              checked={app.shareName}
              disabled={busy}
              label="Share name"
              onChange={(value) => void share(app, "shareName", value)}
            />
            <Switch
              checked={app.shareEmail}
              disabled={busy}
              label="Share email"
              onChange={(value) => void share(app, "shareEmail", value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {!app.team && shareTargets.length > 0 ? (
              <button
                className={rowButton}
                disabled={busy}
                onClick={() => setSharing(app)}
                type="button"
              >
                Share with team
              </button>
            ) : null}
            {app.team && mine ? (
              <button
                className={rowButton}
                disabled={busy}
                onClick={() => void moveToMine(app)}
                type="button"
              >
                Move to my apps
              </button>
            ) : null}
            <button
              className={rowButton}
              disabled={busy || app.consentedAt === null}
              onClick={() => void revoke(app)}
              type="button"
            >
              Stop signing in
            </button>
            {canRemove ? (
              <button
                className={rowDangerButton}
                disabled={busy}
                onClick={() => void remove(app)}
                type="button"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className={SECTION} aria-labelledby="apps-heading">
      <SectionHeading
        id="apps-heading"
        title="Apps"
        description="Web apps that open in Hark, already signed in. Each gets a private Hark ID, plus only what you choose to share."
      />
      {apps === null ? <p className="py-4 text-ink-faint">Loading apps…</p> : null}
      {apps?.length === 0 ? (
        <EmptyState title="No apps yet">
          Ask your agent to add one with <InlineCode>harkctl</InlineCode>, or see the{" "}
          <Link className="hark-link" to="/docs">
            docs
          </Link>
          .
        </EmptyState>
      ) : null}
      {apps && apps.length > 0 ? (
        <div className="space-y-7">
          {groups.map((group) =>
            group.apps.length === 0 && group.teamId === null ? (
              grouped ? (
                <div key={group.key}>
                  <AppGroupHeading group={group} />
                  <p className="rounded-3xl border border-line bg-white/[0.03] px-5 py-4 text-[15px] text-ink-muted">
                    No personal apps. Apps your agents add without a team land here.
                  </p>
                </div>
              ) : null
            ) : (
              <div key={group.key}>
                {grouped ? <AppGroupHeading group={group} /> : null}
                <ul className={LIST_PANEL}>{group.apps.map((app) => renderApp(app, group))}</ul>
              </div>
            ),
          )}
        </div>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {sharing ? (
        <ShareAppModal
          app={sharing}
          teams={shareTargets}
          onClose={() => setSharing(null)}
          onShared={(app) => {
            setSharing(null);
            onChanged(app);
          }}
        />
      ) : null}
      {dialog}
    </section>
  );
}

function AppGroupHeading({ group }: { group: AppGroup }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <h3 className="truncate text-[17px] font-medium text-white">{group.title}</h3>
        {group.teamId ? (
          <p className="mt-0.5 text-[13px] text-ink-faint">
            Shared with the team. Sign-in and sharing choices below are yours alone.
          </p>
        ) : null}
      </div>
      {group.teamId ? (
        <Link className={`${textLink} shrink-0 text-sm`} to={`/dashboard/teams/${group.teamId}`}>
          Open team <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
}

function ShareAppModal({
  app,
  teams,
  onClose,
  onShared,
}: {
  app: AppDto;
  teams: TeamDto[];
  onClose: () => void;
  onShared: (app: AppDto) => void;
}) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = teams.find((candidate) => candidate.id === teamId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!teamId) return;
    setBusy(true);
    setError(null);
    try {
      onShared((await api.shareApp(app.id, { teamId, notify })).app);
    } catch (err) {
      setError(errorMessage(err, "Could not share this app"));
      setBusy(false);
    }
  };

  return (
    <Modal
      busy={busy}
      description={`Everyone on the team can open ${app.name} in Hark, signed in as themselves.`}
      onClose={onClose}
      onSubmit={submit}
      title="Share with team"
    >
      <div className="space-y-4">
        <Field label="Team">
          <Select data-autofocus onChange={(event) => setTeamId(event.target.value)} value={teamId}>
            {teams.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </Field>
        <Switch
          checked={notify}
          label={`Notify ${team ? `${team.name} members` : "team members"}`}
          onChange={setNotify}
        />
        <p className="text-[13px] text-ink-faint">
          Each member approves sign-in and chooses what to share for themselves. You can move it
          back to your apps later.
        </p>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <button className={secondaryButton} disabled={busy} onClick={onClose} type="button">
          Cancel
        </button>
        <button className={primaryButtonSmall} disabled={busy || !teamId} type="submit">
          {busy ? "Sharing…" : "Share"}
        </button>
      </div>
    </Modal>
  );
}
