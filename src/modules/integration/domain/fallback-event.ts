// Ventana de fallback: el tiempo en que el circuito de un proveedor estuvo abierto (de onOpen a onClose).
//
// Reglas (TypeScript puro, sin base ni circuit breaker):
//   - el historial y el dashboard nombran al proveedor, no al producto del circuito (ses → aws_ses);
//   - una ventana sin fin sigue activa;
//   - la duración se informa en segundos enteros, y solo cuando la ventana ya se cerró.

const MS_PER_SECOND = 1000;

// Producto del circuito → nombre del proveedor en el historial y el dashboard.
const PROVIDER_BY_PRODUCT: Readonly<Record<string, string>> = Object.freeze({
  ses: 'aws_ses',
  s3: 'aws_s3',
  sns: 'aws_sns',
  aws_sms: 'aws_sms'
});

/** Nombre del proveedor de un producto del circuito; un producto desconocido se nombra a sí mismo. */
export function providerNameFor(product: string): string {
  return PROVIDER_BY_PRODUCT[product] ?? product;
}

/** Segundos enteros entre dos instantes. */
export function durationSeconds(startedAt: Date, endedAt: Date): number {
  return Math.round((endedAt.getTime() - startedAt.getTime()) / MS_PER_SECOND);
}

export interface FallbackEventProps {
  fallbackEventId: string;
  provider: string;
  circuitProduct: string;
  startedAt: Date;
  /** null mientras la ventana siga abierta. */
  endedAt: Date | null;
  /** Procesos que fallaron durante la ventana; null si no se sabe para ese producto. */
  affectedProcessesCount: number | null;
}

export class FallbackEvent {
  private constructor(private readonly props: FallbackEventProps) {}

  static restore(props: FallbackEventProps): FallbackEvent {
    return new FallbackEvent({ ...props });
  }

  get fallbackEventId() {
    return this.props.fallbackEventId;
  }
  get provider() {
    return this.props.provider;
  }
  get circuitProduct() {
    return this.props.circuitProduct;
  }
  get startedAt() {
    return this.props.startedAt;
  }
  get endedAt() {
    return this.props.endedAt;
  }
  get affectedProcessesCount() {
    return this.props.affectedProcessesCount;
  }

  get isActive(): boolean {
    return this.props.endedAt === null;
  }

  /** Duración de la ventana cerrada; null mientras siga abierta. */
  get durationSeconds(): number | null {
    const { startedAt, endedAt } = this.props;
    return endedAt ? durationSeconds(startedAt, endedAt) : null;
  }
}
