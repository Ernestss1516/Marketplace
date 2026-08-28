import * as fs from 'fs';
import * as path from 'path';
import {
  adminListingHref,
  adminReportHref,
  adminTicketHref,
  adminUserHref,
} from './admin-links';

/**
 * LA BARRERA DEL ENLACE PÚBLICO EN EL BACKOFFICE.
 *
 * No comprueba que las cuatro funciones devuelvan la cadena que devuelven —eso lo
 * ve cualquiera leyéndolas—, sino LO QUE DE VERDAD SE ROMPÍA: que una pantalla de
 * staff mande al moderador a la web pública.
 *
 * Ese defecto se arregló una vez, en la cola de moderación (ficha F1), y volvió a
 * aparecer en otros tres sitios porque cada superficie escribía su URL a mano y
 * nada impedía repetirlo. Un test que sólo mirase las funciones habría pasado con
 * los tres enlaces rotos intactos: el fallo nunca estuvo en cómo se construye la
 * URL, sino en CUÁL se elige.
 *
 * Por eso se barre el árbol de `app/(admin)` en busca de `href` a rutas públicas.
 * Es el mismo tipo de barrera que un `grep` en CI, con la ventaja de correr en la
 * batería y señalar el fichero.
 *
 * SI ALGÚN DÍA HACE FALTA UN ENLACE PÚBLICO DE VERDAD —«ver como lo ve un
 * visitante»— la salida NO es relajar este test: es llamar a `publicListingHref`
 * / `publicSellerHref`, que existen justo para eso y que este barrido no cuenta
 * porque no son `href="..."` literales. El uso legítimo queda explícito y el
 * descuido sigue prohibido.
 */

const ADMIN_DIR = path.join(__dirname, '..', 'app', '(admin)');

function ficherosDeAdmin(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...ficherosDeAdmin(completo));
    else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      salida.push(completo);
    }
  }
  return salida;
}

describe('los enlaces del backoffice', () => {
  it('apuntan al backoffice: las cuatro rutas de staff van a /admin/*', () => {
    expect(adminListingHref('abc')).toBe('/admin/anuncios/abc');
    expect(adminUserHref('abc')).toBe('/admin/usuarios/abc');
    expect(adminTicketHref('abc')).toBe('/admin/tickets/abc');
    expect(adminReportHref('abc')).toBe('/admin/reportes/abc');
  });

  it('LA BARRERA: ninguna pantalla de (admin) enlaza a /anuncio/ ni a /vendedor/', () => {
    // `href={`/anuncio/${...}`}` o `href="/vendedor/…"`, en cualquiera de sus formas.
    const publico = /href=\{?[`'"]\/(anuncio|vendedor)\//;

    const infractores = ficherosDeAdmin(ADMIN_DIR)
      .filter((f) => publico.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ADMIN_DIR, f));

    expect(infractores).toEqual([]);
  });
});
