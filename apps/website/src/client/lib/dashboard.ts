import type {
  ApiTokenDto,
  AppDto,
  BillingDto,
  DeviceDto,
  EventDto,
  LiveActivityDto,
  OAuthClientGrantDto,
  ServiceCreatedResponse,
  ServiceDto,
  TeamDto,
} from "@hark/contracts";
import { createContext, useContext } from "react";
import type { OncallMeResponse } from "./api";

/**
 * Everything the dashboard tabs share. The layout loads it once and keeps it
 * fresh, so switching tabs never refetches or flashes "Loading…".
 */
export interface DashboardData {
  user: { id: string; name: string; email: string; image?: string | null };
  services: ServiceDto[] | null;
  events: EventDto[] | null;
  liveActivities: LiveActivityDto[] | null;
  devices: DeviceDto[] | null;
  apiTokens: ApiTokenDto[] | null;
  apps: AppDto[] | null;
  /** `"unsupported"` when the server predates teams; the tab stays hidden. */
  teams: TeamDto[] | "unsupported" | null;
  teamsError: string | null;
  billing: BillingDto | null;
  /** `null` until loaded, or when the viewer is in no team. */
  oncall: OncallMeResponse | null;
  mcpClients: OAuthClientGrantDto[] | null;
  refresh: () => Promise<void>;
  refreshActivity: () => Promise<void>;
  refreshOncall: () => Promise<void>;
  setApps: React.Dispatch<React.SetStateAction<AppDto[] | null>>;
  setTeams: React.Dispatch<React.SetStateAction<TeamDto[] | "unsupported" | null>>;
  setApiTokens: React.Dispatch<React.SetStateAction<ApiTokenDto[] | null>>;
  setMcpClients: (clients: OAuthClientGrantDto[]) => void;
  /** Opens the new-service dialog; the created webhook is revealed above the tab. */
  createService: () => void;
  editService: (service: ServiceDto) => void;
  /** Shows a rotated webhook URL above the tab. */
  revealRotated: (response: ServiceCreatedResponse) => void;
}

export const DashboardContext = createContext<DashboardData | null>(null);

export function useDashboard(): DashboardData {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard must be used inside the dashboard layout");
  return value;
}

/** Notifications used this month, from the billing limits and what's left. */
export function notificationUsage(billing: BillingDto | null): {
  used: number;
  limit: number;
  unlimited: boolean;
} | null {
  if (!billing) return null;
  const limit = billing.limits.notificationsPerMonth;
  const remaining = billing.usage.notificationsRemaining;
  if (remaining === null) return { used: 0, limit, unlimited: true };
  return { used: Math.max(0, limit - remaining), limit, unlimited: false };
}

/** Open pages for the viewer, unacknowledged first. */
export function openPages(oncall: OncallMeResponse | null) {
  if (!oncall) return [];
  return oncall.pages
    .filter((page) => page.status !== "resolved")
    .sort((a, b) =>
      a.status === b.status
        ? b.createdAt.localeCompare(a.createdAt)
        : a.status === "triggered"
          ? -1
          : 1,
    );
}
