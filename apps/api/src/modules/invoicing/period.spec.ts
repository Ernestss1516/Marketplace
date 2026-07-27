import {
  periodKeyContaining,
  periodRange,
  periodsToProcess,
  previousClosedPeriodKey,
} from './period';

describe('period — lógica de decisión del cron de facturación (RF.13 R4)', () => {
  describe('previousClosedPeriodKey (QUARTERLY)', () => {
    it('desde Q4 → el trimestre cerrado más reciente es Q3 del mismo año', () => {
      expect(previousClosedPeriodKey(new Date(2026, 9, 15), 'QUARTERLY')).toBe('2026-Q3'); // 15-oct
    });
    it('desde Q1 → Q4 del año anterior', () => {
      expect(previousClosedPeriodKey(new Date(2026, 0, 5), 'QUARTERLY')).toBe('2025-Q4'); // 5-ene
    });
    it('desde Q2 (1-abr) → Q1', () => {
      expect(previousClosedPeriodKey(new Date(2026, 3, 1), 'QUARTERLY')).toBe('2026-Q1');
    });
  });

  describe('previousClosedPeriodKey (MONTHLY)', () => {
    it('desde agosto → julio', () => {
      expect(previousClosedPeriodKey(new Date(2026, 7, 10), 'MONTHLY')).toBe('2026-07');
    });
    it('desde enero → diciembre del año anterior', () => {
      expect(previousClosedPeriodKey(new Date(2026, 0, 5), 'MONTHLY')).toBe('2025-12');
    });
  });

  describe('periodRange', () => {
    it('Q3 = [1-jul, 1-oct)', () => {
      const { start, end } = periodRange('2026-Q3');
      expect(start).toEqual(new Date(2026, 6, 1));
      expect(end).toEqual(new Date(2026, 9, 1));
    });
    it('mes 2026-07 = [1-jul, 1-ago)', () => {
      const { start, end } = periodRange('2026-07');
      expect(start).toEqual(new Date(2026, 6, 1));
      expect(end).toEqual(new Date(2026, 7, 1));
    });
    it('clave inválida lanza', () => {
      expect(() => periodRange('nope')).toThrow();
    });
  });

  describe('periodsToProcess (recuperación + idempotencia por marca)', () => {
    it('primer arranque (marca null) → solo el periodo cerrado actual, sin backfill histórico', () => {
      expect(periodsToProcess(null, '2026-Q3', 'QUARTERLY')).toEqual(['2026-Q3']);
    });
    it('DÍA DE EMISIÓN / recuperación: marca un trimestre por detrás → ese trimestre', () => {
      expect(periodsToProcess('2026-Q2', '2026-Q3', 'QUARTERLY')).toEqual(['2026-Q3']);
    });
    it('DÍA QUE NO TOCA: marca al día (== cerrado) → nada', () => {
      expect(periodsToProcess('2026-Q3', '2026-Q3', 'QUARTERLY')).toEqual([]);
    });
    it('marca por delante (no debería pasar) → nada', () => {
      expect(periodsToProcess('2026-Q4', '2026-Q3', 'QUARTERLY')).toEqual([]);
    });
    it('RECUPERACIÓN multi-periodo: caído varios cierres → todos los pendientes en orden', () => {
      expect(periodsToProcess('2025-Q4', '2026-Q3', 'QUARTERLY')).toEqual([
        '2026-Q1',
        '2026-Q2',
        '2026-Q3',
      ]);
    });
    it('cambio de periodicidad respecto a la marca → solo el periodo actual (retoma limpio)', () => {
      expect(periodsToProcess('2026-07', '2026-Q3', 'QUARTERLY')).toEqual(['2026-Q3']);
    });
    it('MONTHLY: marca un mes por detrás → ese mes', () => {
      expect(periodsToProcess('2026-06', '2026-07', 'MONTHLY')).toEqual(['2026-07']);
    });
  });

  describe('periodKeyContaining', () => {
    it('agosto quarterly → Q3; monthly → 2026-08', () => {
      expect(periodKeyContaining(new Date(2026, 7, 15), 'QUARTERLY')).toBe('2026-Q3');
      expect(periodKeyContaining(new Date(2026, 7, 15), 'MONTHLY')).toBe('2026-08');
    });
  });
});
