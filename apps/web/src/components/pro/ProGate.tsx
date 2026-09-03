import Link from 'next/link';
import { Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * CONTARLE A UN NO-PRO LO QUE PRO LE DARÍA — en el punto de fricción, y con la salida.
 *
 * LA REGLA, que ya estaba escrita en el gate del vídeo y aquí se generaliza: **el gate se
 * VE, no se esconde**. Esconder un beneficio hasta que alguien pague deja invisible la
 * ventaja justo para quien hay que convencer; lo que se enseña no es el beneficio, es lo que
 * se está perdiendo.
 *
 * DOS FORMAS, porque hay dos clases de fricción:
 *
 *   · `ProGate` — la pantalla BLOQUEADA. Ocupa el sitio de lo que no puede usar (el editor
 *     de vídeo, las gráficas de estadísticas). Panel con candado, explicación y botón.
 *   · `ProHint` — la fricción de UNA LÍNEA, al lado de algo que sí puede usar: el pack que
 *     está a punto de comprar, el destacado que va a pagar. No bloquea nada; cuenta lo que
 *     Pro añadiría ahí mismo.
 *
 * POR QUÉ VIVEN JUNTOS. Antes había dos gates bien hechos —vídeo y estadísticas— y cinco
 * sitios que no contaban nada; eran **los dos únicos enlaces a `/planes` desde un gate en
 * toda la aplicación**. Con el molde repetido a mano en siete sitios, la próxima ventaja Pro
 * volvería a inventarse su forma. Ver docs/auditoria-pro-video.md §4.2.
 */
export function ProGate({
  titulo,
  children,
  testId,
  cta = 'Hazte Pro',
}: {
  /** Opcional: la pantalla de estadísticas lo usa; la del vídeo ya tiene su cabecera. */
  titulo?: string;
  /** Qué se pierde. En la voz del sitio donde aparece, no un texto genérico. */
  children: React.ReactNode;
  testId: string;
  cta?: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center"
      data-testid={testId}
    >
      <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
      {titulo && <p className="font-medium">{titulo}</p>}
      <p className="text-sm text-muted-foreground">{children}</p>
      <Button asChild size="sm">
        <Link href="/planes">{cta}</Link>
      </Button>
    </div>
  );
}

/**
 * La pista de una línea. No bloquea: acompaña.
 *
 * `Sparkles` y no `Lock` a propósito — aquí no hay ninguna puerta cerrada. El usuario puede
 * comprar ese pack o destacar ese anuncio ahora mismo; lo que se le cuenta es que con Pro le
 * saldría mejor. Un candado prometería un impedimento que no existe.
 */
export function ProHint({
  children,
  testId,
  cta = 'Ver Pro',
}: {
  children: React.ReactNode;
  testId: string;
  cta?: string;
}) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
      data-testid={testId}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-featured" aria-hidden />
      <span>{children}</span>
      <Link href="/planes" className="font-medium text-primary underline hover:no-underline">
        {cta}
      </Link>
    </p>
  );
}
