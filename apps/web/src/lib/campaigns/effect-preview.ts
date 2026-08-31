// Espejo de las fórmulas reales de coste/bonus — vive duplicado a propósito,
// igual que lib/blocks/validation.ts para safe-url: el backend SIEMPRE es la
// fuente de verdad de lo que se cobra (CampaignsService/BillingService/
// RedsysService no leen esto), esto es solo para la vista previa en vivo del
// formulario de campañas. Si la fórmula cambia en el backend, cambiar aquí
// también — deuda de espejo, señalada aquí y en el DTO/service que replica.
//
// - Descuento (ACTION_DISCOUNT): BillingService.featuredByCredits/.bump —
//   floor(base * (100-percent) / 100), a favor del usuario.
// - Bonus (CREDIT_BONUS y BUMP_BONUS — campaña #10, misma fórmula, distinta
//   moneda): campaigns/campaign-bonus.ts `campaignBonusAmount` —
//   PERCENT: ceil(packSize * value / 100); FIXED: value tal cual. Aditivo
//   sobre la base, nunca compuesto con el bonus Pro (cada uno se calcula
//   independientemente contra la misma base, luego se suman).
//
// ESTE ESPEJO SE QUEDA, PERO SU ALCANCE SE ESTRECHÓ (mis-créditos ráfaga A).
// Antes era la única forma que tenía el frontend de anticipar un bonus. Ahora
// el catálogo sirve `campaignBonusAmount` YA RESUELTO por pack, así que las
// listas de packs de `/mis-creditos` NO usan esto: pintan el número del
// servidor, que es el que el checkout congela.
//
// Aquí sigue teniendo sentido y sólo aquí: el formulario de admin previsualiza
// una campaña que TODAVÍA NO EXISTE en la base de datos, así que no hay
// catálogo al que preguntarle. Si alguna pantalla de usuario vuelve a importar
// este fichero para estimar un bonus real, será la segunda fuente que la
// extracción de `campaign-bonus.ts` vino a cerrar.

export function applyActionDiscount(baseCreditCost: number, percent: number): number {
  return Math.floor((baseCreditCost * (100 - percent)) / 100);
}

/** Genérica a propósito: sirve igual para packs de créditos que de bumps — la fórmula nunca fue específica de una moneda. */
export function applyBonus(
  packAmount: number,
  kind: 'PERCENT' | 'FIXED',
  value: number,
): number {
  const bonus = kind === 'PERCENT' ? Math.ceil((packAmount * value) / 100) : value;
  return packAmount + bonus;
}
