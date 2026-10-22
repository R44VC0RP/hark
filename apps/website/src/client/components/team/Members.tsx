import type {
  TeamDto,
  TeamInviteCreateResponse,
  TeamInviteDto,
  TeamMemberDto,
  TeamRole,
} from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  canManage,
  ROLE_LABELS,
  seatsFull,
  seatsLabel,
  TEAM_FREE_SEATS,
  TEAM_SEAT_PRICE_MONTHLY,
  withArticle,
} from "../../lib/teams";
import { useConfirm } from "../ConfirmDialog";
import { CopyField } from "../CopyField";
import {
  Badge,
  ErrorText,
  errorMessage,
  Field,
  INPUT,
  LIST_PANEL,
  Modal,
  PersonAvatar,
  relativeFuture,
  SECTION,
  SectionHeading,
  Select,
} from "../DashboardKit";
import { primaryButtonSmall, rowButton, rowDangerButton, secondaryButton } from "../ui";

/** Seat usage plus the checkout / billing portal entry points. */
export function SeatsPanel({ team, activating }: { team: TeamDto; activating: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = seatsFull(team);
  const manage = canManage(team.role);
  // Only the owner can open team checkout or the billing portal.
  const owner = team.role === "owner";
  const paid = team.plan === "team";
  const ratio =
    team.seats.available === null || team.seats.available === 0
      ? 1
      : Math.min(1, team.seats.used / team.seats.available);

  const redirect = async (kind: "checkout" | "portal") => {
    setBusy(true);
    setError(null);
    try {
      const { url } =
        kind === "checkout"
          ? await api.startTeamCheckout(team.id)
          : await api.openTeamBillingPortal(team.id);
      window.location.assign(url);
    } catch (err) {
      setError(errorMessage(err, "Could not open billing"));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="seats-heading" className="hark-glass rounded-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="seats-heading" className="text-[17px] font-medium text-white">
            Seats
          </h2>
          <p className="mt-0.5 text-[26px] leading-tight font-medium tracking-[-0.015em] text-white tabular-nums">
            {seatsLabel(team)}
          </p>
        </div>
        {owner ? (
          <div className="flex flex-wrap gap-2">
            {paid ? (
              <button
                className={secondaryButton}
                disabled={busy}
                onClick={() => void redirect("portal")}
                type="button"
              >
                {busy ? "Opening…" : "Manage seats"}
              </button>
            ) : (
              <button
                className={primaryButtonSmall}
                disabled={busy}
                onClick={() => void redirect("checkout")}
                type="button"
              >
                {busy ? "Opening…" : "Add seats"}
              </button>
            )}
          </div>
        ) : null}
      </div>
      {team.seats.available !== null ? (
        <div
          aria-hidden="true"
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/12"
          title={seatsLabel(team)}
        >
          <div
            className={`h-full rounded-full ${full ? "bg-warn" : "bg-mint"}`}
            style={{ width: `${Math.max(4, ratio * 100)}%` }}
          />
        </div>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        First seat free, ${TEAM_SEAT_PRICE_MONTHLY} per extra seat per month.
        {paid && manage
          ? ` ${team.seats.billable} paid ${team.seats.billable === 1 ? "seat" : "seats"} · $${
              team.seats.billable * TEAM_SEAT_PRICE_MONTHLY
            }/month.`
          : paid
            ? ""
            : ` This team is on the free plan with ${TEAM_FREE_SEATS} seat.`}
        {manage && !owner ? " The team owner manages billing." : ""}
      </p>
      {activating ? (
        <p className="mt-3 rounded-2xl bg-white/12 px-4 py-3 text-[15px] text-white" role="status">
          Payment received. Updating your seats…
        </p>
      ) : full ? (
        <p className="mt-3 rounded-2xl bg-warn/12 px-4 py-3 text-sm text-white ring-1 ring-warn/40 ring-inset">
          {owner
            ? "Every seat is in use. Add a seat before the next person accepts an invite."
            : "Every seat is in use. Ask the team owner to add seats before inviting anyone else."}
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

export function MembersSection({
  team,
  members,
  viewerId,
  onChanged,
}: {
  team: TeamDto;
  members: TeamMemberDto[];
  viewerId: string;
  onChanged: () => Promise<void> | void;
}) {
  const manage = canManage(team.role);
  const [invites, setInvites] = useState<TeamInviteDto[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [reveal, setReveal] = useState<TeamInviteCreateResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const loadInvites = useCallback(async () => {
    if (!manage) return;
    try {
      const { invites } = await api.listTeamInvites(team.id);
      setInvites(invites.filter((invite) => !invite.acceptedAt && !invite.revokedAt));
    } catch {
      setInvites([]);
    }
  }, [manage, team.id]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const run = async (id: string, action: () => Promise<unknown>, failure: string) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(errorMessage(err, failure));
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = (member: TeamMemberDto, role: TeamRole) =>
    run(
      member.userId,
      () => api.updateTeamMember(team.id, member.userId, { role }),
      "Could not change this role",
    );

  const transfer = async (member: TeamMemberDto) => {
    const confirmed = await confirm({
      title: "Transfer ownership",
      message: `Make ${member.name} the owner of ${team.name}? You'll become an admin, and only the new owner can delete the team or transfer it again.`,
      confirmLabel: "Transfer ownership",
      destructive: true,
    });
    if (!confirmed) return;
    await run(
      member.userId,
      () => api.updateTeamMember(team.id, member.userId, { role: "owner" }),
      "Could not transfer ownership",
    );
  };

  const remove = async (member: TeamMemberDto) => {
    const confirmed = await confirm({
      title: "Remove member",
      message: `Remove ${member.name} from ${team.name}? They lose access to team apps and leave every on-call rotation.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    await run(
      member.userId,
      () => api.removeTeamMember(team.id, member.userId),
      "Could not remove this member",
    );
  };

  const revoke = async (invite: TeamInviteDto) => {
    setBusyId(invite.id);
    setError(null);
    try {
      await api.revokeTeamInvite(team.id, invite.id);
      setInvites((current) => current?.filter((item) => item.id !== invite.id) ?? current);
    } catch (err) {
      setError(errorMessage(err, "Could not revoke this invite"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="members-heading" className={SECTION}>
      <SectionHeading
        id="members-heading"
        title="Members"
        description={`${members.length} ${members.length === 1 ? "person" : "people"} · ${seatsLabel(team)}`}
        action={
          manage ? (
            <button className={rowButton} onClick={() => setInviting(true)} type="button">
              Invite
            </button>
          ) : null
        }
      />

      {reveal ? (
        <div className="hark-glass mb-5 rounded-3xl p-5">
          <div className="mb-1 flex items-center justify-between gap-4">
            <h3 className="text-lg font-medium text-white">
              {reveal.invite.email ? `Invite for ${reveal.invite.email}` : "Invite link ready"}
            </h3>
            <button
              className="text-[15px] text-ink-muted transition-colors hover:text-white"
              onClick={() => setReveal(null)}
              type="button"
            >
              Done
            </button>
          </div>
          <p className="mb-4 text-sm text-ink-muted">
            Copy it now; it's only shown once. It joins {team.name} as{" "}
            {withArticle(reveal.invite.role)} and expires {relativeFuture(reveal.invite.expiresAt)}.
          </p>
          <div className="rounded-2xl bg-panel py-1 pr-1 pl-4">
            <CopyField label="invite link" value={reveal.url} />
          </div>
        </div>
      ) : null}

      <ul className={LIST_PANEL}>
        {members.map((member) => {
          const self = member.userId === viewerId;
          const busy = busyId === member.userId;
          const editable = manage && !self && member.role !== "owner";
          return (
            <li
              className="flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3.5"
              key={member.userId}
            >
              <PersonAvatar person={member} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-medium text-white">{member.name}</span>
                  {self ? <Badge tone="outline">You</Badge> : null}
                </p>
                <p className="truncate text-[13px] text-ink-faint">{member.email}</p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 pl-12 sm:w-auto sm:shrink-0 sm:justify-end sm:pl-0">
                {editable ? (
                  <Select
                    aria-label={`Role for ${member.name}`}
                    className="w-[7.5rem]"
                    compact
                    disabled={busy}
                    onChange={(event) => void changeRole(member, event.target.value as TeamRole)}
                    value={member.role}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </Select>
                ) : (
                  <Badge tone={member.role === "owner" ? "strong" : "quiet"}>
                    {ROLE_LABELS[member.role]}
                  </Badge>
                )}
                {team.role === "owner" && !self ? (
                  <button
                    className={rowButton}
                    disabled={busy}
                    onClick={() => void transfer(member)}
                    type="button"
                  >
                    Make owner
                  </button>
                ) : null}
                {editable ? (
                  <button
                    className={rowDangerButton}
                    disabled={busy}
                    onClick={() => void remove(member)}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {manage && invites && invites.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-3 text-[17px] font-medium text-white">Pending invites</h3>
          <ul className={LIST_PANEL}>
            {invites.map((invite) => (
              <li className="flex items-center gap-3 py-3.5" key={invite.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">
                    {invite.email ?? "Anyone with the link"}
                  </p>
                  <p className="truncate text-[13px] text-ink-faint">
                    {ROLE_LABELS[invite.role]} · invited by {invite.invitedBy} · expires{" "}
                    {relativeFuture(invite.expiresAt)}
                  </p>
                </div>
                <button
                  className={rowDangerButton}
                  disabled={busyId === invite.id}
                  onClick={() => void revoke(invite)}
                  type="button"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ErrorText>{error}</ErrorText>
      {inviting ? (
        <InviteModal
          team={team}
          onClose={() => setInviting(false)}
          onCreated={(response) => {
            setInviting(false);
            setReveal(response);
            setInvites((current) => [response.invite, ...(current ?? [])]);
          }}
        />
      ) : null}
      {dialog}
    </section>
  );
}

function InviteModal({
  team,
  onClose,
  onCreated,
}: {
  team: TeamDto;
  onClose: () => void;
  onCreated: (response: TeamInviteCreateResponse) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = email.trim();
      onCreated(
        await api.createTeamInvite(team.id, { role, ...(trimmed ? { email: trimmed } : {}) }),
      );
    } catch (err) {
      setError(errorMessage(err, "Could not create the invite"));
      setBusy(false);
    }
  };

  return (
    <Modal
      busy={busy}
      description="You'll get a join link to send. It expires in 7 days."
      onClose={onClose}
      onSubmit={submit}
      title={`Invite to ${team.name}`}
    >
      <div className="space-y-4">
        <Field
          hint="If they already use Hark, their iPhone gets a notification too."
          label={
            <>
              Email <span className="font-normal">(optional)</span>
            </>
          }
        >
          <input
            autoComplete="off"
            className={INPUT}
            data-autofocus
            onChange={(event) => setEmail(event.target.value)}
            placeholder="maya@example.com"
            type="email"
            value={email}
          />
        </Field>
        <Field
          hint={
            role === "admin"
              ? "Uses team apps and also manages members, invites, seats and on-call."
              : "Uses team apps and can be added to on-call rotations."
          }
          label="Role"
        >
          <Select
            onChange={(event) => setRole(event.target.value as "member" | "admin")}
            value={role}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        {seatsFull(team) ? (
          <p className="rounded-2xl bg-warn/12 px-4 py-3 text-sm text-white ring-1 ring-warn/40 ring-inset">
            Every seat is in use, so they won't be able to join until you add a seat. First seat
            free, ${TEAM_SEAT_PRICE_MONTHLY} per extra seat per month.
          </p>
        ) : null}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <button className={secondaryButton} disabled={busy} onClick={onClose} type="button">
          Cancel
        </button>
        <button className={primaryButtonSmall} disabled={busy} type="submit">
          {busy ? "Creating…" : "Create invite"}
        </button>
      </div>
    </Modal>
  );
}

/** Leave (members and admins) or delete (owner) at the bottom of the team page. */
export function LeaveOrDelete({
  team,
  onLeft,
}: {
  team: TeamDto;
  onLeft: (kind: "left" | "deleted") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const owner = team.role === "owner";

  const act = async () => {
    const confirmed = await confirm(
      owner
        ? {
            title: "Delete team",
            message: `Delete ${team.name}? Its apps, invites, on-call groups and pages are removed for everyone. This can't be undone.`,
            confirmLabel: "Delete team",
            destructive: true,
          }
        : {
            title: "Leave team",
            message: `Leave ${team.name}? You lose access to its apps and leave every on-call rotation.`,
            confirmLabel: "Leave team",
            destructive: true,
          },
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      if (owner) await api.deleteTeam(team.id);
      else await api.leaveTeam(team.id);
      onLeft(owner ? "deleted" : "left");
    } catch (err) {
      setError(errorMessage(err, owner ? "Could not delete the team" : "Could not leave the team"));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="leave-heading" className={SECTION}>
      <SectionHeading
        id="leave-heading"
        title={owner ? "Delete team" : "Leave team"}
        description={
          owner
            ? "To leave instead, make someone else the owner first."
            : "You can rejoin later with a new invite."
        }
      />
      <button
        className={`${rowDangerButton} h-9 px-4 text-sm`}
        disabled={busy}
        onClick={() => void act()}
        type="button"
      >
        {owner ? "Delete team" : "Leave team"}
      </button>
      <ErrorText>{error}</ErrorText>
      {dialog}
    </section>
  );
}
