# gachipad architecture contract

Developer-facing contract shared by every package. When this file and the code disagree, fix one of them in the same change.

## 1. Runtime topology

```
browser ──HTTP /api/*──────────▶ apps/api    (Fastify, :3001)
        ──SSE  /api/events─────▶ apps/api
        ──WS   /collab?doc=<id>▶ apps/collab (Hocuspocus, :3002)
apps/api, apps/collab ──▶ Database           persistent state (SQLite, PostgreSQL, MongoDB, MySQL/MariaDB)
apps/api, apps/collab ──▶ Valkey 8 (:6379)   pub/sub, presence, codes, caches
production: Caddy (:80/:443) serves apps/web/dist and proxies /api, /collab (lb_policy query doc)
dev: Vite (:5173) proxies /api → :3001 and /collab → :3002 (ws)
```

- One Valkey and one database (SQLite, PostgreSQL, MongoDB, or MySQL/MariaDB). `apps/collab` can run N instances; `@hocuspocus/extension-redis` (ioredis, Valkey-compatible) keeps them in sync, and Caddy routes by `doc` query so one doc normally lives on one instance.
- No runtime request requires the public internet. No CDN, font, analytics or external API.
- The one exception is the update check (§15): apps/api sends one plain GET to the GitHub releases API about every 12 h. It is on by default, off with `UPDATE_CHECK=off`, never blocks startup or a request, and fails silently in 5 s without internet. Browsers never contact anything but the gachipad server.

Storage layer: Persistent storage implements a single `Stores` interface (`ShareStore`, `UpdateLog`, `FileStore`, `SettingsStore`, `AuditStore`) in `packages/storage`. The backend is selected at runtime by the URL scheme of `DATABASE_URL` (`sqlite:`, `postgres:`/`postgresql:`, `mysql:`/`mariadb:`, or `mongodb:`/`mongodb+srv:`). Ephemeral collaboration state, pub/sub channels, document locks, presence, rate limits, and join codes remain on Valkey, which stays required regardless of the selected database backend.

## 2. Packages

| Path | Role |
|---|---|
| `packages/shared` | zod schemas + TS types for every API body/response, SSE event, awareness state, constants (limits, TTLs, key names) |
| `packages/storage` | `ShareStore`, `UpdateLog`, `FileStore`, `SettingsStore`, `AuditStore` interfaces (`Stores`) with backends for SQLite, PostgreSQL, MongoDB, and MySQL/MariaDB. Database drivers are isolated to this package |
| `packages/highlight` | language registry (id, name, extensions, color, loader), CodeMirror themes (2 dark, 2 light) with WCAG-checked token colors, language detection |
| `packages/i18n` | `ko` and `en` dictionaries (same keys, typed), `t()` helper. Only these two locales |
| `packages/ui` | design tokens (CSS variables), Tailwind v4 theme, shared React components on Radix primitives |
| `packages/cli` | `gachipad` CLI (`push`, `open`) |
| `apps/api` | REST + SSE, sessions, codes, permissions, presence, nearby, invites, uploads, labs, admin |
| `apps/collab` | Hocuspocus server, auth, permission enforcement, batched persistence, compaction, nearby previews |
| `apps/web` | React 19 SPA: intro page, editor, my shares, lab, admin |

## 3. Identifiers

| Thing | Format |
|---|---|
| share id | 8 chars base62, always contains at least one letter (`/^[0-9A-Za-z]{8}$/` and `/[A-Za-z]/`). URL `/<id>` |
| join code | 6 digits, no leading zero. URL `/<code>` resolves to `/<id>`. Allocated in Valkey with `SET code:<code> <id> NX EX <ttl>`; retry on collision; released codes are blocked for 24h (`code:cool:<code>`) |
| client id | UUID v4 created by the API on first visit, stored in signed httpOnly cookie `gachipad_sid` (also returned to JS for awareness) |
| file id | `main` for the first file, else 8 chars base62 |
| lab id / lab code | same rules as share id / join code (`lab:` key prefix) |

## 4. Document model (one Y.Doc per share)

```
Y.Map  "meta"     { title: string, language: string (default file language) }
Y.Map  "files"    fileId -> Y.Map { path: string, language: string, order: number }
Y.Text "file:<fileId>"   file content
Y.Array "comments"  { id, fileId, anchor: RelativePosition(JSON), head: RelativePosition(JSON), author: {clientId,name,color}, body, createdAt, resolved }
```

- Server Y.Doc uses `gc: true`. The initial sync sends only the garbage-collected current state, so deleted text is never sent to a newly joining client.
- Awareness state (`packages/shared` `AwarenessState`): `{ user: {clientId, name, color}, fileId, cursor?: {anchor, head} (Yjs relative), viewport?: {fromLine, toLine}, following?: clientId, presenting?: bool, moved?: number, host?: bool }`. `moved` counts a client's own edits and selection changes, so a receiver shows a name only when that person acted, never because other people's edits moved the caret. Collab sets `host` from the connection's controller flag and removes any value a client sent. Clients throttle awareness to ≤30 updates/s; the collab server drops updates beyond that per connection (counted in `gachipad_collab_awareness_dropped_total`), states over 4 KB, and states for Yjs clients another connection announced, and always sets `user` from the token.
- Broadcast window: a doc with ≥ 8 connections sends document updates at once, together with any awareness changes waiting, and sends awareness-only changes at most once per 30 ms window (`COLLAB_BROADCAST_WINDOW_MS`, 0 turns it off). Every cursor fans out to everyone, so a class of 50 would otherwise get one message per cursor move each; batching cut the messages of a 50-person share by 62% with edit latency unchanged (docs/OPERATIONS.md §11). Smaller docs flush every event-loop turn as before.

## 5. MongoDB collections

| Collection | Shape | Indexes |
|---|---|---|
| `shares` | `{_id: id, title, language, ownerId, createdAt, updatedAt, lastActiveAt, expiresAt: Date|null, saved: bool, savedBy: clientId[], access: {default: 'edit'|'view', editKey, pinHash: string|null, requireApproval: bool, nearby: bool}, bans: clientId[], joinCode, labId?: string, forkOf?: id, locked: bool, sizeBytes}` | TTL on `expiresAt` (`expireAfterSeconds: 0`), `ownerId`, `savedBy`, `labId` |
| `share_updates` | `{shareId, seq: number, data: Binary, at: Date}` | unique `{shareId, seq}` |
| `share_snapshots` | `{shareId, seq, state: Binary, at: Date, kind: 'compact'|'history'}` | `{shareId, seq}` |
| `labs` | `{_id, title, ownerId, joinCode, templateShareId, locked, students: [{clientId, name, shareId, joinedAt}], createdAt, expiresAt}` | TTL on `expiresAt` |
| `fs.files` / `fs.chunks` | GridFS bucket `uploads`, metadata `{ownerId, shareId?, expiresAt}` | default + `metadata.expiresAt` |
| `share_labels` | `{_id: "<clientId>:<shareId>", clientId, shareId, folder: string|null, tags: string[], updatedAt}`: one person's own folder and tags for a share in "my shares"; nobody else sees them | `clientId`, `shareId` |
| `settings` | single doc `_id: 'global'` (see §10) | |
| `audit` | `{at, actor: clientId, ip, action, shareId?, detail}` (only when audit enabled) | `{at: -1}`, TTL by retention |

- A sweeper (in `apps/collab`, every 10 min, guarded by a Valkey lock `lock:sweeper`) deletes updates/snapshots/uploads/share_labels whose share no longer exists, and `share_labels` of people who neither own nor have saved the share (a label write that raced with unsave or ban; `PUT .../labels` also checks the share again after writing).
- Expiry: unsaved shares `expiresAt = lastActiveAt + settings.anonymousTtlHours` (default 24). Saving sets `expiresAt = null`.

## 6. Persistence and concurrency (apps/collab)

1. Live state is the in-memory Y.Doc held by Hocuspocus. Nothing on the keystroke path awaits MongoDB.
2. `onChange`/`onStoreDocument` are replaced by a custom extension: every Y update is appended to an in-memory per-doc buffer; a flusher writes buffers with `insertMany` every 100 ms (`seq` monotonically increasing per doc, owned by the instance that holds the doc lock `doclock:<id>` in Valkey).
3. Compaction: after 200 updates or when the doc unloads, write a `compact` snapshot (`Y.encodeStateAsUpdate`) and delete updates with `seq ≤ snapshot.seq`. History snapshots (`kind:'history'`) are kept every 30 s of activity for playback (owner only), up to `settings.historyRetentionDays` and at most the newest 100 per share.
4. Load: latest snapshot + updates after it.
5. Unload: 30 s after the last connection leaves, flush, compact, release lock.
6. Shutdown (SIGTERM): stop accepting, flush all buffers, compact, exit. Target data loss on crash ≤ 1 s.
7. Permissions: on connect the client sends a token (§8). The collab server verifies it, sets `connection.readOnly` for viewers and rejects updates from read-only connections. Permission changes arrive on Valkey channel `perm:<shareId>` with `{version, kind: 'role'|'kick'|'lock'|'delete', clientId?, role?}`; affected connections are closed or switched within 100 ms under normal pub/sub delivery. The API signs `controller` (teacher in a lab, owner otherwise), so a student owning a copy is still read-only under the lab lock. Student metadata and history-restore HTTP writes also check the authoritative lab lock. `access.generation` is stored with the Mongo share and rotated on kick/ban and default role, edit-key, PIN or approval tightening. Non-controller tokens must match it on authentication and connected reconciliation; a kick conservatively invalidates all non-controller tokens for that share. Older tokens without a generation match only unmigrated shares; older tokens without `controller` count as controller only for the owner of a non-lab share, so a teacher still connected with a token from before the upgrade is read-only under a lab lock until it reconnects. Revoked reconnects return the existing `unauthorized` denial; connected clients close with the existing `reauth` reason. `kick`, `lock` and `delete` apply whatever their `version`; only a per-client `role` older than one already applied is ignored. Pub/sub can lose messages, so collab also re-reads the share and lab lock of every doc with connections every 15 s and after its subscriber reconnects (lock, bans, token generation, existence), and replays messages that arrived while a connection was authenticating. Database errors during authentication or load are refused with reason `unavailable` (retry with backoff), not as an access decision.
8. Slow clients: if a connection's buffered amount exceeds 4 MB, close it with code 4408; the client reconnects and resyncs. The same guard counts every message and byte sent (`gachipad_collab_ws_messages_sent_total`, `gachipad_collab_ws_bytes_sent_total`); event-loop lag is on `/metrics` as `gachipad_collab_nodejs_eventloop_lag_*`.
9. Nearby previews: on change (throttled to 2 s), publish `{id, title, language, participants, preview: first 8 lines of main file}` into Valkey hash `nearby:item:<id>` (EX 60) when `access.nearby` is true.
10. `lastActiveAt` is written at most once per minute per doc.
11. Only apps/collab writes `share_updates`. Other services change document content through Valkey channel `cmd:<shareId>` with `{requestId, kind: 'restore', seq}` (restore history snapshot `seq`) or `{requestId, kind: 'replace', state: base64}` (apply a full Y state as a diff) or `{requestId, kind: 'meta', title?, language?, fileId?}`; collab opens the doc (direct connection if not loaded), applies the change as a normal update and replies on `cmd-reply:<requestId>` with `{ok, error?}` within 5 s. Initial content of a brand-new share (uploads, fork, CLI push) is written by the API as a `compact` snapshot at seq 0 before any client connects.
12. A client whose update was refused (read-only or `too_large`) must drop its local Y.Doc and resync (`packages/shared/src/collab.ts`).

## 7. Valkey keys and channels

| Key / channel | Use |
|---|---|
| `code:<code>` → id, `code:cool:<code>` | join codes |
| `labcode:<code>` → labId | lab join codes |
| `presence:<net>` ZSET clientId → lastSeen ms | online users per network group |
| `presence:user:<clientId>` HASH {name, color, net, room} EX 60 | user card |
| `nearby:<net>` ZSET id → lastActive ms, `nearby:item:<id>` HASH | nearby shares |
| `pending:<shareId>` HASH clientId → name | waiting room |
| `perm:<shareId>` channel | permission changes to collab |
| `user:<clientId>` channel | SSE events for one user |
| `net:<net>` channel | SSE events for a network group (broadcast) |
| `cmd:<shareId>` channel, `cmd-reply:<requestId>` channel | content commands to collab (§6.11): `restore`, `replace`, `meta` |
| `cmd:receipt:<shareId>:<requestId>` | 30-second command receipt prevents duplicate execution/replies after releasing an unloaded doc lock |
| `doclock:<id>`, `lock:sweeper` | instance ownership (SET NX PX + renew) |
| `rl:<address>:<bucket>`, `rl:<IPv6 prefix>/64:<bucket>` | rate limiting: per address; an IPv6 /64 also has its own counter at 16× the limit |
| `quota:<shares/uploads/bytes>:<c/i>:<key>` | fixed-window ingress reservations, with TTL |
| `sse:<c/i>:<key>` | ZSET stream leases, 90 s with refresh and disconnect release |
| `admitted-net:<shareId>`, `banned-net:<shareId>` | address each client joined from, and the addresses banned from the share |

Every pub/sub channel is prefixed with the optional env `GACHIPAD_NS` (keys are isolated by Valkey database index instead, but pub/sub ignores it). Tests give each file its own namespace via `scripts/vitest-namespace.ts`; production leaves it empty or sets one per deployment sharing a Valkey.

Network group `net`: the room name when the client IP falls in a configured room CIDR (`settings.rooms: [{name, cidrs}]`), else the IPv4 /24 (`settings.subnetPrefixV4`, default 24) or IPv6 /64. Client IP is the socket address unless the socket address is in `TRUST_PROXY` CIDRs, then the right-most untrusted `X-Forwarded-For` entry (walking from the right; it cannot be spoofed).

## 8. Sessions and tokens

- `gachipad_sid` cookie: `Secure` when `PUBLIC_URL` starts with `https://`; signed (`@fastify/cookie`, `SESSION_SECRET`), httpOnly, SameSite=Lax, value = clientId. Display name/color are stored in `presence:user:*` and localStorage.
- Collab token: `base64url(JSON{shareId, clientId, name, color, role:'owner'|'edit'|'view', controller, generation, exp}) + '.' + HMAC-SHA256(COLLAB_SECRET)`, exp 10 min; the provider fetches a fresh token on reconnect via `POST /api/shares/:id/join`.
- PIN: bcrypt-free — `scrypt` (node:crypto) hash. 5 wrong attempts per client, 30 per address (480 per IPv6 /64) and 200 per share per 10 min → 429; setting a new PIN resets the share counter, so the owner can end a lockout. Slots are reserved atomically before scrypt; successful attempts release their slots. Comparison uses `timingSafeEqual`. PIN length defaults remain unchanged; a short PIN is an admission aid, not a strong password.
- Optional OIDC/LDAP login (settings) only maps a verified identity onto the clientId; anonymous use keeps working unless `settings.guestAllowed` is false.

## 9. HTTP API (apps/api)

All bodies and responses are zod schemas in `packages/shared`. Errors: `{error: {code, message}}` with HTTP status; codes are stable strings (`not_found`, `forbidden`, `pin_required`, `pin_invalid`, `banned`, `pending_approval`, `rate_limited`, `too_large`, `expired`, `validation`).

| Method & path | Purpose |
|---|---|
| `GET /api/version` | public, also without guest access: `{version}` of the running API (`no-store`); clients compare it with their build |
| `GET /api/admin/update` / `POST /api/admin/update/check` | admin: the cached update state `{current, latest, url, publishedAt, notes, checkedAt, status, updateAvailable, repo, channel, releasesUrl, updater}`; the POST checks now, once a minute per deployment (`429` + `Retry-After`) |
| `GET /api/session` | creates session if missing → `{clientId, name|null, color, net, room|null}` |
| `PATCH /api/session` | `{name?, color?}` |
| `POST /api/shares` | `{title?, language?, files?: [{path, language?, content}]}` → `{id, code, url}`; creator = owner |
| `GET /api/shares/:id` | meta + `{role, needsPin, requireApproval}` (no content) |
| `POST /api/shares/:id/join` | `{pin?, editKey?}` → `{token, role}` or 202 `{status:'pending'}` |
| `PATCH /api/shares/:id` | owner: title, language, access, saved, locked |
| `DELETE /api/shares/:id` | owner |
| `POST /api/shares/:id/save` / `DELETE …/save` | any participant: add/remove from "my shares" (`savedBy`), sets `expiresAt=null` while savedBy non-empty |
| `GET /api/shares` | my shares (owned ∪ saved), newest first, with language + preview + my `folder` and `tags` |
| `PUT /api/shares/:id/labels` | a share in my shares: `{folder: string|null, tags: string[]}` (folder 1-60 chars, at most 10 tags of 1-30 chars, trimmed, duplicates removed case-insensitively; empty folder and no tags deletes the entry) → the stored labels |
| `GET /api/templates` | code templates: built-in ones (`packages/shared/src/templates.ts`, `builtin: true`; their `name` and `description` are i18n keys such as `template.java.name`, resolved by the client, while templates from settings carry plain text) followed by `settings.templates`, each `{id, name, language, description, files: [{path, language?, content}], builtin}`. The web app creates a share from one with the normal `POST /api/shares` |
| `GET /api/settings/public` | `{contact, anonymousTtlHours, historyRetentionDays, maxUploadMB, maxDocBytes, guestAllowed}` for the intro page and help text; no secrets |
| `GET /api/codes/:code` | → `{id}` or `{labId}` |
| `POST /api/shares/:id/kick` | owner `{clientId, ban}` |
| `GET /api/shares/:id/pending` / `POST …/pending/:clientId` | owner: list / `{approve}` |
| `POST /api/shares/:id/fork` | → new share id (copy of current state) |
| `GET /api/shares/:id/history` | owner: `[{seq, at}]`; `GET …/history/:seq` → binary state |
| `POST /api/shares/:id/restore` | owner `{seq}` → applies a diff that turns the doc into that state (normal update, keeps history) |
| `GET /api/shares/:id/download` | `?file=<fileId>` single file, else zip of all files |
| `GET /api/nearby` | nearby shares in my `net` |
| `GET /api/presence` | online users in my `net` |
| `POST /api/invites` | `{to: clientId | 'net', shareId, fileId?, uploadId?, note?}` |
| `POST /api/uploads` | multipart (files or zip/folder), limit `settings.maxUploadMB` → `[{uploadId, name, size}]`; `?asShare=1` creates a multi-file share |
| `GET /api/uploads/:uploadId` | download |
| `POST /api/labs`, `GET /api/labs/:id`, `POST /api/labs/:id/join`, `PATCH /api/labs/:id` (`locked`, `templateShareId`), `POST /api/labs/:id/distribute` | lab mode |
| `GET /api/events` | SSE (§9.1) |
| `GET/PUT /api/admin/settings`, `GET /api/admin/audit`, `GET /api/admin/stats` | `Authorization: Bearer <ADMIN_TOKEN>` |
| `GET /healthz`, `GET /metrics` | health + Prometheus (prom-client) |

### 9.1 SSE events (`GET /api/events`)

`event: <type>` + JSON `data`. Heartbeat comment every 15 s. Types: `presence` (full list for my net), `nearby` (full list), `invite` `{from, shareId, title, language, note?, uploadId?}`, `broadcast` `{from, shareId, title}`, `approval-request` `{shareId, clientId, name}`, `approval-result` `{shareId, approved}`, `kicked` `{shareId, banned}`, `lab` `{labId, kind}`.
While a client has an open SSE stream the API refreshes its presence every 20 s. Admission reserves distributed stream slots per client and per address (and IPv6 /64) before subscribing. Presence admission is atomic and capped per network group; a full group leaves the newcomer off the list but keeps its stream, since EventSource does not retry a refused stream. Presence change notifications on internal pub/sub carry an empty list as an invalidation; only the API consumes these, computes a shared cached list and sends the unchanged full-list SSE protocol to browsers. Presence notifications are coalesced for 100 ms, so a burst does not rebuild and publish a full list per joining stream. Each snapshot is serialized once; each recipient omits its own card using a constant number of shared Buffer views. Per-entry hashes permit constant-work change detection excluding the recipient. Lookup/encoding work is linear in cards plus streams rather than rebuilding a list per stream. The unchanged full-snapshot protocol still sends the encoded size per recipient; cardinality and stream caps bound that unavoidable bandwidth.

## 10. Settings (`settings` doc, admin-editable, env provides defaults)

`anonymousTtlHours` 24, `historyRetentionDays` 7, `maxDocBytes` 5 MB (at most 12 MiB, below MongoDB's 16 MiB document limit), `maxUploadMB` 200, `guestAllowed` true, `rooms` [], `subnetPrefixV4` 24, `nearbyDefault` true, `audit.enabled` false, `audit.retentionDays` 90, `secretWarning` true, `auth.oidc` null, `auth.ldap` null, `contact` "", `templates` [] (at most 50 `{id, name, language, description, files}`, each template within `maxDocBytes` and all of them together within 2 MiB (`MAX_TEMPLATES_TOTAL_BYTES`, so the settings document and the `PUT /api/admin/settings` request stay small; the route's body limit is six times that plus 1 MiB for JSON escaping, and a larger body answers `413 too_large`); ids are unique and never collide with built-in ids, which start with `builtin-`).

## 11. Web app

- Routes: `/` intro + start, `/:code(\d{6})` resolve, `/:id` editor, `/me` my shares, `/lab/:id` lab (teacher grid / student), `/admin`.
- State: TanStack Query for REST, one `EventSource` for SSE, one `HocuspocusProviderWebsocket` per tab (multiplexes docs; lab grid uses it).
- Editor: CodeMirror 6 + `y-codemirror.next` (`yCollab`), keymaps via `@replit/codemirror-vim`, `@replit/codemirror-emacs`, sublime-style bindings from `@codemirror/commands`.
- Smoothness: local edits render immediately; remote cursors animate position with CSS transforms, resolve their positions once per document state for both layers, and restart their name flag by switching animation names (no forced reflow); presence hooks (`useAwarenessSelector`) re-render only when what they show changes, so cursor moves do not re-render the people list, follow mode or lab tiles; route transitions via the View Transitions API with a reduced-motion fallback; skeletons instead of spinners; optimistic UI for title/language/settings.
- Smooth typing (setting, on by default): the main cursor is drawn in its own layer and glides with a 90 ms transform transition while typing, deleting or moving with keys; clicks, pastes, undo, remote edits, resizes and moves of more than 3 lines snap. No transition under `prefers-reduced-motion`. Freshly typed characters do not fade: that needs a decoration per keystroke, which splits the text node CodeMirror redraws and would sit inside an IME composition.
- Offline: `y-indexeddb` copy per doc (`gachipad:doc:<shareId>`), on by default and switchable in the settings (§14); banner shows "offline – changes kept" and merges on reconnect.
- PWA: `vite-plugin-pwa` with `registerType: "prompt"`: a new build waits until the user chooses "Reload" in the update toast, except on HTTPS or localhost where untouched tabs with no open documents across any tab auto-apply and reload (tabs with active edits never auto-reload). The build version (root package.json) is compiled in and compared with `GET /api/version` at start, on focus, every 30 min and on every collab reconnect; a mismatch asks the service worker for the new build and shows the toast. A server of another version keeps the Yjs protocol, so open documents resync after the reconnect.
- PWA notifications use the Notification API while the app is open (no external push service exists on a private network).

## 12. Commands

| Command | Where |
|---|---|
| `pnpm dev` | turbo: web + api + collab (needs `pnpm services:up`) |
| `pnpm services:up` / `services:down` | docker compose: MongoDB 8 + Valkey 8 |
| `pnpm check` | biome lint/format check + `tsc -b` + vitest + license check |
| `pnpm test:e2e` | Playwright (Chromium) against a running dev stack |
| `pnpm load` | Node WebSocket load script (`scripts/load`) |
| `node scripts/release.mjs check [vX.Y.Z]` | version in package.json, deploy/.env.example and CHANGELOG.md agree (CI, release) |

## 13. Dependency policy

Allowed licenses: MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, OFL-1.1 (fonts), Python-2.0 (tooling only), CC-BY-4.0 (data only). MPL-2.0 is allowed for dev-only build tools used unmodified (lightningcss via Tailwind/Vite) and must never appear in the production dependency set. `pnpm check` fails on anything else. Valkey (BSD) instead of Redis ≥7.4. MongoDB Community Server is SSPL (source-available, not OSI open source). It runs unmodified as the app's internal database, is never part of this repository, and the offline bundle contains the unmodified official image; the node drivers are Apache-2.0. No k6 (AGPL): load tests are a Node script.

## 14. Security and resource boundaries

- Abuse limits (rate limits, PIN counters, storage quotas, SSE slots) count the client address. One host can take any address of its IPv6 /64, but a /64 is usually a whole LAN segment, so each /64 also gets a counter at 16× the per-address limit (`IPV6_PREFIX_FACTOR`). Clients behind NAT, or behind a proxy that hides their addresses, share every per-address limit; `TRUST_PROXY` must name Caddy so the API sees the real address.
- API sessions and signed collab tokens are authoritative for comment attribution. Before an update with non-text content is applied or broadcast, collab checks that every new or changed comment carries the token's clientId, and that another author's comment only changes `resolved`; forged updates close with `reauth`. Name and colour are not compared: users choose them, and the web client shows unnamed guests with a localized name. Comments an update leaves unchanged are not re-validated. Plain text edits keep the fast path.
- A ban also bans the address the client joined from, so dropping cookies does not get back in, unless another participant (not the owner) joined the share from the same address: behind NAT that would lock out a whole class. IPv6 bans cover the address, not the /64. Changing address remains possible for an anonymous guest. Network-ban state is in protected, persistent Valkey; do not flush production Valkey.
- Storage ingress quotas cover all share creation paths (including forks and lab copies), upload requests and bytes, per client and per address (IPv6 /64 at 16×). Fixed windows begin at the first accepted reservation. Denied or failed requests do not refund admission; `asShare` charges uploaded bytes and stored document bytes. Saving does not bypass creation quotas. These are ingress limits, not a lifetime limit for saved documents.
- GridFS uses a persistent Mongo `storage_quotas` ledger initialized from existing file lengths. Every streamed chunk reserves global bytes atomically before writing; deletion releases them. The default content ceiling is 10 GiB. Failed cleanup or a crashed uploader can leave conservative reservations; to reclaim them, stop api and collab, delete the ledger document (the next upload rebuilds it from `uploads.files` lengths) and start them again (docs/OPERATIONS.md §14). This logical cap leaves filesystem/WiredTiger overhead and share history outside it; monitor host free space and provision a filesystem quota if a hard host disk boundary is required.
- Valkey keeps `noeviction`: evicting join codes, locks, rate/PIN counters or grants could break correctness or weaken limits. New quota-controlled writes, profiles and streams stop at 90% of `maxmemory`; capacity checks are cached for at most one second. At OOM, mandatory writes fail closed with `503 unavailable`; the global request counter uses a bounded (10,000-entry), conservative process-local fallback so read-only routes and health remain usable. Presence entries expire naturally and are capped. Monitor and resize before the headroom is consumed; running collaborators can still consume protected lock/update resources.
- Waiting rooms are capped and owner request notifications have per-network and per-share rate limits. Network broadcasts have their own rate and audience cap. Nearby discovery remains enabled by default and shares are editable by default: disable `nearbyDefault` globally or `access.nearby` per share before sharing private content. Nearby cards include title and the first eight lines; PIN/approval disables them.
- Caddy applies a self-hosted CSP, Permissions-Policy, COOP, nosniff, frame denial and same-origin referrer policy. Inline styles are needed by CodeMirror/Radix; the Caddy image hashes the production entry point’s inline bootstrap scripts at build time; arbitrary inline scripts and eval are not permitted. Bundled inline font subsets require `font-src data:`. Shared Zod schemas initialize with `jitless: true` before construction, avoiding eval probes under CSP. `blob:` workers and `data:`/`blob:` images permit local formatting and QR workflows. HTTPS opt-in is in `deploy/tls/README.md`; HSTS belongs only to its TLS snippet.
- Metrics through Caddy are limited to loopback and the configured compose subnet, including denial of bare `/metrics`. Application ports remain unpublished. api and collab use the Mongo user `gachipad_app` with `readWrite` only on `gachipad`; the one-shot compose service `mongo-users` creates it (or resets its password and role) as root on every start, so volumes created before it existed move over on their next `up` without an operator step. The root user is only used by `mongo-users`, backup and restore. Backups and temporary password configs are private (`0600`, `umask 077`), and no password is passed as a process argument (the container init process shows its arguments to every host user): the Mongo tools read a private config file, Valkey a generated private configuration file.
- Offline bundles include a content manifest verified before image loading; upgrade also verifies the archive sidecar before extracting. Checksums detect corruption and mismatch, not publisher authenticity: distribute them through a trusted channel.
- Edit keys stay out of URLs that reach a server (apps/web `lib/credentials.ts`). Edit links are `/<id>#key=<key>`; browsers never send the fragment. At start, before the router exists, the web client takes a key from the fragment or from a legacy `?key=` query into memory and rewrites the address with `history.replaceState` (the entry's own state kept; other search and hash entries stay byte for byte). A key pasted into an open tab changes only the fragment: a `hashchange` listener does the same through the router's history, so router state does not keep it, and the join is retried with it. The key is passed only in the body of `POST /api/shares/:id/join`; the API remembers a valid key in the client's grant (30 days), so reload, rejoin after a reconnect and browser back/forward work from the clean address. It is not written to `localStorage`, `sessionStorage` or history state, and is dropped from memory when the share is forgotten. A legacy `?key=` link still shows the key once to the server in the request for the page itself (and to any access log in front of it; the shipped Caddy config has none); only `#key=` links avoid that, so share the new form. Nothing after that first request carries it: the app shell is served with `Referrer-Policy: no-referrer` (Caddy for the SPA handler, Vite dev and preview) and `index.html` repeats it as `<meta name="referrer">` before any other request, so the scripts, styles and API calls the page starts before the scrub send no `Referer`.
- Offline copies on shared devices (`lib/device.ts`, `lib/collab/session.ts`).
  - Device choice. `offlineCopy` in `gachipad.prefs` is `undecided` (default, also for every install from before the choice existed: the old `true` was never asked), `yes` or `no`. Nothing opens or creates an IndexedDB database unless it is `yes`; while it is undecided the editor shows a non-blocking banner (two buttons, no focus change) that asks once, and Settings changes the answer. "Reset to defaults" keeps it. Lab previews never keep a copy (`keepCopy: false`).
  - Bookkeeping in `localStorage`, one key per share so tabs writing at the same time never drop each other's entries: `gachipad.device.copy:<id>` is written before the share's database is created; `gachipad.device.forgotten:<id>` is the tombstone of "Forget on this device"; `gachipad.device.erase:<id>` and `gachipad.device.erase-all` mark deletions not confirmed yet (this tab also keeps them in memory, for when storage refuses the write). A copy is written only when the choice is `yes`, the share has no tombstone, no deletion is pending and its entry could be written; unreadable storage counts as no. `gachipad.device.complete` is set only by a successful `indexedDB.databases()`: from then on every copy is listed. Without it (copies from before the list on a browser that cannot enumerate) every cleanup that promises all copies (logout, account change, turning copies off) reports a failure, and the app says that copies might remain and to clear the site's data; it does not block new copies for that. A cleanup reads the lists after `databases()` answered, so a copy listed meanwhile is included, and deletes from the union of enumeration, entries, pending deletions and open documents. At start, every copy that may not be kept is deleted again (choice not `yes`, tombstone, pending deletion); a deletion that failed is reported.
  - Sensitive shares. A share whose join asked for a PIN or an approval, or that the share view flags with `needsPin`, `requireApproval`, `hasPin`, or an approval requirement, attaches the copy only after the collab server has authenticated this connection; the editor mounts only after the join (PIN, waiting room, bans) succeeded.
  - Leaving a share tears its open documents down in every tab before the copy is deleted: the provider and the Y.Doc are destroyed, the PIN and edit key in the session and in the join gate are dropped, nothing reconnects, and the database is deleted (retrying once; a database with an open connection is not deleted). Tabs coordinate over a `BroadcastChannel` (`gachipad:device`), with a `storage` event fallback. A dropped key does not start a new join.
  - Server decisions leave the share and delete its copy and key, also when no document is open (the tab was closed when it happened): kick, ban, `not_found`/`deleted`/`expired`, `forbidden`, a rejected waiting-room request, a PIN or approval asked for again after a `reauth` close (the join then starts over at the gate), a PIN or approval asked for at the door of a share this tab may hold a copy of or kept a key for that let it in (the cleanup runs before the gate shows; a key the link just brought stays with the gate for the next attempt), and collab refusing a token the API had just issued (`unauthorized` after a successful join: a stale permission generation). A `reauth` close joins again with a fresh token. An outage is not a decision: no response at all (a network error, status 0), a 5xx, a reply that is not the API's (no known error code: a proxy page), `rate_limited`, or collab `unavailable` keep the document, its copy, its credentials and its unsent edits and authenticate again with backoff (1 s doubling to 30 s). A decision ends access at once; when the server had not confirmed every local edit, the gate says those changes could not be kept.
  - "Forget on this device" (Settings) leaves the share as above, records a tombstone, and returns to the start page with a message; no copy of that share is written again until the user turns copies on in Settings while that share is open. When the tombstone cannot be stored (storage full), copies are turned off for every share and Forget reports a failure. Turning copies off deletes every copy, including those of shares no tab has open. Forget and logout first ask every tab (over the channel, answers within 300 ms) whether an open document has edits the server has not confirmed; if one has, a dialog says they will be lost (Cancel, Leave anyway).
  - Logout (`signOut`) first tears down every open document in every tab, then ends the session (`POST /api/auth/logout`), then deletes every known copy and all remembered keys and clears the query cache; other tabs return to `/`. Logout is only offered to a verified (OIDC/LDAP) identity: an anonymous session cannot be signed in again, so ending it would orphan its shares.
  - Account change. The account is the session's `clientId` (`gachipad.device.subject`), which login and logout rotate and which a replaced anonymous session changes too; names and emails are not compared, so two accounts with the same name are different. The tab whose session query sees a new `clientId` sets the erase-all mark, stores the new `clientId`, broadcasts `identity`, leaves its own documents and deletes every copy; the session query awaits this before it returns, so no join of the new session in that tab starts earlier. Every other tab closes its documents (provider, Y.Doc, keys) and reloads; it finds the new `clientId` stored, so it does not start over again, and it waits for the erase-all mark like any start. When the deletion fails the mark stays: no copy is written until a later cleanup succeeds, the new session works from memory only, and the app says once per page load that copies might remain. Limits: there is no acknowledgement or lock between tabs. A tab that is slow to receive the message, or a tab whose `clientId` check runs at the same time, can open the share under the new session before the other has closed; it gets no copy (the mark is set first), and an old database it still holds open makes the deletion fail, which keeps the mark. Two tabs that notice the change at once both clean up and each may reload once.
  - Waits are bounded: closing a document's IndexedDB connection (y-indexeddb `destroy`, `clearData` in a resync) and a tab's `leave` are not waited for longer than 4 s, the same as a database deletion. A resync that is overtaken (leave, unmount, another resync while it waits) stops before it creates a provider, and a provider is destroyed only once.
  - The offline and reconnecting banners say whether unconfirmed edits are in an offline copy (`copyKept`: a copy is open and loaded) or only in this tab. The server cannot erase IndexedDB in a browser that never reconnects: on shared devices answer "Not on this device", use a separate browser profile or "Forget on this device".

## 15. Versions and updates

- Version: the root `package.json` `version` is the product version. Images get it as build arg `GACHIPAD_VERSION` (the Dockerfiles refuse a different value) and as `org.opencontainers.image.version`; the API reads `/app/VERSION`, the web build compiles it in. Workspace packages stay private and unversioned.
- Releases: a `vX.Y.Z` tag runs `.github/workflows/release.yml`: images `ghcr.io/kim0040/gachipad-{api,collab,web,mdns}` for linux/amd64 and linux/arm64 with GitHub build provenance, offline bundles per platform, `gachipad-deploy-X.Y.Z.tar.gz` (compose, scripts, `IMAGES` digests; no images) and `SHA256SUMS`, published as a GitHub release whose notes are the CHANGELOG section (RELEASING.md). A version with a suffix (`-rc.1`) is a pre-release.
- Update check (apps/api `updates.ts`): a background job. First run 3-5 min after start, then every 12 h ±30 min; a Valkey lock (`lock:update-check`) and the stored `checkedAt` make it one request per deployment, however many API instances run. Request: `GET https://api.github.com/repos/<UPDATE_REPO>/releases/latest` (`/releases?per_page=20` on the prerelease channel), headers `Accept`, `User-Agent: gachipad/<version>`, `X-GitHub-Api-Version` and `If-None-Match`; no credentials, cookies, identifiers or usage data. 5 s timeout, 1 MB body cap. 304 keeps the cached release; 403/429 store a retry time from `retry-after`/`x-ratelimit-reset` (unauthenticated limit: 60/h per IP); failures keep the last known release with status `unreachable`. Drafts are ignored, pre-releases unless `UPDATE_CHANNEL=prerelease`; versions are compared by SemVer 2.0.0 precedence. The result is cached in Valkey `update:state` (30 days); notes are stored as plain text without control or bidi characters, at most 4000 characters, and rendered as text. Release URLs must be https. `HTTPS_PROXY` works through Node's `NODE_USE_ENV_PROXY=1`, which compose sets when a proxy is configured.
- Applying updates (`deploy/update.sh`, host side): no container gets the Docker socket, so the admin console only shows commands and status. The script verifies `SHA256SUMS`, backs up, installs the new compose file and scripts, pulls and checks image digests against `IMAGES`, restarts and waits for `/healthz` and `/readyz`; on failure it restores files, `.env`, previous images and the backup. Its status goes to `deploy/state/update.json`, mounted read-only into api at `/gachipad-state` (`UPDATE_STATUS_FILE`). Optional daily automatic updates run from a systemd timer or cron, never across a major version.
- Clients and servers of different versions: the collab protocol is Yjs/Hocuspocus and stays compatible across minor versions; a reconnect after a restart resyncs from the server state. A release that breaks this must be a major version.
