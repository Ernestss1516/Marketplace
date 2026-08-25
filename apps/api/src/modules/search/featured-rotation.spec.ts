/**
 * ROTACIÓN DE DESTACADOS — R2: la aritmética del turno.
 *
 * QUÉ SE FIJA AQUÍ. `grupoDeLaVentana` es la única pieza de la rotación que no habla con
 * nadie: dado un instante y un número de grupos, dice qué grupo sale. Todo lo que promete la
 * ráfaga —«todos salen un grupo por ciclo», «con N ≤ 4 no se rota», «el ciclo dura
 * ceil(N/4) ventanas»— es una propiedad de esta función, y aquí se comprueba de forma
 * EXHAUSTIVA y sin reloj de verdad: se le pasan las horas, no se esperan.
 *
 * El e2e comprueba lo que sólo él puede comprobar: que la página que elige esta función
 * corresponde de verdad al grupo que Meilisearch devuelve, con los filtros heredados y la
 * vigencia aplicada.
 *
 * LAS MUTACIONES QUE ESTO MATA:
 *  · `W mod grupos` sin el `+1` → pediría la página 0 una de cada `grupos` ventanas;
 *  · usar el reloj de otra forma (no alineado al epoch) → el ciclo dejaría de recorrer todos
 *    los grupos exactamente una vez;
 *  · rotar con `grupos <= 1` → coste y baile donde no hay competencia.
 */

import { grupoDeLaVentana, FEATURED_ROTATION_WINDOW_SECONDS } from './search.controller';

const VENTANA = 900; // 15 min en segundos — el valor por defecto, fijado aquí a propósito
const ms = (segundos: number) => segundos * 1000;

describe('grupoDeLaVentana — el cursor es el reloj', () => {
  it('la ventana por defecto son 15 minutos', () => {
    // Si alguien cambia el valor por defecto, que sea una decisión y no un descuido: el
    // tamaño de la ventana es lo que fija cuánto dura el ciclo y cuánto espera el último.
    expect(FEATURED_ROTATION_WINDOW_SECONDS).toBe(VENTANA);
  });

  it('con 4 destacados o menos (un solo grupo) NO rota: siempre la página 1', () => {
    for (const grupos of [0, 1]) {
      for (const hora of [0, 1_000, 86_400, 1_787_000_000]) {
        expect(grupoDeLaVentana(ms(hora), grupos, VENTANA)).toBe(1);
      }
    }
  });

  it('avanza un grupo por ventana y vuelve a empezar al cerrar el ciclo', () => {
    const grupos = 3;
    const t0 = 0;
    expect(grupoDeLaVentana(ms(t0), grupos, VENTANA)).toBe(1);
    expect(grupoDeLaVentana(ms(t0 + VENTANA), grupos, VENTANA)).toBe(2);
    expect(grupoDeLaVentana(ms(t0 + VENTANA * 2), grupos, VENTANA)).toBe(3);
    expect(grupoDeLaVentana(ms(t0 + VENTANA * 3), grupos, VENTANA)).toBe(1); // ciclo cerrado
  });

  it('NO se sale del rango de páginas de Meilisearch: nunca 0, nunca > grupos', () => {
    // La mutación del `+1` muere aquí: sin él saldría un 0 una de cada `grupos` ventanas, y
    // la página 0 no existe.
    for (const grupos of [2, 3, 4, 7, 13, 25, 50]) {
      for (let v = 0; v < grupos * 3; v++) {
        const turno = grupoDeLaVentana(ms(v * VENTANA), grupos, VENTANA);
        expect(turno).toBeGreaterThanOrEqual(1);
        expect(turno).toBeLessThanOrEqual(grupos);
      }
    }
  });

  it('UN CICLO COMPLETO VISITA TODOS LOS GRUPOS, EXACTAMENTE UNA VEZ CADA UNO', () => {
    // Ésta es la promesa de la ráfaga, escrita como propiedad: con 50 destacados hay 13
    // grupos, y en 13 ventanas seguidas han salido los 13 — ninguno dos veces, ninguno
    // ausente. Es lo que convierte «rotar» en «repartir».
    for (const grupos of [2, 5, 13, 25]) {
      const visitados = new Set<number>();
      for (let v = 0; v < grupos; v++) {
        visitados.add(grupoDeLaVentana(ms(v * VENTANA), grupos, VENTANA));
      }
      expect(visitados.size).toBe(grupos);
      expect([...visitados].sort((a, b) => a - b)).toEqual(
        Array.from({ length: grupos }, (_, i) => i + 1),
      );
    }
  });

  it('DENTRO de una ventana el turno no se mueve: el bloque no baila entre recargas', () => {
    const grupos = 7;
    const inicio = 100 * VENTANA; // una ventana cualquiera, alineada
    const turno = grupoDeLaVentana(ms(inicio), grupos, VENTANA);

    // Principio, mitad y último segundo de la MISMA ventana.
    expect(grupoDeLaVentana(ms(inicio + 1), grupos, VENTANA)).toBe(turno);
    expect(grupoDeLaVentana(ms(inicio + VENTANA / 2), grupos, VENTANA)).toBe(turno);
    expect(grupoDeLaVentana(ms(inicio + VENTANA - 1), grupos, VENTANA)).toBe(turno);
    // Y el primer segundo de la siguiente YA es otro turno.
    expect(grupoDeLaVentana(ms(inicio + VENTANA), grupos, VENTANA)).not.toBe(turno);
  });

  it('está ALINEADA AL EPOCH: dos instancias calculan el mismo turno sin hablarse', () => {
    // No hay contador en memoria ni "cuándo arrancó el proceso": el turno es función pura de
    // la hora UTC. Dos backends (o el mismo tras un reinicio) coinciden por construcción.
    const grupos = 11;
    const instante = 1_787_654_321_000;
    const esperado = (Math.floor(instante / 1000 / VENTANA) % grupos) + 1;
    expect(grupoDeLaVentana(instante, grupos, VENTANA)).toBe(esperado);
  });

  it('la duración de la ventana cambia el ritmo, no el reparto', () => {
    // Con ventana de 1 h el ciclo dura 4 veces más, pero sigue visitando todos los grupos.
    const grupos = 6;
    const HORA = 3600;
    const visitados = new Set<number>();
    for (let v = 0; v < grupos; v++) visitados.add(grupoDeLaVentana(ms(v * HORA), grupos, HORA));
    expect(visitados.size).toBe(grupos);
  });
});
