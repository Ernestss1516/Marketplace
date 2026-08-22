/**
 * PUNTO 6 · RÁFAGA C — QUÉ ENTRADAS DE LA LISTA DE PALABRAS NO FUNCIONABAN.
 *
 * ─── EL PROBLEMA QUE ESTO AVISA ──────────────────────────────────────────────────────
 *
 * Hasta la ráfaga C, el detector de palabras partía el texto en tokens alfanuméricos y
 * comparaba **cada entrada entera contra un token completo**. Consecuencia: sólo funcionaban
 * las entradas de UNA palabra alfanumérica. Un admin escribía `dinero facil` o
 * `100%-garantizado`, esta misma pantalla se lo guardaba y le prometía que filtraba, y
 * **casaba cero veces**. Fail-open: creías que filtrabas y no filtrabas.
 *
 * La ráfaga C lo arregla — esas entradas ya casan tal como se escribieron.
 *
 * ─── POR QUÉ HAY QUE AVISAR, Y NO SÓLO ARREGLAR ──────────────────────────────────────
 *
 * Porque el arreglo **endurece un detector que está en modo BLOQUEAR**, y desde la ráfaga B
 * bloquear actúa también **al editar**. O sea: una entrada que llevaba meses inerte —y que
 * probablemente nadie recuerda haber escrito— empieza hoy a mandar anuncios a revisión, y
 * puede sacar del escaparate anuncios YA PUBLICADOS en cuanto su dueño los toque.
 *
 * De ahí que la pantalla las señale una por una en vez de dejar que el admin se entere por
 * la cola de moderación. Ver `docs/diseno-listas-bloqueo.md` §5.4.
 *
 * ─── POR QUÉ ESTA REGLA VIVE AQUÍ Y NO SE IMPORTA DEL BACKEND ────────────────────────
 *
 * Porque el frontal no puede importar de `apps/api`, y es el mismo reparto que ya siguen
 * `listing-triage.ts` y `etiquetas.ts`: una regla pura, pequeña, con su test y con un puntero
 * al sitio donde vive la de verdad (`word.detector.ts`). Lo que se duplica es la
 * CLASIFICACIÓN para pintar un aviso, nunca el emparejamiento — ése sigue estando en un
 * único sitio, en el backend.
 */

/**
 * ¿Esta entrada **no casaba nunca** con el emparejamiento viejo?
 *
 * La condición es exactamente la que imponía el tokenizador: la entrada tenía que ser un
 * único token, es decir, no contener nada fuera de `[a-z0-9]` una vez normalizada (sin
 * tildes y en minúsculas). Un espacio, un guion, un punto o un porcentaje la partían y la
 * dejaban sin poder casar con nada.
 */
export function eraInerte(entrada: string): boolean {
  const normalizada = entrada
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

  // Una entrada vacía no es «inerte»: es que no hay entrada. No se avisa de nada.
  if (!normalizada) return false;

  return /[^a-z0-9]/.test(normalizada);
}

/** Las entradas de una lista que empiezan a filtrar con el arreglo. */
export function entradasQueEmpiezanAFiltrar(entradas: string[]): string[] {
  return entradas.filter((e) => e.trim() && eraInerte(e));
}

/**
 * A2 — ¿esta entrada de `flaggedPhones` es un teléfono español?
 *
 * Si no lo es, **no casará nunca**: el detector la descarta al canonizar la lista. Se guarda
 * igual —para que quien la escribió la reconozca y la corrija— y la pantalla la señala, mismo
 * criterio que `eraInerte` para las palabras.
 *
 * ES UNA COPIA DE LA REGLA, y aquí importa por qué es SEGURA serlo: esto sólo decide si se
 * pinta un aviso. **La canonización de verdad —la que decide si un número casa— vive en el
 * backend** (`detection/phone-format.ts`) y es la única que se aplica. Si las dos divergieran,
 * el peor caso es un distintivo de más o de menos, nunca una coincidencia equivocada.
 *
 * Misma forma canónica que allí: nueve dígitos empezando por 6-9, admitiendo prefijo `+34` /
 * `0034` y separadores.
 */
export function esTelefonoEs(entrada: string): boolean {
  const digitos = entrada.replace(/\D/g, '');
  const nueve =
    digitos.length === 9 ? digitos : /^(?:00)?34\d{9}$/.test(digitos) ? digitos.slice(-9) : '';
  return /^[6-9]\d{8}$/.test(nueve);
}
