import type {
  AdminUpdateResponse,
  CreateInviteBody,
  CreateLabBody,
  CreateShareBody,
  CreateShareResponse,
  ErrorCode,
  GetLabResponse,
  GetShareResponse,
  JoinPendingResponse,
  JoinShareBody,
  JoinShareResponse,
  KickBody,
  NearbyItem,
  PatchLabBody,
  PatchSessionBody,
  PatchShareBody,
  PresenceUser,
  PublicSettings,
  PutLabelsBody,
  PutSettingsBody,
  SessionResponse,
  Settings,
  ShareLabels,
  ShareListItem,
  StatsResponse,
  Template,
  UploadResult,
} from "@gachipad/shared";
import { recordDiagnostic, shouldRecordApiFailure } from "./diagnostics";

/** Thin fetch client for the HTTP API (docs/ARCHITECTURE.md §9). Same origin, cookie session. */

export type ClientErrorCode = ErrorCode | "network" | "unknown";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  /** Seconds from `Retry-After`, when the server sent one. */
  readonly retryAfter: number | null;

  constructor(status: number, code: ClientErrorCode, message: string, retryAfter: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function isApiError(error: unknown, code?: ClientErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

const KNOWN_CODES: readonly string[] = [
  "not_found",
  "forbidden",
  "pin_required",
  "pin_invalid",
  "banned",
  "pending_approval",
  "rate_limited",
  "upload_pool_limited",
  "too_large",
  "expired",
  "validation",
  "unavailable",
];

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function errorFrom(response: Response): Promise<ApiError> {
  let code: ClientErrorCode = "unknown";
  let message = response.statusText;
  try {
    const data = (await response.json()) as { error?: { code?: string; message?: string } };
    if (data.error?.code && KNOWN_CODES.includes(data.error.code)) {
      code = data.error.code as ErrorCode;
    }
    if (data.error?.message) message = data.error.message;
  } catch {
    // Not JSON (a proxy error page, say): the status text stands in.
  }
  const retry = Number(response.headers.get("Retry-After"));
  return new ApiError(
    response.status,
    code,
    message,
    Number.isFinite(retry) && retry > 0 ? retry : null,
  );
}

export async function rawRequest(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  let url = path;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const text = params.toString();
    if (text) url += `?${text}`;
  }
  // The API refuses state-changing requests without this header (CSRF guard).
  const headers: Record<string, string> = { "X-Gachipad": "1", ...options.headers };
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    recordDiagnostic(
      "api_failure",
      { method, route: path, status: 0, code: "network", durationMs: performance.now() - started },
      "error",
    );
    throw new ApiError(0, "network", "Network error", null);
  }
  if (!response.ok) {
    const error = await errorFrom(response);
    if (shouldRecordApiFailure(response.status))
      recordDiagnostic(
        "api_failure",
        {
          method,
          route: path,
          status: response.status,
          code: error.code,
          durationMs: performance.now() - started,
        },
        response.status >= 500 ? "error" : "warn",
      );
    throw error;
  }
  return response;
}

async function request<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
  const response = await rawRequest(method, path, options);
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.includes("json")) return undefined as T;
  return (await response.json()) as T;
}

export interface MyShare extends ShareListItem {}

export const api = {
  session: (signal?: AbortSignal) => request<SessionResponse>("GET", "/api/session", { signal }),
  patchSession: (body: PatchSessionBody) =>
    request<SessionResponse>("PATCH", "/api/session", { body }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),

  createShare: (body: CreateShareBody = {}, signal?: AbortSignal) =>
    request<CreateShareResponse>("POST", "/api/shares", { body, signal }),
  listShares: (signal?: AbortSignal) => request<ShareListItem[]>("GET", "/api/shares", { signal }),
  putLabels: (id: string, body: PutLabelsBody) =>
    request<ShareLabels>("PUT", `/api/shares/${id}/labels`, { body }),
  getShare: (id: string, signal?: AbortSignal) =>
    request<GetShareResponse>("GET", `/api/shares/${id}`, { signal }),
  /** 200 with a token, or 202 while the owner has to approve. */
  async joinShare(
    id: string,
    body: JoinShareBody,
    signal?: AbortSignal,
  ): Promise<JoinShareResponse | JoinPendingResponse> {
    const response = await rawRequest("POST", `/api/shares/${id}/join`, { body, signal });
    return (await response.json()) as JoinShareResponse | JoinPendingResponse;
  },
  patchShare: (id: string, body: PatchShareBody) =>
    request<GetShareResponse>("PATCH", `/api/shares/${id}`, { body }),
  deleteShare: (id: string) => request<{ ok: true }>("DELETE", `/api/shares/${id}`),
  saveShare: (id: string) => request<{ ok: true }>("POST", `/api/shares/${id}/save`),
  unsaveShare: (id: string) => request<{ ok: true }>("DELETE", `/api/shares/${id}/save`),
  forkShare: (id: string) => request<CreateShareResponse>("POST", `/api/shares/${id}/fork`),
  kick: (id: string, body: KickBody) =>
    request<{ ok: true }>("POST", `/api/shares/${id}/kick`, { body }),
  listPending: (id: string) =>
    request<{ clientId: string; name: string }[]>("GET", `/api/shares/${id}/pending`),
  resolvePending: (id: string, clientId: string, approve: boolean) =>
    request<{ ok: true }>("POST", `/api/shares/${id}/pending/${clientId}`, { body: { approve } }),
  listHistory: (id: string) =>
    request<{ seq: number; at: string }[]>("GET", `/api/shares/${id}/history`),
  async historyState(id: string, seq: number, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await rawRequest("GET", `/api/shares/${id}/history/${seq}`, { signal });
    return new Uint8Array(await response.arrayBuffer());
  },
  restore: (id: string, seq: number) =>
    request<{ ok: true }>("POST", `/api/shares/${id}/restore`, { body: { seq } }),
  downloadUrl: (id: string, fileId?: string) =>
    `/api/shares/${id}/download${fileId ? `?file=${encodeURIComponent(fileId)}` : ""}`,

  listTemplates: (signal?: AbortSignal) => request<Template[]>("GET", "/api/templates", { signal }),
  publicSettings: (signal?: AbortSignal) =>
    request<PublicSettings>("GET", "/api/settings/public", { signal }),

  resolveCode: (code: string) =>
    request<{ id: string } | { labId: string }>("GET", `/api/codes/${code}`),

  presence: (signal?: AbortSignal) => request<PresenceUser[]>("GET", "/api/presence", { signal }),
  nearby: (signal?: AbortSignal) => request<NearbyItem[]>("GET", "/api/nearby", { signal }),
  invite: (body: CreateInviteBody) => request<{ ok: true }>("POST", "/api/invites", { body }),

  upload: (files: File[], options: { asShare?: boolean; signal?: AbortSignal } = {}) => {
    const form = new FormData();
    for (const file of files) {
      form.append("file", file, relativePathOf(file) ?? file.name);
    }
    return request<UploadResult[] | CreateShareResponse>("POST", "/api/uploads", {
      form,
      query: options.asShare ? { asShare: 1 } : undefined,
      signal: options.signal,
    });
  },
  uploadUrl: (uploadId: string) => `/api/uploads/${uploadId}`,

  createLab: (body: CreateLabBody = {}) =>
    request<{ id: string; code: string; url: string }>("POST", "/api/labs", { body }),
  getLab: (id: string, signal?: AbortSignal) =>
    request<GetLabResponse>("GET", `/api/labs/${id}`, { signal }),
  joinLab: (id: string, name: string) =>
    request<{ shareId: string }>("POST", `/api/labs/${id}/join`, { body: { name } }),
  patchLab: (id: string, body: PatchLabBody) =>
    request<GetLabResponse>("PATCH", `/api/labs/${id}`, { body }),
  distributeLab: (id: string) => request<{ count: number }>("POST", `/api/labs/${id}/distribute`),

  admin: {
    overview: (token: string) =>
      request<import("@gachipad/shared").AdminOverview>("GET", "/api/admin/overview", {
        headers: bearer(token),
      }),
    diagnostics: (token: string, query: { level?: string; source?: string; since?: string } = {}) =>
      request<import("@gachipad/shared").DiagnosticEvent[]>("GET", "/api/admin/diagnostics", {
        headers: bearer(token),
        query,
      }),
    diagnosticExport: (token: string) =>
      request<import("@gachipad/shared").ServerDiagnosticBundle>(
        "GET",
        "/api/admin/diagnostics/export",
        { headers: bearer(token) },
      ),
    security: (token: string) =>
      request<import("@gachipad/shared").AdminSecurity>("GET", "/api/admin/security", {
        headers: bearer(token),
      }),
    shares: (token: string, search = "", before?: string, beforeId?: string) =>
      request<import("@gachipad/shared").AdminShare[]>("GET", "/api/admin/shares", {
        headers: bearer(token),
        query: { search, before, beforeId },
      }),
    shareAction: (token: string, id: string, action: "lock" | "unlock" | "delete") =>
      request<{ ok: true }>("POST", `/api/admin/shares/${id}/${action}`, {
        headers: bearer(token),
      }),
    settings: (token: string) =>
      request<Settings>("GET", "/api/admin/settings", { headers: bearer(token) }),
    putSettings: (token: string, body: PutSettingsBody) =>
      request<Settings>("PUT", "/api/admin/settings", { body, headers: bearer(token) }),
    audit: (token: string, query: { limit?: number; before?: string } = {}) =>
      request<
        {
          at: string;
          actor: string;
          ip: string;
          action: string;
          shareId?: string;
          detail?: unknown;
        }[]
      >("GET", "/api/admin/audit", { query, headers: bearer(token) }),
    stats: (token: string) =>
      request<StatsResponse>("GET", "/api/admin/stats", { headers: bearer(token) }),
    update: (token: string) =>
      request<AdminUpdateResponse>("GET", "/api/admin/update", { headers: bearer(token) }),
    checkUpdate: (token: string) =>
      request<AdminUpdateResponse>("POST", "/api/admin/update/check", { headers: bearer(token) }),
  },
};

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** `webkitRelativePath` of a file picked from a folder, or the path we attach to dropped entries. */
export function relativePathOf(file: File): string | null {
  const dropped = (file as File & { gachipadPath?: string }).gachipadPath;
  if (dropped) return dropped;
  return file.webkitRelativePath ? file.webkitRelativePath : null;
}
