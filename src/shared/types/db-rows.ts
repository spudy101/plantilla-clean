// shared/types/db-rows.ts
//
// Formas mínimas de las filas/instancias de BD que leen los DTOs (solo tipos; no genera código).
// Son estructurales: cuando los modelos Sequelize queden tipados (fase 3 de la migración), sus
// instancias encajan aquí sin cambios porque tienen al menos estos campos.

/** Fechas tal como llegan de Sequelize (Date) o ya serializadas (string ISO). */
export type DbDate = Date | string;

/** Valor opcional de una columna nullable. */
export type Maybe<T> = T | null | undefined;

/** Nombre de la persona asociada a un usuario. */
export interface PersonNameRow {
  firstName?: Maybe<string>;
  lastName?: Maybe<string>;
}

/** Referencia a un usuario (para "quién hizo qué" en auditoría, aprobaciones, etc.). */
export interface UserRefRow {
  userId: string;
  username?: Maybe<string>;
  person?: Maybe<PersonNameRow>;
}

/** Timestamps de una fila (`createdAt`/`updatedAt`). */
export interface TimestampsRow {
  createdAt?: Maybe<DbDate>;
  updatedAt?: Maybe<DbDate>;
}
