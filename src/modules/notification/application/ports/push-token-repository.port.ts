// Puerto de persistencia de los dispositivos push de cada usuario (su endpoint en el proveedor). Lo implementa
// infrastructure/persistence/prisma-push-token.repository.ts.

export interface PushDevice {
  userId: string;
  /** El endpoint del dispositivo en el proveedor push. */
  token: string;
}

export interface PushTokenRepository {
  findActiveByUser(userId: string): Promise<PushDevice[]>;
  findActiveByUsers(userIds: readonly string[]): Promise<PushDevice[]>;
  /** Desactiva los dados de baja por el proveedor: no se les vuelve a enviar. Devuelve cuántos. */
  deactivate(tokens: readonly string[]): Promise<number>;
  /** Borra los inactivos sin cambios hace más de `days` días; devuelve cuántos. */
  deleteInactiveOlderThan(days: number): Promise<number>;
}
