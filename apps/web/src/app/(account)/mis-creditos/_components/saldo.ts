import type { CatalogResponse } from '@/lib/api/billing';

/**
 * MIS-CRÉDITOS RÁFAGA B — QUÉ SIGNIFICA UN SALDO, en acciones y no en unidades sueltas.
 *
 * EL DEFECTO QUE CIERRA (auditoría §4.2): la página que existe para responder «¿cuánto
 * saldo tengo?» no respondía «¿y eso para cuánto me da?». Decía «150 créditos» y ahí se
 * acababa. Los costes —cuánto vale un bump, cuánto un destacado— YA VIAJABAN en el mismo
 * `catalog` que la página pedía: `/mis-anuncios` los usa desde H8 Bloque D, y aquí se
 * descartaban. Un número sin unidad de medida.
 *
 * Módulo de funciones puras, mismo criterio que `anuncios/owner/promocion.ts`: sin hooks ni
 * JSX, así que se prueba solo y no arrastra a quien lo importa a ser componente de cliente.
 *
 * NO CALCULA NINGÚN PRECIO. Los costes vienen resueltos del catálogo, **ya con el descuento
 * de campaña aplicado** si lo hay (`BillingService.getCatalog` lo hace desde H8 Bloque D
 * fase 2). Aquí sólo se divide el saldo entre ellos. Es la misma regla que la ráfaga A fijó
 * para los bonus: el número lo pone el servidor, la interfaz lo lee.
 */

export interface CosteAccion {
  /** Lo que cuesta hoy, en créditos. Ya con el descuento de campaña si lo hay. */
  coste: number;
  /**
   * Cuántas veces alcanza el saldo. `null` cuando el coste es 0 y no hay división posible
   * —un ACTION_DISCOUNT del 90 % sobre un bump de 5 deja `floor(0,5)` = 0—: ahí la
   * respuesta no es «infinitos», es «ahora mismo no cuesta créditos», y eso lo dice la
   * interfaz con palabras, no con un número.
   */
  veces: number | null;
  /** Coste sin promoción, sólo si hay una campaña rebajándolo. */
  costeOriginal?: number;
  descuentoPercent?: number;
  /** Sólo para el destacado: de cuántos días es la variante contada (la más barata). */
  dias?: number;
}

export interface EquivalenciasSaldo {
  /**
   * NUNCA `null`: `bumpCreditCost` es obligatorio en la respuesta del catálogo y la página
   * tiene respaldo para él aunque la petición falle, así que siempre hay un coste que
   * enseñar. Lo que sí puede faltar es `veces` — ver `CosteAccion`.
   */
  bump: CosteAccion;
  /** La variante MÁS BARATA de destacado. `null` si el catálogo no trae ninguna. */
  destacado: CosteAccion | null;
}

/** `floor`, nunca `ceil`: prometer un bump que el saldo no paga sería mentir a la baja. */
function veces(saldo: number, coste: number): number | null {
  return coste > 0 ? Math.floor(saldo / coste) : null;
}

/**
 * En qué se traduce el saldo de créditos, con los costes que el catálogo publica.
 *
 * EL DESTACADO SE CUENTA CON LA VARIANTE MÁS BARATA (normalmente 7 días) y se dice de
 * cuántos días es. Contar con la más cara daría una cifra pesimista y contar con «un
 * destacado» a secas escondería que hay tres duraciones a precios distintos: el usuario
 * merece saber a qué se refiere el número.
 */
export function equivalenciasDeSaldo(
  balance: number,
  catalog: Pick<CatalogResponse, 'products' | 'bumpCreditCost' | 'bumpOriginalCreditCost' | 'bumpDiscountPercent'>,
): EquivalenciasSaldo {
  const bump: CosteAccion = {
    coste: catalog.bumpCreditCost,
    veces: veces(balance, catalog.bumpCreditCost),
    ...(catalog.bumpDiscountPercent != null &&
      catalog.bumpOriginalCreditCost != null && {
        costeOriginal: catalog.bumpOriginalCreditCost,
        descuentoPercent: catalog.bumpDiscountPercent,
      }),
  };

  // Los precios de destacado son los que traen `durationDays` — el mismo criterio con el
  // que la página separa los packs de los destacados.
  const destacados = catalog.products
    .flatMap((p) => p.prices)
    .filter((pr) => pr.durationDays != null && pr.creditCost != null && pr.creditCost > 0);

  const masBarato = destacados.reduce<(typeof destacados)[number] | null>(
    (mejor, pr) => (mejor == null || pr.creditCost! < mejor.creditCost! ? pr : mejor),
    null,
  );

  return {
    bump,
    destacado:
      masBarato == null
        ? null
        : {
            coste: masBarato.creditCost!,
            veces: veces(balance, masBarato.creditCost!),
            dias: masBarato.durationDays!,
            ...(masBarato.discountPercent != null &&
              masBarato.originalCreditCost != null && {
                costeOriginal: masBarato.originalCreditCost,
                descuentoPercent: masBarato.discountPercent,
              }),
          },
  };
}

/**
 * «5 créditos» · «5 créditos (antes 10, −50 %)».
 *
 * Mismo formato que `bumpCostLabel` de `anuncios/owner/promocion.ts`, que es lo que lee un
 * vendedor en la tarjeta de su anuncio: el mismo precio contado igual en las dos pantallas.
 * Que la cartera y la tarjeta dijeran cifras con formatos distintos es de donde salen las
 * dudas sobre cuál es la buena.
 */
export function costeLabel(accion: CosteAccion): string {
  const base = `${accion.coste} cr.`;
  if (accion.descuentoPercent != null && accion.costeOriginal != null) {
    return `${base} (antes ${accion.costeOriginal}, −${accion.descuentoPercent}%)`;
  }
  return base;
}
