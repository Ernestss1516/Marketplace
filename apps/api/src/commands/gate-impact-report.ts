/**
 * MEDICIÓN (M2) — IMPACTO DE LAS REGLAS CANDIDATAS DE LA PUERTA DE VALIDACIÓN.
 *
 * SOLO LECTURA. No escribe nada: ni un anuncio, ni un schema, ni una fila. Su
 * único efecto es imprimir una tabla.
 *
 * PARA QUÉ. La auditoría de la puerta (docs/auditoria-puerta-validacion.md, D5)
 * concluyó que la decisión «estricta vs tolerante» no se puede tomar sin saber a
 * cuántos anuncios YA EXISTENTES afectaría cada regla: si la respuesta es 3, se
 * bloquea y ya; si es 8.000, hace falta grandfathering o un modo avisar-sin-
 * bloquear. Esto produce ese número. NO construye la puerta ni decide nada.
 *
 * POR QUÉ USA LAS FUNCIONES REALES. El recuento sólo vale si valida EXACTAMENTE
 * como validaría la puerta. Por eso la herencia sale de las mismas funciones que
 * usa producción —`ancestorChainIn` para la cadena y `resolveEffectiveSchema`
 * plegado sobre ella— y no de una reimplementación. Medir con una herencia de 2
 * niveles daría un número FALSO ahora que el árbol admite 4: un anuncio de una
 * categoría profunda parecería incumplir atributos que en realidad hereda.
 *
 * ✅ YA NO REPLICA NADA (puerta, ráfaga 2). Los tres validadores de atributos
 * eran `private` de `ListingsService` —un servicio de Nest con doce
 * dependencias, imposible de instanciar en un script de lectura sin arrastrar
 * colas, Redis y Meilisearch—, así que este comando los REPLICABA campo por
 * campo, con el riesgo anotado: si alguien tocaba el original y no la copia, el
 * número dejaba de ser el real.
 *
 * La ráfaga 2 de la puerta los extrajo a `categories/attribute-validation.ts`,
 * un fichero puro. Este comando, el alta/edición y la puerta leen ahora EL MISMO
 * código, y las tres funciones de abajo son adaptadores de tres líneas que sólo
 * traducen la forma del resultado a la que este informe cuenta.
 *
 * USO (desde apps/api/):
 *   pnpm gate-impact-report
 *   DATABASE_URL="postgresql://…" pnpm gate-impact-report   # otra base
 */

import { PrismaClient, type ListingType } from '@prisma/client';
import {
  resolveEffectiveSchema,
  filterSchemaByType,
  type AttributeField,
} from '../modules/categories/category.types';
import {
  missingRequiredNames,
  invalidValueIssues,
  linkedSelectIssues,
} from '../modules/categories/attribute-validation';
import { DEFAULT_MAX_PHOTOS } from '../modules/listing-gate/photo-limits';
import { ancestorChainIn, type CategoryNode } from '../modules/categories/category-tree.service';

const prisma = new PrismaClient();

/** Cuántos IDs de ejemplo se listan por cada regla que falla. */
const MAX_EJEMPLOS = 5;

/**
 * Tope de fotos con el que se mide. Sale de la MISMA constante que aplica la
 * regla #3 (antes era un 15 copiado aquí, cuando el tope vivía en un
 * `@ArrayMaxSize(15)` del DTO). Si un administrador ha cambiado el `Setting`, el
 * número real puede ser otro — este informe mide contra el DEFECTO, que es lo
 * que se quiere para decidir si encender algo.
 */
const TOPE_FOTOS = DEFAULT_MAX_PHOTOS;

/** Topes candidatos para el límite TOTAL de anuncios (la regla nueva de Ernest). */
const TOPES_TOTAL_CANDIDATOS = [5, 10, 20, 50];

interface Hallazgo {
  regla: string;
  fallan: number;
  ejemplos: string[];
}

function nuevoHallazgo(regla: string): Hallazgo {
  return { regla, fallan: 0, ejemplos: [] };
}

function anotar(h: Hallazgo, listingId: string): void {
  h.fallan++;
  if (h.ejemplos.length < MAX_EJEMPLOS) h.ejemplos.push(listingId);
}

// ---------------------------------------------------------------------------
// Adaptadores sobre los validadores COMPARTIDOS (attribute-validation.ts).
//
// El informe cuenta por NOMBRE de atributo; los validadores devuelven issues con
// su mensaje. Eso es todo lo que traducen estas tres funciones — la lógica de
// qué incumple es la misma que aplica el alta y la que aplica la puerta.
// ---------------------------------------------------------------------------

/** Requeridos que faltan, por nombre. */
function requeridosQueFaltan(
  attributes: Record<string, unknown>,
  schema: AttributeField[],
): string[] {
  return missingRequiredNames(attributes, schema);
}

/**
 * Valores inválidos (opción/tipo), por nombre. Las claves desconocidas NO entran
 * aquí: se miden aparte como «huérfanos», porque cada sub-caso puede querer una
 * política distinta.
 */
function valoresInvalidos(
  attributes: Record<string, unknown>,
  schema: AttributeField[],
): string[] {
  return invalidValueIssues(attributes, schema).map((i) => i.field);
}

/** Selects vinculados inválidos, por nombre. Sin `deltaKeys`: aquí se valida el
 *  bag completo, que es lo que hace la puerta al revalidar a fondo. */
function vinculadosInvalidos(
  attributes: Record<string, unknown>,
  schema: AttributeField[],
): string[] {
  return linkedSelectIssues(attributes, schema).map((i) => i.field);
}

// ---------------------------------------------------------------------------

/**
 * AUTO-COMPROBACIÓN — ¿un «0 fallan» significa que no hay incumplimientos, o que
 * el detector no detecta nada?
 *
 * Sin esto, un informe todo a ceros es indistinguible de un informe roto, y sería
 * exactamente el tipo de dato que lleva a decidir mal. Aquí se ejercita cada
 * detector contra casos sintéticos EN MEMORIA —no toca la base— con su caso
 * bueno y su caso malo. Corre siempre, antes del informe: si algo no discrimina,
 * se ve arriba del todo.
 */
function autoComprobacion(): string[] {
  const schema: AttributeField[] = [
    { name: 'year', label: 'Año', type: 'number', filterable: true, required: true },
    { name: 'fuel', label: 'Combustible', type: 'select', filterable: true, required: false, options: ['gasolina', 'diesel'] },
    { name: 'garantia', label: 'Garantía', type: 'boolean', filterable: false, required: false },
    { name: 'modelo', label: 'Modelo', type: 'select', filterable: false, required: false, dependsOn: 'fuel', optionsByParent: { diesel: ['tdi'] } },
  ];
  const casos: Array<[string, boolean]> = [
    ['requerido presente → NO falla', requeridosQueFaltan({ year: 2020 }, schema).length === 0],
    ['requerido ausente → SÍ falla', requeridosQueFaltan({}, schema).length === 1],
    ['opción válida → NO falla', valoresInvalidos({ fuel: 'diesel' }, schema).length === 0],
    ['opción inventada → SÍ falla', valoresInvalidos({ fuel: 'queroseno' }, schema).length === 1],
    ['número válido → NO falla', valoresInvalidos({ year: '2020' }, schema).length === 0],
    ['número no numérico → SÍ falla', valoresInvalidos({ year: 'hace mucho' }, schema).length === 1],
    ['booleano válido → NO falla', valoresInvalidos({ garantia: 'true' }, schema).length === 0],
    ['booleano basura → SÍ falla', valoresInvalidos({ garantia: 'quizá' }, schema).length === 1],
    ['vinculado coherente → NO falla', vinculadosInvalidos({ fuel: 'diesel', modelo: 'tdi' }, schema).length === 0],
    ['vinculado incoherente → SÍ falla', vinculadosInvalidos({ fuel: 'gasolina', modelo: 'tdi' }, schema).length === 1],
    ['vinculado sin su padre → SÍ falla', vinculadosInvalidos({ modelo: 'tdi' }, schema).length === 1],
  ];
  return casos.map(([nombre, ok]) => `  ${ok ? '✓' : '✗ NO DISCRIMINA'}  ${nombre}`);
}

function porcentaje(n: number, total: number): string {
  if (total === 0) return '—';
  return `${((n / total) * 100).toFixed(1)}%`;
}

function fila(h: Hallazgo, total: number): string {
  const ejemplos = h.ejemplos.length > 0 ? h.ejemplos.join(', ') : '—';
  return `${h.regla.padEnd(52)} ${String(h.fallan).padStart(6)}  ${porcentaje(h.fallan, total).padStart(7)}   ${ejemplos}`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '(sin DATABASE_URL)';
  const base = url.replace(/:\/\/[^@]*@/, '://***@');

  // ── El árbol de categorías, para plegar la herencia N igual que producción ──
  const categorias = await prisma.category.findMany({
    select: {
      id: true, slug: true, name: true, parentId: true, attributeSchema: true,
      allowedListingType: true, allowedViews: true, defaultView: true, allowedPriceUnits: true,
    },
  });
  const arbol = new Map<string, CategoryNode>(
    categorias.map((c) => [
      c.id,
      { ...c, attributeSchema: (c.attributeSchema as unknown as AttributeField[]) ?? [] },
    ]),
  );

  /** El schema efectivo de una categoría: el PLIEGUE de su cadena, igual que producción. */
  const efectivoDe = (categoryId: string): AttributeField[] =>
    ancestorChainIn(arbol, categoryId).reduce<AttributeField[]>(
      (acc, nodo) => resolveEffectiveSchema(nodo.attributeSchema, acc),
      [],
    );

  // ── Los anuncios ACTIVOS, que son los que una puerta afectaría ──────────────
  const activos = await prisma.listing.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true, slug: true, type: true, categoryId: true, attributes: true,
      seller: { select: { id: true, emailVerified: true } },
      _count: { select: { images: true } },
    },
  });
  const total = activos.length;

  // ── Regla 1 — atributos vs schema efectivo (N niveles) ──────────────────────
  const hRequeridos = nuevoHallazgo('1a. Requeridos que FALTAN');
  const hValores = nuevoHallazgo('1b. Valores inválidos (opción/tipo)');
  const hVinculados = nuevoHallazgo('1c. Selects vinculados inválidos');
  const hHuerfanos = nuevoHallazgo('1d. Atributos huérfanos (ya no en el schema)');
  const hOtroTipo = nuevoHallazgo('1e. Atributos de otro tipo (appliesTo)');
  const hCualquiera = nuevoHallazgo('1·. CUALQUIER incumplimiento de atributos');

  // ── Regla 5 — categoría irresoluble ─────────────────────────────────────────
  const hSinCategoria = nuevoHallazgo('5a. Categoría inexistente / irresoluble');
  const hSinSchema = nuevoHallazgo('5b. Categoría sin ningún atributo definido');

  // ── Regla 2 y 3 ─────────────────────────────────────────────────────────────
  const hSinVerificar = nuevoHallazgo('2. Vendedor con el correo SIN verificar');
  const hDemasiadasFotos = nuevoHallazgo(`3a. Más de ${TOPE_FOTOS} fotos`);
  const hSinFotos = nuevoHallazgo('3b. CERO fotos (el mínimo que hoy no se exige)');

  const detalles: string[] = [];

  for (const l of activos) {
    // Regla 5
    const cadena = ancestorChainIn(arbol, l.categoryId);
    if (cadena.length === 0) {
      anotar(hSinCategoria, l.id);
      anotar(hCualquiera, l.id);
      continue; // sin categoría no hay schema contra el que validar
    }

    const efectivo = efectivoDe(l.categoryId);
    if (efectivo.length === 0) anotar(hSinSchema, l.id);

    // Regla 1 — mismo orden y mismo ámbito que producción: se filtra por el tipo
    // del anuncio ANTES de validar (filterSchemaByType), igual que create().
    const aplicable = filterSchemaByType(efectivo, l.type as ListingType);
    const attrs = ((l.attributes as Record<string, unknown>) ?? {});

    const faltan = requeridosQueFaltan(attrs, aplicable);
    const malos = valoresInvalidos(attrs, aplicable);
    const vinculados = vinculadosInvalidos(attrs, aplicable);

    // Huérfano vs «de otro tipo»: producción los trata igual (ambos son claves
    // desconocidas para el schema aplicable y dan 422), pero se separan aquí
    // porque son problemas distintos y pueden querer políticas distintas.
    const nombresAplicables = new Set(aplicable.map((f) => f.name));
    const nombresEfectivos = new Set(efectivo.map((f) => f.name));
    const huerfanos = Object.keys(attrs).filter((k) => !nombresEfectivos.has(k));
    const deOtroTipo = Object.keys(attrs).filter(
      (k) => nombresEfectivos.has(k) && !nombresAplicables.has(k),
    );

    if (faltan.length) anotar(hRequeridos, l.id);
    if (malos.length) anotar(hValores, l.id);
    if (vinculados.length) anotar(hVinculados, l.id);
    if (huerfanos.length) anotar(hHuerfanos, l.id);
    if (deOtroTipo.length) anotar(hOtroTipo, l.id);
    if (faltan.length || malos.length || vinculados.length || huerfanos.length || deOtroTipo.length) {
      anotar(hCualquiera, l.id);
      detalles.push(
        `  · ${l.slug} (${cadena.map((c) => c.slug).join(' › ')})` +
          (faltan.length ? ` | faltan: ${faltan.join(',')}` : '') +
          (malos.length ? ` | valor inválido: ${malos.join(',')}` : '') +
          (vinculados.length ? ` | vinculado inválido: ${vinculados.join(',')}` : '') +
          (huerfanos.length ? ` | huérfanos: ${huerfanos.join(',')}` : '') +
          (deOtroTipo.length ? ` | de otro tipo: ${deOtroTipo.join(',')}` : ''),
      );
    }

    // Reglas 2 y 3
    if (!l.seller.emailVerified) anotar(hSinVerificar, l.id);
    if (l._count.images > TOPE_FOTOS) anotar(hDemasiadasFotos, l.id);
    if (l._count.images === 0) anotar(hSinFotos, l.id);
  }

  // ── Regla 4 — límite TOTAL por usuario ──────────────────────────────────────
  // «Total» = todo lo que ocupa catálogo del vendedor. Se excluyen ARCHIVED
  // (terminal e invisible) y SOLD (ya no se ofrece). Se listan también las otras
  // definiciones posibles para que el criterio se pueda cambiar sin re-medir.
  const porUsuarioTotal = await prisma.listing.groupBy({
    by: ['sellerId'],
    where: { status: { notIn: ['ARCHIVED', 'SOLD'] } },
    _count: { _all: true },
  });
  const porUsuarioActivos = await prisma.listing.groupBy({
    by: ['sellerId'],
    where: { status: 'ACTIVE' },
    _count: { _all: true },
  });

  const reparto = (grupos: { _count: { _all: number } }[], tope: number) => {
    const excedidos = grupos.filter((g) => g._count._all > tope);
    const deMas = excedidos.reduce((s, g) => s + (g._count._all - tope), 0);
    return { usuarios: excedidos.length, deMas };
  };

  // ── Salida ──────────────────────────────────────────────────────────────────
  const nl = '\n';
  let out = '';
  out += `${nl}════════════════════════════════════════════════════════════════════════════════${nl}`;
  out += `  M2 — IMPACTO DE LAS REGLAS CANDIDATAS DE LA PUERTA (medición, solo lectura)${nl}`;
  out += `════════════════════════════════════════════════════════════════════════════════${nl}`;
  out += `  Base:      ${base}${nl}`;
  out += `  Fecha:     ${new Date().toISOString()}${nl}`;
  out += `  Categorías: ${categorias.length}   ·   Anuncios ACTIVE: ${total}${nl}`;
  out += `  Herencia:  cadena de ancestros plegada (N niveles), igual que producción${nl}`;
  out += `${nl}  REGLA                                                FALLAN        %   EJEMPLOS (id)${nl}`;
  out += `  ${'─'.repeat(110)}${nl}`;

  for (const h of [
    hRequeridos, hValores, hVinculados, hHuerfanos, hOtroTipo, hCualquiera,
    hSinVerificar, hDemasiadasFotos, hSinFotos, hSinCategoria, hSinSchema,
  ]) {
    out += `  ${fila(h, total)}${nl}`;
  }

  out += `${nl}  4. LÍMITE TOTAL DE ANUNCIOS POR USUARIO${nl}`;
  out += `     («total» = todo menos ARCHIVED y SOLD; ${porUsuarioTotal.length} usuario(s) con algo)${nl}`;
  out += `     ${'tope'.padStart(6)}   usuarios que lo exceden   anuncios «de más»${nl}`;
  for (const tope of TOPES_TOTAL_CANDIDATOS) {
    const r = reparto(porUsuarioTotal, tope);
    out += `     ${String(tope).padStart(6)}   ${String(r.usuarios).padStart(21)}   ${String(r.deMas).padStart(16)}${nl}`;
  }
  out += `${nl}     Comparativa con el criterio ACTUAL (solo ACTIVE, que es lo que ya se aplica):${nl}`;
  for (const tope of [5, 20]) {
    const r = reparto(porUsuarioActivos, tope);
    out += `     ${String(tope).padStart(6)}   ${String(r.usuarios).padStart(21)}   ${String(r.deMas).padStart(16)}${nl}`;
  }

  if (detalles.length > 0) {
    out += `${nl}  DETALLE de los incumplimientos de atributos (categoría en cadena):${nl}`;
    out += detalles.slice(0, 30).join(nl) + nl;
    if (detalles.length > 30) out += `  … y ${detalles.length - 30} más${nl}`;
  }

  const check = autoComprobacion();
  const fallosCheck = check.filter((l) => l.includes('NO DISCRIMINA'));
  out += `${nl}  AUTO-COMPROBACIÓN de los detectores (casos sintéticos, no tocan la base):${nl}`;
  out += fallosCheck.length === 0
    ? `  ✓ los ${check.length} casos discriminan — un «0 fallan» de arriba significa CERO de verdad${nl}`
    : check.join(nl) + nl;

  out += `${nl}  ── AVISOS ──────────────────────────────────────────────────────────────────${nl}`;
  if (fallosCheck.length > 0) {
    out += `  ✗ ${fallosCheck.length} detector(es) NO discriminan: el informe de arriba NO es fiable.${nl}`;
  }
  if (total < 50) {
    out += `  ⚠ MUESTRA NO REPRESENTATIVA: ${total} anuncio(s) activo(s). Estos números NO${nl}`;
    out += `    dicen nada sobre producción; describen esta base y nada más. Sirven para${nl}`;
    out += `    comprobar que la medición FUNCIONA, no para decidir la política de la puerta.${nl}`;
  }
  out += `  ⚠ Los tres validadores de atributos son una RÉPLICA de los privados de${nl}`;
  out += `    ListingsService. Si cambian allí y no aquí, este recuento deja de ser el real.${nl}`;
  out += `════════════════════════════════════════════════════════════════════════════════${nl}`;

  console.log(out);
}

main()
  .catch((err) => {
    console.error('gate-impact-report falló:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
