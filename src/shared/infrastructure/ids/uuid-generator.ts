// Implementación del puerto IdGenerator con UUID v4.
import { v4 as uuidv4 } from 'uuid';
import type { IdGenerator } from '../../application/ports/id-generator.port';

export const uuidGenerator: IdGenerator = { next: () => uuidv4() };
