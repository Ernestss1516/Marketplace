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
 * ─── Y AHORA HAY UN SEGUNDO GRADO: MEDIDO ≠ CONFIRMADO ──────────────────────────
 *
 * Los cuatro datos ya se midieron (runtime real, no lectura de código; ver el reporte de
 * la ráfaga). Pero se midieron **en local, sin HTTPS y con un navegador automatizado**, y
 * eso no es lo que ve un usuario. Colapsar «medido» y «comprobado» en un solo estado
 * habría tirado por tierra justo lo que protege esta página: la tabla se habría quedado
 * con datos de aspecto definitivo que nadie miró dos veces.
 *
 * De ahí la segunda marca, `SIN_CONFIRMAR`. Dice lo contrario que `PENDIENTE`: aquí SÍ
 * hay un dato, y es real, pero le falta una mirada en un navegador de verdad. Se cierra
 * en diez minutos, y hasta entonces la página sigue sin publicarse igual que antes.
 *
 * Dos avisos concretos que la medición dejó y que la confirmación tiene que resolver:
 *   · Los nombres de las cookies de Auth.js llevan `__Secure-`/`__Host-` SÓLO en HTTPS.
 *     La tabla declara los de HTTPS; la medición vio los de HTTP local, sin prefijo.
 *   · Lo de YouTube CAMBIÓ DE SIGNO. La tabla afirmaba que al reproducir escribía cookies
 *     propias; medido, no escribió ninguna. Es el dato que más importa volver a mirar,
 *     porque una política que declara «no escribe» cuando sí escribe es peor que callarse.
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

/**
 * Marca de dato MEDIDO PERO NO CONFIRMADO.
 *
 * Distinta de `PENDIENTE` a propósito, y la diferencia es la que importa: `PENDIENTE`
 * significa «aquí no hay dato»; esto significa «aquí hay un dato real, tomado de una
 * medición fechada, que nadie ha vuelto a comprobar en un navegador de verdad».
 *
 * No son lo mismo y no se cierran igual. Un `PENDIENTE` se cierra midiendo. Esto se
 * cierra abriendo el navegador y mirando si coincide — diez minutos, no veinte.
 *
 * La barrera sigue en pie: mientras quede uno de estos, la página no se publica.
 */
const SIN_CONFIRMAR = '⚠️ SIN CONFIRMAR';

/** Cuándo se tomaron las mediciones que rellenan las tablas. */
const FECHA_MEDICION = '15 de septiembre de 2026';

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
      `> 2. **Confirmar las tablas en un navegador de verdad.** Los cuatro datos que había`,
      `>    que medir ya **están medidos** (el ${FECHA_MEDICION}), pero sobre una copia local`,
      '>    sin HTTPS y con un navegador automatizado. Van marcados con',
      `>    «${SIN_CONFIRMAR}» y los dos recuadros de abajo dicen exactamente qué mirar.`,
      '>    Son diez minutos.',
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
        `__Secure-authjs.session-token ${SIN_CONFIRMAR}`,
        'Esencial',
        'Mantiene tu sesión iniciada. La escribe la biblioteca de autenticación (Auth.js) al entrar. Sin cifrado no habría forma de reconocerte entre una página y la siguiente.',
        `7 días ${SIN_CONFIRMAR}`,
      ],
      [
        `__Host-authjs.csrf-token ${SIN_CONFIRMAR}`,
        'Esencial',
        'Protege el formulario de acceso frente a peticiones falsificadas (CSRF). Se escribe al abrir la página de acceso, antes incluso de que escribas nada.',
        `De sesión: se borra al cerrar el navegador ${SIN_CONFIRMAR}`,
      ],
      [
        `__Secure-authjs.callback-url ${SIN_CONFIRMAR}`,
        'Esencial',
        'Recuerda a qué página volver después de entrar, para devolverte donde estabas en vez de a la portada.',
        `De sesión: se borra al cerrar el navegador ${SIN_CONFIRMAR}`,
      ],
      [
        `__Secure-authjs.pkce.code_verifier ${SIN_CONFIRMAR}`,
        'Esencial',
        'Sólo si entras con Google: asegura que la respuesta de Google corresponde a la petición que hiciste tú (PKCE). Se borra en cuanto termina el proceso.',
        `15 minutos ${SIN_CONFIRMAR}`,
      ],
    ],
  },

  {
    id: 'nota-nombres-cookies',
    type: 'text',
    markdown: [
      '> **Sobre los nombres que empiezan por `__Secure-` y `__Host-`.** Son prefijos que',
      '> el navegador entiende como una promesa: esa cookie sólo viaja por conexión segura',
      '> (y, con `__Host-`, sólo a este mismo sitio). Los añade la biblioteca de',
      '> autenticación cuando la web se sirve por HTTPS, que es como la ves tú. Si alguna',
      '> vez inspeccionas una copia local sin HTTPS verás los mismos nombres sin el prefijo.',
    ].join('\n'),
  },

  {
    id: 'medir-como',
    type: 'text',
    markdown: [
      `> ### ${SIN_CONFIRMAR}: confirma la tabla de arriba en un navegador de verdad`,
      '>',
      `> Los datos de arriba **están medidos**, no supuestos: se tomaron el ${FECHA_MEDICION}`,
      '> sobre la plataforma en marcha, con un navegador automatizado (Chromium headless)',
      '> contra una copia local **sin HTTPS**. Eso deja dos cosas por comprobar, y las dos',
      '> se ven en diez minutos:',
      '>',
      '> - **Los prefijos.** En local sin HTTPS los nombres salen sin `__Secure-` / `__Host-`.',
      '>   Los de la tabla son los que corresponden a HTTPS. Hay que verlos **en la web',
      '>   publicada**, que es la única que los lleva de verdad.',
      '> - **El navegador real.** Un Chromium automatizado no es Chrome con sus ajustes, ni',
      '>   Firefox, ni Safari. Las duraciones no deberían cambiar; confírmalo de todos modos.',
      '>',
      '> Cómo:',
      '>',
      '> 1. Abre la plataforma **publicada** en una ventana privada.',
      '> 2. Herramientas de desarrollo → pestaña **Aplicación** (o *Almacenamiento*) →',
      '>    **Cookies**.',
      '> 3. Inicia sesión con correo y contraseña. Compara **nombre exacto** y **caducidad**',
      '>    con la tabla.',
      '> 4. Repite entrando **con Google** y compara la del proceso OAuth.',
      `> 5. Si coincide, borra las marcas «${SIN_CONFIRMAR}» y este recuadro. Si no coincide,`,
      '>    manda la tabla lo que hayas visto: lo medido cede ante lo observado.',
      '>',
      '> Lo que ya se sabía del código y la medición confirmó: la **sesión dura 7 días**,',
      '> alineada a mano con la validez del token del servidor.',
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
        `Tu dirección IP y la página desde la que lo ves. Nada más cargarse escribe dos cookies en el dominio vimeo.com: «__cf_bm» (30 minutos, protección antirrobots de Cloudflare) y «vuid» (unos 13 meses, identificador de visitante de Vimeo). Si además pulsas reproducir añade «player» (1 año, tus preferencias del reproductor). ${SIN_CONFIRMAR}`,
        'https://vimeo.com/privacy',
      ],
      [
        'YouTube (Google)',
        'Vídeos incrustados en páginas y artículos',
        `Tu dirección IP y la página desde la que lo ves. Usamos el modo sin cookies de YouTube: en nuestra medición no escribió ninguna cookie, ni al cargar el vídeo ni al pulsar reproducir. Al reproducir sí contacta con otros servidores de Google (googlevideo.com, i.ytimg.com), que reciben tu IP. ${SIN_CONFIRMAR}`,
        'https://policies.google.com/privacy',
      ],
      [
        'MapTiler',
        'El mapa de la búsqueda, cuando eliges esa vista',
        `Tu dirección IP y la página desde la que lo ves. En nuestra medición no dejó ninguna cookie en el navegador: sus respuestas incluyen una de Cloudflare («_cfuvid»), pero el mapa pide los datos de forma que el navegador no llega a guardarla. ${SIN_CONFIRMAR}`,
        'https://www.maptiler.com/privacy-policy/',
      ],
    ],
  },

  {
    id: 'medir-terceros',
    type: 'text',
    markdown: [
      `> ### ${SIN_CONFIRMAR}: confirma los terceros en un navegador de verdad`,
      '>',
      `> También están medidos (el ${FECHA_MEDICION}, en la misma tanda que los de arriba),`,
      '> y aquí la confirmación pesa más que en las cookies propias, por tres motivos:',
      '>',
      '> - **Lo de YouTube cambió de signo.** Antes esta tabla decía que al reproducir',
      '>   escribía cookies. La medición dice que **no escribió ninguna**. Una política que',
      '>   afirma «no escribe» cuando sí escribe es peor que una que no lo menciona: vuelve',
      '>   a mirarlo antes de firmarlo.',
      '> - **Depende de dónde estés.** Estos servicios se comportan distinto según el país',
      '>   y según lo que el navegador tenga bloqueado. Lo medido salió de una sola máquina.',
      '> - **Depende de tu sesión.** Se midió en una ventana limpia, sin sesión de Google ni',
      '>   de Vimeo abierta. Con sesión iniciada podría no ser lo mismo.',
      '>',
      '> Cómo:',
      '>',
      '> 1. Abre una página con un vídeo y **acepta el contenido de terceros**.',
      '> 2. En Aplicación → Cookies, mira las de `vimeo.com` y `youtube-nocookie.com`.',
      '> 3. Con YouTube, apunta por separado **lo que aparece al cargar** y **lo que',
      '>    aparece al pulsar reproducir**: no es lo mismo, y la diferencia importa.',
      '> 4. Haz lo mismo con el mapa (`/busqueda?view=mapa`) para `api.maptiler.com`.',
      `> 5. Si coincide, borra las marcas «${SIN_CONFIRMAR}» y este recuadro. Si no, corrige`,
      '>    la tabla con lo que hayas visto.',
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
