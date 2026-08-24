import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DetectorId, ListingStatus, ListingTriage } from '@prisma/client';

/**
 * FICHA F2 (P6) — LOS EJES CON LOS QUE EL BACKOFFICE ENCUENTRA UN ANUNCIO.
 *
 * DERIVADOS DE LAS TAREAS DEL MODERADOR, NO DE LAS COLUMNAS. Un filtro por
 * columna produce treinta controles y ninguna respuesta; cada eje de aquí existe
 * porque desbloquea algo que alguien hace: «encuéntrame este anuncio»,
 * «enséñame todo lo de este vendedor», «qué está denunciado», «qué se publica en
 * esta rama del catálogo». Ver docs/diseno-ficha-anuncio.md §2.2.
 *
 * VAN A POSTGRES, Y NO ES UNA PREFERENCIA. Meilisearch indexa **sólo ACTIVE**
 * (`search.service.ts` filtra antes de enviar y borra del índice lo que deja de
 * serlo), y el moderador trabaja sobre todo con los otros ocho estados. Con Meili
 * no es que fuera peor: el dato no está ahí. De regalo, el backoffice deja de
 * depender de que el índice esté sano.
 *
 * COMPATIBILIDAD, QUE AQUÍ NO ES TEÓRICA: la cola de revisión (M3) llama a este
 * mismo endpoint con `status=PENDING_REVIEW` y `order=oldest`. Los dos parámetros
 * se conservan con su significado EXACTO — `statuses` se añade al lado de
 * `status` en vez de sustituirlo, y `order` gana valores sin que cambien los dos
 * que ya existían.
 */
export class ListAdminListingsDto {
  /**
   * Texto libre. EL HUECO MÁS GRANDE que tenía el backoffice: no había forma de
   * buscar un anuncio por su nombre — se paginaba hasta encontrarlo.
   *
   * Casa por título, por descripción y por identidad exacta (`id` o `slug`),
   * porque «me han pasado este anuncio» llega tanto como nombre cuanto como
   * enlace pegado.
   */
  @IsOptional()
  @IsString()
  q?: string;

  /**
   * Estado ÚNICO. Se mantiene tal cual: es lo que manda la cola de revisión (M3)
   * y lo que mandaban los filtros de `/admin/anuncios` antes de F2.
   */
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  /**
   * Estados MÚLTIPLES, separados por comas: `?statuses=DRAFT,PENDING_REVIEW`.
   *
   * Existe porque las preguntas reales del moderador son CONJUNTOS —«borrador o
   * pendiente», «todo lo que no está archivado»— y con un solo estado hay que
   * mirar la lista dos veces sin poder compararlas.
   *
   * Molde del CSV: `SearchQueryDto.tags`. Si vienen los dos, `statuses` manda:
   * es el más específico y el que sólo puede haber puesto alguien a propósito.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : value,
  )
  @IsEnum(ListingStatus, { each: true })
  statuses?: ListingStatus[];

  /**
   * Categoría, **INCLUYENDO SUS DESCENDIENTES A CUALQUIER PROFUNDIDAD**.
   *
   * Ya existía como parámetro y nadie lo mandaba. Lo que cambia en F2 es la
   * semántica: antes casaba exacto, y con un árbol de N niveles eso significa que
   * filtrar por «Motor» no enseñaba nada porque los anuncios cuelgan de las
   * hojas. Es el riesgo R1 de la profundidad, que este repo ya se comió una vez.
   */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** El vendedor. También estaba construido y sin usar: es el paso siguiente a
   * encontrar un mal actor — «enséñame todo lo suyo». */
  @IsOptional()
  @IsString()
  sellerId?: string;

  /**
   * ETIQUETA INTERNA (P1, E2) — el triaje del staff, MÚLTIPLE:
   * `?triage=EDITED,NEW`.
   *
   * Es el primer eje que ejerce lo que F2 dejó prometido —«los ejes nuevos entran
   * con un campo aquí y una línea en el `where`»— y por eso copia el molde de
   * `statuses` en vez de inventarse otra forma.
   *
   * Múltiple porque las preguntas son conjuntos: «lo que está sin revisar» son
   * `NEW` **y** `EDITED` a la vez, que es justo la cola de trabajo del moderador.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : value,
  )
  @IsEnum(ListingTriage, { each: true })
  triage?: ListingTriage[];

  /**
   * ETIQUETA INTERNA (P1, E2) — «el staff lo vigila». Tres posiciones, molde de
   * `hasReports`: sin el parámetro no filtra, y `false` es la pregunta contraria
   * («qué NO estamos vigilando»), no «me da igual».
   *
   * EJE INDEPENDIENTE de `triage`, igual que en el modelo: «los revisados que
   * además vigilamos» se pide combinando los dos.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  watched?: boolean;

  /**
   * VÍDEO #13 — «sólo los que llevan vídeo». Mismas tres posiciones.
   *
   * Es el eje que la auditoría echaba en falta: sin él, un moderador no puede priorizar
   * ni acotar por vídeo desde la cola, y el vídeo es justo lo que más cuesta revisar (hay
   * que verlo, no leerlo). Con el indicador solo se VE de fila en fila; con el filtro se
   * despacha el lote entero.
   *
   * NO reusa el `conVideo` de `/search` aunque se llame igual, y no puede: aquél filtra en
   * Meilisearch, que **sólo indexa ACTIVE**, y el trabajo del moderador está sobre todo en
   * los otros ocho estados (ver la cabecera de esta clase). Comparten el nombre porque son
   * la misma pregunta del usuario, no la misma implementación.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  conVideo?: boolean;

  /**
   * `true` = sólo anuncios CON denuncias. La bandeja de problemas del moderador.
   * `false` = sólo los que no tienen ninguna. Sin el parámetro, no filtra.
   *
   * Molde del booleano de query: `ListBannersDto.activo` — se preserva
   * `undefined` explícitamente para no colapsar «sin filtro» en «false».
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  hasReports?: boolean;

  /** «Dejó de cumplir la configuración de su categoría» (puerta, ráfaga 2). La
   * columna ya estaba indexada y el filtro no se exponía. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  needsRevalidation?: boolean;

  /**
   * PUNTO 6 · RÁFAGA A — «el motor encontró algo en el texto». Molde exacto de
   * `hasReports`: tres posiciones, y `false` es la pregunta contraria, no «me da igual».
   *
   * ES EL EJE PROPIO DEL AVISO, independiente de `triage` y de `watched`. «Los revisados
   * que además tienen avisos» se pide combinando los tres, igual que P1 previó.
   *
   * SIN ESTE FILTRO EL MODO AVISAR NO SIRVE PARA NADA: un aviso que sólo se ve abriendo
   * fichas de una en una es un aviso que nadie lee. Es la mitad de por qué las detecciones
   * se persisten en vez de derivarse al vuelo como la señal de F1.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  hasDetections?: boolean;

  /**
   * PUNTO 6 · RÁFAGA A — «enséñame los anuncios donde disparó ESTE detector».
   *
   * Es lo que convierte la lista en el BANCO DE PRUEBAS: el staff filtra por `PHONE`, abre
   * veinte anuncios y ve con sus ojos cuántos eran ruido antes de decidir si ese detector se
   * ha ganado bloquear (ráfaga B). No hay forma honesta de sacar esa medida de un contador.
   */
  @IsOptional()
  @IsEnum(DetectorId)
  detector?: DetectorId;

  /**
   * ÚLTIMA IP (5b) — la IP desde la que su DUEÑO gestionó el anuncio por última vez
   * (5a). Cruza con el filtro por IP de usuarios: «qué anuncios se han tocado desde
   * aquí».
   *
   * F2 dejó escrito que un eje nuevo entra «con un campo en el DTO y una línea en el
   * `where`»; P1 fue el primero en ejercerlo y éste es el segundo, sin que la forma haya
   * cambiado. Coincidencia EXACTA, por el mismo motivo que en usuarios.
   */
  @IsOptional()
  @IsString()
  ip?: string;

  /**
   * EL TELÉFONO PUBLICADO del anuncio (`Listing.phone`), buscado **en cualquier formato**.
   *
   * Se compara contra `phoneNormalized`, la forma canónica, después de normalizar también lo
   * que escribe el moderador. Así `654 123 456` en el buscador encuentra el anuncio que lo
   * guardó como `+34654123456`, que es la única forma de que esto sirva para algo: ni el
   * vendedor ni el moderador tienen por qué teclearlo igual.
   *
   * NO va dentro del `OR` de `q`, y no es una preferencia: `q` es `contains` sobre texto, y
   * un teléfono buscado con `contains` casaría trozos de otros números. Es el mismo criterio
   * que mantiene la IP fuera de `q` — un identificador se busca entero o no se busca.
   */
  @IsOptional()
  @IsString()
  phone?: string;

  /**
   * A1 — «la última IP de su dueño está en la lista de marcadas».
   *
   * Es el eje que hace que la lista de IPs sirva para algo: sin él, el aviso sólo se vería
   * abriendo fichas de una en una. Molde de `hasReports`: tres posiciones, y `false` es la
   * pregunta contraria.
   *
   * Se resuelve DERIVANDO —`lastOwnerIp IN (lista)`— y no contra ninguna tabla, así que
   * quitar una IP de la lista deja de traer sus anuncios **al instante**.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  ipFlagged?: boolean;

  /**
   * PROVINCIA y MUNICIPIO del anuncio (`Listing.province` / `Listing.city`).
   *
   * PARÁMETROS PROPIOS Y NO DENTRO DE `q`, y es la decisión de este bloque: «anuncios **DE**
   * Toledo» y «anuncios que **MENCIONAN** Toledo» son preguntas distintas. Metiendo `city` en
   * el buscador de texto, buscar una palabra que además es un topónimo devolvería un
   * revoltijo de las dos y no habría forma de pedir sólo una.
   *
   * `contains` insensible y no igualdad exacta: los dos campos son **texto libre que teclea
   * el vendedor**, así que exacto fallaría con cualquier variante. Y parcial es además más
   * útil — «Alcalá» trae Alcalá de Henares y Alcalá de Guadaíra, que es lo que quiere quien
   * lo escribe.
   */
  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  city?: string;

  // Rangos de fecha. Molde de nombres: `ListAdminTransactionsDto.dateFrom/dateTo`.
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @IsOptional()
  @IsISO8601()
  updatedFrom?: string;

  @IsOptional()
  @IsISO8601()
  updatedTo?: string;

  /**
   * MODERACIÓN M3 — orden de la lista. Omitido = el de siempre (`updatedAt desc`,
   * lo más reciente arriba), así que `/admin/anuncios` no cambia.
   *
   * `oldest` existe para LA COLA DE REVISIÓN: una cola que enseña lo más nuevo
   * primero entierra al que lleva más tiempo esperando, que es justo el que más
   * urge. En un listado de administración «lo último que se movió» es lo útil; en
   * una cola de trabajo, lo es «lo que lleva más tiempo parado».
   *
   * FICHA F2 — los ejes nuevos se AÑADEN a esos dos, que conservan su valor y su
   * significado: la cola sigue pidiendo `oldest` y sigue recibiendo lo mismo.
   * Sólo entran ejes con una pregunta detrás (ver §2.4 del diseño): no hay orden
   * alfabético —nadie ordena un backoffice por título para trabajar— ni por
   * distancia, que es de `/busqueda`.
   */
  @IsOptional()
  @IsEnum([
    'recent',
    'oldest',
    'created-desc',
    'created-asc',
    'price-desc',
    'price-asc',
    'reports-desc',
  ])
  order?:
    | 'recent'
    | 'oldest'
    | 'created-desc'
    | 'created-asc'
    | 'price-desc'
    | 'price-asc'
    | 'reports-desc';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 24;
}
