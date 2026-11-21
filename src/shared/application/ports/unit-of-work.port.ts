// Puerto de transacciones. Un caso de uso que necesita atomicidad pide una unidad de trabajo: todo lo que
// pasa dentro de `run` se confirma junto o se revierte junto. No sabe que existe Prisma.
//
//   await this.unitOfWork.run(async () => {
//     await this.users.save(user);
//     await this.contacts.save(contact);
//   });
//
// La implementación real es shared/infrastructure/database/unit-of-work (PrismaUnitOfWork).

export interface UnitOfWorkOptions {
  /** Nivel de aislamiento de la transacción. */
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  /** Tiempo máximo de la transacción, en ms. */
  timeout?: number;
}

export interface UnitOfWork {
  run<T>(work: () => PromiseLike<T>, options?: UnitOfWorkOptions): Promise<T>;
}
