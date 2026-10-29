import { API_TOKEN_SCOPE_DESCRIPTIONS, type OAuthClientGrantDto } from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { oauthApi } from "../lib/oauth-api";
import { useConfirm } from "./ConfirmDialog";
import { EmptyState } from "./DashboardKit";
import { rowDangerButton } from "./ui";

const LIST_PANEL = "hark-glass divide-y divide-line rounded-3xl px-4 sm:px-5";

/**
 * Dashboard section listing MCP/OAuth clients connected to the account
 * (Claude, OpenCode, Cursor, …) with their permissions and a Disconnect
 * action that revokes their access and refresh tokens. Self-contained:
 * render `<McpClientsSection />` anywhere on the dashboard.
 */
export function McpClientsSection({
  onChange,
}: {
  /** Called with the list after it loads and after a disconnect. */
  onChange?: (clients: OAuthClientGrantDto[]) => void;
}) {
  const [clients, setClients] = useState<OAuthClientGrantDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const { clients: next } = await oauthApi.listClients();
      setClients(next);
      onChange?.(next);
    } catch (err) {
      setClients([]);
      setError(err instanceof Error ? err.message : "Could not load connected clients");
    }
  }, [onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = async (client: OAuthClientGrantDto) => {
    const confirmed = await confirm({
      title: "Disconnect MCP client",
      message: `Disconnect “${client.name}”? Its access stops immediately and it must ask for your approval again to reconnect.`,
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(client.clientId);
    setError(null);
    try {
      await oauthApi.revokeClient(client.clientId);
      const next = (clients ?? []).filter((item) => item.clientId !== client.clientId);
      setClients(next);
      onChange?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect this client");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-10 border-t border-line pt-8" aria-labelledby="mcp-clients-heading">
      <div className="mb-5">
        <h2
          id="mcp-clients-heading"
          className="text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-white"
        >
          Connected MCP clients
        </h2>
        <p className="mt-1.5 text-ink-muted">
          Clients you've approved through the MCP server, and what each one can do.
        </p>
      </div>
      {clients === null ? <p className="py-4 text-ink-faint">Loading clients…</p> : null}
      {clients?.length === 0 && !error ? (
        <EmptyState title="No MCP clients connected">
          Clients you approve show up here, with what they can do.
        </EmptyState>
      ) : null}
      {clients && clients.length > 0 ? (
        <ul className={LIST_PANEL}>
          {clients.map((client) => (
            <li
              className="flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3.5"
              key={client.clientId}
            >
              {client.iconUrl?.startsWith("https:") ? (
                <img
                  alt=""
                  className="size-9 shrink-0 rounded-full bg-white object-cover ring-1 ring-white/15"
                  src={client.iconUrl}
                />
              ) : (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-medium text-green">
                  {client.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">{client.name}</p>
                <p className="truncate text-[13px] text-ink-faint">
                  {client.lastUsedAt
                    ? `Last used ${new Date(client.lastUsedAt).toLocaleString()}`
                    : "Not used yet"}{" "}
                  · connected {new Date(client.createdAt).toLocaleDateString()}
                  {client.redirectHosts.length > 0 ? ` · ${client.redirectHosts.join(", ")}` : ""}
                </p>
                <p
                  className="mt-0.5 truncate text-[13px] text-ink-faint"
                  title={client.scopes.join(" ")}
                >
                  {client.scopes.length === 0
                    ? "No permissions"
                    : client.scopes
                        .map((scope) => API_TOKEN_SCOPE_DESCRIPTIONS[scope].label)
                        .join(" · ")}
                </p>
              </div>
              <button
                className={rowDangerButton}
                disabled={busyId === client.clientId}
                onClick={() => void disconnect(client)}
                type="button"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {dialog}
    </section>
  );
}
