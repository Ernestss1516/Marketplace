'use client';

import Link from 'next/link';
import { Coins, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  getWallet,
  getBumpLedger,
  type WalletItem,
  type BumpLedgerItem,
  type CreditLedgerType,
  type BumpLedgerType,
} from '@/lib/api/billing';
import { HistorialPaginado } from './HistorialPaginado';

/**
 * UXV.6 (M9 + B5) — los dos historiales de la cartera, paginados y con estados vacíos que
 * ofrecen salida.
 *
 * Son componentes de cliente porque paginar es interacción; la PRIMERA página sigue
 * viniendo del servidor (`inicial`), así que la lista se pinta sin esperar a nada y solo
 * las siguientes cuestan una petición.
 */

const LEDGER_LABELS: Record<CreditLedgerType, string> = {
  PACK_PURCHASE: 'Compra de pack',
  FEATURED_DEBIT: 'Destacado',
  BUMP_DEBIT: 'Bump',
  ADMIN_CREDIT: 'Crédito manual',
  ADMIN_DEBIT: 'Ajuste',
  PRO_BONUS: 'Bonus Pro',
  CAMPAIGN_BONUS: 'Bonus campaña',
  COUPON_REDEEM: 'Cupón canjeado',
};

/** Monetización ráfaga 2/4 — etiquetas del historial de bumps (moneda separada). */
const BUMP_LEDGER_LABELS: Record<BumpLedgerType, string> = {
  COUPON_REDEEM: 'Cupón canjeado',
  BUMP_DEBIT: 'Bump',
  ADMIN_CREDIT: 'Crédito manual',
  ADMIN_DEBIT: 'Ajuste',
  PACK_PURCHASE: 'Compra de pack',
  PRO_BONUS: 'Bonus Pro',
  CAMPAIGN_BONUS: 'Bonus campaña',
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

function Fila({ label, createdAt, amount, sufijo, note }: {
  label: string;
  createdAt: string;
  amount: number;
  sufijo: string;
  /**
   * MIS-CRÉDITOS RÁFAGA B — EL PORQUÉ DEL APUNTE, que el servidor escribía y esta fila tiraba.
   *
   * El backend guarda una nota explicativa cada vez que una campaña toca el importe:
   * `Campaña "X" (-N%)` en los débitos abaratados (`BillingService.featuredByCredits`
   * y `.bump`, desde H8 Bloque D) y `Campaña "X"` en los ingresos de bonus (el processor,
   * desde la ráfaga A). El campo viajaba en el payload y estaba en el tipo `WalletItem`
   * desde siempre… y aquí no se pintaba.
   *
   * LA CONSECUENCIA ERA CONCRETA: quien bumpeó durante una campaña veía «Bump · −2 cr.»
   * donde otro día habría visto «−5 cr.», sin ninguna explicación de la diferencia. El
   * texto que la explicaba estaba guardado en su propia fila, y se descartaba.
   */
  note?: string | null;
}) {
  const esIngreso = amount > 0;
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        {esIngreso ? (
          <TrendingUp className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
        ) : (
          <TrendingDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div>
          <p className="text-sm font-medium">{label}</p>
          {/* En la MISMA línea que la fecha, separado por un punto: es una precisión del
              apunte, no un segundo apunte. Una línea propia lo ascendería a la categoría
              de la etiqueta y haría el historial el doble de alto por un matiz. */}
          <p className="text-xs text-muted-foreground">
            {fecha(createdAt)}
            {note ? <span data-testid="ledger-note"> · {note}</span> : null}
          </p>
        </div>
      </div>
      <span
        className={`text-sm font-semibold tabular-nums ${esIngreso ? 'text-green-600' : 'text-foreground'}`}
      >
        {esIngreso ? '+' : ''}
        {amount} {sufijo}
      </span>
    </div>
  );
}

/**
 * B5 — estado vacío con salida, como el de «sin anuncios». Los de esta pantalla decían
 * «No hay movimientos todavía. Compra un pack para empezar.» y dejaban al usuario buscando
 * el pack por su cuenta; el de bumps directamente no se renderizaba, así que quien nunca
 * había tenido bumps no llegaba a saber que existían.
 */
function Vacio({ icono, texto, cta }: { icono: React.ReactNode; texto: string; cta: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        {icono}
        <p className="text-sm text-muted-foreground">{texto}</p>
        <Button asChild size="sm" variant="outline">
          <Link href="#comprar">{cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

type Pagina<T> = { items: T[]; total: number; page: number; perPage: number; totalPages: number };

export function HistorialCreditos({
  token,
  inicial,
}: {
  token: string;
  inicial: Pagina<WalletItem>;
}) {
  return (
    <HistorialPaginado
      inicial={inicial}
      cargar={async (page) => {
        const w = await getWallet(token, page);
        return {
          items: w.items,
          total: w.total,
          page: w.page,
          perPage: w.perPage,
          totalPages: w.totalPages,
        };
      }}
      clave={(i) => i.id}
      fila={(i) => (
        <Fila
          label={LEDGER_LABELS[i.type] ?? i.type}
          createdAt={i.createdAt}
          amount={i.amount}
          sufijo="cr."
          note={i.note}
        />
      )}
      vacio={
        <Vacio
          icono={<Coins className="h-8 w-8 text-muted-foreground" aria-hidden />}
          texto="Todavía no tienes movimientos de créditos. Los créditos sirven para destacar anuncios y para subirlos."
          cta="Comprar créditos"
        />
      }
    />
  );
}

export function HistorialBumps({
  token,
  inicial,
}: {
  token: string;
  inicial: Pagina<BumpLedgerItem>;
}) {
  return (
    <HistorialPaginado
      inicial={inicial}
      cargar={async (page) => {
        const b = await getBumpLedger(token, page);
        return {
          items: b.items,
          total: b.total,
          page: b.page,
          perPage: b.perPage,
          totalPages: b.totalPages,
        };
      }}
      clave={(i) => i.id}
      fila={(i) => (
        <Fila
          label={BUMP_LEDGER_LABELS[i.type] ?? i.type}
          createdAt={i.createdAt}
          amount={i.amount}
          sufijo={`bump${Math.abs(i.amount) === 1 ? '' : 's'}`}
          // Los dos historiales, igual: `BumpLedger` tiene su propia columna `note` y el
          // processor la escribe desde la ráfaga A. Pintarla en uno y no en el otro sería
          // reabrir la asimetría entre monedas que este proyecto lleva cerrando.
          note={i.note}
        />
      )}
      vacio={
        <Vacio
          icono={<Zap className="h-8 w-8 text-muted-foreground" aria-hidden />}
          texto="Todavía no tienes movimientos de bumps. Un bump sube tu anuncio a lo más reciente de los listados."
          cta="Comprar bumps"
        />
      }
    />
  );
}
