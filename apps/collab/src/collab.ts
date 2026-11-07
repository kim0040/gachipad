import {
  AWARENESS_MAX_STATE_BYTES,
  AWARENESS_MAX_UPDATES_PER_SECOND,
  COLLAB_BROADCAST_WINDOW_FROM,
  COLLAB_BROADCAST_WINDOW_MS,
  COLLAB_CLOSE_REASONS,
  COLLAB_COMMAND_ERRORS,
  COLLAB_DENY_REASONS,
  COMPACT_AFTER_UPDATES,
  type CollabCommand,
  type CollabCommandError,
  type CollabCommandReply,
  type CollabStateless,
  channels,
  collabCommandRequestIdSchema,
  collabCommandSchema,
  DEFAULT_FILE_ID,
  defaultSettings,
  diagnosticCountBucket,
  diagnosticError,
  diagnosticSizeBucket,
  FLUSH_INTERVAL_MS,
  HISTORY_SNAPSHOT_INTERVAL_MS,
  keys,
  LAST_ACTIVE_WRITE_INTERVAL_MS,
  languageSchema,
  MAX_DOC_BYTES_LIMIT,
  META_MIRROR_THROTTLE_MS,
  NEARBY_ITEM_TTL_SECONDS,
  NEARBY_PREVIEW_LINES,
  NEARBY_THROTTLE_MS,
  type PermMessage,
  participantPermissions,
  permMessageSchema,
  type Role,
  type Settings,
  type ShareRecord,
  SLOW_CLIENT_BUFFER_BYTES,
  titleSchema,
  UNLOAD_DELAY_MS,
  verifyCollabToken,
  YDOC,
} from "@gachipad/shared";
import type { ServerDiagnostics, ShareUpdate, Stores } from "@gachipad/storage";
import { diagnosticShareRef } from "@gachipad/storage";
import type {
  afterHandleMessagePayload,
  afterUnloadDocumentPayload,
  beforeHandleAwarenessPayload,
  beforeSyncPayload,
  beforeUnloadDocumentPayload,
  Connection,
  connectedPayload,
  DirectConnection,
  Document,
  Extension,
  Hocuspocus,
  onAuthenticatePayload,
  onChangePayload,
  onConfigurePayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
} from "@hocuspocus/server";
import { OutgoingMessage } from "@hocuspocus/server";
import type { Redis } from "ioredis";
import * as Y from "yjs";
import { validCommentAuthors } from "./comments.js";
import { applyMeta, syncContent } from "./content.js";
import { ValkeyLock } from "./lock.js";
import type { CollabMetrics } from "./metrics.js";
import { PersistedDoc } from "./persisted-doc.js";
import { guardSlowClient } from "./slow-client.js";
import { hasNewOperations, permitsUpdate } from "./update-permissions.js";

export interface CollabContext {
  clientId: string;
  name: string;
  color: string;
  role: Role;
  shareId: string;
  controller: boolean;
  generation: string;
  /** Perm messages this instance had received when access was checked (see `catchUp`). */
  permMark: number;
}

export interface CollabTimings {
  flushIntervalMs: number;
  compactAfter: number;
  historyIntervalMs: number;
  unloadDelayMs: number;
  lockTtlMs: number;
  lockRenewMs: number;
  nearbyThrottleMs: number;
  nearbyRefreshMs: number;
  lastActiveIntervalMs: number;
  settingsRefreshMs: number;
  /** How often a doc with connections re-reads its share, for perm messages that got lost. */
  reconcileMs: number;
  slowClientBytes: number;
  metaMirrorMs: number;
  /** Broadcast window of a busy document (0: every event loop turn) and the connections it needs. */
  broadcastWindowMs: number;
  broadcastWindowFrom: number;
}

export const DEFAULT_TIMINGS: CollabTimings = {
  flushIntervalMs: FLUSH_INTERVAL_MS,
  compactAfter: COMPACT_AFTER_UPDATES,
  historyIntervalMs: HISTORY_SNAPSHOT_INTERVAL_MS,
  unloadDelayMs: UNLOAD_DELAY_MS,
  lockTtlMs: 6000,
  lockRenewMs: 2000,
  nearbyThrottleMs: NEARBY_THROTTLE_MS,
  nearbyRefreshMs: (NEARBY_ITEM_TTL_SECONDS * 1000) / 2,
  lastActiveIntervalMs: LAST_ACTIVE_WRITE_INTERVAL_MS,
  settingsRefreshMs: 30_000,
  reconcileMs: 15_000,
  slowClientBytes: SLOW_CLIENT_BUFFER_BYTES,
  metaMirrorMs: META_MIRROR_THROTTLE_MS,
  broadcastWindowMs: COLLAB_BROADCAST_WINDOW_MS,
  broadcastWindowFrom: COLLAB_BROADCAST_WINDOW_FROM,
};

export interface CollabDeps {
  diagnostics?: ServerDiagnostics;
  stores: Stores;
  /** Commands (locks, nearby). */
  redis: Redis;
  /** A dedicated connection for `perm:*` and `cmd:*` (a subscribed connection cannot run commands). */
  subscriber: Redis;
  secret: string;
  instanceId: string;
  metrics: CollabMetrics;
  timings?: Partial<CollabTimings>;
}

/** Viewers, and everyone but the owner of a locked share, cannot edit (§6.7). */
export function isReadOnly(role: Role, locked: boolean, controller = role === "owner"): boolean {
  return role === "view" || (locked && !controller);
}

class DocState {
  locked: boolean;
  nearby: boolean;
  share: ShareRecord;
  idleSince: number | null = Date.now();
  unloadTimer: NodeJS.Timeout | null = null;
  nearbyTimer: NodeJS.Timeout | null = null;
  nearbyAt = 0;
  metaTimer: NodeJS.Timeout | null = null;
  metaAt = 0;
  stopMetaObserver: () => void = () => {};
  lastActiveWrite = 0;
  /** Highest `version` of a per-client role message, by clientId. */
  roleVersions = new Map<string, number>();
  reconciledAt = Date.now();
  reconciling = false;
  deleted = false;
  flushing = false;
  flushFailures = 0;
  flushRetryAt = 0;
  readonly closed: Promise<void>;
  markClosed!: () => void;

  constructor(
    readonly name: string,
    readonly document: Document,
    readonly core: PersistedDoc,
    share: ShareRecord,
  ) {
    this.share = share;
    this.locked = share.locked;
    this.nearby = share.access.nearby;
    this.closed = new Promise((resolve) => {
      this.markClosed = resolve;
    });
  }

  clearTimers() {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    if (this.nearbyTimer) clearTimeout(this.nearbyTimer);
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.unloadTimer = null;
    this.nearbyTimer = null;
    this.metaTimer = null;
  }
}

/** A refusal in the shape Hocuspocus forwards to the provider as `onAuthenticationFailed`. */
function deny(reason: string) {
  return Object.assign(new Error(reason), { reason });
}

function context(connection: Connection): CollabContext {
  return connection.context as CollabContext;
}

function originLabel(origin: unknown): string {
  if (typeof origin === "object" && origin !== null && "source" in origin) {
    return String(origin.source);
  }
  return "local";
}

function isDenied(error: unknown, reason: string): boolean {
  return (
    typeof error === "object" && error !== null && "reason" in error && error.reason === reason
  );
}

/** True when a Yjs update only deletes; deletions never grow a document. */
function onlyDeletes(update: Uint8Array): boolean {
  try {
    return Y.decodeUpdate(update).structs.length === 0;
  } catch {
    return false;
  }
}

/** Perm messages are kept this long for connections that were authenticating meanwhile. */
const PERM_REPLAY_MS = 60_000;
/** Longest wait between flush attempts of a doc while MongoDB keeps failing. */
const FLUSH_BACKOFF_MAX_MS = 5000;
/** The same background error is logged at most this often. */
const ERROR_LOG_INTERVAL_MS = 10_000;
/** Yjs clients one connection may hold awareness for (a resync starts a new Y.Doc). */
const AWARENESS_MAX_CLIENTS_PER_CONNECTION = 4;

/** The first `lines` lines of a Y.Text, without building the whole string. */
function firstLines(text: Y.Text, lines: number): string {
  let head = "";
  let breaks = 0;
  for (let item = text._start; item !== null && breaks < lines; item = item.right) {
    if (item.deleted || !(item.content instanceof Y.ContentString)) continue;
    const { str } = item.content;
    head += str;
    for (const char of str) if (char === "\n") breaks++;
  }
  return head.split("\n", lines).join("\n");
}

interface RecentPerm {
  mark: number;
  at: number;
  message: PermMessage;
}

/**
 * The collaboration extension: token auth, permission enforcement, batched persistence with a doc
 * lock, delayed unload, live permission changes, size limit, nearby previews, activity and content
 * commands from other services (§6).
 */
export class Collab implements Extension<CollabContext> {
  extensionName = "gachipad-collab";
  /** Before extension-redis (1000), so a postponed unload does not wait for its disconnect delay. */
  priority = 1100;

  readonly timings: CollabTimings;
  readonly docs = new Map<string, DocState>();
  private instance!: Hocuspocus;
  private readonly lock: ValkeyLock;
  private settings: Settings = defaultSettings();
  private settingsAt = 0;
  private timers: NodeJS.Timeout[] = [];
  private readonly refused = new WeakSet<Connection>();
  private readonly initialSync = new WeakSet<Connection>();
  /** Updates held back before the first SyncStep2, each answered "not saved" (see `beforeSync`). */
  private readonly heldBack = new WeakMap<Connection, number>();
  private readonly awarenessBudget = new WeakMap<Connection, { tokens: number; at: number }>();
  private readonly updateBudget = new WeakMap<Connection, { tokens: number; at: number }>();
  /** Perm messages received so far, and the recent ones per share (see `catchUp`). */
  private permCount = 0;
  private readonly recentPerms = new Map<string, RecentPerm[]>();
  /** `afterUnloadDocument` work still running, awaited by `onDestroy`. */
  private readonly unloads = new Set<Promise<void>>();
  private readonly loggedAt = new Map<string, number>();
  private subscribed = false;
  private shuttingDown = false;
  private lockTicking = false;

  constructor(private readonly deps: CollabDeps) {
    this.timings = { ...DEFAULT_TIMINGS, ...deps.timings };
    this.lock = new ValkeyLock(deps.redis, deps.instanceId, this.timings.lockTtlMs);
  }

  // lifecycle

  async onConfigure({ instance }: onConfigurePayload) {
    this.instance = instance;
  }

  /** Starts the flush and lock timers and the permission and command subscriptions. */
  async start() {
    await this.refreshSettings(true);
    const permPattern = channels.permPattern();
    const cmdPattern = channels.cmdPattern();
    this.deps.subscriber.on("pmessage", (pattern: string, channel: string, message: string) => {
      // A rejection here would end the process; both handlers log their own errors.
      const shareId = channel.slice(channel.indexOf(":") + 1);
      const log = (error: unknown) =>
        this.logFailure("collab: message handler failed", error, shareId);
      if (pattern === permPattern)
        this.applyPermission(channel.slice(permPattern.length - 1), message).catch(log);
      else if (pattern === cmdPattern)
        this.handleCommand(channel.slice(cmdPattern.length - 1), message).catch(log);
    });
    // Pub/sub drops what was published while the connection was down: re-read every loaded share.
    this.deps.subscriber.on("ready", () => {
      if (!this.subscribed) return;
      for (const state of this.docs.values()) void this.reconcile(state);
    });
    await this.deps.subscriber.psubscribe(permPattern, cmdPattern);
    this.subscribed = true;
    this.timers.push(
      setInterval(() => this.flushTick(), this.timings.flushIntervalMs),
      setInterval(() => void this.lockTick(), this.timings.lockRenewMs),
    );
  }

  /**
   * SIGTERM path (§6.6): from now on documents unload without delay. Documents nobody is connected
   * to are unloaded here; Hocuspocus unloads the others when `destroy()` closes their connections.
   */
  beginShutdown() {
    this.shuttingDown = true;
    for (const state of this.docs.values()) {
      state.clearTimers();
      if (state.document.getConnectionsCount() === 0)
        void this.instance.unloadDocument(state.document);
    }
  }

  async onDestroy() {
    // Hocuspocus calls this once the last doc left its map, which can be before the
    // `afterUnloadDocument` of another doc (final flush, lock release) finished.
    await Promise.allSettled([...this.unloads]);
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.deps.subscriber
      .punsubscribe(channels.permPattern(), channels.cmdPattern())
      .catch(() => {});
  }

  private async currentShare(id: string): Promise<ShareRecord | null> {
    const share = await this.deps.stores.shares.get(id);
    if (!share?.labId) return share;
    const lab = await this.deps.stores.labs.get(share.labId);
    return lab ? { ...share, locked: lab.locked } : share;
  }

  // auth

  async onAuthenticate({ token, documentName, connectionConfig }: onAuthenticatePayload) {
    const payload = await verifyCollabToken(token, this.deps.secret);
    if (!payload || payload.shareId !== documentName) throw deny(COLLAB_DENY_REASONS.unauthorized);
    // Perm messages from now on may not be reflected in the share read below.
    const permMark = this.permCount;
    const share = await this.available(`authentication for ${documentName}`, () =>
      this.currentShare(documentName),
    );
    if (!share) throw deny(COLLAB_DENY_REASONS.notFound);
    if (share.bans.includes(payload.clientId)) throw deny(COLLAB_DENY_REASONS.banned);
    const controller = payload.controller ?? (!share.labId && payload.role === "owner");
    if (!controller && (payload.generation ?? "") !== (share.access.generation ?? ""))
      throw deny(COLLAB_DENY_REASONS.unauthorized);
    connectionConfig.readOnly = isReadOnly(payload.role, share.locked, controller);
    const result: CollabContext = {
      clientId: payload.clientId,
      name: payload.name,
      color: payload.color,
      role: payload.role,
      shareId: payload.shareId,
      controller,
      generation: payload.generation ?? "",
      permMark,
    };
    return result;
  }

  // load and unload

  async onLoadDocument({ document, documentName }: onLoadDocumentPayload) {
    const previous = this.docs.get(documentName);
    if (previous && previous.document !== document) {
      // A fast reconnect can load the doc again while the previous copy is still saving. A copy
      // that was never destroyed is left over from a load that failed after this hook.
      if (previous.document.isDestroyed) await previous.closed;
      else await this.release(previous);
    }

    const share = await this.available(`loading ${documentName}`, () =>
      this.currentShare(documentName),
    );
    if (!share) throw deny(COLLAB_DENY_REASONS.notFound);
    const lockKey = keys.docLock(documentName);
    const core = new PersistedDoc(documentName, document, this.deps.stores, {
      compactAfter: this.timings.compactAfter,
      historyIntervalMs: this.timings.historyIntervalMs,
      // Valkey unreachable: skip the compaction rather than fail the flush with it.
      stillOwner: () => this.lock.renew(lockKey).catch(() => false),
      onFlush: (ms) => {
        this.deps.metrics.flushSeconds.observe(ms / 1000);
        if (ms > 200)
          this.deps.diagnostics?.record("slow_flush", {
            durationMs: ms,
            documentSize: diagnosticSizeBucket(core.sizeEstimate),
            fileCount: diagnosticCountBucket(document.getMap(YDOC.files).size),
            connectionCount: diagnosticCountBucket(document.getConnectionsCount()),
          });
      },
    });
    core.owner = await this.lock.acquire(lockKey).catch(() => false);
    try {
      await this.available(`loading ${documentName}`, () => core.load());
    } catch (error) {
      if (core.owner) await this.lock.release(lockKey).catch(() => {});
      throw error;
    }
    const state = new DocState(documentName, document, core, share);
    const meta = document.getMap(YDOC.meta);
    const observer = () => this.scheduleMetaMirror(state);
    meta.observe(observer);
    state.stopMetaObserver = () => meta.unobserve(observer);
    this.docs.set(documentName, state);
  }

  async connected({ connection, documentName }: connectedPayload<CollabContext>) {
    const { metrics } = this.deps;
    guardSlowClient(
      connection.webSocket,
      this.timings.slowClientBytes,
      () => metrics.slowClients.inc(),
      (bytes) => {
        metrics.messagesSent.inc();
        metrics.bytesSent.inc(bytes);
      },
    );
    const state = this.docs.get(documentName);
    if (!state) return;
    this.setBroadcastWindow(state.document);
    state.idleSince = null;
    if (state.unloadTimer) clearTimeout(state.unloadTimer);
    state.unloadTimer = null;
    await this.catchUp(state, connection);
    // A permission change can commit while authentication is in flight, even if pub/sub was lost.
    const share = await this.available(`connected permissions for ${documentName}`, () =>
      this.currentShare(documentName),
    );
    if (!share) return this.applyDelete(state);
    this.applyShare(state, share, false);
    this.notify(connection, {
      type: "permissions",
      permissions: participantPermissions(share.access),
    });
  }

  /**
   * §6.7 for a connection that authenticated before a permission change and was registered on the
   * doc after the change was applied to the doc's connections: applies what it missed.
   */
  private async catchUp(state: DocState, connection: Connection) {
    if (state.deleted) {
      connection.close({ code: 4404, reason: COLLAB_CLOSE_REASONS.deleted });
      return;
    }
    const { permMark } = context(connection);
    const missed = (this.recentPerms.get(state.name) ?? [])
      .filter((entry) => entry.mark > permMark)
      .map((entry) => entry.message);
    if (missed.length === 0) return;
    try {
      if (missed.some((m) => m.kind === "delete")) return this.applyDelete(state);
      if (missed.some((m) => m.kind === "lock")) {
        const share = await this.currentShare(state.name);
        if (state.deleted || state.document.isDestroyed) return;
        if (!share) return this.applyDelete(state);
        this.applyShare(state, share, false);
      }
      for (const message of missed) {
        if (message.kind === "kick" || message.kind === "role")
          await this.enforce(state, message, [connection]);
      }
    } catch (error) {
      this.logFailure("collab: catching up a connection failed", error, state.name);
      state.reconciledAt = 0;
    }
  }

  async onDisconnect({ document, documentName }: onDisconnectPayload) {
    const state = this.docs.get(documentName);
    if (state?.document !== document) return;
    this.setBroadcastWindow(document);
    if (document.getConnectionsCount() === 0) state.idleSince = Date.now();
  }

  /**
   * A small group gets every change at once. A busy document still sends every edit at once, with
   * the cursors that waited for it, but cursor-only changes wait up to `broadcastWindowMs`: one
   * message per window instead of one per cursor move bounds what each client receives per second.
   */
  private setBroadcastWindow(document: Document) {
    if (document.isDestroyed) return;
    const busy = document.getConnectionsCount() >= this.timings.broadcastWindowFrom;
    const { configuration } = this.instance;
    document.flushDelay = busy ? this.timings.broadcastWindowMs : configuration.flushDelay;
    // A buffered edit of at least this many bytes flushes the window at once.
    document.flushMaxBytes = busy ? 0 : configuration.flushMaxBytes;
  }

  async beforeUnloadDocument({ document, documentName }: beforeUnloadDocumentPayload) {
    const state = this.docs.get(documentName);
    if (!state || state.document !== document) return;
    if (!this.shuttingDown && !state.deleted) {
      // §6.5: keep the doc warm for 30 s after the last connection leaves.
      const idleFor = Date.now() - (state.idleSince ?? Date.now());
      const remaining = this.timings.unloadDelayMs - idleFor;
      if (remaining > 0) {
        this.scheduleUnload(state, remaining);
        return Promise.reject();
      }
    }
    if (state.deleted) return;
    try {
      await this.mirrorMeta(state);
      await state.core.history(true);
      await state.core.compact();
    } catch (error) {
      this.logFailure("collab: saving a document before unload failed", error, documentName);
      // Shutting down: unload anyway so the process can exit. Connected clients still hold these
      // updates and send them to the instance they reconnect to.
      if (this.shuttingDown) return;
      // Keep the doc in memory rather than lose updates; try again later.
      this.scheduleUnload(state, this.timings.unloadDelayMs);
      return Promise.reject();
    }
  }

  async afterUnloadDocument({ documentName }: afterUnloadDocumentPayload) {
    const state = this.docs.get(documentName);
    if (!state?.document.isDestroyed) return;
    const done = (async () => {
      state.clearTimers();
      try {
        // Updates that arrived from other instances while extension-redis delayed the unload.
        if (!state.deleted) await state.core.flush();
      } catch (error) {
        this.logFailure("collab: final document flush failed", error, documentName);
      }
      await this.release(state);
    })();
    this.unloads.add(done);
    try {
      await done;
    } finally {
      this.unloads.delete(done);
    }
  }

  /** Forgets a doc: stops recording, gives up the lock and its nearby entry. */
  private async release(state: DocState) {
    state.clearTimers();
    state.stopMetaObserver();
    state.core.detach();
    if (state.core.owner) {
      state.core.disown();
      await this.lock.release(keys.docLock(state.name)).catch(() => {});
      await this.deps.redis.del(keys.nearbyItem(state.name)).catch(() => {});
    }
    if (this.docs.get(state.name) === state) this.docs.delete(state.name);
    this.loggedAt.delete(`flush:${state.name}`);
    state.markClosed();
  }

  private scheduleUnload(state: DocState, delayMs: number) {
    if (state.unloadTimer) clearTimeout(state.unloadTimer);
    state.unloadTimer = setTimeout(() => {
      state.unloadTimer = null;
      void this.instance.unloadDocument(state.document);
    }, delayMs);
  }

  // keystroke path: no awaits on MongoDB

  async onChange({ documentName, document, transactionOrigin }: onChangePayload) {
    this.deps.metrics.updates.inc({ origin: originLabel(transactionOrigin) });
    const state = this.docs.get(documentName);
    if (!state || state.document !== document || state.deleted) return;
    const now = Date.now();
    if (state.core.owner && now - state.lastActiveWrite >= this.timings.lastActiveIntervalMs) {
      state.lastActiveWrite = now;
      void this.touch(state, now);
    }
    if (!state.nearbyTimer) {
      const wait = Math.max(0, state.nearbyAt + this.timings.nearbyThrottleMs - now);
      state.nearbyTimer = setTimeout(() => {
        state.nearbyTimer = null;
        void this.publishNearby(state);
      }, wait);
    }
  }

  /** §6.6 size limit: refuse an update that would grow the doc past `settings.maxDocBytes`. */
  async beforeSync({ connection, document, type, payload }: beforeSyncPayload<CollabContext>) {
    // y-protocols: 1 = SyncStep2, 2 = Update; SyncStep1 carries no content.
    if (type !== 1 && type !== 2) return;
    const now = Date.now();
    const budget = this.updateBudget.get(connection) ?? { tokens: 200, at: now };
    budget.tokens = Math.min(200, budget.tokens + (Math.max(0, now - budget.at) * 50) / 1000);
    budget.at = now;
    this.updateBudget.set(connection, budget);
    if (budget.tokens < 1) {
      connection.readOnly = true;
      connection.close({ code: 4429, reason: "Document update rate exceeded" });
      return;
    }
    budget.tokens--;
    const state = this.docs.get(document.name);
    if (!state) {
      connection.readOnly = true;
      connection.close({ code: 4401, reason: "Document state unavailable" });
      return;
    }
    // Failed auth clears Hocuspocus's queued updates. A retry can drain later increments
    // before SyncStep2 supplies their missing prefix; wait without poisoning the local doc.
    // Nothing is applied or queued in Yjs here. The complete sync still passes every guard.
    if (type === 2 && !this.initialSync.has(connection)) {
      this.heldBack.set(connection, (this.heldBack.get(connection) ?? 0) + 1);
      this.refused.add(connection);
      connection.readOnly = true;
      return;
    }
    if (type === 1) this.initialSync.add(connection);
    const actor = context(connection);
    // Every opaque non-owner update can contain metadata, even if it appears to be plain text.
    // Decode once and share it with the comment guard; owners skip the permission classifier.
    let decoded: ReturnType<typeof Y.decodeUpdate> | undefined;
    if (actor.role !== "owner" || connection.readOnly) {
      decoded = Y.decodeUpdate(payload);
      if (!hasNewOperations(document, decoded)) return;
      if (
        connection.readOnly ||
        !permitsUpdate(document, decoded, participantPermissions(state.share.access))
      ) {
        this.refused.add(connection);
        connection.readOnly = true;
        console.warn("collab: permission refusal", { role: actor.role });
        this.notify(connection, { type: "permission_refused" });
        return;
      }
    }
    if (!validCommentAuthors(document, payload, actor, decoded)) {
      connection.readOnly = true;
      console.warn("collab: permission refusal", { role: actor.role });
      this.notify(connection, { type: "permission_refused" });
      connection.close({ code: 4401, reason: COLLAB_CLOSE_REASONS.reauth });
      return;
    }
    const max = this.maxDocBytes();
    if (state.core.sizeEstimate + payload.byteLength <= max) return;
    if (onlyDeletes(payload)) return;
    if (state.core.measure() + payload.byteLength <= max) return;
    // Hocuspocus answers a read-only connection's update with "not applied"; restored right after.
    this.refused.add(connection);
    connection.readOnly = true;
    this.deps.metrics.refusedTooLarge.inc();
    this.notify(connection, { type: "too_large", maxDocBytes: max });
  }

  async afterHandleMessage({ connection, document }: afterHandleMessagePayload<CollabContext>) {
    const held = this.heldBack.get(connection);
    if (held && this.initialSync.has(connection) && !this.refused.has(connection)) {
      // The accepted first SyncStep2 carried what was held back: settle the provider's count of
      // unsaved changes, or the tab keeps believing it has unsent edits.
      this.heldBack.delete(connection);
      const ack = new OutgoingMessage(connection.messageAddress)
        .writeSyncStatus(true)
        .toUint8Array();
      for (let i = 0; i < held; i++) connection.send(ack);
    }
    if (!this.refused.has(connection)) return;
    this.refused.delete(connection);
    const state = this.docs.get(document.name);
    connection.readOnly = isReadOnly(
      context(connection).role,
      state?.locked ?? false,
      context(connection).controller,
    );
  }

  /**
   * §4 awareness from clients: at most `AWARENESS_MAX_UPDATES_PER_SECOND` updates per connection,
   * `AWARENESS_MAX_STATE_BYTES` per state, only for Yjs clients no other connection here announced,
   * and `user` always from the token. Dropped entries are simply not forwarded.
   */
  async beforeHandleAwareness({
    connection,
    document,
    states,
    removedClients,
  }: beforeHandleAwarenessPayload<CollabContext>) {
    // Updates from other instances (extension-redis) were checked there.
    if (!connection) return;
    if (!this.takeAwarenessToken(connection)) {
      this.deps.metrics.awarenessDropped.inc();
      states.clear();
      removedClients.clear();
      return;
    }
    const { clientId, name, color } = context(connection);
    const own = document.getClients(connection);
    // Clients announced through another instance are not checked: after that instance died its
    // clients reconnect here with the same Yjs client ids.
    const ownedElsewhere = (yClientId: number) =>
      document
        .getConnections()
        .some((c) => c !== connection && document.getClients(c).has(yClientId));
    let owned = own.size;
    for (const [yClientId, state] of [...states]) {
      if (!own.has(yClientId)) {
        if (ownedElsewhere(yClientId) || owned >= AWARENESS_MAX_CLIENTS_PER_CONNECTION) {
          states.delete(yClientId);
          continue;
        }
        owned++;
      }
      const next: Record<string, unknown> = { ...state, user: { clientId, name, color } };
      if (context(connection).role !== "owner") delete next.presenting;
      // The controller: the owner, or the teacher in a lab (whose students own their copies).
      if (context(connection).controller) next.host = true;
      else delete next.host;
      // In bytes: Korean text takes three per character on the wire.
      if (Buffer.byteLength(JSON.stringify(next), "utf8") > AWARENESS_MAX_STATE_BYTES) {
        states.delete(yClientId);
      } else states.set(yClientId, next);
    }
    for (const yClientId of [...removedClients]) {
      if (!own.has(yClientId)) removedClients.delete(yClientId);
    }
  }

  /** Token bucket: a burst of one second's budget, refilled continuously. */
  private takeAwarenessToken(connection: Connection): boolean {
    const now = Date.now();
    const rate = AWARENESS_MAX_UPDATES_PER_SECOND;
    const budget = this.awarenessBudget.get(connection) ?? { tokens: rate, at: now };
    budget.tokens = Math.min(rate, budget.tokens + ((now - budget.at) * rate) / 1000);
    budget.at = now;
    this.awarenessBudget.set(connection, budget);
    if (budget.tokens < 1) return false;
    budget.tokens--;
    return true;
  }

  /** `settings.maxDocBytes`, never above what one MongoDB document can store. */
  private maxDocBytes(): number {
    return Math.min(this.settings.maxDocBytes, MAX_DOC_BYTES_LIMIT);
  }

  private shareRef(id: string): string {
    return diagnosticShareRef(this.deps.secret, id);
  }

  private logFailure(message: string, error: unknown, shareId?: string): void {
    console.error(
      message,
      ...(shareId ? [{ shareRef: this.shareRef(shareId) }] : []),
      diagnosticError(error),
    );
  }

  /** Logs a scrubbed error unless the same `key` was logged within `ERROR_LOG_INTERVAL_MS`. */
  private logThrottled(key: string, message: string, error: unknown, shareId?: string) {
    this.deps.diagnostics?.record("background_error", diagnosticError(error), "error");
    const now = Date.now();
    if (now - (this.loggedAt.get(key) ?? 0) < ERROR_LOG_INTERVAL_MS) return;
    this.loggedAt.set(key, now);
    console.error(
      message,
      ...(shareId ? [{ shareRef: this.shareRef(shareId) }] : []),
      diagnosticError(error),
    );
  }

  /** Runs a database read for a client; a failure is reported as `unavailable`, not a refusal. */
  private async available<T>(label: string, task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (isDenied(error, COLLAB_DENY_REASONS.notFound)) throw error;
      this.deps.diagnostics?.record("mongo_error", diagnosticError(error), "error");
      const operation = label.split(" ")[0] ?? "database operation";
      const shareId = label.split(" ").at(-1);
      this.logFailure(`collab: ${operation} failed`, error, shareId);
      throw deny(COLLAB_DENY_REASONS.unavailable);
    }
  }

  // timers

  private flushTick() {
    const now = Date.now();
    for (const state of this.docs.values()) {
      const { core } = state;
      if (state.flushing || state.deleted || !core.owner || now < state.flushRetryAt) continue;
      if (core.pendingUpdates === 0 && !core.needsCompaction && !core.historyDue) continue;
      state.flushing = true;
      const work = async () => {
        await core.flush();
        if (core.needsCompaction) await core.compact();
        if (core.historyDue) await core.history();
      };
      work()
        .then(() => {
          state.flushFailures = 0;
          state.flushRetryAt = 0;
        })
        .catch((error) => {
          this.deps.diagnostics?.record("flush_error", diagnosticError(error), "error");
          this.deps.metrics.flushErrors.inc();
          // Back off exponentially so an outage does not become a retry and log storm; the
          // buffer keeps every update meanwhile.
          state.flushFailures++;
          const delay = this.timings.flushIntervalMs * 2 ** state.flushFailures;
          state.flushRetryAt = Date.now() + Math.min(delay, FLUSH_BACKOFF_MAX_MS);
          this.deps.diagnostics?.record("flush_backoff", {
            backoffMs: Math.min(delay, FLUSH_BACKOFF_MAX_MS),
          });
          this.logThrottled(
            `flush:${state.name}`,
            `collab: flush failed (${state.flushFailures} in a row), retrying`,
            error,
          );
        })
        .finally(() => {
          state.flushing = false;
        });
    }
  }

  private async lockTick() {
    if (this.lockTicking) return;
    this.lockTicking = true;
    try {
      await this.lockUpkeep();
    } finally {
      this.lockTicking = false;
    }
  }

  private async lockUpkeep() {
    await this.refreshSettings();
    this.pruneRecentPerms();
    const now = Date.now();
    const live: DocState[] = [];
    for (const state of [...this.docs.values()]) {
      if (state.deleted || state.document.isDestroyed) continue;
      if (this.orphaned(state)) {
        // A load that failed after onLoadDocument (an `afterLoadDocument` hook threw): Hocuspocus
        // dropped the document, so nothing would ever unload this copy or give up its lock.
        console.error("collab: dropping an unloaded document", {
          shareRef: this.shareRef(state.name),
        });
        await this.release(state);
        continue;
      }
      live.push(state);
    }
    await this.upkeepLocks(live);
    for (const state of live) {
      if (state.deleted || state.document.getConnectionsCount() === 0) continue;
      if (now - state.reconciledAt >= this.timings.reconcileMs) void this.reconcile(state);
      if (state.core.owner && now - state.nearbyAt >= this.timings.nearbyRefreshMs)
        void this.publishNearby(state);
    }
  }

  /** True for a doc Hocuspocus neither holds nor is loading. */
  private orphaned(state: DocState): boolean {
    return (
      this.instance.documents.get(state.name) !== state.document &&
      !this.instance.loadingDocuments.has(state.name)
    );
  }

  /** Renews owned doc locks in one Valkey round trip and contends for the others in one more. */
  private async upkeepLocks(states: DocState[]) {
    const lockKey = (state: DocState) => keys.docLock(state.name);
    try {
      const owned = states.filter((s) => s.core.owner);
      const renewed = await this.lock.renewMany(owned.map(lockKey));
      // A renew also fails when the key is merely gone (Valkey restarted, or the TTL ran out
      // during a stall). Taking it again keeps the buffer; only another holder costs ownership.
      const contenders = [
        ...owned.filter((_, i) => renewed[i] === false),
        ...states.filter((s) => !s.core.owner),
      ];
      const acquired = await this.lock.acquireMany(contenders.map(lockKey));
      await Promise.all(
        contenders.map(async (state, i) => {
          const got = acquired[i];
          // null: that command failed, so keep the current role and retry on the next tick.
          if (got === null || got === undefined) return;
          if (state.core.owner) {
            if (!got) {
              this.deps.diagnostics?.record("lock_lost", { code: "lock_lost" }, "error");
              state.core.disown();
            }
            return;
          }
          if (!got) return;
          try {
            if (this.docs.get(state.name) !== state || state.deleted || state.document.isDestroyed)
              await this.lock.release(lockKey(state));
            else await state.core.adopt();
          } catch (error) {
            this.logThrottled("lock", "collab: lock takeover failed", error);
          }
        }),
      );
    } catch (error) {
      // Valkey unavailable: keep the current roles and retry on the next tick.
      this.logThrottled("lock", "collab: lock upkeep failed", error);
    }
  }

  /**
   * Re-reads the share and applies it to the doc's connections: lock, bans, existence. Covers perm
   * messages lost while the Valkey subscriber reconnected and shares removed by the TTL index.
   */
  private async reconcile(state: DocState) {
    if (state.reconciling || state.deleted || state.document.isDestroyed) return;
    state.reconciling = true;
    state.reconciledAt = Date.now();
    try {
      const share = await this.currentShare(state.name);
      if (state.deleted || state.document.isDestroyed) return;
      if (!share) {
        console.warn("collab: share no longer exists, closing it", {
          shareRef: this.shareRef(state.name),
        });
        return this.applyDelete(state);
      }
      this.applyShare(state, share, false);
    } catch (error) {
      this.logThrottled("reconcile", "collab: re-reading share failed", error, state.name);
      state.reconciledAt = 0;
    } finally {
      state.reconciling = false;
    }
  }

  /** Applies a freshly read share record; `announceLock` notifies even if `locked` is unchanged. */
  private applyShare(state: DocState, share: ShareRecord, announceLock: boolean) {
    const lockChanged = share.locked !== state.locked;
    const permissions = participantPermissions(share.access);
    const permissionsChanged =
      JSON.stringify(permissions) !== JSON.stringify(participantPermissions(state.share.access));
    state.share = share;
    state.locked = share.locked;
    state.nearby = share.access.nearby;
    for (const c of state.document.getConnections()) {
      const { clientId, role, controller, generation } = context(c);
      if (role !== "owner" && share.bans.includes(clientId)) {
        c.close({ code: 4403, reason: COLLAB_CLOSE_REASONS.kicked });
        continue;
      }
      if (!controller && generation !== (share.access.generation ?? "")) {
        c.readOnly = true;
        c.close({ code: 4401, reason: COLLAB_CLOSE_REASONS.reauth });
        continue;
      }
      const readOnly = isReadOnly(role, state.locked, controller);
      if (!this.refused.has(c)) c.readOnly = readOnly;
      if (announceLock || lockChanged) {
        this.notify(c, { type: "locked", locked: state.locked, readOnly });
      }
      if (permissionsChanged) this.notify(c, { type: "permissions", permissions });
    }
  }

  private pruneRecentPerms() {
    const now = Date.now();
    for (const [shareId, entries] of this.recentPerms) {
      const kept = entries.filter((entry) => now - entry.at < PERM_REPLAY_MS);
      if (kept.length === 0) this.recentPerms.delete(shareId);
      else this.recentPerms.set(shareId, kept);
    }
  }

  private async refreshSettings(force = false) {
    if (!force && Date.now() - this.settingsAt < this.timings.settingsRefreshMs) return;
    this.settingsAt = Date.now();
    try {
      this.settings = await this.deps.stores.settings.get();
    } catch (error) {
      this.logFailure("collab: reading settings failed", error);
    }
  }

  /** §6.10 and §5 expiry: at most once per minute per doc, from the lock owner only. */
  private async touch(state: DocState, now: number) {
    const expiresAt = new Date(now + this.settings.anonymousTtlHours * 3600_000);
    try {
      const found = await this.deps.stores.shares.touch(
        state.name,
        new Date(now),
        expiresAt,
        state.core.sizeEstimate,
      );
      // Expired by the TTL index while loaded: nobody publishes a delete for that.
      if (!found && !state.deleted) {
        console.warn("collab: share no longer exists, closing it", {
          shareRef: this.shareRef(state.name),
        });
        this.applyDelete(state);
      }
    } catch (error) {
      this.logFailure("collab: activity write failed", error, state.name);
    }
  }

  /** §6.9: `nearby:item:<id>` while the share is listed nearby (`reconcile` keeps the flag current). */
  private async publishNearby(state: DocState) {
    if (!state.core.owner || state.deleted) return;
    state.nearbyAt = Date.now();
    try {
      const key = keys.nearbyItem(state.name);
      if (!state.nearby) {
        await this.deps.redis.del(key);
        return;
      }
      const meta = state.document.getMap(YDOC.meta);
      const text = state.document.getText(YDOC.fileText(DEFAULT_FILE_ID));
      const preview = firstLines(text, NEARBY_PREVIEW_LINES);
      const title = meta.get("title");
      const language = meta.get("language");
      await this.deps.redis
        .multi()
        .hset(key, {
          id: state.name,
          title: typeof title === "string" ? title : state.share.title,
          language: typeof language === "string" ? language : state.share.language,
          participants: String(state.document.awareness.getStates().size),
          preview,
        })
        .expire(key, NEARBY_ITEM_TTL_SECONDS)
        .exec();
    } catch (error) {
      this.logFailure("collab: nearby publish failed", error, state.name);
    }
  }

  private scheduleMetaMirror(state: DocState) {
    if (state.metaTimer || state.deleted) return;
    const wait = Math.max(0, state.metaAt + this.timings.metaMirrorMs - Date.now());
    state.metaTimer = setTimeout(() => {
      state.metaTimer = null;
      void this.mirrorMeta(state);
    }, wait);
  }

  /** Copies Y.Map `meta` title and language into the share record, from the lock owner only. */
  private async mirrorMeta(state: DocState) {
    if (!state.core.owner || state.deleted) return;
    state.metaAt = Date.now();
    const meta = state.document.getMap(YDOC.meta);
    const title = titleSchema.safeParse(meta.get("title"));
    const language = languageSchema.safeParse(meta.get("language"));
    const patch: ShareUpdate = {};
    if (title.success && title.data !== state.share.title) patch.title = title.data;
    if (language.success && language.data !== state.share.language) patch.language = language.data;
    if (patch.title === undefined && patch.language === undefined) return;
    try {
      const share = await this.deps.stores.shares.update(state.name, {
        ...patch,
        updatedAt: new Date(),
      });
      if (share) state.share = share;
      else if (!state.deleted) this.applyDelete(state);
    } catch (error) {
      this.logFailure("collab: mirroring document metadata failed", error, state.name);
    }
  }

  // content commands (§6.11)

  /**
   * Handles one `cmd:<shareId>` message. Every instance receives it; only the doc lock holder
   * handles and answers it, taking the lock when nobody holds it.
   */
  async handleCommand(shareId: string, raw: string) {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      message = undefined;
    }
    const parsed = collabCommandSchema.safeParse(message);
    const requestId = parsed.success
      ? parsed.data.requestId
      : collabCommandRequestIdSchema.safeParse(
          typeof message === "object" && message !== null && "requestId" in message
            ? message.requestId
            : undefined,
        ).data;
    if (requestId === undefined) {
      console.error("collab: ignoring command without a request id", {
        shareRef: this.shareRef(shareId),
      });
      return;
    }
    if (!(await this.claim(shareId).catch(() => false))) return;

    let error: CollabCommandError | undefined;
    try {
      // A missing/invalid doc releases its lock before slower subscribers receive this command.
      // Keep a short receipt so those subscribers cannot execute or answer the same request twice.
      const first = await this.deps.redis.set(
        keys.commandReceipt(shareId, requestId),
        this.deps.instanceId,
        "PX",
        30_000,
        "NX",
      );
      if (first !== "OK") return;
      error = parsed.success
        ? await this.runCommand(shareId, parsed.data)
        : COLLAB_COMMAND_ERRORS.invalid;
    } catch (cause) {
      this.logFailure("collab: command failed", cause, shareId);
      error = COLLAB_COMMAND_ERRORS.failed;
    } finally {
      // The lock was taken for a doc that did not stay loaded here.
      if (!this.docs.get(shareId)?.core.owner) {
        await this.lock.release(keys.docLock(shareId)).catch(() => {});
      }
    }
    const reply: CollabCommandReply = error === undefined ? { ok: true } : { ok: false, error };
    await this.deps.redis
      .publish(channels.cmdReply(requestId), JSON.stringify(reply))
      .catch((cause) => this.logFailure("collab: command reply failed", cause));
  }

  /** True when this instance holds the doc lock (now), so it is the one to run a command. */
  private async claim(shareId: string): Promise<boolean> {
    if (this.shuttingDown) return false;
    let state = this.docs.get(shareId);
    if (state?.document.isDestroyed) {
      await state.closed;
      state = this.docs.get(shareId);
    }
    if (state?.core.owner) return true;
    if (!(await this.lock.acquire(keys.docLock(shareId)))) return false;
    if (state && !state.deleted && !state.document.isDestroyed && !state.core.owner) {
      await state.core.adopt();
    }
    return true;
  }

  private async runCommand(
    shareId: string,
    command: CollabCommand,
  ): Promise<CollabCommandError | undefined> {
    let target: Y.Doc | undefined;
    if (command.kind === "restore") {
      const snapshot = await this.deps.stores.snapshots.get(shareId, "history", command.seq);
      if (!snapshot) return COLLAB_COMMAND_ERRORS.snapshotNotFound;
      target = new Y.Doc();
      Y.applyUpdate(target, snapshot.state);
    } else if (command.kind === "replace") {
      target = new Y.Doc();
      try {
        Y.applyUpdate(target, Buffer.from(command.state, "base64"));
      } catch {
        return COLLAB_COMMAND_ERRORS.invalid;
      }
    }
    if (target && Y.encodeStateAsUpdate(target).byteLength > this.maxDocBytes()) {
      return COLLAB_COMMAND_ERRORS.tooLarge;
    }

    let connection: DirectConnection;
    try {
      // Loads the doc when it is not in memory here; the lock is already ours, so this instance
      // becomes its writer.
      connection = await this.instance.openDirectConnection(shareId);
    } catch (cause) {
      if (isDenied(cause, COLLAB_DENY_REASONS.notFound)) return COLLAB_COMMAND_ERRORS.notFound;
      throw cause;
    }
    try {
      const state = this.docs.get(shareId);
      if (!state || state.document.isDestroyed) return COLLAB_COMMAND_ERRORS.failed;
      if (state.deleted) return COLLAB_COMMAND_ERRORS.notFound;
      if (!state.core.owner) return COLLAB_COMMAND_ERRORS.failed;
      // History before and after, so the change itself is a step in playback.
      if (target) await state.core.history(true);
      let error = undefined as CollabCommandError | undefined;
      await connection.transact((doc) => {
        if (doc !== state.document) error = COLLAB_COMMAND_ERRORS.failed;
        else if (target) syncContent(doc, target);
        else if (command.kind === "meta" && !applyMeta(doc, command)) {
          error = COLLAB_COMMAND_ERRORS.fileNotFound;
        }
      });
      if (error) return error;
      await state.core.flush();
      if (target) await state.core.history(true);
      return undefined;
    } finally {
      // Not awaited: disconnecting runs the store hooks, and extension-redis delays those by up to
      // a second, which the reply must not wait for.
      connection
        .disconnect()
        .catch((cause) => this.logFailure("collab: closing a command connection failed", cause));
    }
  }

  // permissions (§6.7)

  /** Handles one `perm:<shareId>` message; never rejects. */
  async applyPermission(shareId: string, raw: string) {
    let message: PermMessage;
    try {
      message = permMessageSchema.parse(JSON.parse(raw));
    } catch {
      console.error("collab: ignoring malformed permission message", {
        shareRef: this.shareRef(shareId),
      });
      return;
    }
    // Kept for connections that are authenticating now and are not on the doc yet.
    this.permCount++;
    const recent = this.recentPerms.get(shareId) ?? [];
    recent.push({ mark: this.permCount, at: Date.now(), message });
    this.recentPerms.set(shareId, recent);

    const state = this.docs.get(shareId);
    if (!state || state.document.isDestroyed || state.deleted) return;
    try {
      await this.enforce(state, message, state.document.getConnections());
      if (message.kind === "role" || message.kind === "kick") await this.reconcile(state);
    } catch (error) {
      this.logFailure("collab: applying a permission message failed", error, shareId);
      // Read the share again on the next lock tick.
      state.reconciledAt = 0;
    }
  }

  /**
   * Applies a perm message to `connections` of the doc. `kick`, `delete` and `lock` are applied
   * whatever their `version`: the API's counter is not published in order and restarts with
   * Valkey, kicking or deleting twice is harmless, and `lock` re-reads the share. Only per-client
   * role changes are ordered, so an older one cannot undo a newer one.
   */
  private async enforce(state: DocState, message: PermMessage, connections: Connection[]) {
    const targets = (c: Connection) =>
      message.clientId === undefined || context(c).clientId === message.clientId;

    switch (message.kind) {
      case "kick":
        if (message.clientId === undefined) return;
        for (const c of connections.filter(targets)) {
          c.close({ code: 4403, reason: COLLAB_CLOSE_REASONS.kicked });
        }
        return;
      case "role": {
        const { role, clientId } = message;
        if (role !== undefined && clientId !== undefined) {
          const newest = state.roleVersions.get(clientId) ?? -1;
          if (message.version < newest) {
            console.warn("collab: ignoring stale role message", {
              shareRef: this.shareRef(state.name),
            });
            return;
          }
          state.roleVersions.set(clientId, message.version);
          for (const c of connections.filter(targets)) {
            context(c).role = role;
            c.readOnly = isReadOnly(role, state.locked, context(c).controller);
            this.notify(c, { type: "role", role, readOnly: c.readOnly });
          }
          return;
        }
        for (const c of connections.filter(targets)) {
          if (!context(c).controller) c.close({ code: 4401, reason: COLLAB_CLOSE_REASONS.reauth });
        }
        return;
      }
      case "lock": {
        const share = await this.currentShare(state.name);
        if (state.deleted || state.document.isDestroyed) return;
        if (!share) return this.applyDelete(state);
        this.applyShare(state, share, true);
        return;
      }
      case "permissions": {
        const share = await this.currentShare(state.name);
        if (state.deleted || state.document.isDestroyed) return;
        if (!share) return this.applyDelete(state);
        this.applyShare(state, share, false);
        return;
      }
      case "delete":
        return this.applyDelete(state);
    }
  }

  private applyDelete(state: DocState) {
    if (state.deleted) return;
    state.deleted = true;
    if (state.core.owner) {
      state.core.disown();
      void this.lock.release(keys.docLock(state.name)).catch(() => {});
      void this.deps.redis.del(keys.nearbyItem(state.name)).catch(() => {});
    }
    state.clearTimers();
    for (const c of state.document.getConnections()) {
      c.close({ code: 4404, reason: COLLAB_CLOSE_REASONS.deleted });
    }
    void this.instance.unloadDocument(state.document);
  }

  private notify(connection: Connection, message: CollabStateless) {
    connection.sendStateless(JSON.stringify(message));
  }

  /** Test and shutdown helper: writes every buffer now. */
  async flushAll() {
    await Promise.all([...this.docs.values()].map((s) => (s.deleted ? undefined : s.core.flush())));
  }
}
