import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCION_LABELS,
  CONDICION_LABELS,
  ESTADO_BUMP_LABELS,
  ESTADO_REPORTE_LABELS,
  ESTADO_PAGINA_LABELS,
  ESTADO_POST_LABELS,
  ESTADO_USUARIO_LABELS,
  MOTIVO_REPORTE_ANUNCIO_LABELS,
  MOTIVO_REPORTE_LABELS,
  MOTIVO_REPORTE_VALORACION_LABELS,
  MOVIMIENTO_CREDITO_ADMIN_LABELS,
  MOVIMIENTO_CREDITO_LABELS,
  ROL_LABELS,
  SUFIJO_UNIDAD_PRECIO,
  TIPO_ANUNCIO_PLURAL_LABELS,
  STATUS_LABELS,
  TIPO_ANUNCIO_LABELS,
  TIPO_PRECIO_LABELS,
  UNIDAD_PRECIO_LABELS,
  etiqueta,
  etiquetaDeEstado,
  ticketStatusLabel,
  // T3-B — ya no hay puente que atravesar: se importa del vecino, que es la fuente.
} from './etiquetas-enums';
import { ROLE_ORDER } from '@/config/roles';
import { existsSync, readdirSync, statSync } from 'node:fs';

/**
 * I18N T3-B — EL TEST SE MUDÓ CON LO QUE VALIDA.
 *
 * Vivía en `app/(admin)/admin/` porque el vocabulario vivía allí. Ya no: valida
 * `./etiquetas-enums.ts`, su vecino, y a él pertenece. Lo único que la mudanza obliga
 * a cambiar son las rutas de las barreras que leen el FUENTE de las pantallas, que
 * antes eran relativas al propio directorio del backoffice. Se nombran una vez aquí
 * para no repetir la cuenta de `..` en tres bloques.
 */
const SRC = join(__dirname, '..');
const ADMIN = join(SRC, 'app', '(admin)', 'admin');

/**
 * TRADUCCIONES — LA BARRERA.
 *
 * Sin esto, la mutación que este cuerpo tiene que matar («deja un campo pintando el
 * enum crudo») pasa en verde: no existía NI UN test que mirase esos catorce campos.
 * Los tres bloques atacan tres formas distintas de romperlo:
 *
 *   1. el vocabulario se queda corto (un valor del enum sin etiqueta);
 *   2. la caída se rompe (un valor desconocido desaparece de la pantalla);
 *   3. una ficha deja de llamar al vocabulario y vuelve a pintar el crudo.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. EL VOCABULARIO ESTÁ COMPLETO Y ESTÁ EN ESPAÑOL
// ─────────────────────────────────────────────────────────────────────────────
//
// ESPEJO api↔web, mismo criterio que `listing-triage.ts`: los valores viven en
// `apps/api/prisma/schema.prisma` y aquí sólo está la PRESENTACIÓN. Enumerarlos a
// mano es deliberado — es lo que hace que añadir un valor al enum en el backend sin
// darle etiqueta rompa CI en vez de aparecer en crudo en producción.
const ENUMS: Array<[string, Record<string, string>, string[]]> = [
  ['ListingType', TIPO_ANUNCIO_LABELS, ['PRODUCT', 'SERVICE']],
  ['Condition', CONDICION_LABELS, ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'FOR_PARTS']],
  ['PriceType', TIPO_PRECIO_LABELS, ['FIXED', 'FREE', 'NEGOTIABLE']],
  [
    'PriceUnit',
    UNIDAD_PRECIO_LABELS,
    ['ONE_TIME', 'PER_MONTH', 'PER_WEEK', 'PER_DAY', 'PER_HOUR', 'PER_UNIT', 'PER_SESSION'],
  ],
  [
    'ReportReason',
    MOTIVO_REPORTE_LABELS,
    ['SPAM', 'FRAUD', 'INAPPROPRIATE', 'PROHIBITED_ITEM', 'WRONG_CATEGORY', 'FAKE_REVIEW', 'OTHER'],
  ],
  ['ReportStatus', ESTADO_REPORTE_LABELS, ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED']],
  [
    'UserStatus',
    ESTADO_USUARIO_LABELS,
    ['ACTIVE', 'SUSPENDED', 'BANNED', 'ARCHIVED', 'DELETED'],
  ],
  ['Role', ROL_LABELS, ['USER', 'MODERATOR', 'EDITOR', 'ADMIN']],
  [
    'BumpScheduleStatus',
    ESTADO_BUMP_LABELS,
    ['ACTIVE', 'PAUSED_BY_USER', 'PAUSED_NO_FUNDS', 'PAUSED_LISTING_INACTIVE'],
  ],
  [
    'ListingStatus',
    STATUS_LABELS,
    [
      'DRAFT',
      'PENDING_REVIEW',
      'ACTIVE',
      'RESERVED',
      'SOLD',
      'EXPIRED',
      'REJECTED',
      'PAUSED',
      'ARCHIVED',
    ],
  ],
];

describe('el vocabulario cubre cada enum entero', () => {
  it.each(ENUMS.map(([nombre, mapa, valores]) => [nombre, mapa, valores] as const))(
    '%s: todos sus valores tienen etiqueta',
    (_nombre, mapa, valores) => {
      for (const valor of valores) {
        expect(mapa[valor]).toBeDefined();
      }
    },
  );

  it.each(ENUMS.map(([nombre, mapa]) => [nombre, mapa] as const))(
    '%s: no sobra ninguna clave (una etiqueta huérfana es una que ya no se pinta)',
    (_nombre, mapa) => {
      const declarados = ENUMS.find(([, m]) => m === mapa)![2];
      expect(Object.keys(mapa).sort()).toEqual([...declarados].sort());
    },
  );

  it.each(ENUMS.map(([nombre, mapa]) => [nombre, mapa] as const))(
    '%s: ninguna etiqueta es el propio valor crudo',
    (_nombre, mapa) => {
      // Es LA mutación del cuerpo, en su forma más barata: «traducir» escribiendo
      // `PRODUCT: 'PRODUCT'`. Con este test, no cuela.
      for (const [valor, texto] of Object.entries(mapa)) {
        expect(texto).not.toBe(valor);
      }
      // Y ninguna se quedó en SCREAMING_SNAKE, que es la misma trampa con otro
      // nombre (`PROHIBITED_ITEM: 'PROHIBITED ITEM'`).
      for (const texto of Object.values(mapa)) {
        expect(texto).not.toMatch(/^[A-Z][A-Z_ ]*$/);
      }
    },
  );

  it('el vocabulario de la auditoría cubre las acciones de las DOS fichas', () => {
    // La de anuncio lee las `LISTING_*` (resourceType Listing); la de usuario, las
    // `USER_*` y las de Pro (resourceType User). Estaban sólo las primeras, y por eso
    // la ficha de usuario pintaba `USER_ROLE_CHANGE` en crudo.
    for (const accion of [
      'LISTING_STATUS_CHANGE',
      'LISTING_APPROVE',
      'LISTING_REJECT',
      'LISTING_DEACTIVATE',
      'LISTING_RESTORE',
      'LISTING_DELETE',
      'LISTING_TRIAGE_CHANGE',
      'LISTING_EDIT',
      'USER_SUSPEND',
      'USER_BAN',
      'USER_REINSTATE',
      'USER_ROLE_CHANGE',
      'USER_TRUST',
      'USER_UNTRUST',
      'USER_REQUIRE_REVIEW',
      'USER_UNREQUIRE_REVIEW',
      'PRO_GRANT',
      'PRO_REVOKE',
    ]) {
      expect(ACCION_LABELS[accion]).toBeDefined();
      expect(ACCION_LABELS[accion]).not.toBe(accion);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LA COHERENCIA CON LO QUE EL REPO YA DICE
// ─────────────────────────────────────────────────────────────────────────────

describe('las etiquetas son las MISMAS que el resto del sitio ya usa', () => {
  it('los formatos de precio ya no tienen con qué divergir', () => {
    // AQUÍ SE COMPARABA CONTRA `PRICE_UNIT_LABELS` del wizard de publicar, que era la
    // otra copia: «si el wizard renombra Al mes, esta afirmación obliga a decidir aquí
    // también, en vez de divergir en silencio». Era lo mejor que se podía hacer
    // MIENTRAS hubiera dos.
    //
    // T3-B quitó la segunda: el wizard importa de aquí. Comparar dos referencias al
    // mismo objeto sería una afirmación que no puede fallar, así que lo que se vigila
    // ahora es lo único que aún puede romperse — que nadie vuelva a declararla allí.
    const wizard = readFileSync(
      join(SRC, 'components', 'publicar', 'steps', 'StepDatos.tsx'),
      'utf8',
    );
    expect(wizard).not.toMatch(/const PRICE_UNIT_LABELS/);
    expect(wizard).toContain("from '@/lib/etiquetas-enums'");
  });

  it('`FREE` y `NEGOTIABLE` dicen lo mismo que la cabecera de la propia ficha', () => {
    // `formatPrice` (listing-status.ts) pinta el precio de la cabecera con estas dos
    // palabras. Que el campo «Formato de precio» dijera otras dos sería la misma
    // ficha contradiciéndose a sí misma dos secciones más abajo.
    expect(TIPO_PRECIO_LABELS.FREE).toBe('Gratis');
    expect(TIPO_PRECIO_LABELS.NEGOTIABLE).toBe('A convenir');
  });

  it('el estado de anuncio NO se re-declara: sale de `listing-status.ts`', () => {
    // La ficha de usuario pintaba el crudo por no importarlo. La corrección tenía que
    // ser importarlo, no copiarlo: éste es el test de que se re-exporta el mismo
    // objeto y no una copia con las mismas palabras.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const original = require('@/app/(admin)/admin/anuncios/listing-status') as {
      STATUS_LABELS: unknown;
    };
    expect(STATUS_LABELS).toBe(original.STATUS_LABELS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LA CAÍDA — el enum crudo es el último recurso VISIBLE, nunca un fallo
// ─────────────────────────────────────────────────────────────────────────────

describe('la caída de `etiqueta()`', () => {
  it('un valor desconocido se pinta CRUDO, no vacío', () => {
    // La regla de `listing-status.ts:52-54`. Un `?? ''` haría que añadir un motivo de
    // denuncia en el backend BORRARA el motivo de la pantalla sin que nada fallase.
    expect(etiqueta(MOTIVO_REPORTE_LABELS, 'MOTIVO_FUTURO')).toBe('MOTIVO_FUTURO');
    expect(etiquetaDeEstado('ESTADO_FUTURO')).toBe('ESTADO_FUTURO');
  });

  it('ausencia de valor se pinta «—», como el resto de los campos de las fichas', () => {
    expect(etiqueta(CONDICION_LABELS, null)).toBe('—');
    expect(etiqueta(CONDICION_LABELS, undefined)).toBe('—');
    expect(etiqueta(CONDICION_LABELS, '')).toBe('—');
  });

  it('traduce lo que sí conoce', () => {
    expect(etiqueta(CONDICION_LABELS, 'LIKE_NEW')).toBe('Como nuevo');
    expect(etiqueta(TIPO_ANUNCIO_LABELS, 'SERVICE')).toBe('Servicio');
    expect(etiqueta(ROL_LABELS, 'MODERATOR')).toBe('Moderador');
  });

  it('`ticketStatusLabel` tolera un estado futuro en vez de reventar la ficha', () => {
    // Los tipos de `lib/api/admin.ts` declaran `status: string`, así que este valor
    // PUEDE llegar. Antes de este cuerpo la función indexaba sin `?.` y un valor
    // nuevo habría tumbado la ficha entera con un TypeError.
    expect(ticketStatusLabel('ESTADO_FUTURO')).toBe('ESTADO_FUTURO');
    expect(ticketStatusLabel('WAITING_USER')).not.toBe('WAITING_USER');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. LA BARRERA: NINGUNA DE LAS DOS FICHAS PINTA YA UN ENUM CRUDO
// ─────────────────────────────────────────────────────────────────────────────
//
// SE LEE EL FUENTE, y es deliberado — mismo criterio que `backoffice-sections.test.ts`
// cuando busca las rutas en disco («una lista escrita a mano aquí sería otra lista que
// olvidar»). Las dos fichas son componentes de página con `useSession`, `useParams` y
// fetch: montarlas para comprobar catorce cadenas costaría más que el cuerpo entero.
//
// Lo que fija es EXACTO: cada cadena prohibida es, literalmente, cómo estaba escrito
// ese campo antes. Revertir cualquiera de los catorce sitios la reintroduce y este
// test cae. No pretende impedir que alguien invente una forma nueva de pintar el
// crudo — pretende que la vuelta atrás no sea silenciosa.
describe('LA BARRERA — las fichas no vuelven a pintar el enum crudo', () => {
  const leer = (...ruta: string[]) => readFileSync(join(ADMIN, ...ruta), 'utf8');

  const FICHA_ANUNCIO = leer('anuncios', '[id]', 'page.tsx');
  const FICHA_USUARIO = leer('usuarios', '[id]', 'page.tsx');

  it('las dos fichas se leen (red del propio test)', () => {
    expect(FICHA_ANUNCIO.length).toBeGreaterThan(1000);
    expect(FICHA_USUARIO.length).toBeGreaterThan(1000);
  });

  it.each([
    ['Tipo', 'valor={data.type}'],
    ['Estado del artículo', "valor={data.condition ?? '—'}"],
    ['Formato de precio', '${data.priceType} · ${data.priceUnit}'],
    ['Motivo de la denuncia', '{r.reason}'],
    ['Estado de la denuncia', '{r.status}'],
    ['Estado del ticket', '{t.status}'],
    ['Estado del vendedor', 'valor={data.seller.status}'],
    ['Rol del vendedor', 'valor={data.seller.role}'],
    ['Bump programado', '${data.bumpSchedule.status} · cada'],
  ])('ficha de ANUNCIO — %s ya no se pinta crudo', (_campo, crudo) => {
    expect(FICHA_ANUNCIO).not.toContain(crudo);
  });

  it.each([
    ['Estado de cada anuncio', '{l.status}'],
    ['Motivo de la denuncia', '{r.reason}'],
    ['Estado de la denuncia', '{r.status}'],
    ['Estado del ticket', '{t.status}'],
    ['Acción del historial', '{h.action}'],
  ])('ficha de USUARIO — %s ya no se pinta crudo', (_campo, crudo) => {
    expect(FICHA_USUARIO).not.toContain(crudo);
  });

  it('y las dos importan el vocabulario, en vez de re-declararlo', () => {
    expect(FICHA_ANUNCIO).toContain("from '@/lib/etiquetas-enums'");
    expect(FICHA_USUARIO).toContain("from '@/lib/etiquetas-enums'");
    // `ACCION_LABELS` vivía dentro de la ficha de anuncio. Que ya no se declare ahí es
    // la mitad del arreglo: mientras fuera local, la ficha de usuario no podía usarlo.
    expect(FICHA_ANUNCIO).not.toContain('const ACCION_LABELS');
    expect(FICHA_USUARIO).not.toContain('const ROL_LABELS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. I18N T2 — LAS OTRAS CUATRO PANTALLAS DEL BACKOFFICE
// ─────────────────────────────────────────────────────────────────────────────
//
// El bloque 4 cubría LAS DOS FICHAS. La auditoría (`docs/auditoria-i18n-espanol.md`
// §4.2) encontró seis crudos MÁS, repartidos por cuatro pantallas que aquel cuerpo no
// miró: la LISTA de usuarios (no la ficha), la lista y la ficha de denuncias, y el
// libro mayor del admin.
//
// Y el diagnóstico es el mismo que en T1: **la traducción ya existía en los seis
// casos**. `ESTADO_REPORTE_LABELS`, `ticketStatusLabel` y `etiquetaDeEstado` llevaban
// escritos y probados desde la ráfaga de traducciones; lo que faltaba era la llamada.
// La lista de usuarios incluso IMPORTABA ya de `etiquetas.ts` — para otro campo.
//
// Se lee el fuente por la misma razón de siempre (son componentes de página con
// `useSession` + fetch), y cada cadena prohibida es LITERALMENTE cómo estaba escrito
// ese sitio antes de este cuerpo: revertirlo pone el test en rojo.
describe('LA BARRERA T2 — las otras cuatro pantallas tampoco pintan el enum crudo', () => {
  const leer = (...ruta: string[]) => readFileSync(join(ADMIN, ...ruta), 'utf8');

  const LISTA_USUARIOS = leer('usuarios', 'page.tsx');
  const LISTA_REPORTES = leer('reportes', 'page.tsx');
  const FICHA_REPORTE = leer('reportes', '[id]', 'page.tsx');
  const LIBRO_MAYOR = leer('facturacion', 'usuarios', '[id]', 'page.tsx');

  it('las cuatro pantallas se leen (red del propio test)', () => {
    for (const fuente of [LISTA_USUARIOS, LISTA_REPORTES, FICHA_REPORTE, LIBRO_MAYOR]) {
      expect(fuente.length).toBeGreaterThan(1000);
    }
  });

  // ── B1: los seis crudos ────────────────────────────────────────────────────

  it.each([
    ['D3 — estado de la denuncia', '{r.status}'],
    ['D7 — estado de cada anuncio', '{l.status}'],
  ])('LISTA de usuarios — %s ya no se pinta crudo', (_defecto, crudo) => {
    expect(LISTA_USUARIOS).not.toContain(crudo);
  });

  it('LISTA de denuncias — D4: el estado del hilo ya no se pinta crudo', () => {
    expect(LISTA_REPORTES).not.toContain('{r.tickets[0].status}');
    expect(LISTA_REPORTES).toContain('ticketStatusLabel(r.tickets[0].status)');
  });

  it.each([
    ['D5 — estado del hilo', 'Hilo {t.status}'],
    ['D6 — estado del anuncio denunciado', 'Estado: {data.listing.status}'],
  ])('FICHA de denuncia — %s ya no se pinta crudo', (_defecto, crudo) => {
    expect(FICHA_REPORTE).not.toContain(crudo);
  });

  // ── B2: D7 completo — 9 de 9, no 4 de 9 ────────────────────────────────────

  it('D7 — el ternario incompleto no vuelve', () => {
    // Cubría ACTIVE, PENDING_REVIEW, REJECTED y DRAFT, y dejaba los otros CINCO
    // cayendo al `: l.status` final. Un anuncio vendido salía «SOLD».
    expect(LISTA_USUARIOS).not.toContain(": 'Revisión'");
    expect(LISTA_USUARIOS).not.toContain(': l.status}');
    expect(LISTA_USUARIOS).toContain('etiquetaDeEstado(l.status)');
  });

  it('D7 — y el vocabulario que ahora llama cubre los NUEVE estados', () => {
    // La otra mitad: llamar a un diccionario incompleto no arreglaría nada. Los cinco
    // que el ternario NO cubría son los que hay que ver traducidos.
    for (const estado of ['SOLD', 'RESERVED', 'EXPIRED', 'PAUSED', 'ARCHIVED']) {
      expect(etiquetaDeEstado(estado)).not.toBe(estado);
    }
  });

  // ── B3: D8 — la clave que faltaba, y que no vuelva a faltar ────────────────

  it('D8 — el libro mayor tiene los OCHO movimientos, no siete', () => {
    // T3-B — el mapa dejó de vivir DENTRO de la pantalla, así que ya no se comprueba
    // ahí: se comprueba en el objeto, que es más fuerte. La pantalla sólo tiene que
    // llamarlo.
    expect(Object.keys(MOVIMIENTO_CREDITO_ADMIN_LABELS)).toHaveLength(8);
    expect(MOVIMIENTO_CREDITO_ADMIN_LABELS.COUPON_REDEEM).toBe('Cupón canjeado');
    expect(LIBRO_MAYOR).toContain('MOVIMIENTO_CREDITO_ADMIN_LABELS');
    expect(LIBRO_MAYOR).not.toMatch(/const LEDGER_TYPE_LABELS/);
  });

  it('D8 — y el mapa está tipado, así que el noveno no compilará sin etiqueta', () => {
    // Es LA diferencia entre arreglar este caso y arreglar la clase: con
    // `Record<string, string>` la clave se perdió en silencio cuando `COUPON_REDEEM`
    // entró en el enum. Molde: `PLACEMENT_LABELS`. El tipado se mudó con el mapa.
    const fuente = readFileSync(join(SRC, 'lib', 'etiquetas-enums.ts'), 'utf8');
    expect(fuente).toContain('MOVIMIENTO_CREDITO_ADMIN_LABELS: Record<CreditLedgerType, string>');
    // Y su gemelo del lado del usuario, que es la variante declarada.
    expect(fuente).toContain('MOVIMIENTO_CREDITO_LABELS: Record<CreditLedgerType, string>');
  });

  // ── B4: sin copia nueva ────────────────────────────────────────────────────

  it('las cuatro llaman al vocabulario compartido en vez de re-declararlo', () => {
    expect(LISTA_USUARIOS).toContain("from '@/lib/etiquetas-enums'");
    expect(LISTA_REPORTES).toContain("from '@/lib/etiquetas-enums'");
    expect(FICHA_REPORTE).toContain("from '@/lib/etiquetas-enums'");
  });

  it('la LISTA de usuarios ya no lleva su copia divergente de `ReportReason`', () => {
    // Era la tercera copia y la que la cabecera de este fichero señala como ya
    // divergida: sin `FAKE_REVIEW`, así que una denuncia de valoración se pintaba
    // «FAKE_REVIEW» aquí y «Valoración falsa» en las otras dos pantallas.
    expect(LISTA_USUARIOS).not.toContain('const REPORT_REASON_LABELS');
    expect(LISTA_USUARIOS).toContain('MOTIVO_REPORTE_LABELS');
    expect(MOTIVO_REPORTE_LABELS.FAKE_REVIEW).toBe('Valoración falsa');
  });

  it('ninguna de las cuatro re-declara un diccionario que ya existe aquí', () => {
    // La mutación que ningún test de pantalla puede ver: copiar el diccionario dentro
    // de la pantalla deja el render IDÉNTICO. Es la lección de T1 (barrera B4).
    //
    // Se busca la forma de DECLARACIÓN (`DISMISSED: '…'`), no el texto suelto: las
    // tres pantallas tienen chips de filtro con textos que coinciden a propósito
    // («En revisión» es a la vez la etiqueta del estado y la del filtro que lo
    // selecciona), y prohibir la cadena convertiría un acierto en un rojo.
    for (const [nombre, fuente] of [
      ['lista de usuarios', LISTA_USUARIOS],
      ['lista de denuncias', LISTA_REPORTES],
      ['ficha de denuncia', FICHA_REPORTE],
    ] as const) {
      // Dos claves distintivas por enum, las que no aparecen en ningún otro contexto.
      for (const clave of ['REVIEWING', 'DISMISSED', 'WAITING_USER', 'PENDING_REVIEW']) {
        const declara = new RegExp(`\\b${clave}:\\s*'`).test(fuente);
        expect(`${nombre}/${clave}: ${declara}`).toBe(`${nombre}/${clave}: false`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. I18N T3-A — LOS PRERREQUISITOS Y LA MUDANZA
// ─────────────────────────────────────────────────────────────────────────────
//
// Esta fase no consolida nada: arregla las dos cosas que había que arreglar ANTES de
// poder consolidar, y cambia el vocabulario de sitio dejando un puente. Lo que se
// vigila aquí es exactamente eso — que los prerrequisitos no se deshagan y que el
// puente siga siendo un puente y no una segunda copia.
describe('T3-A — los prerrequisitos de la consolidación', () => {
  const raiz = (...ruta: string[]) => readFileSync(join(SRC, ...ruta), 'utf8');

  const TIPOS = raiz('types', 'index.ts');
  const FUENTE = raiz('lib', 'etiquetas-enums.ts');
  const LISTA_USUARIOS = readFileSync(join(ADMIN, 'usuarios', 'page.tsx'), 'utf8');

  // ── B1: `Role` completo ────────────────────────────────────────────────────

  it('B1 — `Role` incluye EDITOR', () => {
    // Faltaba en `types/index.ts` desde que el rol entró en el backend. Un
    // `Record<Role, string>` sobre aquel tipo no habría exigido su etiqueta.
    expect(ROLE_ORDER).toContain('EDITOR');
  });

  it('B1 — y `types/index.ts` ya no declara su propio `Role`', () => {
    // La mitad que importa: el tipo viejo no estaba desactualizado por descuido, sino
    // porque NADA lo ataba al enum real. Ahora sale de `config/roles.ts`, que es
    // espejo del backend y tiene su test de CI (`roles.mirror.test.ts`).
    expect(TIPOS).not.toMatch(/export type Role\s*=\s*'/);
    expect(TIPOS).toContain("from '@/config/roles'");
  });

  it('B1 — el diccionario de `Role` cubre la escalera entera, y está TIPADO', () => {
    for (const rol of ROLE_ORDER) {
      expect(ROL_LABELS[rol]).toBeDefined();
      expect(ROL_LABELS[rol]).not.toBe(rol);
    }
    // El tipado es lo que convierte «hoy están los cuatro» en «el quinto no compila».
    // Es el molde de `PLACEMENT_LABELS`, y el primero del vocabulario en llevarlo.
    expect(FUENTE).toContain('ROL_LABELS: Record<Role, string>');
  });

  // ── B2: la divergencia cerrada ─────────────────────────────────────────────

  it('B2 — `ADMIN` se llama «Administrador», y ya no hay dónde decir otra cosa', () => {
    expect(ROL_LABELS.ADMIN).toBe('Administrador');
    // La lista de usuarios llevaba `ADMIN: 'Admin'` en su propio diccionario Y un
    // tercer «Admin» en la fila de filtros. La Fase A los alineó; la B retiró el
    // diccionario entero, así que lo que se vigila ahora es que no vuelva a haber
    // una segunda opinión — no el texto de una copia que ya no existe.
    //
    // Se mira la DECLARACIÓN y no la cadena: el comentario que cuenta esta historia
    // nombra el «Admin» viejo a propósito, y esa historia es lo único que evita que
    // alguien reabra la divergencia creyendo que nunca se decidió.
    expect(LISTA_USUARIOS).not.toMatch(/const ROLE_LABELS/);
    expect(LISTA_USUARIOS).not.toMatch(/label: 'Admin',\s*value: 'ADMIN'/);
    expect(LISTA_USUARIOS).toContain('ROL_LABELS');
  });

  // ── B3 / B4: la mudanza, ya sin puente (T3-B) ──────────────────────────────

  it('B4 — el contenido vive en `lib/`', () => {
    expect(FUENTE).toContain('export const ROL_LABELS');
    expect(FUENTE).toContain('export const MOTIVO_REPORTE_LABELS');
  });

  it('B3 — el puente ya NO existe: la Fase B lo retiró al quedarse sin nadie', () => {
    // En T3-A esto comprobaba que el puente re-exportaba TODO (`export *`), porque
    // doce ficheros seguían importando de él. Ya no importa ninguno, así que la
    // afirmación se invierte: lo que hay que vigilar ahora es que no vuelva.
    //
    // Que reaparezca no sería inocente — sería un segundo sitio del que importar el
    // vocabulario, es decir, el principio de la dispersión otra vez, y esta vez con
    // dos rutas igual de válidas.
    expect(existsSync(join(ADMIN, 'etiquetas.ts'))).toBe(false);
    expect(ROL_LABELS).toBe(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/lib/etiquetas-enums') as { ROL_LABELS: unknown }).ROL_LABELS,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. I18N T3-B — B5: LA CLASE CERRADA. NO HAY COPIA Nº 32.
// ─────────────────────────────────────────────────────────────────────────────
//
// TODO lo anterior vigila defectos CONCRETOS: este campo, aquella pantalla, esta
// clave. Sirven, pero llegan tarde por definición — hay que saber que el defecto
// existe para escribir su test, y la auditoría encontró 31 copias precisamente
// porque nadie las estaba contando.
//
// Esto es lo otro: no vigila un defecto, vigila la FORMA. Un diccionario de enum es
// reconocible —un `const *_LABELS` con claves en SCREAMING_SNAKE— y a partir de ahora
// sólo puede declararse en el vocabulario o en un puñado de módulos con nombre. Quien
// abra la copia nº 32 en una pantalla no necesita que nadie recuerde este problema:
// CI se lo dice.
//
// SE LEE EL ÁRBOL DE FICHEROS, no una lista escrita a mano. Mismo criterio que
// `backoffice-sections.test.ts` con las rutas: una lista aquí sería otra lista que
// olvidar, y justamente el fallo a evitar es el de un fichero NUEVO.
describe('B5 — ningún diccionario de enum vive fuera del vocabulario', () => {
  /**
   * LOS TRES PERMITIDOS, cada uno con su razón. La lista es corta a propósito: si
   * crece, es que la regla se está erosionando en vez de aplicándose.
   *
   *   · `listing-status.ts` / `listing-triage.ts` — no son diccionarios sueltos: cada
   *     uno es un módulo con SU máquina de estados alrededor (`STATUS_VARIANTS`,
   *     `TARGET_STATUSES`, `TRIAGE_VALUES`, sus `etiquetaDe*`). El vocabulario
   *     RE-EXPORTA sus etiquetas, así que siguen teniendo un solo lector; partirlos
   *     para mudar cuatro líneas dejaría el resto huérfano.
   *   · `lib/api/banners.ts` — `PLACEMENT_LABELS` vive con el tipo `BannerPlacement`,
   *     con `PLACEMENT_GROUPS` y con `ALL_PLACEMENTS`, que son la misma decisión
   *     editorial. Es además el MOLDE que esta ráfaga ha ido copiando.
   */
  const PERMITIDOS = [
    join('lib', 'etiquetas-enums.ts'),
    join('app', '(admin)', 'admin', 'anuncios', 'listing-status.ts'),
    join('app', '(admin)', 'admin', 'anuncios', 'listing-triage.ts'),
    join('lib', 'api', 'banners.ts'),
  ];

  /** `const X_LABELS ... = {` seguido de una clave SCREAMING_SNAKE. */
  const DECLARACION = /const\s+[A-Za-z_]*_LABELS\b[^=]*=\s*\{\s*(?:\/\/[^\n]*\n\s*)*[A-Z][A-Z0-9_]*\s*:/;

  function fuentes(dir: string): string[] {
    return readdirSync(dir).flatMap((entrada) => {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) return fuentes(ruta);
      return /\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada) ? [ruta] : [];
    });
  }

  const infractores = fuentes(SRC)
    .filter((ruta) => !PERMITIDOS.some((p) => ruta.endsWith(p)))
    .filter((ruta) => DECLARACION.test(readFileSync(ruta, 'utf8')))
    .map((ruta) => ruta.slice(SRC.length + 1).replace(/\\/g, '/'));

  it('el barrido encuentra ficheros (red del propio test)', () => {
    // Sin esto, un `readdirSync` que devolviera vacío haría pasar la barrera entera
    // sin mirar nada — el fallo más silencioso que puede tener un test de barrido.
    expect(fuentes(SRC).length).toBeGreaterThan(200);
  });

  it('la propia regla reconoce la forma que persigue', () => {
    // La segunda red: una expresión regular rota tampoco encontraría nada y también
    // pasaría en verde. Se le enseña un caso positivo y uno negativo.
    expect(DECLARACION.test("const ALGO_LABELS: Record<X, string> = {\n  FOO_BAR: 'x',")).toBe(true);
    expect(DECLARACION.test("const ALGO_LABELS: Record<X, string> = {\n  upcoming: 'x',")).toBe(false);
  });

  it('nadie declara un diccionario de enum fuera del vocabulario', () => {
    expect(infractores).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. I18N T3-B — LAS VARIANTES SIGUEN SIENDO VARIANTES
// ─────────────────────────────────────────────────────────────────────────────
//
// La consolidación tiene un modo de fallar que no es «quedan copias»: es pasarse. Un
// par de mapas que dicen cosas distintas A PROPÓSITO se colapsa fácil —parecen dos
// copias con una divergencia— y el que lo haga tendrá razones y ninguna señal.
//
// Esto es esa señal. Cada variante declarada afirma AQUÍ en qué se diferencia de su
// base, así que unificarla deja de ser un refactor silencioso: hay que venir a borrar
// una afirmación que dice por qué no se hace.
describe('las variantes declaradas dicen cosas distintas, que es su motivo', () => {
  it('el libro mayor del staff no habla como el del dueño', () => {
    // Al usuario se le vendió un «bump» y ésa es la palabra de su producto; el staff
    // describe lo que le pasó al anuncio. Y «Ajuste» sería impreciso en una pantalla
    // donde también hay abonos.
    expect(MOVIMIENTO_CREDITO_ADMIN_LABELS.BUMP_DEBIT).not.toBe(
      MOVIMIENTO_CREDITO_LABELS.BUMP_DEBIT,
    );
    expect(MOVIMIENTO_CREDITO_ADMIN_LABELS.ADMIN_DEBIT).not.toBe(
      MOVIMIENTO_CREDITO_LABELS.ADMIN_DEBIT,
    );
    // Y las dos siguen cubriendo el enum entero: una variante no es una excusa para
    // quedarse corta.
    expect(Object.keys(MOVIMIENTO_CREDITO_ADMIN_LABELS).sort()).toEqual(
      Object.keys(MOVIMIENTO_CREDITO_LABELS).sort(),
    );
  });

  it('el motivo de denuncia se explica en público y se abrevia en el backoffice', () => {
    // Una insignia le dice «Spam» a un moderador que ya sabe de qué va; a un comprador
    // al que se le pide clasificar un problema hay que explicárselo.
    for (const clave of ['SPAM', 'OTHER'] as const) {
      expect(MOTIVO_REPORTE_ANUNCIO_LABELS[clave].length).toBeGreaterThan(
        MOTIVO_REPORTE_LABELS[clave].length,
      );
    }
  });

  it('denunciar una VALORACIÓN no se dice igual que denunciar un anuncio', () => {
    // «u ofensivo» sólo tiene sentido sobre lo que alguien escribió de una persona.
    // Es la palabra que se habría perdido al colapsar las dos formas largas.
    expect(MOTIVO_REPORTE_VALORACION_LABELS.INAPPROPRIATE).not.toBe(
      MOTIVO_REPORTE_ANUNCIO_LABELS.INAPPROPRIATE,
    );
    expect(MOTIVO_REPORTE_VALORACION_LABELS.INAPPROPRIATE).toContain('ofensivo');
  });

  it('un anuncio es «Producto» y un montón de anuncios son «Productos»', () => {
    expect(TIPO_ANUNCIO_PLURAL_LABELS.PRODUCT).not.toBe(TIPO_ANUNCIO_LABELS.PRODUCT);
  });

  it('una página se publica en femenino y un post en masculino', () => {
    expect(ESTADO_PAGINA_LABELS.PUBLISHED).not.toBe(ESTADO_POST_LABELS.PUBLISHED);
    // El borrador sí coincide: la concordancia sólo afecta al participio.
    expect(ESTADO_PAGINA_LABELS.DRAFT).toBe(ESTADO_POST_LABELS.DRAFT);
  });

  it('el sufijo del precio no es el nombre del formato', () => {
    // «/mes» se pega a la cifra; «Al mes» nombra el formato en un desplegable.
    expect(SUFIJO_UNIDAD_PRECIO.PER_MONTH).not.toBe(UNIDAD_PRECIO_LABELS.PER_MONTH);
    // Y el pago único no lleva sufijo: «200 €» a secas. Es la única entrada vacía, y
    // se afirma porque un `?? ''` descuidado la volvería indistinguible de un hueco.
    expect(SUFIJO_UNIDAD_PRECIO.ONE_TIME).toBe('');
  });
});
