import type {
  AppDto,
  AppLaunchInput,
  AppPassResponse,
  AppShareInput,
  AppSharingInput,
  DeviceAlertSettingsInput,
  DeviceDto,
  DeviceRegisterInput,
  DeviceUnregisterInput,
  EventDto,
  InboxActivityKind,
  InboxActivityPageDto,
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxMarkAllReadInput,
  InboxNotificationDetailDto,
  InboxNotificationPageDto,
  InboxProjectsDto,
  InteractionCredentialResponseInput,
  InteractionDto,
  InteractionResponseInput,
  LiveActivityPushToStartTokenInput,
  LiveActivityUpdateTokenInput,
  OncallGroupDto,
  OncallPageDto,
  OncallSettingsDto,
  OncallSettingsUpdateInput,
  OncallShiftDto,
  TeamDto,
  TeamInviteCreateResponse,
  TeamInviteDto,
  TeamInvitePreviewDto,
  TeamJoinResponse,
  TeamMemberDto,
  TeamRole,
} from "@hark/contracts";
import { apiErrorFromBody } from "./api-error";
import { API_URL, getCookie } from "./auth";

export type { NotificationDetailFailure } from "./api-error";
export { ApiError, classifyNotificationDetailFailure } from "./api-error";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = getCookie();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || body === null) {
    throw apiErrorFromBody(response.status, body);
  }
  return body;
}

export const api = {
  listDevices: () => request<{ devices: DeviceDto[] }>("/api/devices"),
  registerDevice: (input: DeviceRegisterInput) =>
    request<{ device: { id: string } }>("/api/devices", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  reportAlertSettings: (input: DeviceAlertSettingsInput) =>
    request<{ device: DeviceDto }>("/api/devices/alert-settings", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  unregisterDevice: (input: DeviceUnregisterInput) =>
    request<{ ok: true }>("/api/devices", {
      method: "DELETE",
      body: JSON.stringify(input),
    }),
  registerLiveActivityPushToStartToken: (input: LiveActivityPushToStartTokenInput) =>
    request<{ deviceId: string; updatedAt?: string }>("/api/devices/live-activity/push-to-start", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  registerLiveActivityUpdateToken: (input: LiveActivityUpdateTokenInput) =>
    request<{ activityId: string; deviceId: string }>("/api/devices/live-activity/update-token", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listEvents: (limit = 20) => request<{ events: EventDto[] }>(`/api/events?limit=${limit}`),
  listPendingInteractions: () =>
    request<{ interactions: InboxInteractionDto[] }>("/api/interactions"),
  listActiveActivities: () => request<{ activities: InboxLiveActivityDto[] }>("/api/activities"),
  listActivityFeed: (filter: "all" | InboxActivityKind, page: number) =>
    request<InboxActivityPageDto>(`/api/activity-feed?filter=${filter}&page=${page}`),
  respondToInteraction: (id: string, input: InteractionResponseInput) =>
    request<{ interaction: InteractionDto }>(`/api/interactions/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  respondToInteractionWithToken: (id: string, input: InteractionCredentialResponseInput) =>
    request<{ ok: true; status: string }>(`/api/interaction-responses/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Project inbox endpoints. Older or self-hosted servers 404 on these; the
  // app treats that as "no project inbox" and keeps the legacy behavior.
  listInboxProjects: () => request<InboxProjectsDto>("/api/inbox/projects"),
  listInboxNotifications: (params: {
    project?: string;
    unread?: boolean;
    cursor?: string;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.project) query.set("project", params.project);
    if (params.unread) query.set("unread", "1");
    if (params.cursor) query.set("cursor", params.cursor);
    query.set("limit", String(params.limit ?? 20));
    return request<InboxNotificationPageDto>(`/api/inbox/notifications?${query.toString()}`);
  },
  getInboxNotification: (id: string) =>
    request<{ notification: InboxNotificationDetailDto }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}`,
    ),
  markNotificationRead: (id: string) =>
    request<{ ok: true; readAt: string }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}/read`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  markNotificationUnread: (id: string) =>
    request<{ ok: true; readAt: null }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}/unread`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  listApps: () => request<{ apps: AppDto[] }>("/api/apps"),
  getApp: (id: string) => request<{ app: AppDto }>(`/api/apps/${encodeURIComponent(id)}`),
  updateAppSharing: (id: string, input: AppSharingInput) =>
    request<{ app: AppDto }>(`/api/apps/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  /** Issues a short-lived signed pass. Fails with `consent_required` until approved. */
  getAppPass: (id: string, input: AppLaunchInput = {}) =>
    request<AppPassResponse>(`/api/apps/${encodeURIComponent(id)}/pass`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  revokeApp: (id: string) =>
    request<{ app: AppDto }>(`/api/apps/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  removeApp: (id: string) =>
    request<{ ok: true }>(`/api/apps/${encodeURIComponent(id)}`, { method: "DELETE" }),
  markAllNotificationsRead: (input: InboxMarkAllReadInput) =>
    request<{ ok: true; updated: number }>("/api/inbox/notifications/read-all", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** Moves a personal app into a team, or (`teamId: null`) back to the caller's apps. */
  shareApp: (id: string, input: AppShareInput) =>
    request<{ app: AppDto }>(`/api/apps/${encodeURIComponent(id)}/share`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // Teams and on-call. Older servers 404 on these; screens hide team UI then.
  listTeams: () => request<{ teams: TeamDto[] }>("/api/teams"),
  createTeam: (name: string) =>
    request<{ team: TeamDto }>("/api/teams", { method: "POST", body: JSON.stringify({ name }) }),
  getTeam: (id: string) =>
    request<{ team: TeamDto; members: TeamMemberDto[] }>(`/api/teams/${encodeURIComponent(id)}`),
  renameTeam: (id: string, name: string) =>
    request<{ team: TeamDto }>(`/api/teams/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteTeam: (id: string) =>
    request<{ ok: true }>(`/api/teams/${encodeURIComponent(id)}`, { method: "DELETE" }),
  leaveTeam: (id: string) =>
    request<{ ok: true }>(`/api/teams/${encodeURIComponent(id)}/leave`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  updateTeamMember: (teamId: string, userId: string, role: TeamRole) =>
    request<{ member: TeamMemberDto }>(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ),
  removeTeamMember: (teamId: string, userId: string) =>
    request<{ ok: true }>(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
  listTeamInvites: (teamId: string) =>
    request<{ invites: TeamInviteDto[] }>(`/api/teams/${encodeURIComponent(teamId)}/invites`),
  createTeamInvite: (teamId: string, input: { email?: string; role: "admin" | "member" }) =>
    request<TeamInviteCreateResponse>(`/api/teams/${encodeURIComponent(teamId)}/invites`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  revokeTeamInvite: (teamId: string, inviteId: string) =>
    request<{ ok: true }>(
      `/api/teams/${encodeURIComponent(teamId)}/invites/${encodeURIComponent(inviteId)}`,
      { method: "DELETE" },
    ),
  /** Public: works signed out. */
  previewTeamInvite: (code: string) =>
    request<TeamInvitePreviewDto>(`/api/team-invites/${encodeURIComponent(code)}`),
  /** Fails with 402 `seat_limit` when the team does not have the Team plan. */
  acceptTeamInvite: (code: string) =>
    request<TeamJoinResponse>(`/api/team-invites/${encodeURIComponent(code)}/accept`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  listTeamApps: (teamId: string) =>
    request<{ apps: AppDto[] }>(`/api/teams/${encodeURIComponent(teamId)}/apps`),
  listOncallGroups: (teamId: string) =>
    request<{ groups: OncallGroupDto[] }>(`/api/teams/${encodeURIComponent(teamId)}/oncall`),
  getOncallGroup: (groupId: string) =>
    request<{ group: OncallGroupDto }>(`/api/oncall/${encodeURIComponent(groupId)}`),
  getMyOncall: () => request<OncallMeDto>("/api/oncall/me"),
  getOncallSettings: () => request<{ settings: OncallSettingsDto }>("/api/oncall/settings"),
  updateOncallSettings: (input: OncallSettingsUpdateInput) =>
    request<{ settings: OncallSettingsDto }>("/api/oncall/settings", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  listTeamPages: (teamId: string, params: { status?: "open" | "all"; cursor?: string } = {}) => {
    const query = new URLSearchParams({ status: params.status ?? "open" });
    if (params.cursor) query.set("cursor", params.cursor);
    return request<{ pages: OncallPageDto[]; nextCursor: string | null }>(
      `/api/teams/${encodeURIComponent(teamId)}/pages?${query.toString()}`,
    );
  },
  getPage: (id: string) => request<{ page: OncallPageDto }>(`/api/pages/${encodeURIComponent(id)}`),
  /** 409 when someone else acknowledged first. */
  acknowledgePage: (id: string) =>
    request<{ page: OncallPageDto }>(`/api/pages/${encodeURIComponent(id)}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  escalatePage: (id: string) =>
    request<{ page: OncallPageDto }>(`/api/pages/${encodeURIComponent(id)}/escalate`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  resolvePage: (id: string, note?: string) =>
    request<{ page: OncallPageDto }>(`/api/pages/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify(note ? { note } : {}),
    }),
  /** Lock-screen acknowledge with the push's one-shot token; needs no session. */
  acknowledgePageWithToken: (id: string, responseToken: string) =>
    request<{ ok: true; status: string }>(
      `/api/page-responses/${encodeURIComponent(id)}/acknowledge`,
      { method: "POST", body: JSON.stringify({ responseToken }) },
    ),
};

export type OncallMeShiftDto = OncallShiftDto & {
  groupId: string;
  groupName: string;
  teamId: string;
  teamName: string;
};

export interface OncallMeDto {
  shifts: OncallMeShiftDto[];
  pages: OncallPageDto[];
  /** Ringing settings; absent on older servers. */
  settings?: OncallSettingsDto;
}
