import {
  GalleryHorizontal,
  LayoutList,
  LayoutGrid,
  ListOrdered,
  MousePointerClick,
  Search,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import { generateId } from '@/lib/utils';
import type { HomeBlock } from '@/types/home-blocks';

export type HomeBlockType = HomeBlock['type'];

/**
 * Nombres y descripciones en LENGUAJE CLARO, no jerga técnica — es el requisito
 * central del editor, igual que en el blog: un admin no técnico debe entender
 * qué hace cada bloque sin adivinar qué significa "cta" o "search".
 *
 * A medida que RP.4-RP.6 registren tipos en la unión `HomeBlock`, este Record
 * deja de compilar hasta que se les dé su entrada — misma garantía de
 * exhaustividad que el `switch` del renderizador, aplicada a los metadatos.
 */
export const HOME_BLOCK_TYPE_META: Record<
  HomeBlockType,
  { label: string; description: string; icon: LucideIcon }
> = {
  search: {
    label: 'Buscador',
    description: 'La caja de búsqueda, con enlaces opcionales a las categorías más usadas',
    icon: Search,
  },
  cta: {
    label: 'Botón destacado',
    description: 'Un botón grande y centrado que lleva a otra página',
    icon: MousePointerClick,
  },
  grid: {
    label: 'Rejilla de tarjetas',
    description: 'Tarjetas con icono o foto y un texto; con enlace o solo informativas',
    icon: LayoutGrid,
  },
  steps: {
    label: 'Pasos por público',
    description: 'Cómo funciona: una columna por público, con sus pasos numerados',
    icon: ListOrdered,
  },
  listings: {
    label: 'Anuncios',
    description: 'Los anuncios más recientes, de todo el sitio o de una categoría',
    icon: ShoppingBag,
  },
  searchTable: {
    label: 'Tabla de búsquedas',
    description: 'Pestañas con enlaces a búsquedas: por provincia, por categoría o combinadas',
    icon: LayoutList,
  },
  categoryCarousel: {
    label: 'Carrusel de categorías',
    description: 'Una fila de categorías con su foto, que se desplaza de lado',
    icon: GalleryHorizontal,
  },
};

/**
 * Orden fijo del selector — de más simple/frecuente a más elaborado, no
 * alfabético (ayuda a un admin no técnico a no sentirse abrumado). Mismo
 * criterio que BLOCK_TYPE_ORDER del blog.
 */
export const HOME_BLOCK_TYPE_ORDER: HomeBlockType[] = [
  'search',
  'listings',
  'categoryCarousel',
  'cta',
  'grid',
  'steps',
  'searchTable',
];

/**
 * Valores por defecto al añadir un bloque. Arrancan VÁLIDOS donde el backend lo
 * exige, para que el admin vea el hueco a rellenar en vez de recibir un 400.
 */
export function createDefaultHomeBlock(type: HomeBlockType): HomeBlock {
  const id = generateId();
  switch (type) {
    case 'search':
      // showPopularCategories a true: es lo que hace la portada hoy y lo que
      // casi siempre se quiere; quitarlo es un clic.
      return { id, type, showPopularCategories: true, popularCount: 6 };
    case 'cta':
      return { id, type, label: '', href: '' };
    case 'grid':
      // 4 columnas y una tarjeta: es la forma de las señales de confianza, el
      // caso que más se usa. El backend exige ArrayMinSize(1), así que arranca
      // con la tarjeta ya creada — mejor ver el hueco que recibir un 400.
      return { id, type, columns: 4, items: [{ title: '' }] };
    case 'steps':
      return {
        id,
        type,
        columns: [{ audienceTitle: '', steps: [{ title: '', description: '' }] }],
      };
    case 'listings':
      // Sin `categorySlug`: "de todo el sitio" es el caso principal en la
      // portada, así que es lo que trae un bloque recién añadido.
      return { id, type, limit: 8, sort: 'recent', showAllLink: true };
    case 'categoryCarousel':
      return { id, type, items: [{ categorySlug: '', imageUrl: '', alt: '' }] };
    case 'searchTable':
      // Arranca con las dos pestañas que no piden configurar nada (provincias y
      // categorías salen de datos que ya existen): útil desde el primer clic.
      // Las combinaciones las añade el admin si quiere.
      return {
        id,
        type,
        columns: 3,
        tabs: [
          { kind: 'locations', label: 'Por provincia' },
          { kind: 'categories', label: 'Por categoría', includeChildren: true },
        ],
      };
  }
}

/** True si el bloque ya tiene contenido introducido (para pedir confirmación al borrar). */
export function homeBlockHasContent(block: HomeBlock): boolean {
  switch (block.type) {
    case 'search':
      // El buscador no guarda contenido propio salvo el eyebrow: quitarlo no
      // pierde nada que el admin haya escrito, salvo ese texto.
      return (block.eyebrow ?? '').trim().length > 0;
    case 'cta':
      return block.label.trim().length > 0 || block.href.trim().length > 0;
    case 'grid':
      return block.items.some(
        (cell) => cell.title.trim() || cell.description?.trim() || cell.href?.trim() || cell.media,
      );
    case 'steps':
      return block.columns.some(
        (col) =>
          col.audienceTitle.trim() ||
          col.steps.some((s) => s.title.trim() || s.description.trim()),
      );
    case 'listings':
      // No guarda contenido, guarda una consulta: quitarlo no pierde nada que el
      // admin haya escrito, salvo el título que le pusiera.
      return (block.title ?? '').trim().length > 0;
    case 'categoryCarousel':
      return block.items.some((it) => it.categorySlug.trim() || it.imageUrl.trim());
    case 'searchTable':
      // Lo único que el admin escribe aquí son los pares de "combinaciones": las
      // otras dos pestañas salen de datos que ya existen y no se pierden.
      return block.tabs.some(
        (t) => t.kind === 'combos' && t.items.some((i) => i.categorySlug.trim()),
      );
  }
}
