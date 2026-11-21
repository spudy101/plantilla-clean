// Ack del webhook de bounces (respuesta a SNS). No expone datos del rebote.
/** Resultado del procesamiento del webhook (lo arma EmailBounceWebhookService). */
interface BounceWebhookResult {
  type?: string;
  confirmed?: boolean;
  processed?: number;
  suppressed?: number;
}

class EmailBounceWebhookAckDTO {
  type: string | undefined;
  confirmed: boolean;
  processed: number;
  suppressed: number;

  constructor(result: BounceWebhookResult) {
    this.type = result.type;
    this.confirmed = result.confirmed ?? false;
    this.processed = result.processed ?? 0;
    this.suppressed = result.suppressed ?? 0;
  }
}

export default { EmailBounceWebhookAckDTO };
