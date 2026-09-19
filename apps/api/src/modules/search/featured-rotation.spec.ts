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

import {
  grupoDeLaVentana,
  cuotaDeVitrina,
  repartoDelAnillo,
  tramoDelGrupo,
  FEATURED_BLOCK_SIZE,
  FEATURED_ROTATION_WINDOW_MINUTES,
  FEATURED_ROTATION_WINDOW_SECONDS,
} from './featured-rotation';

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

/**
 * R4 — LA CIFRA QUE SE LE ENSEÑA AL VENDEDOR ANTES DE COBRARLE.
 *
 * Sale de ESTA función, la misma que define los grupos del anillo, y no de una copia: es lo que
 * garantiza que si mañana se toca la ventana o el tamaño del bloque, la promesa cambie con el
 * reparto en vez de quedarse mintiendo (que es exactamente lo que le pasó a «Destacados
 * primero» y costó una ráfaga entera arreglar).
 */
describe('cuotaDeVitrina — lo que le toca a cada uno, calculado y no copiado', () => {
  it('REPRODUCE LA TABLA DEL DISEÑO (§2), que es lo que se dice en voz alta al vender', () => {
    // Si alguna de estas cifras cambia sin querer, la frase del diálogo de compra empieza a
    // prometer otra cosa. Por eso la tabla está aquí y no sólo en el documento.
    const esperado: [number, number, number][] = [
      // [candidatos, grupos, minutos de vitrina al día]
      [4, 1, 1440], // caben todos: 24 h
      [8, 2, 720], // 12 h
      [12, 3, 480], // 8 h
      [20, 5, 288], // 4 h 48
      [50, 13, Math.round(1440 / 13)], // ~1 h 51
      [100, 25, 57.6],
      [200, 50, 28.8],
    ];

    for (const [candidatos, grupos, minutos] of esperado) {
      const cuota = cuotaDeVitrina(candidatos);
      expect(cuota.grupos).toBe(grupos);
      expect(Math.round(cuota.minutosDeVitrinaAlDia)).toBe(Math.round(minutos));
    }
  });

  it('mientras quepan todos en el bloque, «siempre» — y ni un candidato más', () => {
    for (let n = 1; n <= FEATURED_BLOCK_SIZE; n++) {
      expect(cuotaDeVitrina(n).siempre).toBe(true);
      expect(cuotaDeVitrina(n).minutosDeVitrinaAlDia).toBe(1440); // las 24 h
    }
    // El primero que sobra ya reparte: cinco candidatos son dos grupos, media jornada cada uno.
    expect(cuotaDeVitrina(FEATURED_BLOCK_SIZE + 1).siempre).toBe(false);
    expect(cuotaDeVitrina(FEATURED_BLOCK_SIZE + 1).minutosDeVitrinaAlDia).toBe(720);
  });

  it('el ciclo dura lo que dice la ventana — las dos cifras salen de la misma constante', () => {
    // LA BARRERA DE LA COPIA: si alguien duplicara la fórmula con un 15 escrito a mano, esto
    // seguiría verde… hasta que se cambiara la ventana. Se ata a la constante, no al número.
    expect(cuotaDeVitrina(12).cicloMinutos).toBe(3 * FEATURED_ROTATION_WINDOW_MINUTES);
    expect(FEATURED_ROTATION_WINDOW_SECONDS).toBe(FEATURED_ROTATION_WINDOW_MINUTES * 60);
  });

  it('con otra ventana o otro bloque, la cuota cambia con ellos', () => {
    // La razón de ser del módulo compartido, comprobada: la aritmética es función de las dos
    // constantes, no de unos números clavados.
    expect(cuotaDeVitrina(12, 4, 60).cicloMinutos).toBe(180); // ventana de 1 h → ciclo de 3 h
    expect(cuotaDeVitrina(12, 6).grupos).toBe(2); // bloque de 6 → dos grupos, no tres
    expect(cuotaDeVitrina(12, 6).minutosDeVitrinaAlDia).toBe(720);
  });

  it('cero o números absurdos no rompen la cuenta', () => {
    // `candidatos` llega de un COUNT + 1, así que nunca debería ser 0; pero una división por
    // cero en la frase que se le enseña a quien va a pagar no es un sitio donde improvisar.
    expect(cuotaDeVitrina(0).siempre).toBe(true);
    expect(cuotaDeVitrina(-3).siempre).toBe(true);
    expect(cuotaDeVitrina(1.7).grupos).toBe(1);
  });
});

/**
 * EL REPARTO JUSTO — que ningún turno toque casi vacío.
 *
 * LO QUE SE FIJA AQUÍ, y por qué merece su propia batería: la rotación promete que cada
 * destacado sale un turno por ciclo, y esa promesa se cumplía… enseñando a veces un bloque de
 * UNA tarjeta. Con cinco destacados y cuatro huecos, la paginación con avidez daba [4, 1]:
 * quince minutos de vitrina llena y quince de vitrina casi vacía, y al del grupo corto le
 * tocaba siempre la mala. Estos casos fijan las dos mitades del arreglo —los grupos se
 * equilibran, y siguen siendo una partición— con la aritmética entera y no con ejemplos
 * sueltos.
 */
describe('repartoDelAnillo — los turnos, a partes iguales', () => {
  /** Los tamaños de los `grupos` turnos, en orden. */
  const tamaños = (n: number, tamaño = FEATURED_BLOCK_SIZE): number[] => {
    const { grupos } = repartoDelAnillo(n, tamaño);
    return Array.from({ length: grupos }, (_, i) => tramoDelGrupo(n, i + 1, tamaño).limit);
  };

  it('EL CASO QUE LO MOTIVA — cinco destacados y cuatro huecos: [3, 2], no [4, 1]', () => {
    expect(tamaños(5)).toEqual([3, 2]);
  });

  it('y el caso que `ceil(N / grupos)` NO habría arreglado: trece → [4, 3, 3, 3]', () => {
    // Con N=13 y bloque 4, `grupos = 4` y `ceil(13/4) = 4`: una página de tamaño fijo vuelve
    // a dar [4, 4, 4, 1]. Es la razón de que el tramo se pida por offset/limit y no por
    // número de página — si alguien lo revirtiera a páginas, este caso lo cazaría.
    expect(tamaños(13)).toEqual([4, 3, 3, 3]);
  });

  it('con bloques más grandes, que es para lo que esto es precondición', () => {
    // Nueve destacados en un bloque de ocho: con avidez sería [8, 1], el mismo defecto
    // multiplicado. Este es el motivo de que el reparto vaya ANTES de agrandar el bloque.
    expect(tamaños(9, 8)).toEqual([5, 4]);
    expect(tamaños(17, 8)).toEqual([6, 6, 5]);
  });

  it('LA INVARIANTE — ningún grupo difiere de otro en más de UNO, para todo N', () => {
    for (let tamaño = 1; tamaño <= 8; tamaño++) {
      for (let n = 1; n <= 120; n++) {
        const t = tamaños(n, tamaño);
        expect(Math.max(...t) - Math.min(...t)).toBeLessThanOrEqual(1);
        // Y lo que dice el reparto de sí mismo coincide con lo que reparte de verdad.
        const { mayor, menor } = repartoDelAnillo(n, tamaño);
        expect(Math.max(...t)).toBe(mayor);
        expect(Math.min(...t)).toBe(menor);
      }
    }
  });

  it('LA INVARIANTE 2 — los grupos son una PARTICIÓN: ni se pierde ni se repite ninguno', () => {
    // Es la promesa que sostiene toda la rotación: quien paga sale una vez por ciclo. Se
    // comprueba recorriendo los tramos y viendo que cubren [0, N) exactamente una vez.
    for (let tamaño = 1; tamaño <= 8; tamaño++) {
      for (let n = 0; n <= 120; n++) {
        const { grupos } = repartoDelAnillo(n, tamaño);
        const cubiertos: number[] = [];
        for (let turno = 1; turno <= grupos; turno++) {
          const { offset, limit } = tramoDelGrupo(n, turno, tamaño);
          for (let i = 0; i < limit; i++) cubiertos.push(offset + i);
        }
        expect(cubiertos).toEqual(Array.from({ length: n }, (_, i) => i));
      }
    }
  });

  it('NINGÚN GRUPO PASA DEL TAMAÑO DEL BLOQUE — el bloque nunca recibe lo que no puede pintar', () => {
    for (let tamaño = 1; tamaño <= 8; tamaño++) {
      for (let n = 1; n <= 120; n++) {
        expect(repartoDelAnillo(n, tamaño).mayor).toBeLessThanOrEqual(tamaño);
      }
    }
  });

  it('EL NÚMERO DE GRUPOS NO CAMBIA — y por eso la promesa de vitrina sigue valiendo', () => {
    // `cuotaDeVitrina` calcula los minutos como 1440/grupos. Si el reparto hubiera tocado el
    // número de grupos, la cifra que se le enseña al vendedor antes de cobrarle habría
    // cambiado en silencio. No los toca: se reparte DENTRO de los mismos turnos.
    for (let n = 1; n <= 120; n++) {
      expect(repartoDelAnillo(n).grupos).toBe(cuotaDeVitrina(n).grupos);
    }
  });

  it('caben todos → un solo turno con todo dentro, que es el caso mayoritario del sitio', () => {
    for (let n = 1; n <= FEATURED_BLOCK_SIZE; n++) {
      expect(repartoDelAnillo(n).grupos).toBe(1);
      expect(tramoDelGrupo(n, 1)).toEqual({ offset: 0, limit: n });
    }
  });

  it('sin destacados no hay tramo que pedir', () => {
    expect(repartoDelAnillo(0)).toEqual({ candidatos: 0, grupos: 1, mayor: 0, menor: 0 });
    expect(tramoDelGrupo(0, 1)).toEqual({ offset: 0, limit: 0 });
  });

  it('un turno fuera de rango se acota en vez de devolver un tramo imposible', () => {
    // `grupoDeLaVentana` no puede devolverlos, pero un `offset` negativo o más allá del final
    // vaciaría el bloque en TODO el sitio, y eso no puede depender de que nadie se equivoque
    // aguas arriba.
    expect(tramoDelGrupo(5, 0)).toEqual(tramoDelGrupo(5, 1));
    expect(tramoDelGrupo(5, 99)).toEqual(tramoDelGrupo(5, 2));
    expect(tramoDelGrupo(5, -7)).toEqual(tramoDelGrupo(5, 1));
  });

  it('números absurdos no rompen la cuenta', () => {
    expect(repartoDelAnillo(-3).grupos).toBe(1);
    expect(repartoDelAnillo(7.9).candidatos).toBe(7);
    expect(repartoDelAnillo(10, 0).mayor).toBeLessThanOrEqual(10);
  });
});
