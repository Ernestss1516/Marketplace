/**
 * AJUSTES RÁFAGA B — «CÓMO ESTÁ MONTADA ESTA INSTANCIA».
 *
 * La forma de `GET /admin/instance-info`: los datos de configuración de la instancia que un
 * administrador necesita CONFIRMAR, y ninguno más.
 *
 * ── PARA QUÉ EXISTE ───────────────────────────────────────────────────────────────────────
 *
 * Ernest se plantea desplegar esto en varios nichos. Lo que difiere entre despliegues —el
 * dominio, el remitente de los correos, el buzón de soporte, qué pasarela cobra y en qué
 * entorno, dónde están las imágenes— hoy sólo se puede confirmar entrando en el servidor a leer
 * un `.env`. Este panel lo contesta de un vistazo. Ver docs/auditoria-ajustes-backoffice.md §6.
 *
 * ── LA BARRERA, Y ES INNEGOCIABLE: AQUÍ NUNCA VIAJA UN SECRETO ────────────────────────────
 *
 * **El objeto se construye CAMPO A CAMPO** en `InstanceInfoService`. Nunca un `process.env`
 * entero, nunca un spread, nunca un «filtro de claves sensibles». La diferencia no es de estilo:
 * con una lista explícita, **una variable nueva en el `.env` no aparece sola** en la respuesta;
 * con un filtro, un día aparece — y el día que aparece nadie se entera.
 *
 * **De toda credencial se publica el HECHO, nunca el valor**: `configurado: true|false`. Ni
 * siquiera un fragmento. Un «re_ab…3f9» no es público por ser parcial, y no le sirve a nadie
 * para confirmar nada que el booleano no confirme ya.
 *
 * Lo que NUNCA puede aparecer aquí está enumerado en §6.3 de la auditoría —`DATABASE_URL`
 * (lleva la contraseña dentro de la cadena), `REDIS_URL`, `TRUST_PROXY_HOPS` (le diría a un
 * atacante cuántos `X-Forwarded-For` puede falsificar) y todos los secretos— y hay un test que
 * lo comprueba sobre la respuesta REAL: `test/instance-info.e2e-spec.ts`. Ese test es la mitad
 * de esta barrera; escribirlo una vez protege de que alguien añada un campo de más dentro de un
 * año.
 *
 * ── LO QUE NO SE INVENTA ──────────────────────────────────────────────────────────────────
 *
 * Tres datos no existen y **se dicen como no existentes**, en vez de rellenarlos con algo
 * verosímil: el correo de contacto público (no hay tal cosa: los mensajes de `/contacto` van a
 * una tabla), el tipo de IVA global (no hay: el IVA es por línea de factura) y el commit
 * desplegado (no hay inyección de `GIT_SHA` todavía). Un panel de confirmación que inventa un
 * dato es peor que no tener panel.
 *
 * ── LO QUE ESTE OBJETO NO TRAE, Y POR QUÉ ─────────────────────────────────────────────────
 *
 * Cuatro de los datos del panel son constantes de BUILD DEL FRONTEND (`SITE_NAME`,
 * `SITE_DESCRIPTION`, `NEXT_PUBLIC_API_URL`, `DEFAULT_CURRENCY`, en
 * `apps/web/src/config/index.ts`). **El backend no las conoce y no debe conocerlas**: copiarlas
 * aquí crearía dos fuentes para el mismo valor, que es como acaban divergiendo. La página las
 * lee de su propio módulo de configuración y las pinta junto a éstas. El panel enseña los 22;
 * lo que cambia es de dónde sale cada uno.
 */

/** Una credencial: se publica el hecho de estar configurada, jamás su valor. */
export interface CredencialConfigurada {
  configurado: boolean;
}

export interface InstanceInfo {
  /** Bloque A — identidad. Lo que dice QUÉ instancia es ésta. */
  identidad: {
    /** `APP_URL`. El origen del CORS del WebSocket y la base de los enlaces de todo correo. */
    appUrl: string;
    /** `NODE_ENV`. La pregunta que precede a cualquier cambio: ¿esto es producción? */
    entorno: string;
  };

  /** Bloque B — los correos. El corazón del encargo. */
  correos: {
    /**
     * `RESEND_FROM`. OJO al defecto: `noreply@tudominio.es` es un PLACEHOLDER con pinta de
     * dominio real, así que una instancia que no lo defina manda desde él sin que nadie lo note.
     * `esPlaceholder` lo dice para que la pantalla pueda avisar.
     */
    remitente: { direccion: string; esPlaceholder: boolean };
    /**
     * `Setting.supportEmail`. Sin configurar, los avisos de ticket NO salen por correo y sólo
     * queda un warning en el log que no lee nadie. `null` = sin configurar.
     */
    buzonSoporte: string | null;
    /** Proveedor de envío. El nombre es fijo; de la clave, sólo el hecho. */
    proveedor: { nombre: string } & CredencialConfigurada;
    /**
     * NO APLICA, y se dice: no existe un correo de contacto público. Los mensajes de `/contacto`
     * se guardan en `ContactMessage` y los motivos (`ContactReason`) no llevan destinatario.
     */
    contactoPublico: null;
  };

  /** Bloque C — qué proveedor hace cada cosa en esta instancia. */
  proveedores: {
    /**
     * `INVOICING_PROVIDER`. **El dato más valioso del panel.** Hoy sólo existe `stub`, y el stub
     * NO emite facturas fiscalmente válidas — `emiteFacturasValidas` es el hecho de negocio que
     * la pantalla pinta en ámbar. Se calcula aquí, no en la UI: qué proveedor es homologado es
     * conocimiento del backend.
     */
    facturacion: { proveedor: string; emiteFacturasValidas: boolean };
    /**
     * `Setting.fiscalIssuer`. Sin NIF y razón social no se emite NINGUNA factura, y es un fallo
     * silencioso hasta que alguien pide una. Se publica la razón social (dato público de
     * cualquier factura), nunca el resto de la ficha.
     */
    emisorFiscal: { configurado: boolean; razonSocial: string | null };
    /** Stripe — sólo la suscripción Pro (recurrente). Del secreto, el booleano. */
    pagoRecurrente: { nombre: string } & CredencialConfigurada;
    /**
     * Redsys — packs de créditos, destacados y bumps (pago único).
     *
     * `comercio` y `terminal` NO son secretos (el código de comercio lo asigna el banco y viaja
     * en cada formulario de pago); la clave de firma HMAC **jamás**, sólo su booleano.
     *
     * `cobrosReales` es el hecho que importa: con `REDSYS_ENVIRONMENT` distinto de `production`
     * se está cobrando contra el TPV de PRUEBAS. Es exactamente el error que un panel de
     * confirmación existe para atrapar.
     */
    pagoUnico: {
      nombre: string;
      comercio: string | null;
      terminal: string | null;
      entorno: string;
      cobrosReales: boolean;
    } & CredencialConfigurada;
    /** S3/R2/MinIO. El endpoint y el bucket distinguen «local» de «producción» de un vistazo. */
    almacenamiento: { endpoint: string | null; bucket: string | null; urlPublica: string | null };
    /** Meilisearch. El host y el ÍNDICE — el nombre del índice explica un «no encuentro nada». */
    busqueda: { host: string | null; indice: string };
    /** `GEOCODING_PROVIDER`. Nominatim va a 1 req/s: explica una cola lenta. */
    geocodificacion: { proveedor: string };
    /** Login social de Google. Sin él, el botón sale igual y no funciona. */
    loginGoogle: CredencialConfigurada;
    /** Sentry. «¿Me estoy enterando de los errores de esta instancia?» */
    observabilidad: CredencialConfigurada;
  };

  /** Bloque D — configuración con efecto, aquí sólo para confirmarla. */
  configuracion: {
    /**
     * LAS DOS ZONAS HORARIAS, Y JUNTAS PORQUE PUEDEN DISCREPAR. Los crons corren en la hora del
     * SERVIDOR; las programaciones de bump se interpretan en `Europe/Madrid`. Un servidor en UTC
     * hace que el cron de las 04:00 corra a las 06:00 peninsulares — es el dato que contesta
     * «¿por qué se facturó ayer?».
     */
    zonaHoraria: { programaciones: string; servidor: string; coinciden: boolean };
    /**
     * NO HAY UN TIPO DE IVA GLOBAL, y no se inventa uno: cada `InvoiceLine` lleva su `taxRate`.
     * Poner aquí un «21 %» sería fabricar una configuración que el código no tiene.
     */
    iva: { modo: 'por-linea-de-factura' };
    /** Los dos ajustes fiscales, en solo lectura. Se EDITAN en /admin/ajustes. */
    facturacion: { periodicidad: string; ventanaAutoservicioMeses: number };
    /**
     * Versión del backend. Sale de `npm_package_version`, que el gestor de paquetes define al
     * arrancar por script; `null` si se arrancó el `dist` a pelo. Se dice «no disponible» en vez
     * de fingir un número.
     */
    versionApi: string | null;
    /**
     * EL HUECO PREPARADO. Hoy NO hay inyección de `GIT_SHA` en el despliegue, así que esto es
     * `null` y la pantalla dice «no disponible». El día que el despliegue exporte `GIT_SHA`,
     * este campo se llena solo y no hay que tocar nada más — que es justo el motivo de dejarlo
     * puesto ahora y no «cuando haga falta».
     */
    commit: string | null;
  };
}
