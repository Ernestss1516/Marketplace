/**
 * «LA CUOTA SE VA A PERDER» — LA REGLA.
 *
 * Lo que se fija aquí es **cuándo NO se avisa**, que es casi siempre. Un aviso de urgencia
 * encima de la lista de anuncios se gana el derecho a estar ahí saliendo sólo el día que
 * cambia una decisión; el resto del mes, su ausencia es la funcionalidad.
 *
 *   · B-1 — aparece cuando toca: Pro con cuota sin gastar y el ciclo a punto de renovar.
 *   · B-2 — no aparece cuando no toca: cuota agotada, o ciclo lejos. No es ruido permanente.
 *   · B-3 — el Pro MANUAL no lo ve: no tiene cuota mensual que perder (D-1).
 *   · B-5 — el dato es el del backend: `periodEnd` y los dos `remaining`, sin recalcular nada.
 */
import {
  DIAS_AVISO_CADUCIDAD,
  cuandoCaduca,
  loQueSePierde,
  resolverAvisoCaducidad,
} from './cuota-caducidad';
import type { ProStatus } from '@/lib/api/billing';

/** Mediodía, para que ningún caso dependa de estar cerca del cambio de día. */
const AHORA = new Date('2026-09-18T12:00:00');

const enDias = (n: number) => {
  const d = new Date(AHORA);
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

function proStatus(over: Partial<ProStatus> = {}): ProStatus {
  return {
    isPro: true,
    quotaSource: 'SUBSCRIPTION',
    limit: 4,
    used: 1,
    remaining: 3,
    bumpQuota: { limit: 4, used: 2, remaining: 2 },
    periodEnd: enDias(2),
    ...over,
  };
}

describe('B-1 — aparece cuando la cuota se va a perder', () => {
  it('Pro con cuota sin gastar y el ciclo a dos días: avisa', () => {
    const aviso = resolverAvisoCaducidad(proStatus(), AHORA);

    expect(aviso).not.toBeNull();
    expect(aviso!.dias).toBe(2);
    // B-5 — las dos cifras son las que sirvió el backend, no una cuenta hecha aquí.
    expect(aviso!.destacados).toBe(3);
    expect(aviso!.bumps).toBe(2);
  });

  it('el último día del ciclo también avisa — es cuando más importa', () => {
    expect(resolverAvisoCaducidad(proStatus({ periodEnd: enDias(0) }), AHORA)?.dias).toBe(0);
  });

  it('justo en el borde de la ventana avisa; un día más allá, no', () => {
    const dentro = resolverAvisoCaducidad(
      proStatus({ periodEnd: enDias(DIAS_AVISO_CADUCIDAD) }),
      AHORA,
    );
    const fuera = resolverAvisoCaducidad(
      proStatus({ periodEnd: enDias(DIAS_AVISO_CADUCIDAD + 1) }),
      AHORA,
    );

    // El borde se comprueba EN AMBOS LADOS a propósito: un `>` donde va un `>=` mueve el aviso
    // un día entero, y con sólo el caso de dentro el test no lo notaría.
    expect(dentro).not.toBeNull();
    expect(fuera).toBeNull();
  });

  it('con una sola de las dos cuotas basta', () => {
    const soloBumps = resolverAvisoCaducidad(proStatus({ remaining: 0 }), AHORA);
    const soloDestacados = resolverAvisoCaducidad(
      proStatus({ bumpQuota: { limit: 4, used: 4, remaining: 0 } }),
      AHORA,
    );

    expect(soloBumps).not.toBeNull();
    expect(soloDestacados).not.toBeNull();
  });

  it('DÍAS NATURALES, no múltiplos de 24 h', () => {
    // A las 23:00, el ciclo que acaba pasado mañana a las 00:30 está a «dos días» para quien
    // lo lee, aunque falten 25,5 horas. Contar en milisegundos diría «uno» y el aviso hablaría
    // de mañana cuando la persona ya piensa en pasado mañana.
    const casiMedianoche = new Date('2026-09-18T23:00:00');
    const aviso = resolverAvisoCaducidad(
      proStatus({ periodEnd: new Date('2026-09-20T00:30:00').toISOString() }),
      casiMedianoche,
    );

    expect(aviso!.dias).toBe(2);
  });
});

describe('B-2 — no aparece cuando no hay nada que decir', () => {
  it('cuota AGOTADA: no se avisa de perder cero', () => {
    const aviso = resolverAvisoCaducidad(
      proStatus({ remaining: 0, bumpQuota: { limit: 4, used: 4, remaining: 0 } }),
      AHORA,
    );

    // El recordatorio de al lado sigue diciendo «has usado tus destacados gratis», que es la
    // información correcta. Meterle prisa encima sería urgencia sobre nada.
    expect(aviso).toBeNull();
  });

  it('el ciclo LEJOS: la mayor parte del mes no se dice nada', () => {
    expect(resolverAvisoCaducidad(proStatus({ periodEnd: enDias(15) }), AHORA)).toBeNull();
  });

  it('un periodo ya vencido que aún no ha renovado tampoco avisa', () => {
    // La cuota que se enseña es la del ciclo viejo y va a refrescarse sola; meter prisa con una
    // fecha pasada sólo confundiría.
    expect(resolverAvisoCaducidad(proStatus({ periodEnd: enDias(-1) }), AHORA)).toBeNull();
  });

  it('una fecha ilegible no inventa un aviso', () => {
    expect(resolverAvisoCaducidad(proStatus({ periodEnd: 'no-es-una-fecha' }), AHORA)).toBeNull();
  });
});

describe('B-3 — quién NO lo ve', () => {
  it('un NO-Pro: no tiene cuota', () => {
    const aviso = resolverAvisoCaducidad(
      proStatus({ isPro: false, remaining: 0, bumpQuota: { limit: 0, used: 0, remaining: 0 } }),
      AHORA,
    );
    expect(aviso).toBeNull();
  });

  it('el Pro MANUAL, por `quotaSource: NONE` — aunque le llegaran cifras', () => {
    /**
     * LA PUERTA EXPLÍCITA. Un Pro concedido por el equipo es Pro de verdad, pero su cuota
     * mensual cuelga de un ciclo que nadie paga (D-1). Avisarle de que «pierde» cuatro
     * destacados sería contarle una pérdida que no existe — el mismo defecto que UXV.6 arregló
     * en el recordatorio de al lado, donde se le decía «has usado tus destacados gratis» sobre
     * unos que nunca tuvo.
     */
    const aviso = resolverAvisoCaducidad(
      proStatus({ quotaSource: 'NONE', periodEnd: enDias(1) }),
      AHORA,
    );
    expect(aviso).toBeNull();
  });

  it('y por la SEGUNDA puerta: sin `periodEnd` no hay caducidad que anunciar', () => {
    // `quotaSource` es opcional en este lado. Si no llegara, la ausencia de periodo para el
    // mismo usuario lo dejaría fuera igual: dos puertas independientes para el mismo caso.
    const aviso = resolverAvisoCaducidad(
      proStatus({ quotaSource: undefined, periodEnd: undefined }),
      AHORA,
    );
    expect(aviso).toBeNull();
  });
});

describe('Cómo se dice', () => {
  const aviso = (over: Partial<ProStatus>) => resolverAvisoCaducidad(proStatus(over), AHORA)!;

  it('«hoy» y «mañana» antes que una fecha: es lo que diría una persona', () => {
    expect(cuandoCaduca(aviso({ periodEnd: enDias(0) }))).toBe('hoy');
    expect(cuandoCaduca(aviso({ periodEnd: enDias(1) }))).toBe('mañana');
    expect(cuandoCaduca(aviso({ periodEnd: enDias(3) }))).toBe('el 21 de septiembre');
  });

  it('se nombra sólo lo que queda, sin ceros delante', () => {
    expect(loQueSePierde(aviso({}))).toBe('3 destacados y 2 bumps');
    expect(loQueSePierde(aviso({ remaining: 0 }))).toBe('2 bumps');
    expect(loQueSePierde(aviso({ bumpQuota: { limit: 4, used: 4, remaining: 0 } }))).toBe(
      '3 destacados',
    );
  });

  it('singular y plural, que se leen todo el rato', () => {
    expect(
      loQueSePierde(aviso({ remaining: 1, bumpQuota: { limit: 4, used: 3, remaining: 1 } })),
    ).toBe('1 destacado y 1 bump');
  });
});
