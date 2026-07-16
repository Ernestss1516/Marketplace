// Espejo de las fórmulas reales de coste/bonus — vive duplicado a propósito,
// igual que lib/blocks/validation.ts para safe-url: el backend SIEMPRE es la
// fuente de verdad de lo que se cobra (CampaignsService/BillingService/
// RedsysService no leen esto), esto es solo para la vista previa en vivo del
// formulario de campañas. Si la fórmula cambia en el backend, cambiar aquí
// también — deuda de espejo, señalada aquí y en el DTO/service que replica.
//
// - Descuento (ACTION_DISCOUNT): BillingService.featuredByCredits/.bump —
//   floor(base * (100-percent) / 100), a favor del usuario.
// - Bonus (CREDIT_BONUS): RedsysService.createCreditPackCheckout —
//   PERCENT: ceil(packSize * value / 100); FIXED: value tal cual.

export function applyActionDiscount(baseCreditCost: number, percent: number): number {
  return Math.floor((baseCreditCost * (100 - percent)) / 100);
}

export function applyCreditBonus(
  packCreditAmount: number,
  kind: 'PERCENT' | 'FIXED',
  value: number,
): number {
  const bonus = kind === 'PERCENT' ? Math.ceil((packCreditAmount * value) / 100) : value;
  return packCreditAmount + bonus;
}
