/**
 * Pruebas del MECANISMO de espera compartido (test/helpers/async-state.ts).
 *
 * El helper que usan todas las esperas asíncronas de la batería merece sus
 * propias pruebas: si se rinde antes de tiempo, produce rojos que rotan; si no
 * se rinde nunca, esconde bugs reales colgando el test. Las dos mitades se
 * comprueban aquí. No necesita infraestructura (ni Postgres, ni Meili, ni
 * Redis): es lógica pura y corre en milisegundos.
 */
import { pollFor, waitUntil, scaleForCi, DEFAULT_TIMEOUT_MS } from './helpers/async-state';

describe('async-state — el mecanismo de espera compartido', () => {
  describe('espera al ESTADO DEFINITIVO, no a la mera existencia', () => {
    it('sigue sondeando mientras el valor no cumple el predicado, y devuelve el definitivo', async () => {
      // Simula un documento que primero llega "a medias" (boostScore 0) y solo
      // después alcanza su estado final (1) — el caso que producía falsos verdes
      // cuando el predicado era `() => true`.
      const estados = [{ boostScore: 0 }, { boostScore: 0 }, { boostScore: 1 }];
      let i = 0;

      const doc = await pollFor(
        async () => estados[Math.min(i++, estados.length - 1)],
        (d) => d.boostScore === 1,
        { timeoutMs: 5_000, description: 'boostScore=1' },
      );

      expect(doc.boostScore).toBe(1);
      expect(i).toBeGreaterThanOrEqual(3); // no se conformó con la primera lectura
    });

    it('un probe que LANZA es "todavía no", no un fallo: reintenta hasta que deja de lanzar', async () => {
      // Este es exactamente el fallo que tumbaba a redsys-featured: el
      // getDocument() de Meilisearch lanza "Document not found" mientras el job
      // de indexación no ha corrido. El poll anterior moría en la 1ª iteración.
      let llamadas = 0;
      const probe = async () => {
        llamadas += 1;
        if (llamadas < 4) throw new Error('Document not found');
        return { listo: true };
      };

      const v = await pollFor(probe, (x) => x.listo === true, { timeoutMs: 5_000 });

      expect(v.listo).toBe(true);
      expect(llamadas).toBe(4);
    });

    it('aguanta una latencia MUY superior al intervalo de sondeo sin rendirse', async () => {
      // Fuerza la condición lenta: el efecto tarda 1,5 s, mucho más que el
      // intervalo inicial de sondeo (50 ms). El helper debe esperarlo.
      const t0 = Date.now();
      let listo = false;
      setTimeout(() => { listo = true; }, 1_500);

      await waitUntil(async () => listo, { timeoutMs: 10_000, description: 'efecto lento' });

      expect(Date.now() - t0).toBeGreaterThanOrEqual(1_400);
    });
  });

  describe('un fallo REAL sigue siendo rojo — generoso pero FINITO', () => {
    it('si la condición no se cumple NUNCA, lanza al vencer el plazo (no se cuelga)', async () => {
      const t0 = Date.now();

      await expect(
        waitUntil(async () => false, { timeoutMs: 700, description: 'algo que no llega jamás' }),
      ).rejects.toThrow(/Timeout esperando algo que no llega jamás/);

      const transcurrido = Date.now() - t0;
      expect(transcurrido).toBeGreaterThanOrEqual(600); // esperó de verdad
      expect(transcurrido).toBeLessThan(5_000); // pero terminó: no espera para siempre
    });

    it('si el probe SIEMPRE lanza (el efecto está roto de verdad), también termina en rojo', async () => {
      // El helper no debe enmascarar un bug real reintentando indefinidamente.
      await expect(
        pollFor(
          async () => { throw new Error('Document not found'); },
          () => true,
          { timeoutMs: 700, description: 'un documento que nunca se indexa' },
        ),
      ).rejects.toThrow(/nunca devolvió un valor.*Document not found/s);
    });

    it('el mensaje de error incluye el último valor visto (diagnóstico sin reproducir)', async () => {
      await expect(
        pollFor(
          async () => ({ status: 'PENDING' }),
          (v) => v.status === 'SUCCEEDED',
          { timeoutMs: 400, description: 'la transacción en SUCCEEDED' },
        ),
      ).rejects.toThrow(/Último valor observado.*PENDING/s);
    });
  });

  describe('el plazo cubre el CI', () => {
    it('el plazo por defecto es holgado y finito', () => {
      expect(DEFAULT_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
      expect(Number.isFinite(DEFAULT_TIMEOUT_MS)).toBe(true);
    });

    it('scaleForCi amplía el plazo en CI y lo deja igual en local', () => {
      const esperado = process.env.CI === 'true' || process.env.CI === '1' ? 20_000 : 5_000;
      expect(scaleForCi(5_000)).toBe(esperado);
    });
  });
});
