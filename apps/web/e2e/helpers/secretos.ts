import * as fs from 'fs';
import * as path from 'path';
import { expect, type Page } from '@playwright/test';

/**
 * E10 — EL ESCÁNER DE SECRETOS DE LAS PANTALLAS DE STAFF.
 *
 * ── POR QUÉ EXISTE ESTE FICHERO Y NO CUATRO COPIAS DEL BUCLE ────────────────────────
 *
 * El escaneo vivía dentro de `admin-instancia.spec.ts`, aplicado a una sola pantalla.
 * Pero la vía que puede filtrar —el mensaje de error del servidor pintado en el DOM— era
 * la MISMA en las 36 pantallas del backoffice, así que vigilar una y no las demás era
 * vigilar el sitio donde alguien se acordó de mirar. Aquí está el escaneo una vez, y las
 * pantallas se añaden a la lista de quien lo llama.
 *
 * ── LA LECCIÓN QUE ESTE FICHERO GUARDA: UNA AGUJA DEMASIADO CORTA MIENTE ────────────
 *
 * La versión anterior buscaba los PREFIJOS pelados (`sk_test_`, `whsec_`, `re_`) dentro
 * de `body.textContent`, que incluye el texto de los `<script>`. Y `re_` son tres
 * caracteres: en CI dio **rojo por `__webpack_require__`**, que lleva `re_` dentro
 * (`…require__`). Costó una tarde de investigación, un apunte en `pendientes.md` y una
 * ráfaga entera de sospecha de fuga — para nada.
 *
 * Lo importante no es la anécdota, es lo que habría pasado después: **una barrera de
 * seguridad que se pone roja sin motivo enseña a ignorarla**, y la siguiente vez que
 * hubiera saltado —de verdad— alguien habría dicho «bah, el falso positivo de siempre».
 * Un detector que miente es peor que no tenerlo.
 *
 * Así que ahora se busca la FORMA de un secreto, no su primera sílaba:
 *
 *  · **frontera de palabra delante** (`\b`), que es lo que descarta `__webpack_require__`
 *    y `ci_dummy_resend` —en los dos, el prefijo va pegado a un carácter de palabra— sin
 *    tener que excluir los scripts del escaneo, que sería perder cobertura;
 *  · **cuerpo largo detrás**: una clave de verdad lleva un montón de caracteres después
 *    del prefijo. Ocho es de sobra para descartar ruido y de menos para dejar escapar
 *    cualquier credencial real.
 *
 * Se sigue leyendo `textContent` y no `innerText` A PROPÓSITO: un secreto inyectado en un
 * `<script>` inline es una fuga igual de real que uno pintado en un párrafo, y con la
 * aguja bien formada ya no hay motivo para no mirar ahí.
 */

/**
 * Las formas de secreto que se buscan. Cada una es prefijo + cuerpo suficientemente largo.
 *
 * `re_` admite `_` en el cuerpo porque el placeholder del `.env.example`
 * (`re_your_api_key_here`) los lleva, y ése es justo el valor que corre en los entornos de
 * prueba: si algún día se filtrara, tiene que saltar.
 */
export const FORMAS_DE_SECRETO: readonly { nombre: string; patron: RegExp }[] = [
  { nombre: 'clave de Stripe (test)', patron: /\bsk_test_[A-Za-z0-9]{8,}/ },
  { nombre: 'clave de Stripe (live)', patron: /\bsk_live_[A-Za-z0-9]{8,}/ },
  { nombre: 'secreto de webhook', patron: /\bwhsec_[A-Za-z0-9]{8,}/ },
  { nombre: 'clave de Resend', patron: /\bre_[A-Za-z0-9_]{8,}/ },
];

/**
 * Un secreto de mentira, con la forma exacta de una clave de Resend.
 *
 * Se usa para PROVOCAR la fuga en el test de la rama de error: se le mete al servidor
 * simulado dentro del `message` y se exige que no aparezca. Sin esto, el test sólo
 * comprobaría que una pantalla que funciona no enseña secretos —que es lo fácil— en vez de
 * comprobar que la que FALLA tampoco.
 */
export const SECRETO_DE_MENTIRA = 're_ZjK8mQ2vBn4TpL9xW7cR3dS5';

/**
 * Escanea la página y, si encuentra algo con forma de secreto, **guarda el cuerpo entero**
 * antes de fallar.
 *
 * Lo de guardar no es un adorno: la versión anterior sólo afirmaba, así que cuando saltó en
 * CI lo único que quedó fue un `expect` en rojo y un volcado recortado en el log. No se
 * podía saber qué lo había traído, y de ahí salió la ráfaga entera de investigación. Con el
 * fichero en el artefacto, el siguiente que lo vea abre y lee.
 */
export async function exigirQueNoHayaSecretos(page: Page, nombreDeLaPantalla: string) {
  const texto = (await page.locator('body').textContent()) ?? '';

  const encontrados = FORMAS_DE_SECRETO.map(({ nombre, patron }) => ({
    nombre,
    coincidencia: texto.match(patron)?.[0],
  })).filter((f) => f.coincidencia);

  if (encontrados.length > 0) {
    const destino = path.join(
      process.cwd(),
      'test-results',
      `fuga-${nombreDeLaPantalla.replace(/[^a-z0-9]+/gi, '-')}.txt`,
    );
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(
      destino,
      [
        `Pantalla: ${nombreDeLaPantalla}`,
        `URL: ${page.url()}`,
        `Formas encontradas: ${encontrados.map((f) => `${f.nombre} → ${f.coincidencia}`).join(', ')}`,
        '',
        '── CUERPO COMPLETO ─────────────────────────────────────────────────────────',
        texto,
      ].join('\n'),
      'utf8',
    );

    // El mensaje del fallo lleva la forma encontrada y DÓNDE está el volcado, para que
    // quien lo lea en CI no tenga que reconstruir nada.
    expect(
      encontrados,
      `Se ha encontrado algo con forma de secreto en «${nombreDeLaPantalla}». Cuerpo completo guardado en ${destino}`,
    ).toEqual([]);
  }
}
