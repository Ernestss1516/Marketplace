import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { CONTACT_TIME_TRAP_MAX_ELAPSED_MS, CONTACT_TIME_TRAP_MIN_ELAPSED_MS } from './contact.constants';

/**
 * Time-trap anti-bot (RC.1): el formulario embebe un token emitido por
 * GET /contacto/token y lo devuelve tal cual al enviar. El token va firmado
 * con HMAC (CONTACT_FORM_SECRET, dedicado — nunca JWT_SECRET) para que un bot
 * no pueda fabricar un `issuedAt` artificialmente antiguo.
 */
@Injectable()
export class ContactTimeTrapService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('contactForm.secret');
  }

  issue(): { issuedAt: number; token: string } {
    const issuedAt = Date.now();
    return { issuedAt, token: this.buildToken(issuedAt) };
  }

  /**
   * Silencioso por diseño: cualquier fallo (formato, firma, demasiado rápido,
   * demasiado viejo) devuelve `false` sin distinguir el motivo — el llamador
   * debe responder igual en todos los casos (200 OK, sin persistir). Si el
   * motivo se filtrara en la respuesta, un bot aprendería qué comprobación
   * evadir.
   */
  verify(token: string | undefined): boolean {
    if (!token) return false;

    const separatorIndex = token.lastIndexOf('.');
    if (separatorIndex === -1) return false;

    const issuedAtRaw = token.slice(0, separatorIndex);
    const signature = token.slice(separatorIndex + 1);
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isInteger(issuedAt) || issuedAtRaw === '') return false;

    if (!this.signatureMatches(issuedAtRaw, signature)) return false;

    const elapsed = Date.now() - issuedAt;
    return elapsed >= CONTACT_TIME_TRAP_MIN_ELAPSED_MS && elapsed <= CONTACT_TIME_TRAP_MAX_ELAPSED_MS;
  }

  private buildToken(issuedAt: number): string {
    const issuedAtRaw = String(issuedAt);
    return `${issuedAtRaw}.${this.sign(issuedAtRaw)}`;
  }

  /** Comparación en tiempo constante — evita filtrar por timing cuánto coincide la firma.
   * Buffer.from(str, 'hex') nunca lanza (trunca en el primer carácter inválido), así que
   * una firma malformada simplemente produce longitudes distintas y falla la comparación. */
  private signatureMatches(issuedAtRaw: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(issuedAtRaw), 'hex');
    const actual = Buffer.from(signature, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private sign(issuedAtRaw: string): string {
    return createHmac('sha256', this.secret).update(issuedAtRaw).digest('hex');
  }
}
