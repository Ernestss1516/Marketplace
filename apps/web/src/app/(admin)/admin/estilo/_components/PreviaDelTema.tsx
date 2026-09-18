'use client';

import { AlertTriangle, Info, Sparkles } from 'lucide-react';
import type { EstiloResuelto } from '@/lib/api/estilo';
import { textoDeFallo } from '@/lib/api/estilo-admin';

/**
 * E9 — LA PREVISUALIZACIÓN. Los componentes representativos del §11, pintados con el tema
 * que el servidor ha resuelto: un botón de cada variante, una tarjeta, un banner de aviso
 * y un campo con error.
 *
 * ── LO QUE PINTA ES EL TEMA GUARDADO, Y SE DICE CUANDO NO LO ES ──────────────────────
 *
 * Ésta es la decisión de fondo de la pantalla, así que conviene dejarla escrita.
 *
 * De los cuatro colores que el admin elige, el frontend **sólo sabe qué hacen tres**:
 * `primary`, `secondary` y `accent` se copian tal cual al token del mismo nombre
 * (`resolverTokens`: `tokens[slot] = colores[slot]`). Todo lo demás es derivación del
 * modelo y vive en el backend a propósito:
 *
 *  · el `neutral` no es un color de la interfaz, es el origen de una RAMPA —lienzo,
 *    superficies, trazo, texto— que se calcula con las franjas del modelo;
 *  · la LETRA que va sobre cada color de marca la elige `mejorTextoSobre` midiendo
 *    contraste. Es la decisión #2 de E4a y el motivo de que no haya un quinto mando.
 *
 * Reproducir esas dos cosas aquí sería copiar el motor del tema al frontend: la regla
 * innegociable del proyecto («NestJS es la única fuente de verdad de la lógica de
 * negocio») lo prohíbe, y con razón — dos motores divergen, y el día que lo hicieran la
 * previa enseñaría un tema que la plataforma no tiene.
 *
 * Así que esta previa **no adivina**. Pinta el `resuelto` que vino del servidor y, si el
 * borrador ya no coincide con él, lo dice con todas las letras en vez de enseñar una
 * mezcla a medio derivar. Al guardar, el PUT devuelve el tema nuevo resuelto y esto se
 * repinta con lo que la plataforma está sirviendo de verdad — que es exactamente lo que
 * hay que ver antes de irse de la pantalla.
 *
 * Es la misma honestidad que `ZonaDeMarca`, que previsualiza el logo **que se está
 * sirviendo** y no el fichero que se acaba de elegir.
 */
export function PreviaDelTema({
  resuelto,
  hayCambiosSinGuardar,
}: {
  resuelto: EstiloResuelto;
  hayCambiosSinGuardar: boolean;
}) {
  // Los tokens del tema resuelto, aplicados como variables CSS a este subárbol y sólo a
  // él: la previa se pinta con el tema de la plataforma sin repintar el backoffice
  // alrededor. Es el mismo mecanismo que el bloque de `:root`, con menos alcance.
  const variables = Object.fromEntries(
    Object.entries(resuelto.tokens).map(([nombre, valor]) => [`--${nombre}`, valor]),
  ) as React.CSSProperties;

  return (
    <section className="space-y-3" data-testid="previa-tema">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Previsualización</h2>
        <p className="text-xs text-muted-foreground">
          Modelo <span className="font-mono">{resuelto.modelo}</span>, versión{' '}
          <span className="font-mono">{resuelto.version}</span>
        </p>
      </div>

      {hayCambiosSinGuardar && (
        <p
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400"
          data-testid="previa-desactualizada"
        >
          Esto es el tema que está activo ahora mismo. Tus cambios todavía no están
          guardados: el fondo, las superficies y el color de la letra los deriva el
          servidor a partir de lo que elijas, así que no se pueden mostrar hasta guardar.
        </p>
      )}

      <div
        style={variables}
        className="space-y-4 rounded-md border bg-background p-4 text-foreground"
        data-testid="previa-lienzo"
      >
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            Principal
          </span>
          <span className="inline-flex h-9 items-center rounded-md bg-secondary px-4 text-sm font-medium text-secondary-foreground">
            Secundario
          </span>
          <span className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground">
            Resalte
          </span>
          <span className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium">
            Contorno
          </span>
          <span className="inline-flex h-9 items-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground">
            Destructivo
          </span>
        </div>

        <div className="rounded-md border bg-card p-3 text-card-foreground">
          <p className="text-sm font-semibold">Una tarjeta</p>
          <p className="mt-1 text-sm text-muted-foreground">
            El texto atenuado que acompaña a casi todo en la plataforma.
          </p>
        </div>

        {/*
          LOS TRES ESTILOS DE BANNER, Y ANTES AQUÍ HABÍA UN COLOR FIJO.

          Esto era un solo banner pintado con `border-amber-500/50 bg-amber-500/10
          text-amber-600`: ámbar de Tailwind, escrito a mano, **dentro del panel cuyo
          trabajo entero es enseñar cómo queda el modelo elegido**. Los botones de arriba
          giran con el tema, la tarjeta gira, el campo con error gira; el banner se quedaba
          ámbar en los cinco modelos y en oscuro. Y encima mentía sobre el componente que
          decía representar: el aviso real del backoffice (`Aviso.tsx`, las 29 copias) usa
          `--warning` desde E0.

          Ahora son los TRES —la misma terna que puede publicar un administrador— con sus
          tokens. Son tres porque es lo que hay que poder juzgar antes de guardar un modelo:
          que se distingan ENTRE SÍ y que peguen con el resto del tema. Con uno solo no se
          puede ver ni lo uno ni lo otro.

          La cadena de forma es LA MISMA para los tres y la misma que la de `BannerList`
          (`rounded-md border px-…`): si algún día un modelo pudiera cambiarla, esta previa
          lo enseñaría. Lo único que varía entre las tres líneas es el color.
        */}
        <div className="space-y-2" data-testid="previa-banners">
          <div
            className="flex items-start gap-2 rounded-md border border-info-border bg-info px-3 py-2 text-sm text-info-foreground"
            data-testid="previa-banner-info"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Un banner de información.</span>
          </div>
          <div
            className="flex items-start gap-2 rounded-md border border-promo-border bg-promo px-3 py-2 text-sm text-promo-foreground"
            data-testid="previa-banner-promo"
          >
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Un banner de promoción — el único de los tres que cambia con el modelo.</span>
          </div>
          <div
            className="flex items-start gap-2 rounded-md border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground"
            data-testid="previa-banner-aviso"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Un banner de aviso, el que aparece 29 veces en el backoffice.</span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="previa-campo">
            Un campo con error
          </label>
          <input
            id="previa-campo"
            readOnly
            value="Valor que no vale"
            className="h-9 w-full rounded-md border border-destructive bg-background px-2 text-sm"
          />
          <p className="text-xs text-destructive">Este campo no es válido.</p>
        </div>
      </div>

      {/*
        LOS AVISOS NO IMPIDEN GUARDAR, y por eso se enseñan aquí y no como error de campo:
        son parejas que se miden e informan pero que la norma no exige (§ el trazo
        decorativo y WCAG 1.4.11). Quien diseñe un modelo con personalidad quiere el
        número a la vista; quien sólo cambia un azul no tiene que hacer nada con esto.
      */}
      {resuelto.avisos.length > 0 && (
        <div className="space-y-1" data-testid="previa-avisos">
          <p className="text-xs font-medium text-muted-foreground">
            Contrastes por debajo de la norma que no impiden guardar:
          </p>
          {resuelto.avisos.map((aviso) => (
            <p key={aviso.pareja} className="text-xs text-muted-foreground">
              {textoDeFallo({
                pareja: aviso.pareja,
                contrasteActual: aviso.ratio,
                contrasteMinimo: aviso.minimo,
              })}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
