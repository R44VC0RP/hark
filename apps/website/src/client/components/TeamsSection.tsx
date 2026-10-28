import type { TeamDto } from "@hark/contracts";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../lib/api";
import { TEAM_NAME_MAX_CHARS, TEAM_SEAT_PRICE_MONTHLY, teamSummary } from "../lib/teams";
import {
  Badge,
  EmptyState,
  ErrorText,
  errorMessage,
  Field,
  INPUT,
  LIST_PANEL,
  Modal,
  SECTION,
  SectionHeading,
  TeamMark,
} from "./DashboardKit";
import { primaryButtonSmall, rowButton, secondaryButton } from "./ui";

/** Dashboard list of the viewer's teams, linking to each team page. */
export function TeamsSection({
  teams,
  error,
  onCreated,
}: {
  teams: TeamDto[] | null;
  error: string | null;
  onCreated: (team: TeamDto) => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <section className={SECTION} aria-labelledby="teams-heading">
      <SectionHeading
        id="teams-heading"
        title="Teams"
        description="Share apps with the people you work with and page whoever's on call."
        action={
          <button className={rowButton} onClick={() => setCreating(true)} type="button">
            New team
          </button>
        }
      />
      {teams === null && !error ? <p className="py-4 text-ink-faint">Loading teams…</p> : null}
      {teams?.length === 0 ? (
        <EmptyState title="No teams yet">
          Create a team to share apps and set up on-call rotations. Teams use the Team plan: $
          {TEAM_SEAT_PRICE_MONTHLY} per seat per month, every member including you.
        </EmptyState>
      ) : null}
      {teams && teams.length > 0 ? (
        <ul className={LIST_PANEL}>
          {teams.map((team) => (
            <li key={team.id}>
              <Link
                className="group -mx-4 flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/4 sm:-mx-5 sm:px-5"
                to={`/dashboard/teams/${team.id}`}
              >
                <TeamMark name={team.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-white">{team.name}</span>
                    {team.plan === "team" ? <Badge>Team plan</Badge> : null}
                  </span>
                  <span className="line-clamp-2 block text-[13px] text-ink-faint sm:truncate">
                    {teamSummary(team)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {creating ? (
        <CreateTeamModal
          onClose={() => setCreating(false)}
          onCreated={(team) => {
            setCreating(false);
            onCreated(team);
          }}
        />
      ) : null}
    </section>
  );
}

function CreateTeamModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (team: TeamDto) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { team } = await api.createTeam({ name: name.trim() });
      onCreated(team);
      navigate(`/dashboard/teams/${team.id}`);
    } catch (err) {
      setError(errorMessage(err, "Could not create the team"));
      setBusy(false);
    }
  };

  return (
    <Modal
      busy={busy}
      description={`You'll be the owner. Start the Team plan ($${TEAM_SEAT_PRICE_MONTHLY} per seat per month, you included) to add people, share apps and page.`}
      onClose={onClose}
      onSubmit={submit}
      title="New team"
    >
      <Field label="Team name">
        <input
          className={INPUT}
          data-autofocus
          maxLength={TEAM_NAME_MAX_CHARS}
          onChange={(event) => setName(event.target.value)}
          placeholder="Platform"
          required
          value={name}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <button className={secondaryButton} disabled={busy} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={primaryButtonSmall}
          disabled={busy || name.trim().length === 0}
          type="submit"
        >
          {busy ? "Creating…" : "Create team"}
        </button>
      </div>
    </Modal>
  );
}
