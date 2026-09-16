import type { ProfileBlock } from '@/types/blocks';
import { isSafeSrc } from '@/lib/image-domains';

/**
 * ══ ESCAPARATE · LA FICHA, CON ASPECTO DE TARJETA DE CONTACTO ════════════════════════
 *
 * ── DE QUÉ SE VIENE ────────────────────────────────────────────────────────────────
 *
 * Era el ÚNICO bloque de la columna de lectura que C-bis dejó sin revestir: una fila
 * suelta sobre el fondo de la página —sin caja, sin borde, sin sombra— entre vecinos que
 * sí la tienen (`steps`, `hub`, `faq`, y la cita convertida en pieza). Rodeada de cajas,
 * una ficha sin caja no se lee como una ficha: se lee como texto descolgado.
 *
 * ── LA ESTRUCTURA ES COMÚN A LOS CINCO MODELOS, Y EL SABOR SALE DE LOS TOKENS ──────
 *
 * Aquí no hay una sola condición por modelo, y no hace falta ninguna: las cuatro
 * utilidades que forman la caja YA responden al modelo por sí solas —`rounded-2xl` es
 * `calc(var(--radius) * 2)` (tailwind.config.ts), y `border`, `bg-card` y `shadow-sm`
 * son tokens de `globals.css`—. Premium la reviste con su radio corto y su sombra fría;
 * Vibrante, con el radio largo y su color. Es el mismo componente y no se parecen.
 *
 * Por eso la frontera se respeta sin esfuerzo: `estilo-invariancia.spec.ts` compara el
 * árbol ignorando `class` y `style`, y aquí lo único que cambia entre modelos ES la
 * clase. Ninguna parte de la ficha aparece o desaparece según el modelo; lo que decide
 * qué se pinta son los DATOS (¿hay foto?, ¿hay nombre?, ¿hay atributos?), que son los
 * mismos para los cinco.
 *
 * ── LAS CUATRO DECISIONES DE ASPECTO ───────────────────────────────────────────────
 *
 *  1. **La caja se separa del fondo**, que es el encargo entero: `bg-card` + `border` +
 *     `shadow-sm`, el mismo revestimiento que `steps` — no un dialecto nuevo.
 *  2. **La foto manda**: 128 px y redonda, centrada arriba. Lleva `width`/`height`
 *     explícitos además de las clases: la caja queda reservada ANTES de que la imagen
 *     llegue, así que la tarjeta no puede empujar el texto al cargar (CLS cero).
 *  3. **El nombre, grande y con la voz de los titulares**: `text-2xl` —un peldaño de la
 *     escala que ya existe, no un tamaño inventado— y `font-heading`, que en los modelos
 *     con serifa lo lee como lo que es, un nombre propio y no una línea más del cuerpo.
 *  4. **Los datos, debajo y a dos columnas**, separados por un filete. La etiqueta en
 *     versalitas atenuadas y el valor en el color del cuerpo: la jerarquía dice cuál de
 *     los dos se lee primero. Y el valor ENVUELVE en vez de truncarse — lo de antes
 *     (`truncate`) cortaba en seco cualquier correo o dirección un poco larga, que es
 *     justo el dato que una tarjeta de contacto existe para dar.
 *
 * ── LO QUE NO LLEVA, Y ES DELIBERADO ───────────────────────────────────────────────
 *
 * No lleva `.tarjeta-levanta`. Ese gesto significa «esto se puede tocar» y la ficha no
 * lleva a ninguna parte: levantarla al pasar por encima prometería un clic que no existe.
 */
export function ProfileBlockRenderer({ block }: { block: ProfileBlock }) {
  return (
    <div
      data-testid="bloque-ficha"
      className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        {block.image && isSafeSrc(block.image.url) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={block.image.url}
            alt={block.image.alt}
            width={128}
            height={128}
            className="h-32 w-32 rounded-full border object-cover shadow-md"
          />
        )}
        {block.name && (
          <p className="font-heading text-2xl font-semibold leading-tight">{block.name}</p>
        )}
      </div>
      {block.attributes.length > 0 && (
        <dl className="mt-6 grid gap-x-8 gap-y-4 border-t pt-6 sm:grid-cols-2">
          {block.attributes.map((attr, idx) => (
            <div key={idx} className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {attr.label}
              </dt>
              <dd className="mt-1 break-words font-medium">{attr.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
