import { Video } from 'lucide-react';
import { ProHint } from '@/components/pro/ProGate';

/**
 * VÍDEO #11 — «EL VÍDEO SE AÑADE EDITANDO, NO AL PUBLICAR».
 *
 * ─── EL HUECO ────────────────────────────────────────────────────────────────────
 *
 * El asistente de publicar **no tiene paso de vídeo**; sólo lo tiene el editor. Así que un
 * vendedor Pro publicaba su anuncio sin ver el vídeo por ninguna parte y **nada le decía
 * que podía añadirlo después**. Una ventaja que se vende y se cobra quedaba invisible justo
 * en el momento en que alguien está creando el anuncio — que es cuando decide cómo va a
 * enseñar lo que vende.
 *
 * ─── POR QUÉ EL ARREGLO ES AVISAR Y NO METER EL PASO EN EL ASISTENTE ────────────
 *
 * Porque la ausencia **no es un descuido, es el modelo**: `StepVideo` recibe un
 * `listingId` y sube el fichero contra ese anuncio. En el asistente el anuncio **todavía no
 * existe** —se crea al final—, así que meter el paso ahí exigiría una subida en dos tiempos
 * (guardar el fichero en algún limbo y adoptarlo al crear), con su propia clase de
 * huérfanas. El backend está construido de forma coherente; lo único que faltaba era
 * decirlo.
 *
 * ─── DOS MENSAJES, PORQUE HAY DOS PERSONAS ──────────────────────────────────────
 *
 *  · **Pro**: ya puede hacerlo, sólo no sabe dónde. Es información, no venta — así que no
 *    lleva `ProHint`: un enlace a `/planes` a quien ya paga es ruido, y peor, sugiere que
 *    le falta algo que ya tiene.
 *  · **No Pro**: es el gate, y va con `ProHint` —el molde de una línea, sin candado—
 *    porque aquí no hay nada bloqueado: puede publicar su anuncio ahora mismo. Lo que se
 *    le cuenta es lo que Pro añadiría, que es exactamente para lo que `ProHint` existe.
 *
 * Ver docs/auditoria-pro-video.md, hueco #11.
 */
export function AvisoVideo({ isPro }: { isPro: boolean }) {
  if (isPro) {
    return (
      <p
        className="mt-4 flex items-start gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
        data-testid="aviso-video-pro"
      >
        <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          ¿Quieres añadir un <strong>vídeo</strong>? Se sube al <strong>editar</strong> el
          anuncio, una vez publicado: publica primero y lo añades desde «Editar».
        </span>
      </p>
    );
  }

  return (
    <div className="mt-4">
      <ProHint testId="aviso-video-no-pro">
        Con Pro puedes añadir un <strong>vídeo</strong> a tus anuncios (se sube al editarlos,
        ya publicados).
      </ProHint>
    </div>
  );
}
