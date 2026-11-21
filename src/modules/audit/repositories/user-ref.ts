// modules/schemas/records/audit/repositories/user-ref.ts
//
// Usuario que se adjunta a las filas de auditoría (quién ejecutó, quién reconoció…). audit_logs y
// audit_alerts no declaran relación con users en el schema (user_id es trazabilidad: puede quedar huérfano),
// así que los repositorios los resuelven con una sola consulta por lote.
import type { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';

export const USER_REF_SELECT = {
  userId: true,
  username: true,
  person: { select: { firstName: true, lastName: true } }
} satisfies Prisma.UserSelect;

export type UserRef = Prisma.UserGetPayload<{ select: typeof USER_REF_SELECT }>;

/** Usuarios por id (los ids nulos o repetidos se ignoran). */
export async function loadUserRefs(db: Prisma.TransactionClient, ids: Array<string | null | undefined>): Promise<Map<string, UserRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) {
    return new Map();
  }
  const users = await db.user.findMany({ where: { userId: { in: unique } }, select: USER_REF_SELECT });
  return new Map(users.map(u => [u.userId, u]));
}
