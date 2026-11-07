import {
  COLLAB_CLOSE_REASONS,
  COLLAB_DENY_REASONS,
  type CollabStateless,
  diagnosticCountBucket,
  diagnosticSizeBucket,
  type ParticipantPermissions,
  participantPermissionsSchema,
  type Role,
  type UserRef,
  YDOC,
} from "@gachipad/shared";
import { HocuspocusProvider, type HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { ApiError, api } from "../api";
import {
  CLOSE_TIMEOUT_MS,
  dropCopy,
  idbName,
  leaveAfterDenial,
  mayKeepCopy,
  noteCopy,
  registerHolder,
  within,
} from "../device";
import {
  captureDiagnosticError,
  clearDiagnosticContext,
  newDiagnosticReference,
  recordDiagnostic,
  updateDiagnosticContext,
} from "../diagnostics";
import { subscribePrefs } from "../prefs";
import { acquireSocket } from "./socket";

/**
 * Everything about one open share that is not React: the Y.Doc, its IndexedDB copy, the provider
 * on the shared socket, the token refresh and the reaction to server-side permission changes.
 */

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "disconnected";

export interface JoinCredentials {
  pin?: string;
  editKey?: string;
}

export interface SessionState {
  /** Local-only text snapshots retained before a permission resync, until explicitly dismissed. */
  unsentText: { id: number; fileId: string; path: string; text: string }[];
  status: ConnectionStatus;
  /** The first sync with the server (or the local copy, when offline) is done. */
  synced: boolean;
  role: Role;
  permissions?: ParticipantPermissions;
  /** Typing is blocked: view-only link, or the owner locked editing. */
  readOnly: boolean;
  locked: boolean;
  /** Incremented whenever the Y.Doc was replaced, so the editor rebinds. */
  generation: number;
  /** Local edits the server has not confirmed yet. */
  unsynced: number;
  /** Why the server will not let this client in (after the join succeeded once). */
  denied: "unauthorized" | "not_found" | "banned" | "pin_required" | "pending_approval" | null;
  /** The server closed this connection for good, or this device left the share (`left`). */
  closed: "kicked" | "deleted" | "left" | null;
  /** The share hit the size limit; set until the next successful resync. */
  tooLarge: number | null;
  /** An offline copy is open in this browser: unconfirmed edits survive a closed tab. */
  copyKept: boolean;
  /** The session ended (denial, removal) while the server had not confirmed every local edit. */
  lostEdits: boolean;
}

export interface SessionOptions {
  shareId: string;
  user: UserRef;
  role: Role;
  credentials: JoinCredentials;
  /**
   * The share asks for a PIN or an approval. Its local copy is not read before the server has
   * accepted this client on the current connection.
   */
  sensitive?: boolean;
  /** False for previews (lab): never an offline copy. */
  keepCopy?: boolean;
  /** Called once when the connection came back and local offline edits are merged. */
  onMerged?: () => void;
  onRole?: (role: Role, readOnly: boolean) => void;
  onPermissionRefused?: () => void;
}

const sessions = new Set<DocSession>();

/** Document updates are sent immediately; wait for every open document's server acknowledgement.
 * Without an acknowledgement we keep the tab alive, even if IndexedDB happens to be available.
 */
export async function flushPendingSessions(timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while ([...sessions].some((session) => session.provider.unsyncedChanges > 0)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

const AWARENESS_MIN_GAP_MS = Math.ceil(1000 / 30);
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * No usable answer: no response at all (network, aborted), a server error, a rate limit, or a
 * reply that is not the API's (a proxy page). Not a decision about access.
 */
export function isOutage(error: ApiError | null): boolean {
  return (
    error === null ||
    error.status === 0 ||
    error.status >= 500 ||
    error.code === "network" ||
    error.code === "unknown" ||
    error.code === "rate_limited" ||
    error.code === "unavailable"
  );
}

export function parseStateless(payload: string): CollabStateless | null {
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (
      value.type === "role" &&
      typeof value.role === "string" &&
      typeof value.readOnly === "boolean"
    ) {
      return { type: "role", role: value.role as Role, readOnly: value.readOnly };
    }
    if (
      value.type === "locked" &&
      typeof value.locked === "boolean" &&
      typeof value.readOnly === "boolean"
    ) {
      return { type: "locked", locked: value.locked, readOnly: value.readOnly };
    }
    if (value.type === "too_large" && typeof value.maxDocBytes === "number") {
      return { type: "too_large", maxDocBytes: value.maxDocBytes };
    }
    if (value.type === "permission_refused") return { type: "permission_refused" };
    if (value.type === "permissions") {
      const parsed = participantPermissionsSchema.safeParse(value.permissions);
      if (parsed.success) return { type: "permissions", permissions: parsed.data };
    }
  } catch {
    // Not one of ours.
  }
  return null;
}

export class DocSession {
  readonly shareId: string;
  readonly user: UserRef;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  private persistence: IndexeddbPersistence | null = null;
  /** Authorization of this connection went through (the PIN and approval checks included). */
  private authorized = false;
  /** This device left the share: provider, document and credentials are gone for good. */
  private left = false;
  /** Bumped by every resync, leave and destroy: a resync that was overtaken stops. */
  private epoch = 0;
  private readonly closedProviders = new WeakSet<HocuspocusProvider>();
  private readonly unregisterHolder: () => void;
  private readonly unsubscribePrefs: () => void;
  private readonly socket: HocuspocusProviderWebsocket;
  private readonly releaseSocket: () => void;
  private credentials: JoinCredentials;
  /** The last token request: answered, refused by the API (error), or no answer (null). */
  private lastJoin: { ok: true } | { ok: false; error: ApiError | null } = {
    ok: false,
    error: null,
  };
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_MIN_MS;
  private listeners = new Set<() => void>();
  private destroyed = false;
  private everConnected = false;
  private readonly diagnosticRef = newDiagnosticReference();
  private readonly diagnosticsStarted = Date.now();
  private diagnosticsSynced = false;
  private diagnosticReconnects = 0;
  private offlineSince: number | null = null;
  private editedWhileAway = false;
  private lastLocalEditAt = 0;
  /**
   * Edits typed here that the server has not confirmed. The provider's own count is also above
   * zero while any sync is under way, edits or not.
   */
  private editsUnconfirmed = false;
  /** Files whose text this client changed since the server last confirmed everything. */
  private readonly unconfirmedText = new Set<string>();
  private unsentIds = 0;
  private state: SessionState;
  private readonly options: SessionOptions;
  private docListener:
    | ((update: Uint8Array, origin: unknown, doc: Y.Doc, transaction: Y.Transaction) => void)
    | null = null;
  private onlineListener = () => this.refreshStatus();
  private pendingAwareness: Record<string, unknown> = {};
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAwarenessAt = 0;

  constructor(options: SessionOptions) {
    // The only reference to the PIN and edit key; leave() drops it.
    this.credentials = { ...options.credentials };
    this.options = { ...options, credentials: {} };
    this.shareId = options.shareId;
    this.user = options.user;
    const held = acquireSocket(options.shareId);
    this.socket = held.socket;
    this.releaseSocket = held.release;
    this.state = {
      unsentText: [],
      status: "connecting",
      synced: false,
      role: options.role,
      readOnly: options.role === "view",
      locked: false,
      generation: 0,
      unsynced: 0,
      denied: null,
      closed: null,
      tooLarge: null,
      copyKept: false,
      lostEdits: false,
    };
    this.doc = new Y.Doc();
    this.provider = this.createProvider(this.doc);
    this.unregisterHolder = registerHolder({
      shareId: this.shareId,
      releaseLocal: () => this.releaseLocal(),
      leave: () => this.leave(),
      unsent: () => this.unsent(),
    });
    this.unsubscribePrefs = subscribePrefs(() => this.onPrefs());
    this.attachPersistence();
    sessions.add(this);
    window.addEventListener("online", this.onlineListener);
    window.addEventListener("offline", this.onlineListener);
  }

  /**
   * Changes the moment a resync, a leave or a destroy starts, before the document itself is
   * replaced: work begun on `doc` under one epoch must not be applied under another.
   */
  get docEpoch(): number {
    return this.epoch;
  }

  get awareness(): Awareness {
    const awareness = this.provider.awareness;
    if (!awareness) throw new Error("awareness is disabled");
    return awareness;
  }

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(next: Partial<SessionState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private createProvider(doc: Y.Doc): HocuspocusProvider {
    const provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: this.shareId,
      document: doc,
      token: () => this.fetchToken(),
      // Typing is batched on the wire for ~30 fps awareness, not for document updates.
      onStatus: () => this.refreshStatus(),
      onConnect: () => {
        recordDiagnostic("connect", { shareRef: this.diagnosticRef });
        this.refreshStatus();
      },
      onDisconnect: () => {
        recordDiagnostic("disconnect", { shareRef: this.diagnosticRef });
        if (this.everConnected) this.patch({ synced: false });
        this.refreshStatus();
      },
      onAuthenticated: ({ scope }) => {
        this.everConnected = true;
        this.authorized = true;
        this.retryDelay = RETRY_MIN_MS;
        this.attachPersistence();
        this.patch({ denied: null });
        // The latest answer decides, both ways: an earlier provider of this document (a remount,
        // a pasted key) shares its name on the socket, so its late `readonly` can arrive first.
        const readOnly = scope === "readonly";
        if (readOnly !== this.state.readOnly) this.patch({ readOnly });
        // The provider sets `isAuthenticated` after this callback returns.
        queueMicrotask(() => this.refreshStatus());
      },
      onAuthenticationFailed: ({ reason }) => this.handleDenied(reason),
      onSynced: ({ state }) => {
        if (!state) return;
        const context = {
          documentSize: diagnosticSizeBucket(Y.encodeStateAsUpdate(this.doc).byteLength),
          fileCount: diagnosticCountBucket(this.doc.getMap(YDOC.files).size),
          connectionCount: diagnosticCountBucket(this.provider.awareness?.getStates().size ?? 0),
        };
        updateDiagnosticContext(this.diagnosticRef, context);
        if (!this.diagnosticsSynced) {
          this.diagnosticsSynced = true;
          const durationMs = Date.now() - this.diagnosticsStarted;
          recordDiagnostic("first_sync", { durationMs, shareRef: this.diagnosticRef });
          if (durationMs > 5000)
            recordDiagnostic("slow_sync", { durationMs, shareRef: this.diagnosticRef, ...context });
        }
        this.patch({ synced: true });
        this.refreshStatus();
        if (this.editedWhileAway) {
          this.editedWhileAway = false;
          this.options.onMerged?.();
        }
      },
      onUnsyncedChanges: ({ number }) => {
        if (number === 0 && provider === this.provider) {
          this.editsUnconfirmed = false;
          this.unconfirmedText.clear();
        }
        this.patch({ unsynced: number });
      },
      onClose: ({ event }) => {
        const reason = event.reason;
        recordDiagnostic("disconnect", {
          closeCode: event.code,
          reason,
          shareRef: this.diagnosticRef,
        });
        const rejoin = reason === "provider_initiated" || reason === COLLAB_CLOSE_REASONS.reauth;
        if (rejoin && !this.destroyed && !this.left && provider === this.provider) {
          // `provider_initiated`: the server answering a Close sent by an earlier provider of
          // this same document (a React remount, a resync); it names the document, so it reaches
          // this provider too. `reauth`: access changed (PIN, approval, key, role) and only a
          // fresh token tells. Either way: join again over the open socket.
          void provider.onOpen(new Event("open"));
          return;
        }
        if (reason === "kicked" || reason === "deleted") {
          this.patch({ closed: reason, lostEdits: this.unsent() > 0 });
          // Leave the document, but keep the shared socket for other documents of this tab.
          this.forgetAfterDenial();
        }
        this.refreshStatus();
      },
      onStateless: ({ payload }) => this.handleStateless(payload),
    });
    provider.attach();
    this.setLocalUser(provider);
    this.watchLocalEdits(doc);
    return provider;
  }

  private setLocalUser(provider: HocuspocusProvider) {
    provider.awareness?.setLocalStateField("user", {
      clientId: this.user.clientId,
      name: this.user.name,
      color: this.user.color,
    });
  }

  private watchLocalEdits(doc: Y.Doc) {
    if (this.docListener) return;
    this.docListener = (_update, origin, _doc, transaction) => {
      if (origin === this.provider || origin instanceof IndexeddbPersistence) return;
      this.lastLocalEditAt = Date.now();
      this.editsUnconfirmed = true;
      for (const type of transaction.changed.keys()) {
        if (type._item !== null) continue;
        const root = Y.findRootTypeKey(type);
        if (root.startsWith(YDOC.fileText(""))) {
          this.unconfirmedText.add(root.slice(YDOC.fileText("").length));
        }
      }
      if (this.state.status !== "connected") this.editedWhileAway = true;
    };
    doc.on("update", this.docListener);
  }

  private mayKeepCopy(): boolean {
    if (this.destroyed || this.left || this.options.keepCopy === false) return false;
    // Between two providers (a resync): the copy belongs to the next document.
    if (this.closedProviders.has(this.provider)) return false;
    if (!mayKeepCopy(this.shareId)) return false;
    return !this.options.sensitive || this.authorized;
  }

  private attachPersistence() {
    // A per-document offline copy: edits survive a closed tab and merge on the next connect.
    // The registry lists the database before it exists (device.ts).
    if (this.persistence || !this.mayKeepCopy() || !noteCopy(this.shareId)) return;
    try {
      const persistence = new IndexeddbPersistence(idbName(this.shareId), this.doc);
      this.persistence = persistence;
      persistence.whenSynced
        .then(() => {
          if (this.destroyed || this.left || this.persistence !== persistence) return;
          this.patch({ copyKept: true });
        })
        .catch(() => undefined);
    } catch {
      this.persistence = null;
    }
  }

  /** The device choice changed (in this tab or another one); device.ts deletes what must go. */
  private onPrefs() {
    if (this.mayKeepCopy()) this.attachPersistence();
    else void this.releaseLocal();
  }

  /** Closes the IndexedDB connection and stops writing a copy; the document stays open. */
  async releaseLocal(): Promise<void> {
    const persistence = this.persistence;
    if (!persistence) return;
    this.persistence = null;
    this.patch({ copyKept: false });
    await within(persistence.destroy(), CLOSE_TIMEOUT_MS);
  }

  /** Local edits the server has not confirmed yet (0 once this device left the share). */
  unsent(): number {
    if (this.left || this.destroyed || !this.editsUnconfirmed) return 0;
    return Math.max(1, this.provider.unsyncedChanges);
  }

  /** Destroys a provider once; a later call for the same one does nothing. */
  private closeProvider(provider: HocuspocusProvider) {
    if (this.closedProviders.has(provider)) return;
    this.closedProviders.add(provider);
    provider.destroy();
  }

  /**
   * Leaves the share on this device (forget, denial, logout, another account): the provider, the
   * document, the PIN and edit key and the copy's connection go, and nothing reconnects.
   */
  async leave(): Promise<void> {
    if (this.left || this.destroyed) return;
    this.left = true;
    clearDiagnosticContext(this.diagnosticRef);
    this.epoch++;
    this.credentials = {};
    this.clearRetry();
    if (this.docListener) this.doc.off("update", this.docListener);
    this.docListener = null;
    this.closeProvider(this.provider);
    const persistence = this.persistence;
    this.persistence = null;
    this.patch({ closed: this.state.closed ?? "left", copyKept: false });
    if (persistence) await within(persistence.destroy(), CLOSE_TIMEOUT_MS);
    this.doc.destroy();
  }

  /**
   * The server will not have this client (removed, banned, share gone, authorization refused):
   * the session ends, the offline copy and the remembered edit key go (in every tab).
   */
  private forgetAfterDenial() {
    void leaveAfterDenial(this.shareId);
  }

  /** Fresh collab token on every (re)connect; a failure becomes a rejected token, not a hang. */
  private async fetchToken(): Promise<string> {
    if (this.left) return "";
    try {
      const result = await api.joinShare(this.shareId, this.credentials);
      if (!("token" in result)) {
        this.lastJoin = {
          ok: false,
          error: new ApiError(202, "pending_approval", "pending", null),
        };
        return "";
      }
      this.lastJoin = { ok: true };
      if (result.role !== this.state.role) {
        this.patch({ role: result.role, readOnly: result.role === "view" || this.state.locked });
        this.options.onRole?.(result.role, this.state.readOnly);
      }
      return result.token;
    } catch (error) {
      captureDiagnosticError("sync_error", error, { shareRef: this.diagnosticRef });
      this.lastJoin = { ok: false, error: error instanceof ApiError ? error : null };
      return "";
    }
  }

  /**
   * Authentication failed. An outage (no answer, a server error, collab `unavailable`) keeps the
   * document and its unsent edits and tries again. Anything else is the server's decision and
   * ends the session: a PIN or approval asked for anew, a ban, a share gone or expired, a refusal,
   * or collab refusing a token the API had just issued (its permission generation is stale).
   */
  private handleDenied(reason: string) {
    recordDiagnostic("permission_error", { reason, shareRef: this.diagnosticRef }, "error");
    this.authorized = false;
    const failure = this.lastJoin.ok ? null : this.lastJoin.error;
    if (reason === COLLAB_DENY_REASONS.unavailable || (!this.lastJoin.ok && isOutage(failure))) {
      this.retryLater();
      return;
    }
    let denied: SessionState["denied"] = "unauthorized";
    if (failure?.code === "pin_required" || failure?.code === "pin_invalid")
      denied = "pin_required";
    else if (failure?.code === "pending_approval") denied = "pending_approval";
    else if (failure?.code === "banned" || reason === "banned") denied = "banned";
    else if (
      failure?.code === "not_found" ||
      failure?.code === "expired" ||
      reason === "not_found"
    ) {
      denied = "not_found";
    }
    this.patch({ denied, lostEdits: this.unsent() > 0 });
    this.forgetAfterDenial();
  }

  /** Authenticates again after a backoff; a socket that reopens does that by itself. */
  private retryLater() {
    if (this.retryTimer || this.left || this.destroyed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.left || this.destroyed || this.socket.status !== "connected") return;
      void this.provider.onOpen(new Event("open"));
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.refreshStatus();
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private handleStateless(payload: string) {
    const message = parseStateless(payload);
    if (!message) return;
    if (message.type === "permissions") {
      this.patch({ permissions: message.permissions });
      this.options.onRole?.(this.state.role, this.state.readOnly);
      return;
    }
    if (message.type === "permission_refused") {
      this.patch({ readOnly: true });
      this.options.onPermissionRefused?.();
      void this.resync(true);
      return;
    }
    if (message.type === "too_large") {
      this.patch({ tooLarge: message.maxDocBytes, readOnly: this.state.readOnly });
      // The document goes back to what the server holds: what it refused must not vanish with it.
      void this.resync("unconfirmed");
      return;
    }
    const wasReadOnly = this.state.readOnly;
    if (message.type === "role") {
      this.patch({ role: message.role, readOnly: message.readOnly });
      this.options.onRole?.(message.role, message.readOnly);
    } else {
      this.patch({ locked: message.locked, readOnly: message.readOnly });
      this.options.onRole?.(this.state.role, message.readOnly);
    }
    // Edits typed in the instant before the server flipped to read-only were refused and would
    // keep poisoning this client's later updates (packages/shared/src/collab.ts).
    const recentlyEdited = Date.now() - this.lastLocalEditAt < 4000;
    if (message.readOnly && !wasReadOnly && (recentlyEdited || this.state.unsynced > 0)) {
      void this.resync(true);
    }
  }

  private refreshStatus() {
    if (this.destroyed || this.left) return;
    const connected = this.socket.status === "connected" && this.provider.isAuthenticated;
    let status: ConnectionStatus;
    if (typeof navigator !== "undefined" && navigator.onLine === false) status = "offline";
    else if (connected) status = "connected";
    else if (this.socket.status === "connecting") {
      status = this.everConnected ? "reconnecting" : "connecting";
    } else status = this.everConnected ? "disconnected" : "connecting";
    if (status !== this.state.status) {
      if (status === "offline") {
        this.offlineSince = Date.now();
        recordDiagnostic("offline", { reason: "offline", shareRef: this.diagnosticRef });
      }
      if (status === "reconnecting")
        recordDiagnostic("reconnect", {
          reconnects: ++this.diagnosticReconnects,
          shareRef: this.diagnosticRef,
        });
      if (status === "connected" && this.offlineSince !== null) {
        recordDiagnostic("offline", {
          offlineMs: Date.now() - this.offlineSince,
          reason: "connected",
          shareRef: this.diagnosticRef,
        });
        this.offlineSince = null;
      }
      this.patch({ status });
    }
  }

  /** Re-checks the connection state once (the socket does not emit on every change). */
  poll(): void {
    this.refreshStatus();
  }

  /** "Retry now": authenticate again at once, or reopen the socket. */
  async reconnect(): Promise<void> {
    if (this.left || this.destroyed) return;
    this.clearRetry();
    this.patch({ denied: null });
    if (this.socket.status === "connected" && !this.provider.isAuthenticated) {
      await this.provider.onOpen(new Event("open")).catch(() => undefined);
      return;
    }
    await this.provider.connect().catch(() => undefined);
  }

  /**
   * Drop the Y.Doc, its local copy and the provider, then start over from the server state.
   * `preserveText` keeps local text for the person to copy; it stays in this tab and is never sent.
   * `true` keeps every file. "unconfirmed" keeps the files this client changed since the server
   * last confirmed everything, one snapshot per file: a share at its size limit refuses every
   * keystroke, and neither everyone's files nor a copy per keystroke would help.
   */
  async resync(preserveText: boolean | "unconfirmed" = false): Promise<void> {
    if (this.destroyed || this.left) return;
    if (preserveText) {
      // A refusal has no per-file acknowledgement. Keep a conservative snapshot, including
      // orphaned text roots and offline edits, rather than guessing which local text was refused.
      let unsentText = [...this.state.unsentText];
      const files = this.doc.getMap<Y.Map<unknown>>(YDOC.files);
      for (const name of this.doc.share.keys()) {
        if (!name.startsWith(YDOC.fileText(""))) continue;
        const root = this.doc.share.get(name);
        if (!(root instanceof Y.Text) && root?.constructor !== Y.AbstractType) continue;
        const fileId = name.slice(YDOC.fileText("").length);
        const text = this.doc.getText(name).toString();
        if (preserveText === "unconfirmed") {
          if (!this.unconfirmedText.has(fileId) || text === "") continue;
          unsentText = unsentText.filter((saved) => saved.fileId !== fileId);
        }
        if (unsentText.some((saved) => saved.fileId === fileId && saved.text === text)) continue;
        const file = files.get(fileId);
        const path = file instanceof Y.Map ? file.get("path") : undefined;
        unsentText.push({
          id: this.unsentIds++,
          fileId,
          path: typeof path === "string" ? path : fileId,
          text,
        });
      }
      this.patch({ unsentText });
    }
    const epoch = ++this.epoch;
    const old = this.provider;
    const oldDoc = this.doc;
    const oldPersistence = this.persistence;
    if (this.docListener) oldDoc.off("update", this.docListener);
    this.docListener = null;
    this.pendingAwareness = {};
    this.closeProvider(old);
    this.persistence = null;
    if (oldPersistence) {
      // Closed, then deleted here: y-indexeddb's `clearData` resolves before its deletion ran, and
      // a deletion that runs after the next copy opened deletes that one. Waited for a moment;
      // after that the document goes on from memory and keeps a copy once it finished.
      void oldPersistence.destroy().catch(() => undefined);
      const dropped = dropCopy(this.shareId);
      void dropped.then(() => this.onPrefs());
      await within(dropped, CLOSE_TIMEOUT_MS);
    }
    oldDoc.destroy();
    // Left, unmounted or resynced again meanwhile: whoever did that owns what comes next.
    if (epoch !== this.epoch || this.destroyed || this.left) return;
    this.doc = new Y.Doc();
    this.editedWhileAway = false;
    this.editsUnconfirmed = false;
    this.unconfirmedText.clear();
    this.provider = this.createProvider(this.doc);
    this.attachPersistence();
    this.patch({
      generation: this.state.generation + 1,
      synced: false,
      unsynced: 0,
      copyKept: false,
    });
    this.refreshStatus();
  }

  dismissUnsentText(): void {
    this.patch({ unsentText: [] });
  }

  /**
   * Merges fields into this client's awareness state, at most ~30 times a second
   * (docs/ARCHITECTURE.md §4). The latest value of each field always wins.
   */
  publish(patch: Record<string, unknown>): void {
    this.pendingAwareness = { ...this.pendingAwareness, ...patch };
    if (this.awarenessTimer || this.destroyed || this.left) return;
    const wait = Math.max(0, AWARENESS_MIN_GAP_MS - (Date.now() - this.lastAwarenessAt));
    this.awarenessTimer = setTimeout(() => this.flushAwareness(), wait);
  }

  private flushAwareness() {
    this.awarenessTimer = null;
    const awareness = this.provider.awareness;
    const patch = this.pendingAwareness;
    this.pendingAwareness = {};
    if (!awareness || this.destroyed || this.left) return;
    this.lastAwarenessAt = Date.now();
    awareness.setLocalState({ ...(awareness.getLocalState() ?? {}), ...patch });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearDiagnosticContext(this.diagnosticRef);
    this.epoch++;
    sessions.delete(this);
    window.removeEventListener("online", this.onlineListener);
    window.removeEventListener("offline", this.onlineListener);
    if (this.docListener) this.doc.off("update", this.docListener);
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    this.clearRetry();
    this.unregisterHolder();
    this.unsubscribePrefs();
    this.closeProvider(this.provider);
    this.persistence?.destroy().catch(() => undefined);
    this.releaseSocket();
    this.listeners.clear();
  }
}
