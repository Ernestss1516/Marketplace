import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ILUSTRACION_IDS,
  ILUSTRACION_MAX_BYTES,
  ILUSTRACION_SETTING_KEYS,
  ILUSTRACION_SETTING_KEY_LIST,
  ILUSTRACION_SLOTS,
  buscarSlot,
} from './ilustraciones.constants';
import { LOGO_MAX_BYTES, LOGO_SETTING_KEY_LIST } from '../branding/branding.constants';
import { TODOS_LOS_MODELOS } from '../estilo/estilo.constants';

/**
 * E7 — LAS BARRERAS DEL REGISTRO DE ILUSTRACIONES.
 *
 * Lo que una captura no puede ver y una revisión a ojo tampoco: que los diez slots estén
 * completos, que el registro del backend y el espejo del frontend no se hayan separado, y
 * que las claves de `Setting` no se pisen con las de nadie.
 */

describe('El registro está completo: ningún slot puede quedarse a medias', () => {
  it('declara los diez slots de v1, sin repetidos', () => {
    expect(ILUSTRACION_SLOTS).toHaveLength(10);
    expect(new Set(ILUSTRACION_IDS).size).toBe(10);
  });

  /**
   * ⚠ LA BARRERA 1, Y ES LA QUE SOSTIENE TODO EL SUBSISTEMA (§8.2): **cada slot tiene
   * SIEMPRE valor**. Un slot sin default sería un hueco, y un hueco es el único fallo de
   * verdad que esto puede tener — una pantalla vacía con una imagen rota es peor que una
   * pantalla vacía sin imagen.
   *
   * Se comprueba el default Y su forma: una ruta que no empiece por `/ilustraciones/` no
   * la sirve nadie, y una que no acabe en `.svg` no es el fichero que hay en el repo.
   */
  it('CADA slot trae su default del modelo — nunca un hueco', () => {
    for (const slot of ILUSTRACION_SLOTS) {
      expect(slot.defecto).toMatch(/^\/ilustraciones\/[a-z-]+\.svg$/);
      expect(slot.defecto).toBe(`/ilustraciones/${slot.id}.svg`);
    }
  });

  /**
   * LA BARRERA 3: el `alt` sale del registro, no del admin. Se exige que exista y que
   * sea una frase, no un identificador reciclado — «empty-favorites» leído por un lector
   * de pantalla no es texto alternativo, es ruido.
   */
  it('CADA slot trae un texto alternativo escrito, no su identificador', () => {
    for (const slot of ILUSTRACION_SLOTS) {
      expect(slot.alt.length).toBeGreaterThan(15);
      expect(slot.alt).not.toContain(slot.id);
      expect(slot.alt).toMatch(/^[A-ZÁÉÍÓÚÑ]/);
    }
  });

  /**
   * ⚠ Y EL FICHERO EXISTE DE VERDAD. Lo anterior comprueba que la RUTA está bien escrita;
   * esto, que hay algo al otro lado. Sin este test, borrar un SVG de `public/` o
   * equivocarse en una letra pasaría los diez casos de arriba y produciría exactamente lo
   * que el §8.2 prohíbe: un hueco, con el icono roto del navegador dentro.
   *
   * Se cruza la frontera de los paquetes por lo mismo que en el espejo de más abajo: es un
   * TEST leyendo un fichero, no código de un paquete importando otro.
   */
  it('el fichero de CADA default existe en el repo y no está vacío', () => {
    const PUBLICO = join(__dirname, '..', '..', '..', '..', 'web', 'public');
    for (const slot of ILUSTRACION_SLOTS) {
      const ruta = join(PUBLICO, slot.defecto);
      expect(existsSync(ruta)).toBe(true);
      const svg = readFileSync(ruta, 'utf8');
      expect(svg).toContain('<svg');
      // Con dimensiones dentro: es lo que hace que el hueco que reserva `next/image`
      // coincida con la imagen y no haya salto (§8.4, cero CLS).
      expect(svg).toContain(`viewBox="0 0 ${slot.proporcion.ancho} ${slot.proporcion.alto}"`);
    }
  });

  it('CADA slot trae descripción para el admin y proporción para el hueco', () => {
    for (const slot of ILUSTRACION_SLOTS) {
      expect(slot.descripcion.length).toBeGreaterThan(20);
      expect(slot.proporcion.ancho).toBeGreaterThan(0);
      expect(slot.proporcion.alto).toBeGreaterThan(0);
    }
  });

  it('`buscarSlot` encuentra los diez y rechaza lo demás', () => {
    for (const id of ILUSTRACION_IDS) expect(buscarSlot(id)?.id).toBe(id);
    expect(buscarSlot('no-existe')).toBeUndefined();
    // Un slot vacío no puede colarse como «todos»: es el caso que un `find` mal escrito
    // devolvería si comparara con `includes`.
    expect(buscarSlot('')).toBeUndefined();
  });
});

/**
 * ══ LA CADENA DE RESPALDO: admin → modelo → registro ═════════════════════════════════
 *
 * El §8.2 dice «el default del MODELO activo», y así está implementado. Pero un modelo
 * declara sus ilustraciones a mano, así que puede olvidarse de una — y ahí es donde el
 * registro cierra la cadena. Estas dos afirmaciones son las que hacen que «nunca un hueco»
 * no dependa de que nadie se acuerde de nada.
 */
describe('La cadena de respaldo no se puede romper por olvido', () => {
  it('TODOS los modelos declaran los diez slots', () => {
    for (const m of TODOS_LOS_MODELOS) {
      expect({ modelo: m.id, slots: Object.keys(m.ilustraciones).sort() }).toEqual({
        modelo: m.id,
        slots: [...ILUSTRACION_IDS].sort(),
      });
    }
  });

  it('ningún modelo declara un slot que el REGISTRO no conoce', () => {
    // Al revés que lo de arriba, y no es lo mismo: un modelo con un slot de más
    // apuntaría a un hueco que ninguna pantalla pinta — trabajo perdido que nadie ve.
    for (const m of TODOS_LOS_MODELOS) {
      const sobrantes = Object.keys(m.ilustraciones).filter(
        (id) => !ILUSTRACION_IDS.includes(id),
      );
      expect({ modelo: m.id, sobrantes }).toEqual({ modelo: m.id, sobrantes: [] });
    }
  });
});

describe('Las claves de Setting no se pisan con nadie', () => {
  it('hay una clave por slot, con su espacio de nombres', () => {
    expect(ILUSTRACION_SETTING_KEY_LIST).toHaveLength(10);
    for (const id of ILUSTRACION_IDS) {
      expect(ILUSTRACION_SETTING_KEYS[id]).toBe(`ilustracion:${id}`);
    }
  });

  /**
   * NI CON LAS DE LOGO. Las dos familias las lee la MISMA consulta de la limpieza
   * (`laReferenciaAlguienMas`), así que una colisión no daría un error: haría que una
   * ilustración protegiera a un logo o al revés, en silencio.
   */
  it('ninguna choca con las de marca', () => {
    const cruce = ILUSTRACION_SETTING_KEY_LIST.filter((k) =>
      LOGO_SETTING_KEY_LIST.includes(k),
    );
    expect(cruce).toEqual([]);
  });
});

describe('El límite de peso es una decisión del dominio', () => {
  /**
   * El §8.3 lo pide explícitamente: el número lo fija el dominio, no quien sube. Se
   * afirma la RELACIÓN con el molde, no sólo el número: un logo se sirve en TODAS las
   * páginas y una ilustración en UNA, así que ésta puede pesar más — pero no tanto como
   * una foto de anuncio, que es el contenido que alguien vino a ver.
   */
  it('es mayor que el de un logo y menor que el de una foto de anuncio', () => {
    const FOTO_DE_ANUNCIO = 10 * 1024 * 1024;
    expect(ILUSTRACION_MAX_BYTES).toBeGreaterThan(LOGO_MAX_BYTES);
    expect(ILUSTRACION_MAX_BYTES).toBeLessThan(FOTO_DE_ANUNCIO);
    expect(ILUSTRACION_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

/**
 * ══ LA BARRERA 6 — EL ESPEJO ══════════════════════════════════════════════════════════
 *
 * El registro vive en el backend y el frontend tiene una copia de los identificadores,
 * porque este monorepo no tiene paquete compartido. **Una copia sin test es una copia que
 * diverge**, y el §8.2 dice exactamente qué pasa cuando lo hace: quien sube y quien pinta
 * no se conocen, así que añadir un slot en un solo lado deja al otro desincronizado EN
 * SILENCIO — sin error de compilación y sin nada que mirar hasta que alguien abre la
 * pantalla.
 *
 * Este test LEE el fichero del frontend desde la batería del backend. Es el mismo remedio
 * —y el mismo atrevimiento— que `globals-espejo.spec.ts` usa con los tokens de
 * `globals.css`, y funciona por lo mismo: cruzar la frontera de los paquetes en un TEST
 * no acopla el código, acopla las dos verdades para que no puedan separarse.
 */
describe('El espejo del frontend no se separa del registro', () => {
  const ESPEJO = join(__dirname, '..', '..', '..', '..', 'web', 'src', 'lib', 'ilustraciones.ts');

  function leerEspejo(): string[] {
    const fuente = readFileSync(ESPEJO, 'utf8');
    const bloque = /export const ILUSTRACION_IDS = \[([\s\S]*?)\] as const;/.exec(fuente);
    if (!bloque) {
      throw new Error(
        `No se encontró \`ILUSTRACION_IDS\` en ${ESPEJO}. Si el espejo se movió o se ` +
          'renombró, este test tiene que ir con él — sin él, las dos listas pueden ' +
          'separarse sin que nada avise.',
      );
    }
    return [...bloque[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  it('el fichero del frontend existe y se puede leer', () => {
    expect(() => leerEspejo()).not.toThrow();
  });

  it('los diez identificadores coinciden, y EN EL MISMO ORDEN', () => {
    // El orden importa menos que la lista, pero exigirlo es gratis y hace que el rojo
    // señale también un slot movido de familia.
    expect(leerEspejo()).toEqual([...ILUSTRACION_IDS]);
  });

  it('el espejo no declara ni el `alt` ni el default', () => {
    // Duplicar el texto alternativo sería duplicar la decisión de accesibilidad, y
    // entonces la copia divergente sería la que lee un lector de pantalla. El frontend
    // los recibe RESUELTOS del backend.
    const fuente = readFileSync(ESPEJO, 'utf8');
    for (const slot of ILUSTRACION_SLOTS) {
      expect(fuente).not.toContain(slot.alt);
      expect(fuente).not.toContain(slot.defecto);
    }
  });
});
