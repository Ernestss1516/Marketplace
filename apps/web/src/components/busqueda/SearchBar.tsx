'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, Tag as TagIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoriaDialogo } from '@/components/busqueda/CategoriaDialogo';
import { ProvinciaDialogo } from '@/components/busqueda/ProvinciaDialogo';
import { categoryPathWithQuery, findCategoryUrlParts } from '@/lib/category-url';
import { suggestTags } from '@/lib/api/categorias';
import type { Category, TagSuggestion } from '@/types';

interface SearchBarProps {
  defaultValue?: string;
  /** Categorías top-level para el selector — pasadas por el llamador (ya cargadas server-side), sin query propia. */
  categories?: Category[];
}

/**
 * ══ BUSCADOR · BQ-C — LA ESCALA DE ALTO, UNA Y ESCRITA EN UN SOLO SITIO ══════════════
 *
 * **Los CUATRO controles del buscador miden lo mismo**: los dos disparadores, el campo de
 * texto y el botón. Es el punto 2 del encargo —que el buscador se lea como UNA pieza y no
 * como cuatro cajas— y hasta BQ-C no se cumplía.
 *
 * ── LO QUE HABÍA, MEDIDO ───────────────────────────────────────────────────────────
 *
 * En móvil, 48 / 48 / 56 / 56. En escritorio la incoherencia **estaba disimulada**: los dos
 * selectores llevaban `md:h-full`, o sea que se estiraban hasta el alto de la fila — que lo
 * fijaba el campo de texto con su `md:h-16`. Había un control que mandaba y tres que
 * obedecían, y sólo se notaba en móvil.
 *
 * Y no es una lectura del código: lo midió la MUTACIÓN de BQ-A. Bajar los dos `<select>` de
 * 48 a 44 px puso rojas las capturas de móvil y **dejó verdes las de escritorio**, porque
 * ahí el `md:h-full` se comía el cambio. Ese verde era el síntoma.
 *
 * ── POR QUÉ SE SUBE Y NO SE BAJA ───────────────────────────────────────────────────
 *
 * El campo de texto no puede encoger: es candidato a LCP con el buscador montado sobre la
 * banda del hero (`diseno-escaparate.md` §5.2) y es lo que da al buscador su peso visual.
 * La coherencia se consigue subiendo los otros tres hasta él.
 *
 * ── Y POR QUÉ EL VALOR VIVE AQUÍ Y NO EN EL MOLDE ──────────────────────────────────
 *
 * Porque `DialogoFiltrable` es genérico y su defecto es `h-10`, el de cualquier control de
 * formulario de la casa. Quien sabe que aquí hay cuatro controles que deben medir igual es
 * esta pantalla, no el componente. El día que el molde entre en `FilterPanel` —donde los
 * controles son de 40 px— no habrá nada que negociar dentro de él.
 *
 * ⚠ CLASES ESTÁTICAS, NUNCA INTERPOLADAS: Tailwind purga lo que no encuentra escrito. Es la
 * misma regla de `ALTURA_CLASS` en `HomeHeroBanda` y de `ROTATION_CLASS` en `HomeHero`.
 */
const ALTO_CONTROL = 'h-14 md:h-16';

/** B4 — a partir de aquí se piden sugerencias. Por debajo, casi todo casa con casi todo. */
const MIN_CHARS = 2;
/** Espera tras la última tecla. Suficiente para no disparar por letra, corto para no notarse. */
const DEBOUNCE_MS = 250;

/**
 * ══ BUSCADOR · BQ-B — LOS DOS FILTROS SON DIÁLOGOS, Y NADA MÁS CAMBIÓ ════════════════
 *
 * Los dos `<select>` nativos de categoría y provincia pasan a ser diálogos filtrables
 * (`ui/dialogo-filtrable.tsx` + sus dos adaptadores). **Lo que esos diálogos hacen es
 * escribir `category` y `province`. Punto.**
 *
 * `navegar()`, `paramsBase()`, `elegirTag()`, `buscarTextoLibre()` y `handleSubmit()` NO
 * SE TOCAN, y eso es lo que conserva sin negociar las dos decisiones que se ganaron antes:
 * A1 —con categoría elegida se va a su ruta CANÓNICA (`/vehiculos/coches?…`), no a
 * `?category=`— y B4 —elegir una sugerencia emite `?tags=<slug>` sobre ese mismo destino—.
 *
 * ⚠ TRES COSAS QUE PASAN AL METER UN DIÁLOGO DENTRO DE UN `<form>`, y ninguna es un
 * defecto:
 *
 *  1. El disparador es `type="button"` (lo pone Radix). Sin eso, abrirlo enviaría la
 *     búsqueda: un `<button>` dentro de un `<form>` es `submit` por defecto.
 *  2. **Abrir un diálogo cierra el desplegable de etiquetas.** El cierre por clic fuera
 *     (abajo) escucha en `document`, y el velo del diálogo se monta en `<body>`, o sea
 *     FUERA de este `<form>`. Es lo correcto —dos capas no deben convivir— y queda escrito
 *     para que nadie lo «arregle».
 *  3. `Esc` tiene dos dueños: sobre el campo de texto cierra las sugerencias; con un
 *     diálogo abierto lo atrapa Radix y cierra el diálogo. No chocan: son estados
 *     excluyentes.
 */
export function SearchBar({ defaultValue = '', categories = [] }: SearchBarProps) {
  const [query, setQuery] = useState(defaultValue);
  // BQ-B — los dos únicos estados que los diálogos escriben. Lo que se hace con ellos
  // (componer la query, elegir el destino) sigue viviendo más abajo, sin cambios.
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
   *
   * ⚠ `category` ES DEPENDENCIA, Y CON EL DIÁLOGO ESO SE NOTA MÁS (BQ-B). Elegir una
   * categoría vuelve a pedir las sugerencias, ya acotadas a ella — que es el
   * comportamiento correcto y sale gratis. La consecuencia visible: **cerrar el diálogo de
   * categoría puede repintar el desplegable de etiquetas que hay debajo**. No es un
   * defecto; es este efecto haciendo su trabajo.
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
      {/* BQ-B — EL GUARD SE MANTIENE, Y AQUÍ PESA MÁS QUE CON UN `<select>`. Sin
          categorías (la API caída: `getCategories().catch(() => [])` en la portada) el
          control entero no se pinta. Un `<select>` vacío se ve vacío desde fuera; un
          diálogo vacío hay que ABRIRLO para descubrir que no hay nada, y un disparador
          que promete una lista y enseña un hueco es peor que un control ausente. */}
      {categories.length > 0 && (
        <div className="border-b md:w-48 md:shrink-0 md:border-b-0 md:border-r">
          <CategoriaDialogo
            categories={categories}
            valor={category}
            onElegir={setCategory}
            className={ALTO_CONTROL}
          />
        </div>
      )}

      <div className="border-b md:w-44 md:shrink-0 md:border-b-0 md:border-r">
        <ProvinciaDialogo valor={province} onElegir={setProvince} className={ALTO_CONTROL} />
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
          className={`${ALTO_CONTROL} w-full rounded-xl border-0 bg-transparent pl-12 pr-10 text-lg ring-offset-background placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-xl`}
        />
        {cargando && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* ESCAPARATE C — el otro CTA de impacto. La zona de impacto son cuatro sitios
          (§6.1) y éste es uno: el botón que cierra el buscador de la portada. Lleva el
          mismo destello que el CTA canónico, con su clase y su `prefers-reduced-motion`
          (`.anima-brillo`, globals.css).

          El `<span>` del brillo va en un nodo APARTE del texto y con `aria-hidden`, así
          que apagarlo deja el botón entero. El `currentColor` del degradado hace que el
          destello sea del color de la letra: contrasta con el relleno sin un color
          escrito a mano. Ver `CtaButton`, donde está el porqué completo. */}
      <Button
        type="submit"
        size="lg"
        className={`${ALTO_CONTROL} relative overflow-hidden rounded-xl px-6 text-base md:px-8 md:text-lg`}
      >
        Buscar
        <span
          aria-hidden="true"
          className="anima-brillo pointer-events-none absolute inset-y-0 left-0 w-1/2 opacity-25"
          style={{ background: 'linear-gradient(90deg, transparent, currentColor, transparent)' }}
        />
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
