/**
 * EL BONUS DE UNA CAMPAÑA — una sola fórmula, y por eso vive fuera de los tres que la usan.
 *
 * MISMO MOTIVO QUE `billing/pro-bonus.ts`, y este fichero es su hermano: el número lo
 * calculaban a mano los DOS checkouts (`createCreditPackCheckout` y `createBumpPackCheckout`,
 * un `Math.ceil` copiado en cada uno), y era el único sitio que lo sabía. El usuario
 * descubría el regalo de la campaña **después de pagar**, en el historial.
 *
 * Al ponerlo también en el catálogo —para poder PREVISUALIZARLO antes de comprar— habría
 * aparecido una TERCERA copia del cálculo. Tres sitios que pueden separarse, y separarse
 * aquí significa **prometer un número y acreditar otro**. Así que la fórmula se extrajo
 * ANTES de añadir el tercer consumidor, no después.
 *
 * Ahora la llaman los tres: los dos checkouts (que congelan lo que se va a acreditar) y
 * `BillingService.getCatalog` (que enseña lo que se va a acreditar). Lo que el catálogo
 * muestra es literalmente lo que el checkout congela.
 *
 * DÓNDE VIVE Y POR QUÉ AQUÍ. En `campaigns/` y no en `billing/` junto a `pro-bonus.ts`:
 * los topes de cordura ya vivían en `CampaignsService` (los usa `validateParams` al crear
 * una campaña) y la forma de `params` es un concepto de campañas. Ponerlo en `billing/`
 * obligaría a `campaigns.service.ts` a importar de `billing/`, una dirección NUEVA —hoy
 * sólo existe billing → campaigns. Este fichero no tiene dependencias, así que no acopla
 * nada en ninguna dirección.
 *
 * EL REDONDEO ES HACIA ARRIBA, A FAVOR DEL USUARIO — igual que `proBonusAmount`, y por el
 * mismo motivo: un «+15 %» anunciado sobre un pack de 30 daría 4,5, y redondear hacia abajo
 * lo convertiría en un 13,3 % real.
 *
 * ADITIVO, NUNCA COMPUESTO. Este bonus y el de Pro se calculan cada uno contra la MISMA
 * base y luego se suman; ninguno se calcula sobre el resultado del otro. Un Pro comprando
 * durante una campaña se lleva los dos (ver `RedsysService.createCreditPackCheckout`).
 *
 * Ver docs/auditoria-mis-creditos.md §2.4 y §6 (ráfaga A, paso 1).
 */

/**
 * Topes de cordura para `value` — sin esto, un typo de admin (p. ej. 10000 en vez de 100)
 * regala una cantidad absurda de créditos o bumps a quien compre durante la campaña.
 *
 * A diferencia de `ACTION_DISCOUNT.percent` (tope 90 %: un descuento >100 % no tiene
 * sentido, regalarías el producto y encima pagarías), un bonus SÍ puede pasar de 100 % de
 * forma legítima («compra 100 créditos, llévate 200» = 200 %), así que el tope va más alto:
 * 500 % deja margen a promociones agresivas y sigue atrapando un error de una o más órdenes
 * de magnitud.
 *
 * `PERCENT_MAX` es relativo (%); `FIXED_MAX` es absoluto (créditos o bumps, según el type)
 * — mismo valor de cordura que `UpdateCreditPackDto.creditAmount` (`@Max(1000000)`), no un
 * límite de negocio real, sólo la valla que ningún caso legítimo alcanza.
 *
 * Aplican a CREDIT_BONUS y BUMP_BONUS por igual: mismo shape, mismo tope, reutilizado y no
 * duplicado (campaña #10).
 */
export const CAMPAIGN_BONUS_PERCENT_MAX = 500;
export const CAMPAIGN_BONUS_FIXED_MAX = 1_000_000;

/**
 * La forma de `Campaign.params` para CREDIT_BONUS y BUMP_BONUS. Es Json en la base de datos
 * (validado por `CampaignParamsDto` al crear), así que el tipo vive aquí para que los tres
 * consumidores lo lean igual en vez de escribir el mismo cast tres veces.
 *
 * ALIAS DE TIPO Y NO `interface`, y no es cuestión de estilo: los consumidores hacen
 * `campaign.params as CampaignBonusParams` sobre el `JsonValue` de Prisma, y TypeScript sólo
 * admite ese cast directo si el destino tiene índice implícito — cosa que un alias de objeto
 * tiene y una `interface` no. Con `interface` haría falta pasar por `unknown` en los tres
 * sitios, que es precisamente la clase de cast ciego que conviene no repartir.
 */
export type CampaignBonusParams = {
  kind: 'PERCENT' | 'FIXED';
  value: number;
};

/** El tope que le corresponde a un `value` según su `kind`. Usado al validar una campaña. */
export function campaignBonusMax(kind: CampaignBonusParams['kind']): number {
  return kind === 'PERCENT' ? CAMPAIGN_BONUS_PERCENT_MAX : CAMPAIGN_BONUS_FIXED_MAX;
}

/**
 * Lo que la campaña regala al comprar un pack de `baseAmount`.
 *
 * `FIXED` devuelve `value` TAL CUAL, sin escalar con el tamaño del pack: es deliberado del
 * motor de campañas («llévate 50 créditos extra compres lo que compres»), no un olvido. La
 * consecuencia es que el pack pequeño sale proporcionalmente mejor parado — cierto, y la
 * interfaz debe enseñarlo tal como es en vez de disimularlo.
 *
 * Genérica a propósito: sirve igual para créditos que para bumps. La fórmula nunca fue
 * específica de una moneda.
 */
export function campaignBonusAmount(baseAmount: number, params: CampaignBonusParams): number {
  return params.kind === 'PERCENT' ? Math.ceil((baseAmount * params.value) / 100) : params.value;
}
