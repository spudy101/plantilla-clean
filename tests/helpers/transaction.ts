// tests/helpers/transaction.ts
//
// Doble de `prisma.$transaction(work, options)` para tests que mockean shared/database/prisma: ejecuta
// `work(tx)`, llama a `tx.commit()` si termina bien y a `tx.rollback()` si lanza (y relanza), que es lo
// que hace Prisma con la transacción interactiva. Las aserciones sobre commit/rollback del `tx` falso
// dicen si el Unit of Work confirmó o revirtió.
//
//   prisma.$transaction.mockImplementation(managedTransaction(tx));

interface FakeTransaction {
  commit?: () => unknown;
  rollback?: () => unknown;
}

type Work = (tx: unknown) => unknown;

export function managedTransaction<T extends FakeTransaction>(tx: T) {
  return async (optionsOrWork?: unknown, maybeWork?: unknown): Promise<unknown> => {
    const work = (typeof optionsOrWork === 'function' ? optionsOrWork : maybeWork) as Work | undefined;
    if (!work) {
      return tx;
    }
    try {
      const result = await work(tx);
      await tx.commit?.();
      return result;
    } catch (error) {
      await tx.rollback?.();
      throw error;
    }
  };
}

export default { managedTransaction };
