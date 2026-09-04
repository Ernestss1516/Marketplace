import { getIlustracion } from '@/lib/api/ilustraciones';
import type { IlustracionSlotId } from '@/lib/ilustraciones';
import { IlustracionImagen } from './IlustracionImagen';

/**
 * E7 — LA ILUSTRACIÓN DE UN SLOT, resuelta y pintada. Server Component.
 *
 * Es todo lo que una pantalla de servidor necesita escribir:
 *
 *     <Ilustracion slot="empty-favorites" />
 *
 * ── LA FRONTERA, EN UNA LÍNEA (§8.1) ───────────────────────────────────────────────
 *
 * **El hueco donde va esto es estructura; la imagen es el asset.** La pantalla decide que
 * aquí hay una ilustración, de qué tamaño y con qué texto al lado. QUÉ imagen es lo único
 * que un modelo o un admin cambian. Por eso el componente recibe un identificador de slot
 * y no una URL: pasarle una URL sería dejar que la pantalla eligiera la imagen, que es
 * justo la frontera que este subsistema existe para no cruzar.
 *
 * Si el backend no responde no se pinta nada y el estado vacío se ve como antes de E7 —
 * ver `getIlustracionesSeguras`.
 */
export async function Ilustracion({
  slot,
  className,
}: {
  slot: IlustracionSlotId;
  className?: string;
}) {
  return <IlustracionImagen ilustracion={await getIlustracion(slot)} className={className} />;
}
