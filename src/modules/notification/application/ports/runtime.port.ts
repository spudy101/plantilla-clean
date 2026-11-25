// Puertos de lo que el módulo necesita del entorno: datos de contacto cifrados, el aviso en tiempo real del
// contador, la transacción en curso, la generación de códigos y la verificación del feed de rebotes. Los
// implementa infrastructure/ (cifrado, Redis Pub/Sub, contexto de Prisma, crypto, firma SNS).
import type { FeedMessage } from '../../domain/bounce-feed';

/** Datos de contacto que pueden llegar cifrados (p. ej. dentro de la metadata de una notificación). */
export interface ContactCipher {
  /** El valor en claro; si ya viene en claro, tal cual. */
  reveal(value: string): string;
  /** Hash de búsqueda (SHA-256) del valor. */
  hash(value: string): string;
}

/** Aviso a las conexiones abiertas (SSE) de que cambió el contador de no leídas. */
export type UnreadCountEvent = { userId: string; count: number } | { global: true };

export interface UnreadCountChannel {
  publish(event: UnreadCountEvent): void;
  /** Escucha los avisos; devuelve cómo dejar de escuchar. */
  subscribe(listener: (event: UnreadCountEvent | null | undefined) => void): () => void;
  /** Conexiones escuchando en esta instancia (observabilidad). */
  listenerCount(): number;
  /** 'redis' si el aviso cruza instancias; 'local' si queda en esta. */
  transport(): 'redis' | 'local';
}

/** ¿Hay una unidad de trabajo en curso? Su commit llega después: lo que se mande debe esperar al despachador. */
export interface TransactionProbe {
  inTransaction(): boolean;
}

export interface VerificationCodeGenerator {
  next(): string;
}

/** Autenticidad del feed de rebotes: la firma del mensaje SNS y la confirmación de la suscripción. */
export interface BounceFeedVerifier {
  verify(message: FeedMessage): Promise<boolean>;
  confirmSubscription(message: FeedMessage): Promise<void>;
}
