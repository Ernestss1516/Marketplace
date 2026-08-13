import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Listing } from '@prisma/client';
import {
  LISTING_GATE_RULES,
  type GateContext,
  type GateReason,
  type GateRuleGroup,
  type ListingGateRule,
} from './listing-gate.types';
import { ListingGateException } from './listing-gate.exception';

/** Orden de evaluación: lo barato primero. Ver `GateRuleGroup`. */
const ORDEN_DE_GRUPOS: GateRuleGroup[] = ['entrada', 'contenido'];

/**
 * LA PUERTA DE VALIDACIÓN — el punto único que TODA transición a ACTIVE llama
 * ANTES de escribir el estado.
 *
 * ES EL HERMANO PREVIO DE `ListingActivationService`. Juntos dejan cada
 * transición legible de arriba abajo:
 *
 *     assertCanBecomeActive(...)   ← LA PUERTA: valida ANTES de escribir
 *     prisma.listing.update(...)   ← la transición
 *     listingBecameActive(...)     ← los efectos, DESPUÉS de escribir
 *
 * NO SE METIÓ DENTRO DE `ListingActivationService` a propósito: ese corre
 * DESPUÉS del update y no inyecta Prisma; convertirlo en la puerta lo volvería
 * otra cosa. Y su comentario decía «Called by every path that transitions a
 * Listing to ACTIVE» cuando era FALSO en tres caminos — el aviso de que aquí la
 * convención no basta. Por eso esta puerta trae una prueba estructural de
 * cobertura (ver `listing-gate-coverage.e2e-spec.ts`): un camino que no la llame
 * rompe el test.
 *
 * QUÉ VALIDA — nada por sí misma. Recorre una LISTA DE REGLAS inyectada
 * (`LISTING_GATE_RULES`), así que añadir una regla es añadir una entrada a esa
 * lista, sin tocar esta clase ni ninguno de los caminos que la llaman. Es lo que
 * permite que las reglas futuras (límite total, correo verificado, fotos,
 * moderación previa) sean proyectos independientes.
 *
 * TOPOLOGÍA vs VALIDEZ — esta puerta responde «¿MERECE este anuncio estar
 * activo?». La otra pregunta, «¿es legal ir de X a Y?», la responde la máquina de
 * estados (`listing-status.transitions.ts`), que es ortogonal y sigue corriendo
 * antes: un `ARCHIVED → ACTIVE` se rechaza allí sin que la puerta llegue a mirar
 * nada.
 */
@Injectable()
export class ListingGateService {
  constructor(
    @Inject(LISTING_GATE_RULES) private readonly rules: ListingGateRule[],
  ) {}

  /**
   * Lanza si el anuncio no puede pasar (o seguir) activo. No devuelve nada
   * cuando todo está bien: el idioma del repo son guardas que lanzan.
   *
   * ACUMULA DENTRO DEL GRUPO, CORTA ENTRE GRUPOS. Todas las reglas de `entrada`
   * se evalúan y sus motivos se juntan; si alguna falló, las de `contenido` ni
   * se tocan. Así el usuario ve de una vez todo lo que le falta del mismo nivel,
   * y no se paga una resolución de categoría para un anuncio que ya falló por
   * algo barato.
   */
  async assertCanBecomeActive(listing: Listing, context: GateContext): Promise<void> {
    for (const grupo of ORDEN_DE_GRUPOS) {
      const reasons = await this.evaluarGrupo(grupo, listing, context);
      if (reasons.length > 0) throw this.construirRechazo(reasons);
    }
  }

  private async evaluarGrupo(
    grupo: GateRuleGroup,
    listing: Listing,
    context: GateContext,
  ): Promise<GateReason[]> {
    const reasons: GateReason[] = [];
    for (const rule of this.rules) {
      if (rule.group !== grupo) continue;
      if (!rule.appliesTo(context)) continue;
      const reason = await rule.check(listing, context);
      if (reason) reasons.push(reason);
    }
    return reasons;
  }

  /**
   * El código HTTP sale del PRIMER motivo, y los mensajes se preservan tal cual.
   *
   * Con un solo motivo, la respuesta es indistinguible de la que daba la guarda
   * suelta que había antes: mismo status, mismo `message`, mismo `code`. Eso es
   * lo que hace que centralizar la cuota no cambie nada observable — sólo se
   * añade `reasons`, que nadie leía porque no existía.
   */
  private construirRechazo(reasons: GateReason[]): ListingGateException {
    const status = ESTADO_POR_CODIGO[reasons[0].code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
    const message =
      reasons.length === 1
        ? reasons[0].message
        : `Este anuncio no se puede activar: ${reasons.length} cosas que corregir.`;
    const code = reasons.length === 1 ? reasons[0].code : 'LISTING_NOT_VALID';
    return new ListingGateException(reasons, status, message, code);
  }
}

/**
 * Qué código HTTP corresponde a cada familia de motivo. Se PRESERVAN los que ya
 * daba el código disperso (mitigación M5 de la auditoría): el cliente ramifica
 * por `statusCode` además de por `code`, así que cambiar uno rompería el
 * frontend en silencio.
 */
const ESTADO_POR_CODIGO: Record<string, HttpStatus> = {
  ACTIVE_LIMIT_REACHED: HttpStatus.FORBIDDEN, // era ForbiddenException en checkActiveListingLimit
};
