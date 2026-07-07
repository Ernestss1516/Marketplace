import { Prisma } from '@prisma/client';

/** True when err is a Prisma unique constraint violation (P2002). */
export function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
