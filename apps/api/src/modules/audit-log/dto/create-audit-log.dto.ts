import { Prisma } from '@prisma/client';

export interface CreateAuditLogDto {
  action: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
  // InputJsonValue (not JsonValue): Prisma distinguishes read types (includes null)
  // from write types (excludes null, uses DbNull/JsonNull sentinels instead).
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
}
