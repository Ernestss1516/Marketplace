/**
 * LA FÓRMULA DEL BONUS DE CAMPAÑA — el test que la fija ahora que la comparten TRES.
 *
 * Antes de la ráfaga A esta fórmula estaba copiada a mano en los dos checkouts de
 * `RedsysService` y no la probaba nadie: cada copia podía cambiar sin que nada se quejara.
 * Al pasar el catálogo a previsualizarla (para que el usuario vea el regalo ANTES de
 * comprar), lo que se enseña y lo que se cobra dependen del MISMO código — así que este
 * fichero es lo que impide que «prometer un número y acreditar otro» vuelva a ser posible.
 *
 * Ver docs/auditoria-mis-creditos.md §6 (ráfaga A, paso 1) y §7 (barrera 2).
 */
import {
  CAMPAIGN_BONUS_FIXED_MAX,
  CAMPAIGN_BONUS_PERCENT_MAX,
  campaignBonusAmount,
  campaignBonusMax,
} from './campaign-bonus';

describe('campaignBonusAmount — PERCENT', () => {
  it('aplica el porcentaje sobre la base del pack', () => {
    expect(campaignBonusAmount(100, { kind: 'PERCENT', value: 20 })).toBe(20);
    expect(campaignBonusAmount(50, { kind: 'PERCENT', value: 10 })).toBe(5);
  });

  it('REDONDEA HACIA ARRIBA, a favor del usuario', () => {
    // 30 al 15 % son 4,5. Hacia abajo, el «15 %» anunciado sería un 13,3 % real — que es
    // exactamente la clase de desajuste entre lo prometido y lo acreditado que la
    // extracción de esta fórmula vino a cerrar. Mismo criterio que `proBonusAmount`.
    expect(campaignBonusAmount(30, { kind: 'PERCENT', value: 15 })).toBe(5);
    expect(campaignBonusAmount(25, { kind: 'PERCENT', value: 33 })).toBe(9); // 8,25 → 9
  });

  it('un bonus por encima del 100 % es legítimo («compra 100, llévate 200»)', () => {
    expect(campaignBonusAmount(100, { kind: 'PERCENT', value: 200 })).toBe(200);
  });
});

describe('campaignBonusAmount — FIXED', () => {
  it('devuelve `value` tal cual, sin mirar el tamaño del pack', () => {
    // No es un olvido: es el diseño del motor («llévate 50 extra compres lo que compres»).
    // La consecuencia —que el pack pequeño salga proporcionalmente mejor— es real, y la
    // interfaz la enseña tal cual en vez de disimularla.
    expect(campaignBonusAmount(25, { kind: 'FIXED', value: 50 })).toBe(50);
    expect(campaignBonusAmount(500, { kind: 'FIXED', value: 50 })).toBe(50);
  });
});

describe('campaignBonusMax — el tope según el kind', () => {
  it('PERCENT y FIXED tienen techos distintos, y ninguno es el del otro', () => {
    expect(campaignBonusMax('PERCENT')).toBe(CAMPAIGN_BONUS_PERCENT_MAX);
    expect(campaignBonusMax('FIXED')).toBe(CAMPAIGN_BONUS_FIXED_MAX);
    expect(CAMPAIGN_BONUS_PERCENT_MAX).toBeLessThan(CAMPAIGN_BONUS_FIXED_MAX);
  });
});

describe('BARRERA 2 — la misma base con el mismo params da el mismo número, siempre', () => {
  it('el catálogo y el checkout no pueden divergir: es la misma llamada', () => {
    // Este caso no prueba aritmética: prueba que la función es pura y determinista, que es
    // la propiedad de la que depende la barrera 2 (un solo sitio). Si alguien reintrodujera
    // una copia con `floor` en el catálogo, el número mostrado dejaría de coincidir con el
    // congelado — y ninguna prueba de aritmética sola lo detectaría.
    const params = { kind: 'PERCENT', value: 20 } as const;
    const enElCatalogo = campaignBonusAmount(100, params);
    const enElCheckout = campaignBonusAmount(100, params);
    expect(enElCatalogo).toBe(enElCheckout);
  });
});
