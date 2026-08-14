import { ListingStatus } from '@prisma/client';
import {
  DEFAULT_FREE_ACTIVE_LIMIT,
  DEFAULT_FREE_TOTAL_LIMIT,
  DEFAULT_PRO_ACTIVE_LIMIT,
  DEFAULT_PRO_TOTAL_LIMIT,
  ESTADOS_QUE_CUENTAN_AL_TOTAL,
} from './listing-limits';
import { LISTING_STATUS_TRANSITIONS } from '../listings/listing-status.transitions';

/**
 * PUERTA regla #1 — las dos invariantes de los límites, fijadas donde se definen.
 *
 * Son un test de tres líneas cada una y ninguna de las dos se puede comprobar
 * leyendo: la primera porque un cambio de tope se hace sin mirar el otro fichero,
 * y la segunda porque el fallo llega el día que alguien añade un estado nuevo al
 * enum, meses después, sin acordarse de esta lista.
 */

describe('Los topes por defecto', () => {
  it('el TOTAL es siempre mayor que el de ACTIVOS, en los dos planes', () => {
    // Es la misma invariante que la guarda de `AdminService.updateSetting`
    // protege en caliente. Aquí se protege en frío: si alguien sube el tope de
    // activos por encima del total por defecto, el fallo sale al compilar los
    // tests y no el día que un vendedor se queda sin poder crear.
    expect(DEFAULT_FREE_TOTAL_LIMIT).toBeGreaterThan(DEFAULT_FREE_ACTIVE_LIMIT);
    expect(DEFAULT_PRO_TOTAL_LIMIT).toBeGreaterThan(DEFAULT_PRO_ACTIVE_LIMIT);
  });

  it('el TOTAL es el doble del de activos — la política, escrita como número', () => {
    expect(DEFAULT_FREE_TOTAL_LIMIT).toBe(DEFAULT_FREE_ACTIVE_LIMIT * 2);
    expect(DEFAULT_PRO_TOTAL_LIMIT).toBe(DEFAULT_PRO_ACTIVE_LIMIT * 2);
  });
});

describe('Qué estados cuentan al total', () => {
  it('cuenta TODOS los estados menos ARCHIVED y SOLD — sin dejarse ninguno nuevo', () => {
    // LA BARRERA QUE IMPORTA. La lista es explícita (y no un «todo menos estos
    // dos») para que añadir un estado al enum obligue a decidir si cuenta. Sin
    // este test, ese estado nuevo simplemente NO contaría, en silencio, y el
    // límite total tendría un agujero del tamaño de ese estado.
    const todos = Object.values(ListingStatus);
    const esperados = todos.filter(
      (s) => s !== ListingStatus.ARCHIVED && s !== ListingStatus.SOLD,
    );

    expect([...ESTADOS_QUE_CUENTAN_AL_TOTAL].sort()).toEqual([...esperados].sort());
  });

  it('ARCHIVED y SOLD quedan fuera: son la SALIDA del tope', () => {
    // Sin esto el límite sería un muro sin puerta: al llegar al tope, la única
    // forma de crear otro anuncio sería borrar historial.
    expect(ESTADOS_QUE_CUENTAN_AL_TOTAL).not.toContain(ListingStatus.ARCHIVED);
    expect(ESTADOS_QUE_CUENTAN_AL_TOTAL).not.toContain(ListingStatus.SOLD);
  });

  it('ARCHIVED es TERMINAL en la máquina de estados — el hueco no se recupera dos veces', () => {
    // Si un ARCHIVED pudiera volver, un vendedor podría archivar para crear y
    // luego desarchivar, quedándose por encima del tope indefinidamente. Que sea
    // irreversible (ráfaga A) es lo que hace honesto excluirlo del recuento, así
    // que se comprueba contra la máquina de estados de verdad, no de palabra.
    expect(LISTING_STATUS_TRANSITIONS[ListingStatus.ARCHIVED]).toEqual([]);
  });
});
