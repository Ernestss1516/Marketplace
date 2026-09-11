import { Prisma } from '@prisma/client';

/**
 * COOKIES RÁFAGA 3 — LA PÁGINA DE COOKIES, EN BORRADOR.
 *
 * Ver docs/diseno-consentimiento-cookies.md §5.
 *
 * ─── POR QUÉ LA SIEMBRA Y NO LA CREA UN ADMIN A MANO ────────────────────────────
 *
 * Porque el hueco tiene que ser VISIBLE. Si la página no existiera, la falta de política
 * de cookies sería un silencio: nadie se tropieza con lo que no está. Sembrada en
 * borrador, cada instancia arranca con una página a medio hacer esperando en
 * `/admin/paginas` — con su estructura montada, su inventario técnico ya escrito y los
 * huecos señalados. Alguien la ve y sabe qué falta.
 *
 * ─── NACE EN BORRADOR, Y ESO ES EL MECANISMO ────────────────────────────────────
 *
 * `DRAFT` significa que el público no la ve y que no entra en el sitemap. No hace falta
 * inventar ningún estado de «a medias»: el CMS ya distingue borrador de publicado, y
 * publicar es justo el acto que dice «el texto legal ya está». Mientras siga en borrador,
 * el «Más información» del banner sigue desplegando el detalle en el propio banner
 * (ráfaga 2) en vez de enlazar a un 404 — lo garantiza `ConsentConfigService`.
 *
 * ─── LOS HUECOS GRITAN, Y ES DELIBERADO ─────────────────────────────────────────
 *
 * En cumplimiento, un marcador de posición que parece un dato real es peligroso: alguien
 * publica, nadie lo relee, y la política declara una duración inventada. Por eso los
 * huecos van en MAYÚSCULAS, con la palabra PENDIENTE y con lo que hay que hacer para
 * cerrarlos. Son imposibles de confundir con una medición.
 *
 * ─── LO QUE ESTE FICHERO SÍ APORTA ──────────────────────────────────────────────
 *
 * El inventario técnico, que es lo único que el código puede saber con certeza: qué
 * cookies escribe la plataforma, qué terceros existen, qué categorías hay y para qué
 * sirve cada cosa. El texto legal lo escribe asesoría (D8); esto es su insumo.
 */

export const PAGINA_COOKIES_SLUG = 'cookies';
export const PAGINA_COOKIES_TITULO = 'Política de cookies';

/** La ruta pública, para `cookiePolicyUrl`. Una sola verdad sobre dónde vive la página. */
export const PAGINA_COOKIES_RUTA = `/paginas/${PAGINA_COOKIES_SLUG}`;

/**
 * Marca de hueco. Se usa tal cual dentro del contenido para que sea imposible publicar
 * sin verla — y para que un `grep` la encuentre.
 */
const PENDIENTE = '⚠️ PENDIENTE';

export const PAGINA_COOKIES_BLOQUES: Prisma.InputJsonValue = [
  {
    id: 'aviso-borrador',
    type: 'text',
    markdown: [
      `> ## ${PENDIENTE}: ESTA PÁGINA NO ESTÁ TERMINADA`,
      '>',
      '> **No la publiques todavía.** Le faltan dos cosas, y ninguna se puede resolver',
      '> escribiendo código:',
      '>',
      '> 1. **El texto legal** — lo redacta la asesoría. Los apartados marcados abajo',
      '>    están vacíos a propósito: esta página aporta el inventario técnico, no la',
      '>    redacción jurídica.',
      '> 2. **Cuatro datos que hay que MEDIR en un navegador**, no deducir. Están',
      `>    señalados con «${PENDIENTE}» en la tabla.`,
      '>',
      '> Cuando las dos estén, borra este aviso, publica la página y pon su ruta en',
      '> **Administración → Cookies → «Enlace a la política de cookies»**. A partir de ahí,',
      '> el botón «Más información» del banner llevará aquí.',
    ].join('\n'),
  },

  {
    id: 'intro',
    type: 'text',
    markdown: [
      '## Qué son las cookies',
      '',
      `${PENDIENTE}: texto de asesoría legal.`,
      '',
      'Debe explicar, en lenguaje llano, qué es una cookie y que aquí se cubre también',
      'cualquier otro almacenamiento en el dispositivo (`localStorage`), porque la ley',
      'habla de «almacenar información», no sólo de cookies.',
    ].join('\n'),
  },

  {
    id: 'categorias',
    type: 'text',
    markdown: [
      '## Las dos categorías que usamos',
      '',
      '**Esenciales.** Imprescindibles para que la plataforma funcione: mantener tu sesión',
      'iniciada, proteger el formulario de acceso y recordar la decisión que tomes sobre',
      'esta misma página. No se pueden desactivar, y por eso no te las pedimos: te las',
      'contamos.',
      '',
      '**Contenido de terceros.** Vídeos y mapas incrustados en algunas páginas. **No se',
      'cargan hasta que lo aceptas**: mientras no lo hagas verás un aviso en su lugar, con',
      'la opción de cargarlos uno a uno.',
      '',
      '> No usamos cookies de publicidad ni de seguimiento, ni propias ni de terceros. No',
      '> hay categoría de «marketing» ni de «analítica» porque no hay nada que ofrecerte',
      '> apagar: sería inventarnos un tratamiento que no hacemos.',
    ].join('\n'),
  },

  {
    id: 'tabla-propias',
    type: 'text',
    markdown: [
      '## Cookies propias',
      '',
      'Las que escribe esta plataforma en tu navegador.',
    ].join('\n'),
  },
  {
    id: 'tabla-propias-datos',
    type: 'table',
    headers: ['Nombre', 'Categoría', 'Para qué sirve', 'Duración'],
    rows: [
      [
        'mp_consent',
        'Esencial',
        'Guarda qué has decidido en el aviso de cookies (y cuándo), para no volver a preguntártelo y para respetar tu elección. Sin ella no podríamos cumplir tu decisión.',
        '6 meses',
      ],
      [
        `${PENDIENTE}: nombre real`,
        'Esencial',
        'Mantiene tu sesión iniciada. La escribe la biblioteca de autenticación (Auth.js) al entrar.',
        `${PENDIENTE}: duración real`,
      ],
      [
        `${PENDIENTE}: nombre real`,
        'Esencial',
        'Protege el formulario de acceso frente a peticiones falsificadas (CSRF). Temporal, sólo durante el proceso de inicio de sesión.',
        `${PENDIENTE}: duración real`,
      ],
      [
        `${PENDIENTE}: nombre real`,
        'Esencial',
        'Sólo si entras con Google: asegura que la respuesta de Google corresponde a la petición que hiciste tú. Temporal.',
        `${PENDIENTE}: duración real`,
      ],
    ],
  },

  {
    id: 'medir-como',
    type: 'text',
    markdown: [
      `> ### ${PENDIENTE}: cómo cerrar los huecos de la tabla de arriba`,
      '>',
      '> Los nombres y las duraciones de las cookies de sesión **los decide la biblioteca**',
      '> (Auth.js), no nuestro código, así que no se pueden leer del repositorio: hay que',
      '> medirlos. Sólo se hace una vez.',
      '>',
      '> 1. Abre la plataforma en una ventana privada.',
      '> 2. Abre las herramientas de desarrollo del navegador → pestaña **Aplicación**',
      '>    (o *Almacenamiento*) → **Cookies**.',
      '> 3. Inicia sesión con correo y contraseña. Apunta el **nombre exacto** y la',
      '>    **fecha de caducidad** de cada cookie nueva.',
      '> 4. Repite entrando **con Google**: aparecen otras, temporales, del proceso OAuth.',
      '> 5. Sustituye cada hueco por lo que hayas medido y borra este recuadro.',
      '>',
      '> Lo único que ya sabemos del código: la **sesión dura 7 días**, alineada a mano con',
      '> la validez del token del servidor.',
    ].join('\n'),
  },

  {
    id: 'tabla-terceros',
    type: 'text',
    markdown: [
      '## Contenido de terceros',
      '',
      'Estos servicios no se cargan mientras no los aceptes. Si los aceptas, reciben tu',
      'dirección IP y pueden usar sus propias cookies, bajo sus propias políticas.',
    ].join('\n'),
  },
  {
    id: 'tabla-terceros-datos',
    type: 'table',
    headers: ['Proveedor', 'Dónde aparece', 'Qué recibe', 'Su política'],
    rows: [
      [
        'Vimeo',
        'Vídeos incrustados en páginas y artículos',
        `Tu dirección IP y la página desde la que lo ves. ${PENDIENTE}: qué cookies escribe exactamente`,
        'https://vimeo.com/privacy',
      ],
      [
        'YouTube (Google)',
        'Vídeos incrustados en páginas y artículos',
        `Tu dirección IP y la página desde la que lo ves. Usamos el modo sin cookies de YouTube, pero al reproducir el vídeo escribe las suyas. ${PENDIENTE}: qué cookies escribe exactamente, al cargar y al reproducir`,
        'https://policies.google.com/privacy',
      ],
      [
        'MapTiler',
        'El mapa de la búsqueda, cuando eliges esa vista',
        `Tu dirección IP y la página desde la que lo ves. ${PENDIENTE}: si escribe alguna cookie`,
        'https://www.maptiler.com/privacy-policy/',
      ],
    ],
  },

  {
    id: 'medir-terceros',
    type: 'text',
    markdown: [
      `> ### ${PENDIENTE}: cómo cerrar los huecos de los terceros`,
      '>',
      '> Lo que cada proveedor escribe está dentro de su propio marco incrustado, así que',
      '> tampoco se puede leer de nuestro código: se mide.',
      '>',
      '> 1. Abre una página con un vídeo y **acepta el contenido de terceros**.',
      '> 2. En Aplicación → Cookies, mira las de `vimeo.com` y `youtube-nocookie.com`.',
      '> 3. Con YouTube, apunta por separado **lo que aparece al cargar** y **lo que',
      '>    aparece al pulsar reproducir**: no es lo mismo, y la diferencia importa.',
      '> 4. Haz lo mismo con el mapa (`/busqueda?view=mapa`) para `api.maptiler.com`.',
      '> 5. Sustituye los huecos por lo medido y borra este recuadro.',
    ].join('\n'),
  },

  {
    id: 'sin-seguimiento',
    type: 'text',
    markdown: [
      '## Lo que NO hacemos',
      '',
      'No usamos Google Analytics, ni Tag Manager, ni píxeles de redes sociales, ni ninguna',
      'otra herramienta de analítica o publicidad de terceros. Ninguna.',
      '',
      '**Sí medimos** cuántas veces se ve y aparece cada anuncio, porque quien publica',
      'necesita saberlo. Pero lo hacemos sin ponerte nada en el navegador: el servidor',
      'calcula una huella temporal a partir de tu dirección IP, la usa durante 30 minutos',
      'para no contarte dos veces, y la descarta. **No se guarda tu IP, no se crea ningún',
      'identificador y no queda ningún perfil**: lo único que se conserva son sumas por',
      'anuncio y por día.',
      '',
      `${PENDIENTE}: que la asesoría revise este apartado y añada la base jurídica del`,
      'tratamiento (interés legítimo), el responsable, los plazos de conservación y cómo',
      'ejercer los derechos.',
    ].join('\n'),
  },

  {
    id: 'como-cambiar',
    type: 'text',
    markdown: [
      '## Cambiar o retirar tu decisión',
      '',
      'Puedes cambiar de opinión cuando quieras, aquí abajo o desde el enlace',
      '**«Preferencias de cookies»** que hay al pie de todas las páginas. Retirar el',
      'consentimiento es tan fácil como darlo.',
    ].join('\n'),
  },

  // EL PANEL, y va aquí y no al final del todo a propósito: después de explicar qué es
  // cada categoría y antes de la letra pequeña de cómo borrar cookies en cada navegador.
  // Quien ha leído hasta aquí ya está informado, que es justo cuando debe poder decidir.
  { id: 'panel', type: 'cookiePreferences' },

  {
    id: 'borrar-navegador',
    type: 'text',
    markdown: [
      '## Borrar las cookies desde tu navegador',
      '',
      `${PENDIENTE}: texto de asesoría legal.`,
      '',
      'Debe incluir las instrucciones para Chrome, Firefox, Safari y Edge, con sus enlaces',
      'de ayuda oficiales.',
    ].join('\n'),
  },

  {
    id: 'contacto',
    type: 'text',
    markdown: [
      '## Dudas',
      '',
      `${PENDIENTE}: texto de asesoría legal.`,
      '',
      'Debe indicar el responsable del tratamiento, su dirección, la vía de contacto para',
      'temas de privacidad y la fecha de la última actualización de esta política.',
    ].join('\n'),
  },
];
