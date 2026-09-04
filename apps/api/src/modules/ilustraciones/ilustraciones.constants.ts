/**
 * E7 — EL REGISTRO CERRADO DE ILUSTRACIONES.
 *
 * ── EL PRINCIPIO QUE LO ORDENA (§8.1 del diseño) ────────────────────────────────────
 *
 *     La ilustración es un asset intercambiable. El hueco donde va, NO.
 *
 * Un modelo (o un admin) cambia QUÉ imagen ocupa el slot «favoritos vacío». No decide si
 * esa pantalla tiene ilustración, dónde va ni qué texto la acompaña: eso es estructura, y
 * la estructura no la toca ni un modelo ni un admin. Es la misma frontera de la decisión
 * #1, aplicada a las imágenes.
 *
 * ── POR QUÉ EL REGISTRO ES CERRADO Y VIVE EN CÓDIGO (decisión #5) ───────────────────
 *
 * Añadir un slot no es rellenar un formulario: es que una pantalla concreta pase a tener
 * un hueco donde antes no lo había. Eso es un despliegue, no un ajuste — «los iremos
 * añadiendo» describe una lista que crece por código.
 *
 * ── FICHERO PURO, SIN DI, Y ES LA RAZÓN DE QUE ESTÉ SEPARADO ───────────────────────
 *
 * Molde literal de `branding.constants.ts`, y por el motivo escrito allí: lo importan el
 * servicio (que escribe los ajustes) y `MediaCleanupService` (que tiene que saber cuáles
 * son para NO borrar una ilustración viva). Los dos módulos no se ven entre sí; si la
 * lista viviera dentro del servicio habría que copiarla en la limpieza, y el día que se
 * añadiera un slot su imagen quedaría desprotegida **en silencio**.
 *
 * Y hay un tercer lector que tampoco se conoce con los otros dos: **el frontend, que las
 * pinta**. Ahí la lista se espeja en `apps/web/src/lib/ilustraciones.ts`, y
 * `ilustraciones-espejo.spec.ts` comprueba que las dos no se separan — el mismo remedio
 * que `globals-espejo.spec.ts` usa para los tokens.
 *
 * Ver `docs/diseno-sistema-estilo.md` §8.
 */
import { tipoDeFicheroNoAdmitido } from '../../common/mensajes-subida';

/** La proporción recomendada de un slot, en píxeles del asset. */
export interface ProporcionIlustracion {
  ancho: number;
  alto: number;
}

export interface SlotIlustracion {
  /** Identificador ESTABLE. Viaja a la base, a la UI de admin y al frontend. */
  id: string;
  /** Para que el admin sepa qué está cambiando antes de subir nada. */
  descripcion: string;
  /** Lo que el asset debería medir. No se impone: se recomienda y se pinta con ella. */
  proporcion: ProporcionIlustracion;
  /**
   * ⚠ EL TEXTO ALTERNATIVO VIVE AQUÍ Y NO LO ESCRIBE EL ADMIN (§8.2).
   *
   * La accesibilidad no puede depender de que alguien rellene un campo: un `alt` vacío o
   * ausente es exactamente lo que produce un formulario opcional. Aquí siempre hay uno
   * correcto, escrito por quien conoce la pantalla.
   *
   * Afinarlo desde el backoffice NO entra en v1, y se dice a la cara: la propiedad que
   * sostiene la decisión —que la accesibilidad no dependa del admin— ya se cumple, y
   * permitir editarlo es una adición, no un prerrequisito. Si algún día se añade, el
   * valor guardado puede pasar de cadena a objeto sin migrar nada, igual que
   * `EstiloService.normalizar` ya hace con su Json.
   */
  alt: string;
  /**
   * EL DEFAULT DEL MODELO. **Cada slot tiene SIEMPRE valor** (§8.2): si el admin no
   * sustituye nada, se sirve esto. Nunca un hueco, nunca una imagen rota — la misma
   * doctrina de «degrada, nunca rompe» de `BrandingService`.
   *
   * Es una ruta del propio frontend (`/ilustraciones/…`), no una URL del bucket: el
   * default viaja CON el código, así que una instancia recién desplegada ya tiene las
   * diez sin que nadie suba nada.
   */
  defecto: string;
}

/**
 * LOS DIEZ DE v1 (decisión #5). Errores y transversales van en una segunda pasada — no
 * porque sobren, sino porque un registro cerrado se amplía cuando se sabe qué pantalla
 * gana el hueco, y esas todavía no están decididas.
 *
 * Dos familias, y el orden es el del documento: primero los estados vacíos —donde la
 * pantalla no tiene nada que enseñar y la ilustración ES el contenido— y después las
 * confirmaciones, donde acompaña a una buena noticia.
 */
export const ILUSTRACION_SLOTS: readonly SlotIlustracion[] = [
  // ── Estados vacíos ────────────────────────────────────────────────────────────────
  {
    id: 'empty-favorites',
    descripcion: 'Favoritos, cuando el usuario todavía no ha guardado ningún anuncio.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de una lista de favoritos vacía',
    defecto: '/ilustraciones/empty-favorites.svg',
  },
  {
    id: 'empty-my-listings',
    descripcion: 'Mis anuncios, cuando el vendedor no ha publicado ninguno.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de un tablón de anuncios vacío',
    defecto: '/ilustraciones/empty-my-listings.svg',
  },
  {
    id: 'empty-search',
    descripcion: 'Búsqueda sin resultados.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de una búsqueda sin resultados',
    defecto: '/ilustraciones/empty-search.svg',
  },
  {
    id: 'empty-messages',
    descripcion: 'Bandeja de mensajes sin conversaciones.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de una bandeja de mensajes vacía',
    defecto: '/ilustraciones/empty-messages.svg',
  },
  {
    id: 'empty-tickets',
    descripcion: 'Mis tickets, cuando el usuario no ha abierto ninguno.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de una bandeja de tickets vacía',
    defecto: '/ilustraciones/empty-tickets.svg',
  },
  {
    id: 'empty-notifications',
    descripcion: 'Notificaciones, cuando no hay ninguna.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de una campana de notificaciones en reposo',
    defecto: '/ilustraciones/empty-notifications.svg',
  },

  // ── Confirmaciones ────────────────────────────────────────────────────────────────
  {
    id: 'success-payment',
    descripcion: 'Confirmación de un pago o una compra de créditos.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de un pago confirmado',
    defecto: '/ilustraciones/success-payment.svg',
  },
  {
    id: 'success-review',
    descripcion: 'Confirmación de que una valoración se ha publicado.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de una valoración enviada',
    defecto: '/ilustraciones/success-review.svg',
  },
  {
    id: 'success-listing-published',
    descripcion: 'Confirmación de que un anuncio se ha publicado.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de un anuncio publicado',
    defecto: '/ilustraciones/success-listing-published.svg',
  },
  {
    id: 'success-ticket-sent',
    descripcion: 'Confirmación de que un ticket de soporte se ha enviado.',
    proporcion: { ancho: 240, alto: 180 },
    alt: 'Ilustración de un mensaje de soporte enviado',
    defecto: '/ilustraciones/success-ticket-sent.svg',
  },
];

export const ILUSTRACION_IDS: readonly string[] = ILUSTRACION_SLOTS.map((s) => s.id);

export function buscarSlot(id: string): SlotIlustracion | undefined {
  return ILUSTRACION_SLOTS.find((s) => s.id === id);
}

/**
 * La clave de `Setting` de cada slot — UNA POR SLOT, molde literal de los tres logos.
 *
 * Se valoró guardar las diez en un solo Json (como `estiloConfig`) y se descartó por una
 * razón concreta: escribir un mapa entero obliga a leerlo antes, y dos admins subiendo
 * dos slots a la vez se pisarían el uno al otro sin que nada avisara. Con una fila por
 * slot, dos subidas simultáneas escriben en filas distintas y no existe esa carrera.
 *
 * **NINGUNA ESTÁ EN EL WHITELIST DE `PATCH /admin/settings/:key`**, igual que las de
 * logo y por el mismo motivo: ese PATCH aceptaría cualquier cadena —una URL de otro
 * dominio—, no limpiaría el objeto anterior y no revalidaría nada. El único escritor de
 * estas claves es este módulo.
 */
export const ILUSTRACION_SETTING_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  ILUSTRACION_SLOTS.map((s) => [
    s.id,
    // `ilustracion:` con dos puntos, como prefijo de espacio de nombres. El id ya es
    // estable y legible; anteponerle el dominio evita que un slot llamado `empty-search`
    // colisione algún día con un ajuste de búsqueda.
    `ilustracion:${s.id}`,
  ]),
);

/**
 * Las claves como lista, para quien necesita mirarlas sin saber nada de slots. Su
 * consumidor de fuera es la limpieza (`laReferenciaAlguienMas`), que pregunta «¿esta URL
 * es una ilustración activa?» y no «¿de qué slot?». Molde de `LOGO_SETTING_KEY_LIST`.
 */
export const ILUSTRACION_SETTING_KEY_LIST: readonly string[] = Object.values(
  ILUSTRACION_SETTING_KEYS,
);

/**
 * EL MISMO MAPA MIME QUE LOS LOGOS, incluido el SVG, y con los mismos tres hechos
 * sosteniéndolo (ver `branding.constants.ts`): sólo ADMIN sube, se sirve desde otro
 * origen, y se pinta con `<img>` —nunca incrustado en el DOM—, que es donde un `<script>`
 * dentro de un SVG no llega a ejecutarse jamás.
 *
 * Se declara aquí en vez de importarse de `branding` porque son dos superficies con dos
 * decisiones: si mañana los logos dejaran de admitir SVG, las ilustraciones no tienen por
 * qué seguirlos.
 */
export const ILUSTRACION_MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/jpeg': '.jpg',
};

export const ILUSTRACION_ALLOWED_MIME_TYPES: readonly string[] = Object.keys(
  ILUSTRACION_MIME_TO_EXT,
);

export const ILUSTRACION_MIME_ERROR = tipoDeFicheroNoAdmitido('PNG, WebP, SVG o JPEG');

/**
 * 2 MB — EL DOBLE QUE UN LOGO, Y UNA QUINTA PARTE DE UNA FOTO DE ANUNCIO.
 *
 * El número lo fija el dominio y no el criterio de quien sube, que es lo que el §8.3 pide
 * explícitamente. Las dos referencias:
 *
 *  · `LOGO_MAX_BYTES` es 1 MB **porque un logo se sirve en TODAS las páginas**. Una
 *    ilustración se sirve en UNA, y sólo cuando esa pantalla está vacía, así que el mismo
 *    peso cuesta órdenes de magnitud menos.
 *  · `MAX_FILE_SIZE` son 10 MB porque una foto de anuncio ES el contenido que alguien
 *    vino a ver. Una ilustración de estado vacío acompaña a un texto; no merece el mismo
 *    presupuesto.
 *
 * 2 MB es holgado de sobra para lo que esto es: los diez defaults del modelo pesan menos
 * de 2 KB cada uno. El límite no está para dimensionar el caso normal, está para que
 * nadie pegue una fotografía de 10 MB en un hueco decorativo.
 */
export const ILUSTRACION_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Prefijo propio en el bucket, como `branding/`, `blocks/` y `sponsored/`. El nombre del
 * objeto es aleatorio y no `empty-favorites.png`: una clave estable dejaría al navegador
 * sirviendo la ilustración vieja de su caché durante horas, y haría indistinguibles el
 * objeto nuevo y el viejo justo donde la limpieza necesita distinguirlos.
 */
export const ILUSTRACION_KEY_PREFIX = 'ilustraciones';

/** Tag de caché en el frontend (`unstable_cache`). Molde de `BRANDING_CACHE_TAG`. */
export const ILUSTRACIONES_CACHE_TAG = 'ilustraciones';
