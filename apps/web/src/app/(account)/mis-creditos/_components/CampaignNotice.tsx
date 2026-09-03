import { Sparkles } from 'lucide-react';
import type { ActiveBonusCampaign } from '@/lib/api/billing';

/**
 * MIS-CRÉDITOS RÁFAGA A — EL AVISO DE CAMPAÑA ACTIVA, encima de los packs.
 *
 * QUÉ HACE QUE NO HAGA LA TARJETA. La tarjeta de cada pack dice el NÚMERO («+ 20 por la
 * campaña "Vuelta al cole"»), que es lo que cambia de un pack a otro. Lo que no cabe ahí
 * —y repetirlo tres veces sería ruido— es el CONTEXTO: qué campaña es y hasta cuándo dura.
 * Sin el aviso, un «+20» aparece sin causa y sin plazo; sin las tarjetas, el usuario tiene
 * que multiplicar. Cada uno cuenta la mitad que el otro no puede.
 *
 * SIN COMPONENTE DE CLIENTE: no tiene estado ni interacción, así que se renderiza en el
 * servidor con el resto de la página. Un `'use client'` aquí sólo añadiría JavaScript para
 * pintar dos frases.
 *
 * NO ES UN BANNER de los de `BannerList`: aquéllos son contenido que un administrador
 * redacta y coloca por ubicación; esto es la lectura directa del motor de campañas, que ya
 * está regalando dinero ahora mismo. Si un día se apaga la campaña, esta pieza desaparece
 * sola — nadie tiene que acordarse de retirarla.
 */
export function CampaignNotice({
  campaign,
  moneda,
}: {
  campaign: ActiveBonusCampaign;
  /** Qué regala esta campaña. Las dos monedas tienen campañas distintas e independientes. */
  moneda: 'créditos' | 'bumps';
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-success-border bg-success px-4 py-3 text-sm"
      data-testid={`campaign-notice-${moneda === 'créditos' ? 'creditos' : 'bumps'}`}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-success-foreground" aria-hidden />
      <span className="font-medium">Campaña «{campaign.name}»</span>
      <span className="text-muted-foreground">
        Recibes {moneda} extra en cualquier pack{formatEnd(campaign.endsAt)}.
      </span>
    </div>
  );
}

/**
 * «, hasta el 15 de septiembre» — o nada.
 *
 * El plazo es lo que convierte un descuento en un motivo para comprar hoy, así que se dice
 * cuando se puede. Una fecha ilegible (payload raro, campo ausente) no vale la pena
 * defenderla con una frase a medias: se omite el trozo y el aviso sigue siendo cierto.
 */
function formatEnd(endsAt: string): string {
  const fecha = new Date(endsAt);
  if (Number.isNaN(fecha.getTime())) return '';
  return `, hasta el ${fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`;
}
