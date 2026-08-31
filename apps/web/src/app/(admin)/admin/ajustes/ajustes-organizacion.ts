/**
 * AJUSTES RÁFAGA A — QUÉ AJUSTES HAY, CÓMO SE LLAMAN, QUÉ HACEN Y EN QUÉ ORDEN SE LEEN.
 *
 * MÓDULO PROPIO Y NO CONSTANTES DENTRO DE `page.tsx`, molde exacto de `entradas-inertes.ts`
 * (su vecino): son DATOS puros, sin JSX y sin `'use client'`, y sacarlos aquí es lo que
 * permite que un test los mire sin montar la página entera —que arrastra `next-auth`, el
 * cliente de la API y siete editores—.
 *
 * Y hace falta que alguien los mire. Este fichero es la respuesta a un defecto real: la
 * página llevaba dos ajustes MUERTOS y cuatro descripciones que decían cosas que el código
 * no hacía, y **nada podía notarlo** porque no había nada que lo comprobara. El test de al
 * lado cierra el caso barato y frecuente: que un ajuste nuevo entre en un grupo y se quede
 * sin título o sin descripción, es decir, mudo. Ver docs/auditoria-ajustes-backoffice.md.
 */

export const SETTING_TITLES: Record<string, string> = {
  badWordList: 'Lista de palabras prohibidas',
  listingExpiryDays: 'Caducidad de anuncios',
  contactRequiresVerification: 'Verificación para contacto',
  freeActiveListingLimit: 'Límite de anuncios activos (Free)',
  proActiveListingLimit: 'Límite de anuncios activos (Pro)',
  freeTotalListingLimit: 'Límite TOTAL de anuncios (Free)',
  proTotalListingLimit: 'Límite TOTAL de anuncios (Pro)',
  totalListingLimitEnabled: 'Aplicar el límite total de anuncios',
  emailVerifiedToPublishEnabled: 'Exigir correo verificado para publicar',
  maxPhotosPerListing: 'Máximo de fotos por anuncio',
  minPhotosPerListing: 'Mínimo de fotos para publicar',
  minPhotosRuleEnabled: 'Exigir el mínimo de fotos',
  preModerationAllListings: 'Revisar TODOS los anuncios antes de publicarlos',
  preModerationTrustedExempt: 'Los vendedores de confianza se saltan la revisión general',
  detectionModes: 'Qué hace cada detector de contenido',
  flaggedIps: 'IPs marcadas para vigilancia',
  flaggedPhones: 'Teléfonos marcados',
  proMonthlyFeaturedQuota: 'Cuota mensual de destacados (Pro)',
  proQuotaFeaturedDurationDays: 'Duración del destacado por cuota (Pro)',
  proExtraCreditsPercent: 'Bonus de créditos al comprar packs (Pro)',
  proMonthlyBumpQuota: 'Cuota mensual de bumps (Pro)',
  proExtraBumpsPercent: 'Bonus de bumps al comprar packs de bumps (Pro)',
  maxTagsPerListing: 'Máximo de tags por anuncio',
  // ENCENDER EL VÍDEO — los cuatro interruptores que el backend ya aceptaba y esta página
  // no pintaba. Ver docs/auditoria-pro-video.md §2.0.
  videoEnabled: 'Vídeo en los anuncios (ventaja Pro)',
  attributeRevalidationEnabled: 'Marcar los anuncios que dejan de cumplir su categoría',
  bumpAutoEnabled: 'Bump automático (programaciones)',
  maxBumpSchedulesPerUser: 'Máximo de programaciones de bump por usuario',
  supportEmail: 'Buzón de soporte',
  ticketAutoCloseWindowDays: 'Ventana de reapertura y cierre de tickets',
  // AJUSTES RÁFAGA A — los cuatro huérfanos. Existían y se leían desde hace ráfagas;
  // lo único que no existía era una forma de tocarlos que no fuera un UPDATE a mano.
  messageEmailGraceMinutes: 'Espera antes del correo de mensaje sin leer',
  defaultSuspensionDays: 'Duración por defecto de una suspensión',
  fiscalSelfServiceWindow: 'Ventana de autoservicio de facturas',
  fiscalInvoicingPeriodicity: 'Periodicidad de la facturación automática',
  // AJUSTES RÁFAGA A — los cuatro de monetización se mudan aquí desde su propio mapa.
  // Dos sitios donde buscar el título de un ajuste es como acaban divergiendo (este repo
  // ya pagó ese precio con las etiquetas de ReportReason).
  bumpCreditCost: 'Coste de subir un anuncio',
  featuredCreditCost7d: 'Coste del destacado — 7 días',
  featuredCreditCost14d: 'Coste del destacado — 14 días',
  featuredCreditCost30d: 'Coste del destacado — 30 días',
};

export const SETTING_DESCRIPTIONS: Record<string, string> = {
  badWordList:
    'Palabras o frases que activan la revisión manual de un anuncio. Si alguna aparece en el título o la descripción, el anuncio pasa a "En revisión" en lugar de publicarse directamente — y desde ahora eso vale también cuando su dueño EDITA un anuncio ya publicado, que puede volver a la cola. Se casan palabras enteras: «estafa» no salta con «estafador». Se admiten frases con espacios y entradas con símbolos, y la puntuación no tiene que coincidir: «100%-garantizado» encuentra «100 % garantizado». Ojo: para IPs y teléfonos no hace falta escribir nada aquí — tienen sus propios detectores, más abajo.',
  listingExpiryDays:
    'Días que un anuncio permanece publicado antes de caducar solo. ⚠ NO ES RETROACTIVO, y es la ' +
    'parte que importa: la fecha de caducidad se calcula al publicar y se guarda en el anuncio, así ' +
    'que cambiar este número afecta ÚNICAMENTE a los que se publiquen, renueven, reactiven o se ' +
    'aprueben a partir de ahora. Los que ya están vivos conservan el vencimiento con el que ' +
    'nacieron. Al caducar, el anuncio pasa a EXPIRED y sale del marketplace; su dueño recibe un ' +
    'preaviso 7 días antes (ese preaviso es fijo, no se configura), así que por debajo de una ' +
    'semana se avisaría casi al publicar. Rango sensato: 15-180 días.',
  contactRequiresVerification:
    'Si está activado, quien no haya verificado su correo NO puede abrir una conversación nueva con ' +
    'un vendedor: recibe un aviso que le dice que verifique. Sólo frena ABRIR hilos nuevos — quien ' +
    'ya tenga conversaciones puede seguir leyéndolas y respondiendo, y el vendedor contesta con ' +
    'normalidad. Publicar no se toca (eso lo decide «Exigir correo verificado para publicar»).',
  freeActiveListingLimit:
    'Cuántos anuncios puede tener PUBLICADOS a la vez un usuario del plan gratuito. Al llegar al ' +
    'tope, publicar o reactivar otro SE RECHAZA con un aviso que le ofrece Pro (sólo si el tope de ' +
    'Pro es de verdad mayor). No se despublica nada de lo que ya esté activo. El propio anuncio ' +
    'cuenta al renovarlo, así que renovar justo en el tope falla — es el comportamiento de siempre. ' +
    'Tiene un segundo efecto en otro momento: cuando una suscripción Pro caduca, los anuncios ' +
    'activos del ex-Pro que pasen de este número se guardan como borrador, los más antiguos ' +
    'primero. El staff está exento: un moderador puede aprobar por encima del cupo del vendedor.',
  proActiveListingLimit:
    'Lo mismo para un usuario con plan Pro: al llegar al tope, publicar otro se rechaza. A un Pro no ' +
    'se le ofrece nada más, así que su aviso se queda en el motivo a secas. Debe ser mayor que el ' +
    'de Free, o /planes acabaría anunciando como ventaja algo que el plan gratuito ya da igual o mejor.',
  freeTotalListingLimit:
    'Cuántos anuncios puede TENER en total un usuario Free, estén publicados o no: cuenta borradores, en revisión, activos, reservados, pausados, caducados y rechazados. NO cuentan los archivados ni los vendidos, así que archivar o marcar como vendido libera hueco. Es distinto del límite de activos: aquel limita el escaparate y este la acumulación. Tiene que ser mayor que el de activos — el backend rechaza el cambio si no lo es.',
  proTotalListingLimit:
    'Lo mismo para un usuario Pro. Tiene que ser mayor que el límite de activos de Pro.',
  maxPhotosPerListing:
    'Cuántas fotos admite como máximo un anuncio. Antes era un número fijo en el código (15); ahora se puede cambiar sin desplegar. Bajarlo NO toca los anuncios ya publicados con más fotos: sólo impide guardar tantas a partir de ahora.',
  minPhotosPerListing:
    'Cuántas fotos hacen falta como mínimo para PUBLICAR. Sólo se aplica si el interruptor de abajo está encendido. No puede superar al máximo — el backend rechaza esa combinación, porque dejaría el sistema pidiendo algo imposible.',
  minPhotosRuleEnabled:
    'El asistente de publicación lleva desde siempre diciendo «se necesita al menos 1 foto» y deshabilitando su botón sin ellas, pero el servidor no lo exigía: por «Mis anuncios» o por la API se podía publicar un anuncio sin ninguna. Encender esto alinea el servidor con lo que la interfaz ya promete. Sólo afecta a PUBLICAR: crear y editar borradores sin fotos sigue permitido, y los anuncios ya publicados no se tocan (renovar y reactivar tampoco lo miran).',
  preModerationTrustedExempt:
    'Sólo tiene efecto con la revisión de plataforma encendida. Apagado (por defecto), «revisar todos» significa TODOS, incluidos los vendedores con la insignia de confianza. Encendido, esa insignia pasa a eximir de la revisión GENERAL — y ojo: hoy la insignia es puramente decorativa, así que al encender esto los vendedores marcados hace meses quedan exentos sin que nadie lo haya decidido para ellos. NUNCA exime de las marcas específicas: una categoría que exige revisión, o un vendedor marcado para revisión, se revisan igual.',
  preModerationAllListings:
    'MODERACIÓN PREVIA, nivel plataforma. Encendido, TODO anuncio nuevo queda «en revisión» al publicarse y no se ve en el marketplace hasta que un moderador lo apruebe. ⚠ Es el más exigente de los tres niveles: a partir del clic, cada anuncio espera a un humano, así que enciéndelo sólo si hay alguien vaciando la cola. Para acotarlo a una parte del catálogo, marca «requiere revisión» en una categoría: se aplica a ella y a TODOS sus descendientes. Los anuncios ya publicados no se tocan.',
  flaggedPhones:
    'Teléfonos bajo vigilancia. Cuando un anuncio contiene uno de estos números —en el título, en la descripción O en su campo de teléfono— el equipo lo ve señalado. Da igual el formato: «654 123 456» encuentra al que lo escribió como «+34654123456». ⚠ Hoy sólo MARCA, no despublica; se puede cambiar a «Bloquear» en el ajuste de detectores, más abajo. Ojo con la diferencia entre los dos avisos de teléfono: «Teléfono en el texto» salta con CUALQUIER número escrito fuera de su campo (es evasión, y se equivoca a menudo — cualquier referencia de nueve dígitos lo parece), mientras que éste salta sólo con los que hayas puesto aquí.',
  flaggedIps:
    'Direcciones IP bajo vigilancia. Cuando la ÚLTIMA conexión de un usuario, o la última gestión de un anuncio, viene de una de estas IPs, el equipo lo ve señalado en las fichas y puede filtrar por ello en las listas. ⚠ Marcar una IP NO bloquea a nadie: no despublica anuncios ni suspende cuentas, sólo señala para que alguien lo mire. Se decidió así por dos motivos: la IP que se anota puede estar falsificada mientras no se verifique la topología del proxy, y además se anota en CADA gestión del dueño (también al subir un anuncio, que no toca el contenido). Quitar una IP de la lista des-señala al instante todo lo que marcaba, sin dejar rastro que limpiar.',
  detectionModes:
    'El motor busca TRES cosas en el título y la descripción de cada anuncio: palabras de la lista de arriba, teléfonos escritos en el texto (cualquiera) y teléfonos de la lista de marcados (sólo los que hayas puesto tú). El detector de direcciones IP en el texto se retiró — las IPs se vigilan por su propia lista, más abajo, y sobre la última conexión en vez del texto. Aquí se decide qué pasa cuando encuentra algo. ⚠ Poner un detector en «Bloquear» tiene consecuencias para los vendedores: el anuncio pasa a «En revisión» al publicarse Y al editarse, así que uno ya publicado puede volver a la cola por una edición. Antes de ascender un detector, mira en cuántos anuncios está disparando y abre unos cuantos: los de IP y teléfono se equivocan (una IP es legítima en un anuncio de router, y cualquier referencia de nueve dígitos parece un teléfono). Ojo también con el teléfono: el anuncio TIENE un campo propio para publicarlo, que sólo se ve tras iniciar sesión — lo que este detector marca es que está escrito fuera de su sitio, no que publicarlo esté prohibido.',
  emailVerifiedToPublishEnabled:
    'Mientras esté apagado, un usuario con el correo sin verificar publica como siempre. Al encenderlo, NO se rechaza nada ni se pierde ningún anuncio: quien intente publicar sin haber verificado su correo se encuentra el anuncio guardado como BORRADOR y un aviso con el enlace para verificar. Crear y redactar siguen siendo libres — sólo se frena el paso al mercado, y en cuanto verifique podrá publicarlo. No afecta a los anuncios que ya están publicados.',
  totalListingLimitEnabled:
    'Mientras esté apagado, los dos límites totales de arriba NO se aplican: se pueden configurar y dejar preparados sin que nadie se vea frenado. Al encenderlo, un usuario que ya esté por encima de su tope NO pierde ningún anuncio; simplemente no podrá crear otro hasta bajar archivando o vendiendo. El freno actúa al CREAR, no al publicar.',
  proMonthlyFeaturedQuota:
    'Destacados gratuitos que un usuario Pro puede usar cada mes. Se renuevan en el aniversario del ciclo de su suscripción; los no usados no se acumulan al mes siguiente.',
  proQuotaFeaturedDurationDays:
    'Duración fija (en días) de un destacado pagado con la cuota gratuita de Pro. Al pagar con créditos, el usuario elige la duración (7/14/30 días); la cuota siempre usa esta duración fija.',
  proExtraCreditsPercent:
    'Porcentaje de créditos extra que recibe un usuario Pro al comprar un pack de créditos, sobre el mismo precio que paga cualquier usuario (no es un descuento en euros). Se congela en cada compra: cambiar este valor no afecta a compras ya realizadas.',
  proMonthlyBumpQuota:
    'Bumps gratuitos que un usuario Pro puede usar cada mes. Mismo periodo que la cuota de destacados (una sola suscripción por usuario); se renuevan en el aniversario del ciclo, los no usados no se acumulan. Se consumen ANTES que el saldo de bumps por cupón y que los créditos.',
  proExtraBumpsPercent:
    'Porcentaje de bumps extra que recibe un usuario Pro al comprar un pack de bumps, sobre el mismo precio que paga cualquier usuario. Setting independiente del bonus de créditos (proExtraCreditsPercent) — beneficios distintos, calibrables por separado. Se congela en cada compra: cambiar este valor no afecta a compras ya realizadas.',
  maxTagsPerListing:
    'Cuántas etiquetas puede llevar como máximo un anuncio. Los tags se configuran por categoría (catálogo en Tags, asignación en Categorías) y el usuario elige entre los que su categoría ofrece; este número es el tope de cuántos puede marcar. Subirlo no afecta a los anuncios ya publicados con menos.',
  videoEnabled:
    'Permite a los vendedores Pro añadir un vídeo corto a sus anuncios (MP4, máximo 60 segundos y 50 MB). ⚠ Nace APAGADO a propósito, y encenderlo es una decisión de coste: desde el primer vídeo la plataforma paga almacenamiento y ancho de banda cada vez que alguien le da al play. Mientras esté apagado, la sección de vídeo no existe para nadie —ni siquiera para un Pro— y el servidor rechaza cualquier subida. Apagarlo después NO borra nada: los vídeos ya subidos dejan de ofrecerse, y vuelven si se reenciende.',
  attributeRevalidationEnabled:
    'Cuando un administrador cambia los atributos de una categoría, los anuncios que ya estaban publicados pueden dejar de cumplirla. Encendido, esos anuncios quedan MARCADOS y su dueño ve qué tiene que corregir. ⚠ Es la única regla capaz de señalar anuncios publicados hace años sin que su dueño haya tocado nada, así que antes de encenderla conviene mirar a cuántos afecta con `pnpm gate-impact-report`. Apagada, el mecanismo sigue marcando y avisando por dentro — que es lo que hace que encenderla no sea a ciegas.',
  bumpAutoEnabled:
    'Interruptor de emergencia del bump automático. Encendido (por defecto), el cron ejecuta las programaciones de bump que los usuarios hayan dejado puestas. ⚠ Es la única función que gasta dinero de los usuarios de forma DESATENDIDA, así que este interruptor existe para poder pararla sin desplegar. Apagarlo detiene el cron pero NO borra ninguna programación: al reencender, siguen donde estaban.',
  maxBumpSchedulesPerUser:
    'Cuántas programaciones de bump ACTIVAS puede tener a la vez un mismo usuario. Bajarlo no cancela las que ya existan: sólo impide crear más a quien esté en su tope.',
  supportEmail:
    'Dirección única a la que llegan los avisos por correo de los tickets de soporte. No es un reparto por administrador: es un buzón compartido. Si se deja vacío, el aviso in-app al staff se sigue creando y solo se omite el correo.',
  ticketAutoCloseWindowDays:
    'Días que un ticket resuelto admite reapertura por parte del usuario y, pasados los cuales, se cierra automáticamente. Es UN SOLO valor para las dos cosas a propósito: si divergieran habría un limbo entre "ya no puedo reabrir" y "aún no me han cerrado".',

  // ─── AJUSTES RÁFAGA A — los cuatro costes en créditos ────────────────────────
  //
  // Estaban en un mapa aparte y decían la mitad: el número de aquí es el PRECIO BASE,
  // no lo que se le cobra al usuario. Escritas leyendo el cobro real (billing.service).
  bumpCreditCost:
    'Créditos que cuesta un bump manual. Es el PRECIO BASE: si hay una campaña de descuento de ' +
    'bumps activa se cobra menos (el redondeo va a favor del usuario), y un Pro con cuota mensual ' +
    'de bumps o con saldo de bumps por cupón no gasta créditos en absoluto — esas bolsas se ' +
    'consumen antes que el saldo. Cambiarlo afecta al instante siguiente; los bumps ya cobrados no ' +
    'se recalculan.',
  featuredCreditCost7d:
    'Créditos que cuesta destacar un anuncio 7 días pagando con saldo de créditos. No es el precio ' +
    'en euros (ése está en «Precios (Redsys)», al final del grupo): son dos monedas para el mismo ' +
    'producto y conviene mirarlas juntas. Los tres importes deben guardar una proporción coherente ' +
    'entre sí — un destacado de 30 días más barato que el de 7 sería comprable a trozos.',
  featuredCreditCost14d:
    'Créditos que cuesta destacar un anuncio 14 días pagando con saldo de créditos. Ver la nota de ' +
    'coherencia entre las tres duraciones en el de 7 días.',
  featuredCreditCost30d:
    'Créditos que cuesta destacar un anuncio 30 días pagando con saldo de créditos. Ver la nota de ' +
    'coherencia entre las tres duraciones en el de 7 días.',

  // ─── AJUSTES RÁFAGA A — los cuatro huérfanos ─────────────────────────────────
  //
  // Cada descripción está escrita leyendo SU LECTOR, no la intención: es la regla que
  // esta ráfaga viene a instaurar (las cuatro que mentían nacieron de lo contrario).
  messageEmailGraceMinutes:
    'Minutos que la plataforma espera antes de avisar por correo de un mensaje sin leer. Si el ' +
    'destinatario abre la conversación dentro de esa ventana, el correo NO se manda: sólo avisa a ' +
    'quien de verdad no lo ha visto. Subirlo reduce correos y retrasa el aviso; bajarlo hace lo ' +
    'contrario. Afecta sólo a los mensajes que lleguen a partir del cambio — los avisos ya ' +
    'programados salen con la ventana antigua. Rango sensato: 5-60 minutos.',
  defaultSuspensionDays:
    'Días que dura una suspensión cuando el moderador no indica una duración. ⚠ Sin configurar, esa ' +
    'suspensión es INDEFINIDA —lo que ha hecho siempre el botón «Suspender»—, así que poner aquí un ' +
    'número cambia el efecto de un botón que el equipo ya usa a diario. No toca ninguna suspensión ' +
    'en curso. Para volver al comportamiento indefinido no basta con poner 0 (el backend lo ' +
    'rechaza): hay que borrar la fila del ajuste. Rango sensato: 3-30 días.',
  fiscalSelfServiceWindow:
    'Cuántos meses atrás puede un usuario pedirse una factura por su cuenta, contados sobre la fecha ' +
    'de la OPERACIÓN, no la del pago. Fuera de esa ventana tiene que pedirla al soporte. Bajarlo ' +
    'cierra la puerta a operaciones antiguas de inmediato, pero no invalida ninguna factura ya ' +
    'emitida. El valor por defecto (6 meses) es provisional: el plazo fiscalmente correcto lo ' +
    'confirma el asesor.',
  fiscalInvoicingPeriodicity:
    'Cada cuánto emite facturas el proceso automático: trimestral (por defecto) o mensual. El cron se ' +
    'despierta a diario de madrugada y pregunta si hay algún periodo CERRADO sin facturar; con ese ' +
    'diseño, cambiar la periodicidad puede disparar la emisión de los periodos del nuevo calendario ' +
    'que aún no se hayan facturado. ⚠ No lo cambies a mitad de un ejercicio sin hablarlo con el ' +
    'asesor: la periodicidad de facturación es una decisión fiscal, no una preferencia.',
};

//
// ANTES: 29 tarjetas en una lista PLANA, ordenadas por un array cuyos comentarios
// explicaban la agrupación… que no se veía en ninguna parte. Los grupos existían en
// la cabeza de quien escribió el orden y no en la pantalla, así que encontrar un
// ajuste era recorrer 29 tarjetas iguales.
//
// EL ORDEN ENTRE GRUPOS es frecuencia de uso × urgencia: primero lo que se toca en
// una incidencia, al final lo que se toca una vez al montar la instancia. Por eso
// «Bump automático» tiene grupo propio en vez de vivir dentro de Monetización: es el
// freno de mano de la única función que gasta saldo de los usuarios sin que estén
// delante, y en una incidencia hay que encontrarlo en dos segundos.
//
// EL ORDEN DENTRO DE CADA GRUPO no es cosmético en dos sitios: los cuatro límites de
// anuncios van juntos y en ese orden porque el backend valida la invariante
// `total > activos` en las dos direcciones, y el par de fotos porque valida
// `min <= max`. Separarlos invitaría a editar uno y comerse un 400 sin entender por qué.
// Los interruptores van SIEMPRE debajo de los números que gobiernan.
//
// Ver docs/auditoria-ajustes-backoffice.md §4.

export interface GrupoDeAjustes {
  id: string;
  titulo: string;
  /** Una línea que dice de qué van los ajustes de dentro. No repite lo que ya dicen ellos. */
  resumen: string;
  keys: readonly string[];
}

export const GRUPOS: readonly GrupoDeAjustes[] = [
  {
    id: 'moderacion',
    titulo: 'Moderación y contenido',
    resumen:
      'Qué se revisa antes de publicarse y qué vigila la plataforma. Es lo que se toca durante una incidencia.',
    keys: [
      'preModerationAllListings',
      'preModerationTrustedExempt',
      'detectionModes',
      'badWordList',
      'flaggedPhones',
      'flaggedIps',
    ],
  },
  {
    id: 'anuncios',
    titulo: 'Publicación y límites de anuncios',
    resumen:
      'Cuántos anuncios cabe tener, con cuántas fotos y etiquetas, cuánto duran y qué se exige para publicarlos.',
    keys: [
      'freeActiveListingLimit',
      'proActiveListingLimit',
      'freeTotalListingLimit',
      'proTotalListingLimit',
      'totalListingLimitEnabled',
      'maxPhotosPerListing',
      'minPhotosPerListing',
      'minPhotosRuleEnabled',
      'maxTagsPerListing',
      'listingExpiryDays',
      'emailVerifiedToPublishEnabled',
      'attributeRevalidationEnabled',
    ],
  },
  {
    id: 'pro',
    titulo: 'Ventajas Pro y cuotas',
    resumen: 'Lo que un usuario recibe por estar suscrito: cuotas mensuales, bonus al comprar y vídeo.',
    keys: [
      'proMonthlyFeaturedQuota',
      'proQuotaFeaturedDurationDays',
      'proMonthlyBumpQuota',
      'proExtraCreditsPercent',
      'proExtraBumpsPercent',
      'videoEnabled',
    ],
  },
  {
    id: 'monetizacion',
    titulo: 'Monetización',
    resumen:
      'Qué cuesta cada cosa. Arriba en créditos, abajo en euros: son dos monedas para los mismos productos y se leen juntas.',
    keys: ['bumpCreditCost', 'featuredCreditCost7d', 'featuredCreditCost14d', 'featuredCreditCost30d'],
  },
  {
    id: 'bump-automatico',
    titulo: 'Bump automático',
    resumen:
      'El freno de mano de la única función que gasta saldo de los usuarios sin que estén delante, y su tope por usuario.',
    keys: ['bumpAutoEnabled', 'maxBumpSchedulesPerUser'],
  },
  {
    id: 'atencion',
    titulo: 'Atención al usuario',
    resumen: 'Cómo y cuándo se le escribe a la persona del otro lado, y cuánto duran sus plazos.',
    keys: [
      'supportEmail',
      'ticketAutoCloseWindowDays',
      'messageEmailGraceMinutes',
      'contactRequiresVerification',
      'defaultSuspensionDays',
    ],
  },
  {
    id: 'facturacion',
    titulo: 'Facturación',
    resumen:
      'Cuándo se emiten las facturas y hasta cuándo puede pedírselas un usuario. Los datos del emisor tienen su propia página.',
    keys: ['fiscalInvoicingPeriodicity', 'fiscalSelfServiceWindow'],
  },
];

/** Los valores del enum de periodicidad. Los MISMOS que valida `ENUM_SETTING_VALUES` en el backend. */
export const PERIODICIDAD_OPCIONES = [
  { value: 'QUARTERLY', label: 'Trimestral (por defecto)' },
  { value: 'MONTHLY', label: 'Mensual' },
] as const;
