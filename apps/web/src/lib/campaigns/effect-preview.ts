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
//   moneda): RedsysService.createCreditPackCheckout/createBumpPackCheckout —
//   PERCENT: ceil(packSize * value / 100); FIXED: value tal cual. Aditivo
//   sobre la base, nunca compuesto con el bonus Pro (cada uno se calcula
//   independientemente contra la misma base, luego se suman).

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
