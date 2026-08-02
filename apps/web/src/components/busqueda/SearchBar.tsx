'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, Tag as TagIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PROVINCIAS } from '@/lib/provincias';
import { categoryPathWithQuery, findCategoryUrlParts } from '@/lib/category-url';
import { suggestTags } from '@/lib/api/categorias';
import type { Category, TagSuggestion } from '@/types';

interface SearchBarProps {
  defaultValue?: string;
  /** Categorías top-level para el selector — pasadas por el llamador (ya cargadas server-side), sin query propia. */
  categories?: Category[];
}

/** B4 — a partir de aquí se piden sugerencias. Por debajo, casi todo casa con casi todo. */
const MIN_CHARS = 2;
/** Espera tras la última tecla. Suficiente para no disparar por letra, corto para no notarse. */
const DEBOUNCE_MS = 250;

export function SearchBar({ defaultValue = '', categories = [] }: SearchBarProps) {
  const [query, setQuery] = useState(defaultValue);
  const [category, setCategory] = useState('');
  const [province, setProvince] = useState('');
  const router = useRouter();

  // B4 — estado del desplegable de sugerencias.
  const [sugerencias, setSugerencias] = useState<TagSuggestion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  // -1 = ninguna sugerencia resaltada; la salida de escape (texto libre) es el índice
  // `sugerencias.length`, así que las flechas recorren la lista Y el escape.
  const [resaltado, setResaltado] = useState(-1);
  const contenedorRef = useRef<HTMLFormElement>(null);

  /**
   * Pide sugerencias con debounce. El `AbortController` cancela la petición anterior:
   * sin él, teclear rápido puede hacer que una respuesta vieja llegue después de una
   * nueva y pinte una lista que ya no corresponde a lo escrito.
   */
  useEffect(() => {
    const texto = query.trim();
    if (texto.length < MIN_CHARS) {
      setSugerencias([]);
      setCargando(false);
      return;
    }

    const ctrl = new AbortController();
    setCargando(true);
    const id = setTimeout(async () => {
      const res = await suggestTags(texto, category || undefined, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setSugerencias(res);
      setResaltado(-1);
      setCargando(false);
      setAbierto(true);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query, category]);

  // Cerrar al hacer clic fuera. El foco dentro del formulario no cuenta como fuera.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!contenedorRef.current?.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  /** Query base compartida por los dos destinos (tag y texto libre). */
  function paramsBase(): URLSearchParams {
    const params = new URLSearchParams();
    if (province) params.set('province', province);
    return params;
  }

  /** Navega al destino de la categoría elegida, o a /busqueda si no hay ninguna. */
  function navegar(params: URLSearchParams) {
    // A1 (URLs anidadas) — con categoría elegida se navega a SU ruta canónica
    // (/vehiculos/coches?…) en vez de a /busqueda?category=coches: una sola URL por
    // categoría.
    const urlParts = category ? findCategoryUrlParts(categories, category) : null;
    if (urlParts) {
      router.push(categoryPathWithQuery(urlParts, params));
      return;
    }
    // `category` seleccionada pero ausente del árbol (no debería pasar: las opciones
    // salen del propio árbol) — se conserva como query param, que sigue siendo válido
    // en /busqueda, en vez de perder el filtro en silencio.
    if (category) params.set('category', category);
    const qs = params.toString();
    router.push(qs ? `/busqueda?${qs}` : '/busqueda');
  }

  /**
   * B4 — elegir una etiqueta lleva a la búsqueda FILTRADA por ella (B3), no a una
   * búsqueda de texto. Es el "texto libre canalizado hacia el vocabulario": el usuario
   * escribió "diesel" y acaba con `?tags=diesel`, que es un filtro exacto, en vez de
   * con `?q=diesel`, que es una coincidencia de texto.
   */
  function elegirTag(tag: TagSuggestion) {
    const params = paramsBase();
    params.set('tags', tag.slug);
    setAbierto(false);
    navegar(params);
  }

  /** La salida de escape: la búsqueda de texto libre de SIEMPRE. */
  function buscarTextoLibre() {
    const params = paramsBase();
    const q = query.trim();
    if (q) params.set('q', q);
    setAbierto(false);
    navegar(params);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter con una sugerencia resaltada la elige; sin nada resaltado, texto libre —
    // exactamente el comportamiento anterior a B4.
    if (abierto && resaltado >= 0 && resaltado < sugerencias.length) {
      elegirTag(sugerencias[resaltado]);
      return;
    }
    buscarTextoLibre();
  }

  /** Flechas + Esc. Enter lo gestiona el submit del formulario. */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setAbierto(false);
      setResaltado(-1);
      return;
    }
    if (!abierto || sugerencias.length === 0) return;

    // El último índice es la salida de escape, para poder llegar a ella con el teclado.
    const ultimo = sugerencias.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setResaltado((prev) => (prev >= ultimo ? 0 : prev + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setResaltado((prev) => (prev <= 0 ? ultimo : prev - 1));
    }
  }

  const hayDesplegable = abierto && query.trim().length >= MIN_CHARS;

  return (
    <form
      ref={contenedorRef}
      onSubmit={handleSubmit}
      className="relative flex flex-col gap-2 rounded-2xl border bg-background p-2 shadow-lg md:flex-row md:items-stretch md:gap-0"
    >
      {categories.length > 0 && (
        <div className="border-b md:w-48 md:shrink-0 md:border-b-0 md:border-r">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Categoría"
            className="h-12 w-full rounded-xl bg-transparent px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-full md:text-base"
          >
            <option value="">Categoría</option>
            {categories.map((cat) =>
              cat.children && cat.children.length > 0 ? (
                <optgroup key={cat.slug} label={cat.name}>
                  <option value={cat.slug}>Todo en {cat.name}</option>
                  {cat.children.map((child) => (
                    <option key={child.slug} value={child.slug}>{child.name}</option>
                  ))}
                </optgroup>
              ) : (
                <option key={cat.slug} value={cat.slug}>{cat.name}</option>
              ),
            )}
          </select>
        </div>
      )}

      <div className="border-b md:w-44 md:shrink-0 md:border-b-0 md:border-r">
        <select
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          aria-label="Provincia"
          className="h-12 w-full rounded-xl bg-transparent px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-full md:text-base"
        >
          <option value="">Toda España</option>
          {PROVINCIAS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="relative flex-1">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query.trim().length >= MIN_CHARS && setAbierto(true)}
          placeholder="¿Qué estás buscando?"
          role="combobox"
          aria-expanded={hayDesplegable}
          aria-controls="sugerencias-etiquetas"
          aria-autocomplete="list"
          className="h-14 w-full rounded-xl border-0 bg-transparent pl-12 pr-10 text-lg ring-offset-background placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-16 md:text-xl"
        />
        {cargando && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      <Button type="submit" size="lg" className="h-14 rounded-xl px-6 text-base md:h-16 md:px-8 md:text-lg">
        Buscar
      </Button>

      {/* B4 — DESPLEGABLE. Las etiquetas ARRIBA y destacadas; el texto libre al final,
          como salida de escape. Ese orden ES la decisión de producto: el texto libre
          existe, pero canalizado hacia el vocabulario controlado. */}
      {hayDesplegable && (
        <div
          id="sugerencias-etiquetas"
          role="listbox"
          data-testid="sugerencias-etiquetas"
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border bg-background shadow-xl"
        >
          {sugerencias.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Etiquetas
              </p>
              <ul>
                {sugerencias.map((tag, i) => (
                  <li key={tag.slug}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={resaltado === i}
                      onMouseEnter={() => setResaltado(i)}
                      onClick={() => elegirTag(tag)}
                      className={[
                        'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors',
                        resaltado === i ? 'bg-accent' : 'hover:bg-accent/60',
                      ].join(' ')}
                    >
                      <TagIcon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="flex-1 font-medium">{tag.name}</span>
                      {/* El (0) se muestra, no se esconde: es información honesta —
                          "existe pero todavía no hay nada". Ver P6 del diseño. */}
                      <span className="text-xs text-muted-foreground">({tag.count})</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {sugerencias.length === 0 && !cargando && (
            <p className="px-4 pt-3 text-sm text-muted-foreground">
              Ninguna etiqueta coincide.
            </p>
          )}

          <div className={sugerencias.length > 0 ? 'border-t' : ''}>
            <button
              type="button"
              role="option"
              aria-selected={resaltado === sugerencias.length}
              onMouseEnter={() => setResaltado(sugerencias.length)}
              onClick={buscarTextoLibre}
              data-testid="buscar-texto-libre"
              className={[
                'flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors',
                resaltado === sugerencias.length ? 'bg-accent' : 'hover:bg-accent/60',
              ].join(' ')}
            >
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                Buscar <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span> en todo
              </span>
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
