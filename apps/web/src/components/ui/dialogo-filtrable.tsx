'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OpcionFiltrable } from './dialogo-filtrable-tipos';

export type { OpcionFiltrable };

/**
 * ══ BUSCADOR · BQ-B — EL DIÁLOGO FILTRABLE ═══════════════════════════════════════════
 *
 * Un disparador que abre una capa con un campo de texto arriba y una lista debajo que se
 * recorta según se escribe. Sustituye a un `<select>` allí donde la lista es larga o
 * jerárquica. `docs/diseno-buscador.md` §2.
 *
 * ── ESTE COMPONENTE NO SABE DE DOMINIO, Y ESO ES LA MITAD DEL DISEÑO ────────────────
 *
 * No conoce categorías ni provincias, no recorre árboles, no lee constantes, **no navega,
 * no toca la URL y no llama a ninguna API**. Recibe una lista ya normalizada, escribe un
 * valor y cierra. Quien sabe de dominio son los adaptadores (`CategoriaDialogo`,
 * `ProvinciaDialogo`), y es lo que permite que esto sirva mañana para unificar el
 * `<select>` de provincia de `/busqueda` sin tocarle una línea.
 *
 * ── EL REPARTO EN DOS FICHEROS ES UNA DECISIÓN DE PESO, NO DE ORDEN ────────────────
 *
 * Aquí vive **sólo el disparador**, que es un `<button>` y nada más. Toda la capa —Radix
 * Dialog, el filtro, la lista— está en `dialogo-filtrable-capa.tsx` y llega por
 * `next/dynamic`, así que **su código no viaja en la primera carga de la portada**: la
 * descarga se dispara al abrir, porque `dynamic()` sólo la dispara cuando el componente se
 * RENDERIZA (el mismo argumento con el que `MapViewClient` deja MapLibre fuera de
 * `/busqueda` hasta que alguien pide el mapa).
 *
 * **No es una precaución: es un número medido con `next build`.** Con la capa importada a
 * secas, la portada pasaba de 228 kB a 242 kB de First Load JS — 14 kB en la página de más
 * tráfico del sitio, que es exactamente lo que el §7 del diseño pedía no pagar. El diseño
 * daba por hecho que `@radix-ui/react-dialog` ya viajaba en ese chunk y dejó escrito que
 * había que medirlo antes de afirmarlo. No viajaba.
 *
 * ⚠ **«NO SE RENDERIZA» NO ERA «NO SE DESCARGA».** Radix no monta el portal mientras el
 * diálogo está cerrado, así que el CONTENIDO no se pintaba — pero el CÓDIGO se descargaba
 * igual. Son dos cosas distintas y el diseño las había tratado como una, igual que §5.2 del
 * escaparate trataba «está en el HTML servido» y «funciona sin JS» como una sola.
 *
 * ── POR QUÉ LA CAPA SE CONSTRUYE SOBRE `ui/dialog.tsx` ─────────────────────────────
 *
 * Porque `DialogContent` declara `data-zona` en LOS DOS nodos portalados (el velo y el
 * contenido), que es el mecanismo con el que E6 devolvió a los overlays los tokens de su
 * zona después de que el portal los sacara del subárbol. `AdminMobileNav` sí se bajó al
 * primitivo, y pudo porque **pertenece a una zona por construcción y se la escribe a
 * mano**; un componente genérico no puede saber dónde se abre. En la portada eso significa
 * que el sabor del modelo llega SOLO: la zona pública es la BASE, no se emite `data-zona` y
 * la capa hereda de `html:root`.
 */

/**
 * `loading: null` y no un esqueleto: una capa que aún no está no deja hueco que rellenar,
 * y un destello de caja vacía sobre el velo se lee peor que el instante de nada que
 * sustituye. `ssr: false` porque esto sólo existe tras un clic.
 */
const CapaFiltrable = dynamic(() => import('./dialogo-filtrable-capa'), {
  ssr: false,
  loading: () => null,
});

export interface DialogoFiltrableProps {
  opciones: OpcionFiltrable[];
  /** El valor elegido ahora. Cadena vacía = ninguno. */
  valor: string;
  /**
   * ⚠ SE LLAMA **SÓLO** AL ELEGIR UNA FILA, NUNCA AL TECLEAR. Es la invariante que hace
   * imposible enviar texto aproximado donde el backend filtra con un `=` exacto (§4.3 del
   * diseño). El campo de texto FILTRA; no es el campo del valor.
   */
  onElegir: (valor: string) => void;
  /** Lo que muestra el disparador sin selección («Categoría», «Toda España»). */
  etiquetaVacio: string;
  /** La fila que borra la selección. Siempre la primera, y siempre visible. */
  opcionLimpiar: string;
  /** `DialogTitle`. Obligatorio: Radix lo exige para el nombre accesible de la capa. */
  titulo: string;
  /** Placeholder y etiqueta accesible del campo de filtro. */
  marcadorFiltro: string;
  /** El nombre del campo. Es el asidero de los tests y la etiqueta accesible. */
  etiquetaDisparador: string;
  /**
   * La geometría del disparador dentro de su fila — alto, ancho, tipografía.
   *
   * ⚠ **EL ALTO LO DECIDE QUIEN MONTA EL COMPONENTE, NO EL COMPONENTE.** El defecto es
   * `h-10`, que es el de `ui/input.tsx` y el de cualquier control de formulario de la casa;
   * el buscador de portada pasa `h-14 md:h-16` porque allí los cuatro controles forman una
   * pieza y tienen que medir lo mismo (BQ-C). Si el alto viviera aquí, el día que este
   * molde entre en `FilterPanel` —donde los controles son de 40 px— habría que negociarlo
   * dentro de un componente que no sabe dónde se está pintando.
   *
   * `cn()` es `twMerge`, así que lo que llegue por aquí GANA a lo de abajo.
   */
  className?: string;
}

export function DialogoFiltrable({
  opciones,
  valor,
  onElegir,
  etiquetaVacio,
  opcionLimpiar,
  titulo,
  marcadorFiltro,
  etiquetaDisparador,
  className,
}: DialogoFiltrableProps) {
  const [abierto, setAbierto] = React.useState(false);
  const disparadorRef = React.useRef<HTMLButtonElement>(null);

  /**
   * ⚠ EL FOCO VUELVE AL DISPARADOR, Y LO DEVOLVEMOS NOSOTROS. MEDIDO EN BQ-C.
   *
   * Radix restaura el foco al cerrar una capa: su `FocusScope` guarda quién lo tenía al
   * montarse y se lo devuelve al desmontarse. **Aquí no llegaba a hacerlo**, y la causa es
   * el reparto que BQ-B introdujo por peso: la capa no se «cierra», se DESMONTA entera de
   * golpe (`{abierto && <CapaFiltrable/>}`), así que Radix nunca ve su `open` pasar a
   * `false` y su secuencia de cierre no se ejecuta como cuando controla el estado él.
   *
   * El síntoma era exactamente el que un teclado nota: pulsas `Esc`, la capa se va y el
   * foco se queda en el `<body>` — «inactive», decía el test—. Quien navega sin ratón se
   * quedaba en el limbo, en medio de un formulario.
   *
   * El `requestAnimationFrame` no es decorativo: en el mismo fotograma todavía se están
   * ejecutando las limpiezas de `react-remove-scroll` y `aria-hidden`, y un `focus()`
   * lanzado ahí se lo puede llevar por delante. Al fotograma siguiente el documento ya está
   * entero.
   */
  const cerrar = React.useCallback(() => {
    setAbierto(false);
    requestAnimationFrame(() => disparadorRef.current?.focus());
  }, []);

  const elegida = opciones.find((o) => o.valor === valor);

  return (
    <>
      {/*
        EL DISPARADOR CONSERVA EL `aria-label` DEL `<select>` QUE SUSTITUYE, y por eso
        `getByLabel('Categoría')` sigue encontrando el control después de esta ráfaga: lo
        único que cambia es la acción (`e2e/helpers/buscador.ts`).

        El valor elegido se añade al nombre accesible en vez de quedarse sólo en el texto
        visible: un `aria-label` PISA el contenido del botón, así que sin esto un lector de
        pantalla anunciaría «Categoría» y nunca «Coches» — que es justo lo que un `<select>`
        sí decía.

        `type="button"` explícito y no heredado de Radix: este botón vive dentro del
        `<form>` del buscador de portada, donde el defecto es `submit`, y abrir el diálogo
        no puede lanzar la búsqueda. Antes lo ponía `DialogTrigger`; al sacar a Radix del
        camino crítico, lo pone este fichero — y es la clase de detalle que se pierde en una
        refactorización si no queda escrito.
      */}
      <button
        ref={disparadorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={elegida ? `${etiquetaDisparador}: ${elegida.etiqueta}` : etiquetaDisparador}
        onClick={() => setAbierto(true)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-xl bg-transparent px-4',
          // ⚠ `md:text-base` NO ES EL ALTO Y NO SE VA CON ÉL. BQ-C quitó de aquí el
          // `md:h-full` —el que disimulaba la incoherencia de alturas— y se llevó por
          // delante esta línea; la captura de escritorio lo cazó en la misma corrida,
          // porque el texto del disparador había encogido de 16 a 14 px sin que el alto
          // cambiara. Es la escala del `<select>` al que sustituye, y se queda.
          'text-left text-sm text-foreground md:text-base',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <span className={cn('truncate', !elegida && 'text-muted-foreground')}>
          {elegida?.etiqueta ?? etiquetaVacio}
        </span>
        {/* Un diálogo no despliega hacia abajo, pero el chevron es lo que comunica «esto se
            abre» y es lo que el usuario asocia a un selector (decisión C del §13). El grosor
            del trazo lo pone el modelo por token (`--icon-stroke`). */}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {/* Montar y desmontar en vez de abrir y cerrar. Dos consecuencias buenas: la descarga
          diferida se dispara aquí, y la capa nace con el campo vacío sin que nadie tenga que
          acordarse de vaciarlo. */}
      {abierto && (
        <CapaFiltrable
          opciones={opciones}
          valor={valor}
          onElegir={onElegir}
          onCerrar={cerrar}
          opcionLimpiar={opcionLimpiar}
          titulo={titulo}
          marcadorFiltro={marcadorFiltro}
        />
      )}
    </>
  );
}
