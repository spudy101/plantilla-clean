// Puerto para generar identificadores nuevos. Un caso de uso que crea algo pide un id acá en vez de llamar a
// un paquete (uuid) o a node:crypto: en los tests se le pasa un generador predecible.
// La implementación real es shared/infrastructure/ids/uuid-generator.ts.

export interface IdGenerator {
  /** Un identificador nuevo y único (UUID v4). */
  next(): string;
}
