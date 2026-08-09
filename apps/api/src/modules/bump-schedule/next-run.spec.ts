import { computeFirstRunAt, computeNextRunAt } from './next-run';

/**
 * El cálculo del siguiente turno. Unidad pura: sin base de datos, sin cron y sin esperar al
 * reloj, que es justamente lo que permite probar el cambio de hora y la pasada que llega
 * tarde — dos cosas imposibles de provocar de otra forma.
 */
describe('bump automático — cuándo toca el siguiente turno', () => {
  // España: UTC+1 en invierno, UTC+2 en verano. 09:00 peninsular son las 08:00Z en enero
  // y las 07:00Z en julio.
  const enero9h = (dia: number) => new Date(Date.UTC(2026, 0, dia, 8, 0, 0));
  const julio9h = (dia: number) => new Date(Date.UTC(2026, 6, dia, 7, 0, 0));

  describe('está ANCLADO al turno previsto, no a la hora de ejecución', () => {
    it('el siguiente turno es slot + intervalo, a la misma hora', () => {
      const slot = enero9h(10);
      expect(computeNextRunAt(slot, 3, 9, slot)).toEqual(enero9h(13));
    });

    it('una pasada que llega TARDE no corre el calendario', () => {
      const slot = enero9h(10);
      // El cron se retrasó 50 minutos. El turno siguiente sigue siendo a las 9:00, no a las 9:50.
      const conRetraso = new Date(slot.getTime() + 50 * 60_000);

      expect(computeNextRunAt(slot, 3, 9, conRetraso)).toEqual(enero9h(13));
    });

    it('y dos instancias que miran el mismo turno calculan lo mismo', () => {
      const slot = enero9h(10);
      const instanciaA = computeNextRunAt(slot, 7, 9, new Date(slot.getTime() + 1_000));
      const instanciaB = computeNextRunAt(slot, 7, 9, new Date(slot.getTime() + 9_000));

      // Determinista: es lo que permite comparar y reclamar sin coordinación entre procesos.
      expect(instanciaA).toEqual(instanciaB);
      expect(instanciaA).toEqual(enero9h(17));
    });
  });

  describe('no acumula turnos atrasados', () => {
    it('tras cuatro días caído, devuelve el PRIMER turno futuro, no cuatro seguidos', () => {
      const slot = enero9h(10);
      const alVolver = enero9h(14); // el servidor estuvo caído del 10 al 14

      const siguiente = computeNextRunAt(slot, 1, 9, alVolver);

      // Encadenar cobros retroactivos sería lo contrario de lo que el usuario espera.
      expect(siguiente).toEqual(enero9h(15));
      expect(siguiente.getTime()).toBeGreaterThan(alVolver.getTime());
    });

    it('y el turno recuperado sigue cayendo en la rejilla del intervalo', () => {
      const slot = enero9h(1);
      const alVolver = enero9h(20);

      // Intervalo de 7 días desde el 1: 8, 15, 22… El primero futuro es el 22, no «hoy + 7».
      expect(computeNextRunAt(slot, 7, 9, alVolver)).toEqual(enero9h(22));
    });
  });

  describe('el cambio de hora no mueve la hora prometida', () => {
    it('de invierno a verano: sigue siendo las 9:00 peninsulares', () => {
      // 2026: el cambio a horario de verano es el domingo 29 de marzo.
      const antes = new Date(Date.UTC(2026, 2, 27, 8, 0, 0)); // 27-mar 09:00 (UTC+1)
      const siguiente = computeNextRunAt(antes, 3, 9, antes);

      // 30-mar ya es verano: 09:00 peninsulares son las 07:00Z. Sin corregir el offset,
      // el turno se habría ido a las 10:00 locales.
      expect(siguiente).toEqual(new Date(Date.UTC(2026, 2, 30, 7, 0, 0)));
      expect(horaPeninsular(siguiente)).toBe(9);
    });

    it('de verano a invierno: también', () => {
      // El cambio a horario de invierno es el domingo 25 de octubre de 2026.
      const antes = new Date(Date.UTC(2026, 9, 23, 7, 0, 0)); // 23-oct 09:00 (UTC+2)
      const siguiente = computeNextRunAt(antes, 3, 9, antes);

      expect(siguiente).toEqual(new Date(Date.UTC(2026, 9, 26, 8, 0, 0)));
      expect(horaPeninsular(siguiente)).toBe(9);
    });

    it('en verano la hora se respeta igual que en invierno', () => {
      expect(computeNextRunAt(julio9h(10), 5, 9, julio9h(10))).toEqual(julio9h(15));
    });
  });

  describe('la hora del día se respeta aunque el turno anterior no cayera en ella', () => {
    it('reencaja en hourOfDay, no arrastra los minutos del turno viejo', () => {
      const desalineado = new Date(Date.UTC(2026, 0, 10, 8, 37, 12));

      const siguiente = computeNextRunAt(desalineado, 1, 9, desalineado);

      expect(siguiente).toEqual(enero9h(11));
      expect(siguiente.getUTCMinutes()).toBe(0);
      expect(siguiente.getUTCSeconds()).toBe(0);
    });

    it('una hora distinta de las 9 también funciona', () => {
      const slot = new Date(Date.UTC(2026, 0, 10, 17, 0, 0)); // 18:00 peninsulares
      expect(computeNextRunAt(slot, 2, 18, slot)).toEqual(new Date(Date.UTC(2026, 0, 12, 17, 0, 0)));
    });
  });

  describe('el PRIMER turno de una programación recién creada', () => {
    it('es hoy si la hora aún no ha pasado', () => {
      const ahora = new Date(Date.UTC(2026, 0, 10, 6, 0, 0)); // 07:00 peninsulares
      expect(computeFirstRunAt(ahora, 9)).toEqual(enero9h(10));
    });

    it('y mañana si ya pasó', () => {
      const ahora = new Date(Date.UTC(2026, 0, 10, 12, 0, 0)); // 13:00 peninsulares
      expect(computeFirstRunAt(ahora, 9)).toEqual(enero9h(11));
    });

    it('nunca cae en el pasado', () => {
      for (const hora of [0, 6, 9, 15, 23]) {
        const ahora = new Date(Date.UTC(2026, 5, 15, 10, 30, 0));
        expect(computeFirstRunAt(ahora, hora).getTime()).toBeGreaterThan(ahora.getTime());
      }
    });
  });
});

/** La hora peninsular de un instante, para comprobar lo que el usuario vería. */
function horaPeninsular(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      hour: 'numeric',
      hour12: false,
    }).format(d),
  );
}
