/**
 * EL BONUS PRO DE UN PACK — una sola fórmula, y por eso vive fuera de los dos que la usan.
 *
 * POR QUÉ SE EXTRAJO. El número lo calculaba `RedsysService.computeProBonus` en el momento
 * de COBRAR, y era el único sitio que lo sabía: las listas de packs no enseñaban nada, así
 * que el usuario descubría su regalo después de pagar. Al ponerlo también en el catálogo
 * —para poder PREVISUALIZARLO— aparecía el riesgo de siempre: dos copias del cálculo que
 * pueden separarse, y separarse aquí significa **prometer un número y acreditar otro**.
 *
 * Así que la fórmula es una y las dos la llaman. Lo que el catálogo enseña es literalmente
 * lo que el checkout congela.
 *
 * EL REDONDEO ES HACIA ARRIBA, A FAVOR DEL USUARIO, y no es un detalle de implementación:
 * un pack de 25 créditos al 20 % da 5 exactos, pero uno de 30 al 15 % da 4,5 → 5. Redondear
 * hacia abajo convertiría el «20 % extra» anunciado en un 16,6 % real en algunos packs.
 *
 * Ver docs/auditoria-pro-video.md §4.2 (E-4 y E-5).
 */

/** Porcentaje por defecto cuando el ajuste no tiene fila. El mismo para las dos monedas. */
export const DEFAULT_PRO_EXTRA_PERCENT = 20;

/**
 * Cada moneda tiene su AJUSTE PROPIO, y nunca se reutiliza el de la otra: son beneficios
 * distintos y el negocio los calibra por separado (monetización ráfaga 4).
 */
export const PRO_EXTRA_CREDITS_SETTING = 'proExtraCreditsPercent';
export const PRO_EXTRA_BUMPS_SETTING = 'proExtraBumpsPercent';

/** Lo que un Pro recibe de regalo al comprar un pack de `baseAmount` con un bonus del `pct`. */
export function proBonusAmount(baseAmount: number, pct: number): number {
  return Math.ceil((baseAmount * pct) / 100);
}
