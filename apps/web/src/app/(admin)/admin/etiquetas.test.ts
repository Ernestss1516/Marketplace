import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCION_LABELS,
  CONDICION_LABELS,
  ESTADO_BUMP_LABELS,
  ESTADO_REPORTE_LABELS,
  ESTADO_USUARIO_LABELS,
  MOTIVO_REPORTE_LABELS,
  ROL_LABELS,
  STATUS_LABELS,
  TIPO_ANUNCIO_LABELS,
  TIPO_PRECIO_LABELS,
  UNIDAD_PRECIO_LABELS,
  etiqueta,
  etiquetaDeEstado,
  ticketStatusLabel,
} from './etiquetas';
import { PRICE_UNIT_LABELS } from '@/components/publicar/steps/StepDatos';

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
  it('los formatos de precio son literalmente los del wizard de publicar', () => {
    // El único de los mapas nuevos cuyo original está EXPORTADO, así que se compara
    // contra él en vez de contra una copia. Si el wizard renombra «Al mes», esta
    // afirmación obliga a decidir aquí también, en vez de divergir en silencio —
    // que es exactamente lo que le pasó a `ReportReason` entre `/admin/reportes` y
    // `/admin/usuarios` (a la segunda le falta `FAKE_REVIEW`).
    expect(UNIDAD_PRECIO_LABELS).toEqual(PRICE_UNIT_LABELS);
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
    const original = require('./anuncios/listing-status') as { STATUS_LABELS: unknown };
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
  const leer = (...ruta: string[]) => readFileSync(join(__dirname, ...ruta), 'utf8');

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
    expect(FICHA_ANUNCIO).toContain("from '../../etiquetas'");
    expect(FICHA_USUARIO).toContain("from '../../etiquetas'");
    // `ACCION_LABELS` vivía dentro de la ficha de anuncio. Que ya no se declare ahí es
    // la mitad del arreglo: mientras fuera local, la ficha de usuario no podía usarlo.
    expect(FICHA_ANUNCIO).not.toContain('const ACCION_LABELS');
    expect(FICHA_USUARIO).not.toContain('const ROL_LABELS');
  });
});
