'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { filtrarPorTexto, normalizarParaFiltrar } from '@/lib/filtro-texto';
import { cn } from '@/lib/utils';
import type { OpcionFiltrable } from './dialogo-filtrable-tipos';

/**
 * ══ LA CAPA DEL DIÁLOGO FILTRABLE — Y VIVE APARTE POR UNA RAZÓN MEDIDA ═══════════════
 *
 * Todo lo que hay aquí dentro —Radix Dialog con `react-remove-scroll` y `aria-hidden`, el
 * filtro, la lista— **son 14 kB de First Load JS en la portada**, que es la página de más
 * tráfico del sitio. Se midió con `next build`, antes y después:
 *
 *     sin diálogos:   /  →  6.29 kB de ruta, 228 kB de First Load
 *     con diálogos:   /  →  6.88 kB de ruta, 242 kB de First Load
 *
 * El diseño daba por hecho que `@radix-ui/react-dialog` ya viajaba en ese chunk y dejó
 * escrito que había que MEDIRLO antes de afirmarlo (§7.1). No viajaba.
 *
 * ── Y «NO SE RENDERIZA» NO ES «NO SE DESCARGA» ─────────────────────────────────────
 *
 * Es la confusión que el número destapa: Radix no monta el portal mientras el diálogo está
 * cerrado, así que el CONTENIDO no se pinta — pero el CÓDIGO viajaba igual en la primera
 * carga. `dialogo-filtrable.tsx` lo importa con `next/dynamic`, y entonces sí: **la
 * descarga se dispara al abrir**, porque `dynamic()` sólo la dispara cuando el componente
 * se RENDERIZA. Es el mismo argumento, escrito y medido, con el que `MapViewClient` deja
 * MapLibre fuera de `/busqueda` hasta que alguien pide el mapa.
 *
 * ── LO QUE ESTE FICHERO GANA DE PROPINA ────────────────────────────────────────────
 *
 * Que se monta ENTERO en cada apertura, así que el texto del filtro y la fila resaltada
 * nacen limpios sin que nadie los reinicie. Lo que antes era un manejador de apertura que
 * se acordaba de vaciar el campo, ahora es el estado inicial de un componente nuevo.
 */

export interface CapaFiltrableProps {
  opciones: OpcionFiltrable[];
  valor: string;
  onElegir: (valor: string) => void;
  /** Llamado cuando Radix cierra la capa (Esc, velo, botón). El padre la desmonta. */
  onCerrar: () => void;
  opcionLimpiar: string;
  titulo: string;
  marcadorFiltro: string;
}

export default function CapaFiltrable({
  opciones,
  valor,
  onElegir,
  onCerrar,
  opcionLimpiar,
  titulo,
  marcadorFiltro,
}: CapaFiltrableProps) {
  const [texto, setTexto] = React.useState('');
  /**
   * Arranca en la opción YA ELEGIDA (decisión 5), para que `Enter` nada más abrir no haga
   * nada sorprendente. El `+ 1` salta la fila de limpiar, que siempre es la primera.
   */
  const [resaltado, setResaltado] = React.useState(() => {
    const i = opciones.findIndex((o) => o.valor === valor);
    return i >= 0 ? i + 1 : 0;
  });

  const campoRef = React.useRef<HTMLInputElement>(null);
  const zonaScrollRef = React.useRef<HTMLDivElement>(null);
  const idLista = React.useId();

  const q = normalizarParaFiltrar(texto);

  /**
   * El filtro, en dos pasadas y con la segunda como red (§3.3 del diseño). La primera busca
   * en `buscable`, que es lo preciso; si no casa nada, la segunda busca en `buscableAmplio`
   * antes de decir que no hay nada.
   */
  const coincidencias = React.useMemo(() => {
    if (!q) return opciones;
    const porNombre = filtrarPorTexto(opciones, q, (o) => o.buscable);
    if (porNombre.length > 0) return porNombre;
    return filtrarPorTexto(opciones, q, (o) => o.buscableAmplio ?? o.buscable);
  }, [opciones, q]);

  /**
   * La fila de limpiar va DENTRO de la lista y no en un botón aparte, por lo mismo que era
   * la primera `<option>` del `<select>`: así se alcanza con las flechas y con el mismo
   * gesto que las demás. **Y no desaparece al teclear** (decisión B del §13): es una
   * acción, no un resultado — esconderla obligaría a borrar el texto para poder limpiar.
   */
  const filas: OpcionFiltrable[] = React.useMemo(
    () => [{ valor: '', etiqueta: opcionLimpiar, buscable: opcionLimpiar }, ...coincidencias],
    [opcionLimpiar, coincidencias],
  );

  /** Acotado al render: `resaltado` puede quedar fuera de rango al recortarse la lista. */
  const activo = Math.min(resaltado, filas.length - 1);
  const idActivo = `${idLista}-op-${activo}`;

  /**
   * Mantiene visible la fila resaltada cuando se llega a ella con el teclado.
   *
   * Se localiza por `aria-selected` y no por el id: `useId()` devuelve cadenas con
   * caracteres que un selector CSS no admite sin escapar (`«r0»` en React 19), y buscar por
   * atributo evita esa trampa entera. El `typeof` cubre a jsdom, que no implementa
   * `scrollIntoView`: un test que renderice esto no debe morir por el scroll.
   */
  React.useEffect(() => {
    const fila = zonaScrollRef.current?.querySelector('[aria-selected="true"]');
    if (fila && typeof fila.scrollIntoView === 'function') {
      fila.scrollIntoView({ block: 'nearest' });
    }
  }, [activo]);

  /** En cuanto hay texto, la primera COINCIDENCIA (índice 1; el 0 es limpiar). */
  function alTeclear(e: React.ChangeEvent<HTMLInputElement>) {
    setTexto(e.target.value);
    setResaltado(1);
  }

  function elegir(fila: OpcionFiltrable) {
    onElegir(fila.valor);
    onCerrar();
  }

  /**
   * Flechas y Enter. `Esc` y `Tab` los gestiona Radix —cierra la capa y devuelve el foco al
   * disparador—, así que aquí no se tocan.
   *
   * Las flechas SE DETIENEN en los extremos en vez de ciclar, igual que
   * `MunicipioAutocomplete`: en una lista larga, ciclar desde el final hasta el principio se
   * lee como un salto, no como un movimiento.
   */
  function alPulsarTecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setResaltado(Math.min(activo + 1, filas.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setResaltado(Math.max(activo - 1, 0));
    } else if (e.key === 'Enter') {
      // El contenido está portalado a `<body>`, o sea FUERA del `<form>` del buscador, así
      // que este Enter no podría enviarlo. Se frena igual: la tecla la consume la lista.
      e.preventDefault();
      const fila = filas[activo];
      if (fila) elegir(fila);
    }
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent
        /*
         * Móvil: hoja a pantalla completa. `inset-0` anula el centrado de `DialogContent` y
         * `translate-*-0` su desplazamiento; `flex-col` + `min-h-0` en la zona de scroll es
         * lo que hace que scrollee la lista y no la capa entera.
         *
         * A partir de `md`: se restaura punto por punto la geometría de casa. El
         * `sm:rounded-lg` que trae `DialogContent` se neutraliza a propósito — entre 640 y
         * 768 px la hoja sigue siendo hoja, y redondearle las esquinas fuera de pantalla es
         * una costura que no se ve pero está.
         */
        className={cn(
          'inset-0 flex h-full max-h-none w-full max-w-none translate-x-0 translate-y-0',
          'flex-col gap-3 rounded-none border-0 p-4 sm:rounded-none',
          'md:inset-auto md:left-[50%] md:top-[50%] md:h-auto md:max-h-[80vh] md:max-w-lg',
          'md:translate-x-[-50%] md:translate-y-[-50%] md:gap-4 md:rounded-lg md:border md:p-6',
        )}
        onOpenAutoFocus={(e) => {
          // El foco va al CAMPO y no al primer botón de la capa: lo que se viene a hacer
          // aquí es escribir. Radix enfocaría el contenedor, y entonces la primera tecla se
          // perdería.
          e.preventDefault();
          campoRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{titulo}</DialogTitle>
          {/* Radix avisa por consola si la capa no tiene descripción, y de paso esto le dice
              a quien no ve la lista cómo se maneja. */}
          <DialogDescription className="sr-only">
            Escribe para filtrar la lista y elige una opción. Usa las flechas para recorrerla
            y Enter para elegir.
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={campoRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={idActivo}
            aria-label={marcadorFiltro}
            autoComplete="off"
            value={texto}
            onChange={alTeclear}
            onKeyDown={alPulsarTecla}
            placeholder={marcadorFiltro}
            className={cn(
              'flex h-10 w-full rounded-md border border-input bg-background py-2 pl-9 pr-3',
              'text-base ring-offset-background placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'md:text-sm',
            )}
          />
        </div>

        {/* El contenedor que scrollea envuelve a la lista en vez de SER la lista: el aviso
            de «nada coincide» tiene que caer dentro del área con scroll, y un
            `role="listbox"` sólo admite opciones y grupos como hijos. */}
        <div ref={zonaScrollRef} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <ul id={idLista} role="listbox" aria-label={titulo}>
            {filas.map((fila, i) => (
              <li
                key={`${fila.valor}-${i}`}
                id={`${idLista}-op-${i}`}
                role="option"
                aria-selected={i === activo}
                data-valor={fila.valor}
                onMouseEnter={() => setResaltado(i)}
                onPointerDown={(e) => {
                  // Sin esto, el `pointerdown` saca el foco del campo antes de que el clic
                  // llegue a registrarse. Mismo cuidado que `MunicipioAutocomplete`.
                  e.preventDefault();
                  elegir(fila);
                }}
                className={cn(
                  'flex cursor-pointer items-baseline gap-2 rounded-md px-3 py-2.5 text-sm',
                  i === activo ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{fila.etiqueta}</span>
                {fila.nota && (
                  <span className="shrink-0 text-xs text-muted-foreground">{fila.nota}</span>
                )}
                {fila.contexto && (
                  <span className="shrink-0 truncate text-xs text-muted-foreground">
                    {fila.contexto}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {coincidencias.length === 0 && (
            /* `role="status"` para que un lector de pantalla lo ANUNCIE al quedarse la lista
               vacía; sin él, quien no ve la pantalla sólo oiría silencio. */
            <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nada coincide.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
