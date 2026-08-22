import {
  keyFromPublicUrl,
  listingMediaKeys,
  ownUrlsDeep,
  releasedUrls,
  thumbKeyFor,
} from './media-keys';

/**
 * BORRADO B3 — la regla de las claves de R2, pinzada.
 *
 * Estas funciones son la ÚNICA copia de dos cosas que antes vivían sueltas: cómo
 * se llama la miniatura de una imagen (estaba dentro de `ImageProcessor`) y qué
 * ficheros pertenecen a un anuncio. Si la primera cambia y la limpieza no se
 * entera, todas las miniaturas nuevas quedan huérfanas **en silencio** — no hay
 * error, no hay log, sólo un bucket que engorda. Este fichero es lo que hace que
 * ese cambio se note.
 */
describe('thumbKeyFor', () => {
  it('sustituye la extensión por -thumb.webp', () => {
    expect(thumbKeyFor('media/abc123.jpg')).toBe('media/abc123-thumb.webp');
    expect(thumbKeyFor('media/abc123.png')).toBe('media/abc123-thumb.webp');
    expect(thumbKeyFor('media/abc123.webp')).toBe('media/abc123-thumb.webp');
  });

  it('sólo toca la ÚLTIMA extensión, no un punto del nombre', () => {
    expect(thumbKeyFor('media/foto.de.perfil.jpg')).toBe('media/foto.de.perfil-thumb.webp');
  });
});

describe('keyFromPublicUrl', () => {
  const prefijo = 'https://cdn.example.com/';

  it('resta el prefijo público', () => {
    expect(keyFromPublicUrl('https://cdn.example.com/media/a.jpg', prefijo)).toBe('media/a.jpg');
  });

  it('tolera que el prefijo venga sin la barra final', () => {
    expect(keyFromPublicUrl('https://cdn.example.com/media/a.jpg', 'https://cdn.example.com')).toBe(
      'media/a.jpg',
    );
  });

  it('devuelve null para una URL AJENA — no se inventa una clave', () => {
    // Es la guarda que impide lanzar un DELETE contra una ruta inventada a partir
    // de, por ejemplo, un avatar de Google. Molde: `VideoService.deleteObjectByUrl`.
    expect(keyFromPublicUrl('https://otro-dominio.com/media/a.jpg', prefijo)).toBeNull();
    expect(keyFromPublicUrl('https://lh3.googleusercontent.com/foto', prefijo)).toBeNull();
  });

  it('devuelve null si no queda nada después del prefijo', () => {
    expect(keyFromPublicUrl('https://cdn.example.com/', prefijo)).toBeNull();
  });
});

describe('listingMediaKeys', () => {
  const prefijo = 'https://cdn.example.com/';

  it('DOS claves por imagen: el original y su miniatura', () => {
    // El hallazgo que motiva todo B3. Quien limpiara sólo lo que hay en la base
    // de datos borraría el original y dejaría la miniatura para siempre: la
    // clave de la miniatura no está en ninguna columna.
    const keys = listingMediaKeys({ imageUrls: ['https://cdn.example.com/media/a.jpg'] }, prefijo);

    expect(keys.sort()).toEqual(['media/a-thumb.webp', 'media/a.jpg']);
  });

  it('incluye el vídeo Y su póster', () => {
    // El póster es el que se olvida: es un objeto más, con su propia columna.
    const keys = listingMediaKeys(
      {
        imageUrls: [],
        videoUrl: 'https://cdn.example.com/video/v.mp4',
        videoPosterUrl: 'https://cdn.example.com/video/v.jpg',
      },
      prefijo,
    );

    expect(keys.sort()).toEqual(['video/v.jpg', 'video/v.mp4']);
  });

  it('NO deriva miniatura del vídeo ni del póster', () => {
    // Sólo las imágenes de anuncio pasan por `ImageProcessor`. Derivar una
    // miniatura del vídeo produciría borrados contra claves que no existen.
    const keys = listingMediaKeys(
      { imageUrls: [], videoUrl: 'https://cdn.example.com/video/v.mp4' },
      prefijo,
    );

    expect(keys).toEqual(['video/v.mp4']);
  });

  it('deduplica: la misma URL dos veces no borra dos veces', () => {
    const url = 'https://cdn.example.com/media/a.jpg';
    const keys = listingMediaKeys({ imageUrls: [url, url] }, prefijo);

    expect(keys.sort()).toEqual(['media/a-thumb.webp', 'media/a.jpg']);
  });

  it('ignora las URLs ajenas sin romper el resto', () => {
    const keys = listingMediaKeys(
      {
        imageUrls: ['https://otro.com/x.jpg', 'https://cdn.example.com/media/b.png'],
      },
      prefijo,
    );

    expect(keys.sort()).toEqual(['media/b-thumb.webp', 'media/b.png']);
  });

  it('un anuncio sin ficheros no produce ninguna clave', () => {
    // Importa porque el llamante NO encola trabajo si la lista viene vacía: un
    // job de limpieza sin nada que limpiar es ruido en la cola.
    expect(listingMediaKeys({ imageUrls: [] }, prefijo)).toEqual([]);
    expect(
      listingMediaKeys({ imageUrls: [], videoUrl: null, videoPosterUrl: null }, prefijo),
    ).toEqual([]);
  });
});

/**
 * HUÉRFANAS H1 — el diff que decide qué se soltó.
 *
 * LO QUE ESTE BLOQUE PROTEGE es la decisión de **no enumerar campos**. Las
 * imágenes de bloque viven dentro de un `Json` en campos con nombres distintos
 * según el tipo de bloque (`imageUrl` en el carrusel de la portada, `url` en la
 * rejilla y en los bloques de imagen del blog…), así que una lista escrita a mano
 * se queda corta en cuanto alguien añade un tipo nuevo — y se queda corta **en
 * silencio**: nadie ve el fichero que dejó de limpiarse. Los casos de nombre raro
 * y de anidamiento profundo son exactamente esa mutación.
 */
describe('ownUrlsDeep', () => {
  const prefijo = 'https://cdn.example.com/';

  it('encuentra la URL viva donde sea, con el nombre de campo que sea', () => {
    const bloques = [
      { id: 'a', type: 'image', url: `${prefijo}blocks/a.jpg` },
      { id: 'b', type: 'category-carousel', items: [{ imageUrl: `${prefijo}homepage/b.png` }] },
      { id: 'c', type: 'grid', items: [{ media: { kind: 'image', url: `${prefijo}blocks/c.webp` } }] },
      { id: 'd', type: 'text', html: '<p>sin imágenes</p>' },
    ];

    expect(ownUrlsDeep(bloques, prefijo).sort()).toEqual([
      `${prefijo}blocks/a.jpg`,
      `${prefijo}blocks/c.webp`,
      `${prefijo}homepage/b.png`,
    ]);
  });

  it('ignora lo AJENO — un avatar de Google no es nuestro y no se toca', () => {
    const valor = {
      avatarUrl: 'https://lh3.googleusercontent.com/foto',
      enlace: 'https://ejemplo.com/pagina',
      propia: `${prefijo}avatars/x.jpg`,
    };

    expect(ownUrlsDeep(valor, prefijo)).toEqual([`${prefijo}avatars/x.jpg`]);
  });

  it('deduplica y tolera null/undefined/números sin romperse', () => {
    const url = `${prefijo}blocks/a.jpg`;
    expect(ownUrlsDeep([{ url }, { otro: url }, null, undefined, 3, true], prefijo)).toEqual([url]);
    expect(ownUrlsDeep(null, prefijo)).toEqual([]);
  });
});

describe('releasedUrls', () => {
  const prefijo = 'https://cdn.example.com/';
  const a = `${prefijo}blocks/a.jpg`;
  const b = `${prefijo}blocks/b.jpg`;

  it('devuelve lo que estaba y ya no está', () => {
    expect(releasedUrls([{ url: a }, { url: b }], [{ url: b }], prefijo)).toEqual([a]);
  });

  it('añadir una imagen no suelta nada', () => {
    expect(releasedUrls([{ url: a }], [{ url: a }, { url: b }], prefijo)).toEqual([]);
  });

  it('editar sin tocar las imágenes no suelta nada', () => {
    expect(
      releasedUrls([{ url: a, texto: 'antes' }], [{ url: a, texto: 'después' }], prefijo),
    ).toEqual([]);
  });

  it('la misma imagen en DOS bloques y se quita uno: no se suelta', () => {
    // El diff es entre conjuntos, y por eso este caso sale gratis: si la URL sigue
    // en cualquier parte del «después», no está en la diferencia.
    expect(releasedUrls([{ url: a }, { pie: a }], [{ url: a }], prefijo)).toEqual([]);
  });

  it('borrar el documento entero suelta todas las suyas', () => {
    expect(releasedUrls([{ url: a }, { url: b }], null, prefijo).sort()).toEqual([a, b]);
  });
});
