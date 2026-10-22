import { API_TOKEN_SCOPE_DESCRIPTIONS, type OAuthClientGrantDto } from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { oauthApi } from "../lib/oauth-api";
import { useConfirm } from "./ConfirmDialog";
import { rowDangerButton } from "./ui";

const LIST_PANEL = "hark-glass divide-y divide-line rounded-3xl px-4 sm:px-5";

/**
 * Dashboard section listing MCP/OAuth clients connected to the account
 * (Claude, OpenCode, Cursor, …) with their permissions and a Disconnect
 * action that revokes their access and refresh tokens. Self-contained:
 * render `<McpClientsSection />` anywhere on the dashboard.
 */
export function McpClientsSection({ mcpUrl }: { mcpUrl?: string }) {
  const [clients, setClients] = useState<OAuthClientGrantDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const endpoint = mcpUrl ?? `${window.location.origin}/mcp`;

  const load = useCallback(async () => {
    try {
      setClients((await oauthApi.listClients()).clients);
    } catch (err) {
      setClients([]);
      setError(err instanceof Error ? err.message : "Could not load connected clients");
    }
  }, []);

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
      setClients((current) => current?.filter((item) => item.clientId !== client.clientId) ?? null);
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
          Add{" "}
          <code className="rounded-md bg-white/8 px-1 py-px font-mono text-[0.86em] text-white">
            {endpoint}
          </code>{" "}
          to Claude, OpenCode, Cursor, or any MCP client. It asks for your approval here first.
        </p>
      </div>
      {clients === null ? <p className="py-4 text-ink-faint">Loading clients…</p> : null}
      {clients?.length === 0 && !error ? (
        <div className="rounded-3xl border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="font-medium text-white">No MCP clients connected</p>
        </div>
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
