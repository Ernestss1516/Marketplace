/**
 * BARRERA DE FIN DE CORRIDA — ninguna suite deja una clave de `Setting` cambiada.
 *
 * ── POR QUÉ ES DE CORRIDA Y NO DE SUITE ──────────────────────────────────────
 *
 * El defecto que vigila es, por construcción, INVISIBLE desde la suite que lo
 * comete: `Setting` se siembra una vez en `globalSetup`, `cleanDb` no lo toca, y la
 * batería corre `--runInBand` en un orden de ficheros que no es estable. La suite
 * que deja la clave sucia termina en verde; la que se pone roja es otra, más
 * adelante, y con un fallo que no habla de lo que ella prueba. Ninguna aserción
 * dentro de una suite puede ver eso. Ésta sí, porque mira cuando ya han corrido
 * todas.
 *
 * ── CÓMO SE COMPARA ──────────────────────────────────────────────────────────
 *
 * Contra `SETTINGS_SEMILLA_TEST`, la MISMA lista que siembra `seed-test.ts` — no una
 * copia. Una barrera que repite lo que vigila deja de vigilar en cuanto las dos
 * copias se separan.
 *
 * Se comprueban las dos cosas que forman «como estaba»: que la fila SIGA EXISTIENDO
 * y que su valor sea el sembrado. Borrar una clave cuenta como dejarla sucia, aunque
 * el valor por defecto del código coincida con el del seed: esa coincidencia es una
 * casualidad de `freeActiveListingLimit` (5 y 5) que en `videoEnabled` no se da —
 * sin fila el vídeo está APAGADO y el seed lo enciende.
 *
 * Las claves que el seed NO siembra quedan fuera a propósito: para ellas «sin fila»
 * es el estado de partida y no hay nada contra lo que comparar.
 */

import { PrismaClient } from '@prisma/client';
// De `settings-test` y NO de `seed-test`: ese último es un script con `main()` de
// nivel superior, así que importarlo sembraría — y esta barrera se repararía el
// defecto justo antes de ir a buscarlo. Pasó al escribirla; ver `settings-test.ts`.
import { SETTINGS_SEMILLA_TEST } from '../prisma/settings-test';

type Discrepancia = { key: string; esperado: string; encontrado: string };

async function main() {
  const prisma = new PrismaClient();
  try {
    const filas = await prisma.setting.findMany({
      where: { key: { in: SETTINGS_SEMILLA_TEST.map((s) => s.key) } },
    });
    const porClave = new Map(filas.map((f) => [f.key, f.value]));

    const sucias: Discrepancia[] = [];
    for (const { key, value } of SETTINGS_SEMILLA_TEST) {
      if (!porClave.has(key)) {
        sucias.push({ key, esperado: JSON.stringify(value), encontrado: 'SIN FILA (borrada)' });
        continue;
      }
      const actual = JSON.stringify(porClave.get(key));
      const esperado = JSON.stringify(value);
      if (actual !== esperado) sucias.push({ key, esperado, encontrado: actual });
    }

    if (sucias.length === 0) return;

    const detalle = sucias
      .map((d) => `   · ${d.key}\n       esperado: ${d.esperado}\n       quedó en: ${d.encontrado}`)
      .join('\n');

    throw new Error(
      [
        '',
        '═══════════════════════════════════════════════════════════════════',
        ' AISLAMIENTO DE `Setting` ROTO — alguna suite no dejó la tabla como',
        ' se la encontró.',
        '',
        detalle,
        '',
        ' Esto NO rompe la suite que lo hizo: rompe a la SIGUIENTE que dependa',
        ' de esa clave, y el rojo aparece lejos y sin relación aparente. Por eso',
        ' se comprueba aquí, al final de la corrida.',
        '',
        ' El arreglo es `test/helpers/settings.ts`: `withSetting` para un caso,',
        ' `ajustesDeSuite` para toda la suite, `preservarAjustes` cuando el',
        ' ajuste es el objeto de estudio. Los tres devuelven la FILA EXACTA,',
        ' borrado incluido. Lo que NO vale es `deleteMany` en la limpieza:',
        ' borrar no es restaurar.',
        '═══════════════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
