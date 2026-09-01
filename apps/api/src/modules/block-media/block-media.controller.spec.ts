import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * VÍDEO DE BLOQUE V1 — BARRERA B-1, pinzada donde de verdad se rompe: **en el fichero**.
 *
 * POR QUÉ UNA PINZA SOBRE EL CÓDIGO FUENTE Y NO SÓLO SOBRE EL COMPORTAMIENTO. La garantía
 * que hay que sostener es «los bytes de un vídeo no pasan por la memoria de esta API», y la
 * mutación que la mata es concreta y tentadora: añadir un `FileInterceptor` aquí «para
 * simplificar el editor». Si alguien lo hiciera, el e2e seguiría en verde —el camino
 * prefirmado no deja de funcionar porque exista otro— y la regresión entraría sin que nada
 * se pusiera rojo. Lo que hay que impedir no es que el camino bueno deje de existir, es que
 * aparezca uno malo al lado.
 *
 * Molde `admin-controllers.contract.spec.ts`: una afirmación estructural sobre el código,
 * barata y sin app que levantar, para lo que un test de comportamiento no puede ver.
 *
 * Ver `docs/diseno-video-bloque.md` §10, B-1.
 */
describe('BlockMediaController — B-1: ninguna ruta de subida por la API', () => {
  const fuente = readFileSync(join(__dirname, 'block-media.controller.ts'), 'utf8');

  it.each(['FileInterceptor', 'memoryStorage', 'diskStorage', 'UploadedFile', 'multipart'])(
    'no menciona %s',
    (prohibido) => {
      // El comentario de cabecera del controlador nombra `FileInterceptor` y `memoryStorage`
      // para explicar por qué NO están; se mira sólo el código, no los comentarios.
      const codigo = fuente
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(codigo).not.toContain(prohibido);
    },
  );

  it('el servicio tampoco recibe ficheros: no hay `Express.Multer` en el módulo', () => {
    const servicio = readFileSync(join(__dirname, 'block-media.service.ts'), 'utf8');
    expect(servicio).not.toContain('Multer');
    // Y lo único que toca del almacenamiento es firmar, mirar y (al rechazar) borrar —
    // nunca `upload`, que es el método por el que los bytes SÍ pasarían por aquí.
    expect(servicio).not.toMatch(/\br2\.upload\(/);
  });
});
