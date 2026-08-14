import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  LISTING_GATE_RULES,
  type GateContext,
  type GateListing,
  type GateReason,
  type GateRuleGroup,
  type ListingGateRule,
} from './listing-gate.types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ListingGateException } from './listing-gate.exception';
import { RevalidationService } from './revalidation.service';

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
    private readonly revalidation: RevalidationService,
    private readonly prisma: PrismaService,
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
  async assertCanBecomeActive(listing: GateListing, context: GateContext): Promise<void> {
    await this.evaluar(listing, context);
  }

  /**
   * PUERTA — RÁFAGA 2. La otra pregunta: «¿se puede PROMOCIONAR este anuncio?».
   *
   * Misma puerta y mismas reglas; lo que cambia es la pregunta, y por eso tiene
   * su propio nombre. `bump` y `featured` no llevan a ACTIVE —el anuncio ya lo
   * está— así que llamarlas `assertCanBecomeActive` habría sido mentir en el
   * punto de uso. Las reglas distinguen por `context.transition`: la cuota no se
   * aplica (no se ocupa plaza nueva) y la de atributos sólo mira a los anuncios
   * ya marcados con `needsRevalidation`.
   */
  async assertCanBePromoted(listing: GateListing, context: GateContext): Promise<void> {
    await this.evaluar(listing, context);
  }

  /**
   * Igual, pero cargando el anuncio por id.
   *
   * Existe por `BillingService`: sus dos caminos leen la fila con `select` cortos
   * y muy razonados (el de `bump` documenta por qué NO trae `bumpedAt`), y
   * ampliarlos para la puerta invitaría a que el día de mañana alguien añada un
   * camino nuevo con un `select` al que le falte un campo. Aquí la puerta pide lo
   * que necesita y nadie más tiene que saberlo.
   *
   * Un anuncio inexistente NO lanza: quien llama ya tiene su propio 404 y le toca
   * antes que a la puerta.
   */
  async assertCanBePromotedById(listingId: string, context: GateContext): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        sellerId: true,
        categoryId: true,
        type: true,
        status: true,
        attributes: true,
        needsRevalidation: true,
      },
    });
    if (!listing) return;
    await this.evaluar(listing, context);
  }

  /**
   * REGLA #1 (límite total) — LA PUERTA, ANTES DE QUE EL ANUNCIO EXISTA.
   *
   * Es la tercera pregunta de la puerta, y la única que no recibe un anuncio:
   * «¿puede este vendedor tener uno más?». Sólo la contestan las reglas que
   * implementan `checkBeforeCreate`; las demás ni se consultan, así que crear un
   * borrador sigue sin pagar la cuota de activos ni la revalidación de atributos
   * — que es exactamente como estaba antes de esta regla.
   *
   * Mismos grupos y mismo corto-circuito que las otras dos entradas, para que el
   * orden de evaluación no dependa de por dónde se entre.
   */
  async assertCanCreate(sellerId: string, context: GateContext): Promise<void> {
    for (const grupo of ORDEN_DE_GRUPOS) {
      const reasons: GateReason[] = [];
      for (const rule of this.rules) {
        if (rule.group !== grupo) continue;
        if (!rule.checkBeforeCreate) continue;
        if (!rule.appliesTo(context)) continue;
        if (rule.isEnabled && !(await rule.isEnabled())) continue;
        const reason = await rule.checkBeforeCreate(sellerId, context);
        if (Array.isArray(reason)) reasons.push(...reason);
        else if (reason) reasons.push(reason);
      }
      if (reasons.length > 0) throw this.construirRechazo(reasons);
    }
  }

  private async evaluar(listing: GateListing, context: GateContext): Promise<void> {
    for (const grupo of ORDEN_DE_GRUPOS) {
      const reasons = await this.evaluarGrupo(grupo, listing, context);
      if (reasons.length > 0) throw this.construirRechazo(reasons);
    }

    // PASÓ. Si venía marcado, ya no lo está: la puerta acaba de comprobar que
    // cumple. Va DESPUÉS de las reglas y no dentro de ninguna porque no es una
    // validación — es la contrapartida del marcado, y tiene que ocurrir aunque
    // la regla de atributos esté apagada (ver `RevalidationService`, la tabla de
    // coherencia con `enabled`). Aquí, y no en cada camino, para que ningún
    // camino tenga que acordarse.
    if (listing.needsRevalidation) {
      await this.revalidation.clearIfCompliant(listing);
    }
  }

  private async evaluarGrupo(
    grupo: GateRuleGroup,
    listing: GateListing,
    context: GateContext,
  ): Promise<GateReason[]> {
    const reasons: GateReason[] = [];
    for (const rule of this.rules) {
      if (rule.group !== grupo) continue;
      // Una regla que sólo limita la ENTRADA (`checkBeforeCreate`) no tiene nada
      // que decir sobre un anuncio que ya existe.
      if (!rule.check) continue;
      if (!rule.appliesTo(context)) continue;
      // El interruptor, ANTES de `check`: una regla apagada no consulta nada.
      if (rule.isEnabled && !(await rule.isEnabled())) continue;
      const reason = await rule.check(listing, context);
      if (Array.isArray(reason)) reasons.push(...reason);
      else if (reason) reasons.push(reason);
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
  // Regla #1 — MISMO 403 que la cuota de activos, y a propósito: son la misma
  // familia («tu plan no te deja»), y el cliente ya sabe distinguirlas por
  // `code`. Darle un 422 sugeriría que el problema está en lo que se envía, y no
  // lo está: el anuncio es correcto, lo que se ha llenado es el plan.
  TOTAL_LIMIT_REACHED: HttpStatus.FORBIDDEN,
};
