import type {
  ApiError,
  ApiTokenCreatedResponse,
  ApiTokenCreateInput,
  ApiTokenDto,
  AppDto,
  AppShareInput,
  AppSharingInput,
  BillingDto,
  BillingRedirectResponse,
  DeviceAuthorizationRequestDto,
  DeviceDto,
  EventDto,
  LiveActivityDto,
  OncallGroupCreateInput,
  OncallGroupDto,
  OncallGroupUpdateInput,
  OncallOverrideCreateInput,
  OncallPageCreateInput,
  OncallPageCreateResponse,
  OncallPageDto,
  OncallSettingsDto,
  OncallSettingsUpdateInput,
  PricingPlansDto,
  ServiceCreatedResponse,
  ServiceCreateInput,
  ServiceDto,
  ServiceUpdateInput,
  TeamCreateInput,
  TeamDto,
  TeamInviteCreateInput,
  TeamInviteCreateResponse,
  TeamInviteDto,
  TeamInvitePreviewDto,
  TeamJoinResponse,
  TeamMemberDto,
  TeamMemberUpdateInput,
  TeamUpdateInput,
} from "@hark/contracts";

export class ApiRequestError extends Error {
  status: number;
  /** Machine-readable discriminator; absent on bare 404s from servers without the route. */
  code?: string;
  issues?: unknown;

  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.code = body.code;
    this.issues = body.issues;
  }
}

/** A bare 404 means this server does not implement the route at all. */
export function isMissingRoute(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404 && !error.code;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });
  const body = (await response.json().catch(() => ({ error: "Request failed" }))) as T & ApiError;
  if (!response.ok) {
    throw new ApiRequestError(response.status, body);
  }
  return body;
}

function send<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const id = encodeURIComponent;

export interface OncallPageListResponse {
  pages: OncallPageDto[];
  nextCursor: string | null;
}

export const api = {
  listApiTokens: () => request<{ tokens: ApiTokenDto[] }>("/api/api-tokens"),
  getDeviceAuthorization: (code: string) =>
    request<{ request: DeviceAuthorizationRequestDto }>(
      `/api/device-authorization/requests/${encodeURIComponent(code)}`,
    ),
  approveDeviceAuthorization: (code: string) =>
    request<{ request: DeviceAuthorizationRequestDto }>(
      `/api/device-authorization/requests/${encodeURIComponent(code)}/approve`,
      { method: "POST" },
    ),
  denyDeviceAuthorization: (code: string) =>
    request<{ request: DeviceAuthorizationRequestDto }>(
      `/api/device-authorization/requests/${encodeURIComponent(code)}/deny`,
      { method: "POST" },
    ),
  createApiToken: (input: ApiTokenCreateInput) =>
    request<ApiTokenCreatedResponse>("/api/api-tokens", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  revokeApiToken: (id: string) =>
    request<{ ok: true }>(`/api/api-tokens/${id}`, { method: "DELETE" }),
  listServices: () => request<{ services: ServiceDto[] }>("/api/services"),
  createService: (input: ServiceCreateInput) =>
    request<ServiceCreatedResponse>("/api/services", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  rotateServiceToken: (id: string) =>
    request<ServiceCreatedResponse>(`/api/services/${id}/rotate`, { method: "POST" }),
  updateService: (id: string, input: ServiceUpdateInput) =>
    request<{ service: ServiceDto }>(`/api/services/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteService: (id: string) => request<{ ok: true }>(`/api/services/${id}`, { method: "DELETE" }),
  listDevices: () => request<{ devices: DeviceDto[] }>("/api/devices"),
  removeDevice: (id: string) => request<{ ok: true }>(`/api/devices/${id}`, { method: "DELETE" }),
  getBilling: () => request<BillingDto>("/api/billing"),
  getPricingPlans: () => request<PricingPlansDto>("/api/billing/plans"),
  startCheckout: () =>
    request<BillingRedirectResponse>("/api/billing/checkout", { method: "POST" }),
  openBillingPortal: () =>
    request<BillingRedirectResponse>("/api/billing/portal", { method: "POST" }),
  listEvents: (limit = 50) => request<{ events: EventDto[] }>(`/api/events?limit=${limit}`),
  listLiveActivities: () => request<{ activities: LiveActivityDto[] }>("/api/activities"),
  listApps: () => request<{ apps: AppDto[] }>("/api/apps"),
  updateAppSharing: (id: string, input: AppSharingInput) =>
    request<{ app: AppDto }>(`/api/apps/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  revokeApp: (id: string) => request<{ app: AppDto }>(`/api/apps/${id}/revoke`, { method: "POST" }),
  deleteApp: (id: string) => request<{ ok: true }>(`/api/apps/${id}`, { method: "DELETE" }),
  /** Moves an app into a team, or (`teamId: null`) back to the caller's own apps. */
  shareApp: (appId: string, input: AppShareInput) =>
    send<{ app: AppDto }>(`/api/apps/${id(appId)}/share`, "POST", input),

  // Teams
  listTeams: () => request<{ teams: TeamDto[] }>("/api/teams"),
  createTeam: (input: TeamCreateInput) => send<{ team: TeamDto }>("/api/teams", "POST", input),
  getTeam: (teamId: string) =>
    request<{ team: TeamDto; members: TeamMemberDto[] }>(`/api/teams/${id(teamId)}`),
  updateTeam: (teamId: string, input: TeamUpdateInput) =>
    send<{ team: TeamDto }>(`/api/teams/${id(teamId)}`, "PATCH", input),
  deleteTeam: (teamId: string) => send<{ ok: true }>(`/api/teams/${id(teamId)}`, "DELETE"),
  leaveTeam: (teamId: string) => send<{ ok: true }>(`/api/teams/${id(teamId)}/leave`, "POST"),
  /** Role `owner` transfers ownership to this member. */
  updateTeamMember: (teamId: string, userId: string, input: TeamMemberUpdateInput) =>
    send<unknown>(`/api/teams/${id(teamId)}/members/${id(userId)}`, "PATCH", input),
  removeTeamMember: (teamId: string, userId: string) =>
    send<unknown>(`/api/teams/${id(teamId)}/members/${id(userId)}`, "DELETE"),
  listTeamInvites: (teamId: string) =>
    request<{ invites: TeamInviteDto[] }>(`/api/teams/${id(teamId)}/invites`),
  createTeamInvite: (teamId: string, input: TeamInviteCreateInput) =>
    send<TeamInviteCreateResponse>(`/api/teams/${id(teamId)}/invites`, "POST", input),
  revokeTeamInvite: (teamId: string, inviteId: string) =>
    send<unknown>(`/api/teams/${id(teamId)}/invites/${id(inviteId)}`, "DELETE"),
  getTeamInvite: (code: string) => request<TeamInvitePreviewDto>(`/api/team-invites/${id(code)}`),
  acceptTeamInvite: (code: string) =>
    send<TeamJoinResponse>(`/api/team-invites/${id(code)}/accept`, "POST"),
  listTeamApps: (teamId: string) => request<{ apps: AppDto[] }>(`/api/teams/${id(teamId)}/apps`),
  startTeamCheckout: (teamId: string) =>
    send<BillingRedirectResponse>(`/api/teams/${id(teamId)}/billing/checkout`, "POST"),
  openTeamBillingPortal: (teamId: string) =>
    send<BillingRedirectResponse>(`/api/teams/${id(teamId)}/billing/portal`, "POST"),

  // On-call
  listOncallGroups: (teamId: string) =>
    request<{ groups: OncallGroupDto[] }>(`/api/teams/${id(teamId)}/oncall`),
  createOncallGroup: (teamId: string, input: OncallGroupCreateInput) =>
    send<{ group: OncallGroupDto }>(`/api/teams/${id(teamId)}/oncall`, "POST", input),
  getOncallGroup: (groupId: string) =>
    request<{ group: OncallGroupDto }>(`/api/oncall/${id(groupId)}`),
  updateOncallGroup: (groupId: string, input: OncallGroupUpdateInput) =>
    send<{ group: OncallGroupDto }>(`/api/oncall/${id(groupId)}`, "PATCH", input),
  deleteOncallGroup: (groupId: string) => send<unknown>(`/api/oncall/${id(groupId)}`, "DELETE"),
  /** The signed-in person's paging preferences; they apply in every group. */
  getOncallSettings: () => request<{ settings: OncallSettingsDto }>("/api/oncall/settings"),
  updateOncallSettings: (input: OncallSettingsUpdateInput) =>
    send<{ settings: OncallSettingsDto }>("/api/oncall/settings", "PATCH", input),
  addOncallOverride: (groupId: string, input: OncallOverrideCreateInput) =>
    send<{ group: OncallGroupDto }>(`/api/oncall/${id(groupId)}/overrides`, "POST", input),
  removeOncallOverride: (groupId: string, overrideId: string) =>
    send<{ group: OncallGroupDto }>(
      `/api/oncall/${id(groupId)}/overrides/${id(overrideId)}`,
      "DELETE",
    ),
  createOncallPage: (groupId: string, input: OncallPageCreateInput) =>
    send<OncallPageCreateResponse>(`/api/oncall/${id(groupId)}/pages`, "POST", input),
  listTeamPages: (teamId: string, options: { status?: "open" | "all"; cursor?: string } = {}) => {
    const query = new URLSearchParams({ status: options.status ?? "open" });
    if (options.cursor) query.set("cursor", options.cursor);
    return request<OncallPageListResponse>(`/api/teams/${id(teamId)}/pages?${query}`);
  },
  getPage: (pageId: string) => request<{ page: OncallPageDto }>(`/api/pages/${id(pageId)}`),
  updatePage: (pageId: string, action: "acknowledge" | "escalate" | "resolve") =>
    send<{ page: OncallPageDto }>(`/api/pages/${id(pageId)}/${action}`, "POST", {}),
};
