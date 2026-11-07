import {
  ACCESS_LEVELS,
  MAX_FILES_PER_SHARE,
  MAX_NOTE_LENGTH,
  MAX_PATH_LENGTH,
  MAX_PIN_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_PIN_LENGTH,
  ROLES,
} from "./constants.js";
import {
  clientIdSchema,
  fileIdSchema,
  joinCodeSchema,
  labIdSchema,
  shareIdSchema,
  uploadIdSchema,
} from "./ids.js";
import { shareLabelsViewSchema } from "./labels.js";
import { participantPermissionFields, participantPermissionsSchema } from "./permissions.js";
import { settingsSchema } from "./settings.js";
import { colorSchema, displayNameSchema } from "./user.js";
import { z } from "./zod.js";

/** Request and response bodies of the HTTP API (§9). Dates travel as ISO 8601 strings. */

const isoDate = z.iso.datetime();
export const titleSchema = z.string().trim().max(MAX_TITLE_LENGTH);
export const languageSchema = z.string().min(1).max(40);
const pinSchema = z.string().min(MIN_PIN_LENGTH).max(MAX_PIN_LENGTH);

export const roleSchema = z.enum(ROLES);
export const accessLevelSchema = z.enum(ACCESS_LEVELS);

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;

export const healthResponseSchema = okResponseSchema;

// params and queries
export const shareParamsSchema = z.object({ id: shareIdSchema });
export const labParamsSchema = z.object({ id: labIdSchema });
export const codeParamsSchema = z.object({ code: joinCodeSchema });
export const pendingParamsSchema = z.object({ id: shareIdSchema, clientId: clientIdSchema });
export const historyParamsSchema = z.object({
  id: shareIdSchema,
  seq: z.coerce.number().int().nonnegative(),
});
export const uploadParamsSchema = z.object({ uploadId: uploadIdSchema });
export const downloadQuerySchema = z.object({ file: fileIdSchema.optional() });
export const uploadQuerySchema = z.object({ asShare: z.literal("1").optional() });
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: isoDate.optional(),
});

// session
export const identityViewSchema = z.object({
  provider: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
});

export const sessionResponseSchema = z.object({
  clientId: clientIdSchema,
  name: z.string().nullable(),
  color: colorSchema,
  net: z.string(),
  room: z.string().nullable(),
  /** The verified OIDC / LDAP identity bound to this session, if any. */
  identity: identityViewSchema.nullable().optional(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const patchSessionBodySchema = z.object({
  name: displayNameSchema.optional(),
  color: colorSchema.optional(),
});
export type PatchSessionBody = z.infer<typeof patchSessionBodySchema>;

// shares
export const createShareBodySchema = z.object({
  title: titleSchema.optional(),
  language: languageSchema.optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(MAX_PATH_LENGTH),
        language: languageSchema.optional(),
        content: z.string(),
      }),
    )
    .max(MAX_FILES_PER_SHARE)
    .optional(),
});
export type CreateShareBody = z.infer<typeof createShareBodySchema>;

export const createShareResponseSchema = z.object({
  id: shareIdSchema,
  code: joinCodeSchema,
  url: z.string(),
});
export type CreateShareResponse = z.infer<typeof createShareResponseSchema>;

/**
 * What the owner may see and change about access control. The PIN hash stays server-side; the
 * edit key is shown to the owner only, so the owner can hand out an edit link next to a view link.
 */
export const shareAccessViewSchema = z.object({
  ...participantPermissionFields,
  default: accessLevelSchema,
  hasPin: z.boolean(),
  requireApproval: z.boolean(),
  nearby: z.boolean(),
  editKey: z.string(),
});

export const shareMetaSchema = z.object({
  id: shareIdSchema,
  title: z.string(),
  language: z.string(),
  joinCode: joinCodeSchema,
  createdAt: isoDate,
  updatedAt: isoDate,
  lastActiveAt: isoDate,
  expiresAt: isoDate.nullable(),
  saved: z.boolean(),
  locked: z.boolean(),
  labId: labIdSchema.optional(),
  forkOf: shareIdSchema.optional(),
});
export type ShareMeta = z.infer<typeof shareMetaSchema>;

export const getShareResponseSchema = shareMetaSchema.extend({
  /** Null until the viewer has passed the PIN / approval checks. */
  role: roleSchema.nullable(),
  needsPin: z.boolean(),
  requireApproval: z.boolean(),
  /** Present for the owner only. */
  access: shareAccessViewSchema.optional(),
  /** Safe capabilities for admitted participants; never includes keys or PIN details. */
  permissions: participantPermissionsSchema.optional(),
});
export type GetShareResponse = z.infer<typeof getShareResponseSchema>;

export const joinShareBodySchema = z.object({
  pin: z.string().max(MAX_PIN_LENGTH).optional(),
  editKey: z.string().optional(),
});
export type JoinShareBody = z.infer<typeof joinShareBodySchema>;

export const joinShareResponseSchema = z.object({ token: z.string(), role: roleSchema });
export type JoinShareResponse = z.infer<typeof joinShareResponseSchema>;
/** 202 while the owner has not approved the join. */
export const joinPendingResponseSchema = z.object({ status: z.literal("pending") });
export type JoinPendingResponse = z.infer<typeof joinPendingResponseSchema>;

export const patchShareBodySchema = z.object({
  title: titleSchema.optional(),
  language: languageSchema.optional(),
  access: z
    .object({
      default: accessLevelSchema.optional(),
      /** A new PIN, or null to remove it. */
      pin: pinSchema.nullable().optional(),
      requireApproval: z.boolean().optional(),
      nearby: z.boolean().optional(),
      ...participantPermissionFields,
      /** Invalidates the current edit link. */
      rotateEditKey: z.boolean().optional(),
    })
    .optional(),
  saved: z.boolean().optional(),
  locked: z.boolean().optional(),
});
export type PatchShareBody = z.infer<typeof patchShareBodySchema>;

export const shareListItemSchema = z.object({
  id: shareIdSchema,
  title: z.string(),
  language: z.string(),
  role: roleSchema,
  saved: z.boolean(),
  updatedAt: isoDate,
  expiresAt: isoDate.nullable(),
  preview: z.string(),
  /** The viewer's own folder and tags (§5 `share_labels`); nobody else sees them. */
  folder: z.string().nullable(),
  tags: z.array(z.string()),
});
export type ShareListItem = z.infer<typeof shareListItemSchema>;
export const listSharesResponseSchema = z.array(shareListItemSchema);
export const shareLabelsResponseSchema = shareLabelsViewSchema;

export const codeResolveResponseSchema = z.union([
  z.object({ id: shareIdSchema }),
  z.object({ labId: labIdSchema }),
]);
export type CodeResolveResponse = z.infer<typeof codeResolveResponseSchema>;

export const kickBodySchema = z.object({ clientId: clientIdSchema, ban: z.boolean() });
export type KickBody = z.infer<typeof kickBodySchema>;

export const pendingEntrySchema = z.object({ clientId: clientIdSchema, name: z.string() });
export const listPendingResponseSchema = z.array(pendingEntrySchema);
export const resolvePendingBodySchema = z.object({ approve: z.boolean() });
export type ResolvePendingBody = z.infer<typeof resolvePendingBodySchema>;

export const forkShareResponseSchema = createShareResponseSchema;

export const historyEntrySchema = z.object({ seq: z.number().int().nonnegative(), at: isoDate });
export const listHistoryResponseSchema = z.array(historyEntrySchema);
export const restoreBodySchema = z.object({ seq: z.number().int().nonnegative() });
export type RestoreBody = z.infer<typeof restoreBodySchema>;

// nearby, presence, invites
export const nearbyItemSchema = z.object({
  id: shareIdSchema,
  title: z.string(),
  language: z.string(),
  participants: z.number().int().nonnegative(),
  /** First lines of the main file. */
  preview: z.string(),
});
export type NearbyItem = z.infer<typeof nearbyItemSchema>;
export const nearbyResponseSchema = z.array(nearbyItemSchema);

export const presenceUserSchema = z.object({
  clientId: clientIdSchema,
  name: z.string(),
  color: colorSchema,
  room: z.string().nullable(),
});
export type PresenceUser = z.infer<typeof presenceUserSchema>;
export const presenceResponseSchema = z.array(presenceUserSchema);

export const createInviteBodySchema = z.object({
  to: z.union([clientIdSchema, z.literal("net")]),
  shareId: shareIdSchema,
  fileId: fileIdSchema.optional(),
  uploadId: uploadIdSchema.optional(),
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
});
export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;

// uploads
export const uploadResultSchema = z.object({
  uploadId: uploadIdSchema,
  name: z.string(),
  size: z.number().int().nonnegative(),
});
export const uploadResponseSchema = z.array(uploadResultSchema);
export type UploadResult = z.infer<typeof uploadResultSchema>;
/** `POST /api/uploads?asShare=1` answers with a new multi-file share. */
export const uploadAsShareResponseSchema = createShareResponseSchema;

// labs
export const createLabBodySchema = z.object({
  title: titleSchema.optional(),
  templateShareId: shareIdSchema.optional(),
});
export type CreateLabBody = z.infer<typeof createLabBodySchema>;
export const createLabResponseSchema = z.object({
  id: labIdSchema,
  code: joinCodeSchema,
  url: z.string(),
});

export const labStudentViewSchema = z.object({
  clientId: clientIdSchema,
  name: z.string(),
  shareId: shareIdSchema,
  joinedAt: isoDate,
});
export const getLabResponseSchema = z.object({
  id: labIdSchema,
  title: z.string(),
  joinCode: joinCodeSchema,
  templateShareId: shareIdSchema.nullable(),
  locked: z.boolean(),
  role: z.enum(["teacher", "student"]),
  /** Teachers get every student; a student gets their own entry only. */
  students: z.array(labStudentViewSchema),
  createdAt: isoDate,
  expiresAt: isoDate,
});
export type GetLabResponse = z.infer<typeof getLabResponseSchema>;
export const joinLabBodySchema = z.object({ name: displayNameSchema });
export const joinLabResponseSchema = z.object({ shareId: shareIdSchema });
export const patchLabBodySchema = z.object({
  locked: z.boolean().optional(),
  templateShareId: shareIdSchema.nullable().optional(),
});
export type PatchLabBody = z.infer<typeof patchLabBodySchema>;
export const distributeLabResponseSchema = z.object({ count: z.number().int().nonnegative() });

// optional login (OIDC / LDAP), off unless enabled in the settings
export const authProvidersResponseSchema = z.object({
  oidc: z.boolean(),
  ldap: z.boolean(),
  guestAllowed: z.boolean(),
});
export type AuthProvidersResponse = z.infer<typeof authProvidersResponseSchema>;
export const ldapLoginBodySchema = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
});
export type LdapLoginBody = z.infer<typeof ldapLoginBodySchema>;

// admin
export const getSettingsResponseSchema = settingsSchema;
export const putSettingsBodySchema = settingsSchema;
export type PutSettingsBody = z.infer<typeof putSettingsBodySchema>;

/** `GET /api/settings/public`: what the intro page and help text need; no secrets. */
export const publicSettingsSchema = z.object({
  contact: z.string(),
  anonymousTtlHours: z.number().positive(),
  historyRetentionDays: z.number().int().nonnegative(),
  maxUploadMB: z.number().positive(),
  /** Bytes one share may hold; the editor checks an import against it before applying. */
  maxDocBytes: z.number().int().positive(),
  guestAllowed: z.boolean(),
});
export type PublicSettings = z.infer<typeof publicSettingsSchema>;

export const auditEntrySchema = z.object({
  at: isoDate,
  actor: clientIdSchema,
  ip: z.string(),
  action: z.string(),
  shareId: shareIdSchema.optional(),
  detail: z.unknown().optional(),
});
export const auditResponseSchema = z.array(auditEntrySchema);

export const statsResponseSchema = z.object({
  shares: z.number().int().nonnegative(),
  labs: z.number().int().nonnegative(),
  onlineUsers: z.number().int().nonnegative(),
  uploadBytes: z.number().int().nonnegative(),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;
