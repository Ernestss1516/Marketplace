import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import {
  getWallet,
  getCatalog,
  getBumpLedger,
  getProStatus,
  type CatalogResponse,
  type ProStatus,
} from '@/lib/api/billing';
import { ResumenSaldo } from './_components/ResumenSaldo';
import { PackList } from './_components/PackList';
import { BumpPackList } from './_components/BumpPackList';
import { CampaignNotice } from './_components/CampaignNotice';
import { RedeemCouponForm } from './_components/RedeemCouponForm';
import { HistorialCreditos, HistorialBumps } from './_components/Historiales';
import { BumpsProgramados } from './_components/BumpsProgramados';
import { getBumpSchedules } from '@/lib/api/bump-schedules';
import { getActiveBanners } from '@/lib/api/banners';
import { BannerList } from '@/components/banners/BannerList';
import { buildLoginUrl } from '@/lib/auth/callback-url';

/**
 * Monetización ráfaga 4 — el título pasa a algo más general: la página cubre DOS monedas
 * (créditos y bumps), no solo una.
 *
 * UXV.6 (B1) — el monedero tenía tres nombres: «Mis créditos» en el menú, «Mi saldo» en el
 * título y `/mis-creditos` en la URL. Los dos VISIBLES ya se unificaron en UXV.2 (el menú
 * pasó a «Mi saldo», que es lo que dicen también el `<title>` y el `<h1>`).
 *
 * LA URL SE QUEDA, y es una decisión, no un olvido: renombrarla rompería los enlaces que
 * ya existen —los correos de compra, los tickets de soporte con la ruta escrita, cualquier
 * marcador del usuario— y obligaría a mantener un redirect permanente, todo a cambio de
 * una coherencia que el usuario no ve. El nombre visible es lo que se lee; la ruta es
 * historia.
 */
export const metadata: Metadata = { title: 'Mi saldo' };

export default async function MisCreditosPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mis-creditos'));

  const token = session.user.accessToken;

  const [wallet, catalog, bumpLedger, proStatus, programaciones, banners] = await Promise.all([
    getWallet(token).catch(() => ({
      balance: 0,
      bumpBalance: 0,
      items: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    })),
    getCatalog().catch(
      (): CatalogResponse => ({ products: [], bumpCreditCost: 5, proExtraBumpsPercent: 20 }),
    ),
    // Monetización ráfaga 2 — historial de bumps, lista separada de créditos.
    getBumpLedger(token).catch(() => ({
      bumpBalance: 0,
      items: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    })),
    // Monetización ráfaga 4 — solo para saber isPro y previsualizar el bonus
    // de packs de bumps antes de comprar.
    getProStatus(token).catch(
      (): ProStatus => ({
        isPro: false,
        limit: 0,
        used: 0,
        remaining: 0,
        bumpQuota: { limit: 0, used: 0, remaining: 0 },
      }),
    ),
    // Bump automático — las programaciones del usuario. Si la API falla, la sección se
    // pinta vacía en vez de tumbar la página: el saldo y los packs siguen siendo útiles.
    getBumpSchedules(token).catch(() => ({ items: [], total: 0 })),
    // La mejor ubicación del lote: es donde se compra, así que una promo de
    // cupón o de pack cae en el sitio exacto donde se ejecuta.
    getActiveBanners('MIS_CREDITOS').catch(() => []),
  ]);

  const packProducts = catalog.products.filter(
    (p) => p.type === 'ONE_TIME' && p.prices.some((pr) => pr.creditAmount != null),
  );
  // Monetización ráfaga 4 — packs de bumps DIRECTOS, separados de los de créditos.
  const bumpPackProducts = catalog.products.filter(
    (p) => p.type === 'ONE_TIME' && p.prices.some((pr) => pr.bumpAmount != null),
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Mi saldo</h1>
      </div>

      {/*
        ── 1. CUÁNTO TENGO ────────────────────────────────────────────────────
        Lo primero, sin encabezado: la franja ES la respuesta a la pregunta con la que se
        entra, y ponerle un «Saldo» encima repetiría el `<h1>`. Aquí estaba el defecto de
        orden más claro de la pantalla: el sitio lo ocupaba una caja para escribir un código
        de cupón, que ahora vive abajo, con lo demás que sirve para CONSEGUIR saldo.
      */}
      <ResumenSaldo
        balance={wallet.balance}
        bumpBalance={wallet.bumpBalance}
        proStatus={proStatus}
        catalog={catalog}
      />

      <p className="-mt-6 text-sm text-muted-foreground">
        Créditos y bumps son monedas distintas: los créditos sirven para destacar anuncios o
        hacer bump; los bumps solo sirven para bumpear, y se gastan primero al hacerlo.
      </p>

      {/* Hijo directo del `space-y-10` — sin margen propio (§3.3). Baja por debajo de la
          franja con el mismo criterio que el cupón: promociona, y lo que promociona es
          conseguir saldo, no mirarlo. */}
      {banners.length > 0 && <BannerList banners={banners} />}

      {/*
        ── 2. CONSEGUIR MÁS ───────────────────────────────────────────────────
        AGRUPADO POR TAREA Y NO POR MONEDA, que es el cambio de fondo de esta ráfaga.

        La página eran dos bloques verticales simétricos —Créditos y Bumps—, cada uno con su
        saldo, su compra y su historial. La simetría es elegante y es justo lo que rompía la
        jerarquía: obligaba a leer el historial de créditos ENTERO antes de llegar al saldo
        de bumps, y ponía un historial (detalle que se consulta de vez en cuando) al mismo
        nivel que un saldo (lo primario). Reagrupar por lo que el usuario HACE —mirar,
        conseguir, gestionar, consultar— mantiene toda la información y la ordena por
        importancia. Nada se ha quitado; ha cambiado de vecino.

        El cupón entra AQUÍ y no en su antiguo primer puesto porque canjear un código es otra
        forma de conseguir saldo, igual que comprar un pack. Es la misma tarea.
      */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold">Conseguir más saldo</h2>

        {packProducts.length > 0 && (
          <div>
            <h3 id="comprar" className="mb-4 text-lg font-semibold">Comprar créditos</h3>
            {/* MIS-CRÉDITOS RÁFAGA A — el aviso va DENTRO del bloque de compra y pegado a
                los packs, no arriba del todo: es contexto de una decisión concreta
                («¿compro ahora?»), no un anuncio general de la página. Y sólo aparece si
                hay campaña — sin ella, este bloque es exactamente el de antes. */}
            {catalog.creditBonusCampaign && (
              <div className="mb-4">
                <CampaignNotice campaign={catalog.creditBonusCampaign} moneda="créditos" />
              </div>
            )}
            {/* E-5 — `proStatus` ya se pedía en esta página (lo usaba la lista de bumps);
                lo que faltaba era pasárselo también a ésta, que no sabía nada de Pro. */}
            <PackList
              packs={packProducts}
              isPro={proStatus.isPro}
              proExtraCreditsPercent={catalog.proExtraCreditsPercent}
              campaign={catalog.creditBonusCampaign}
            />
          </div>
        )}

        {/* Monetización ráfaga 4 — packs de bumps directos, opción B retirada
            (ya no son créditos con highlightBumps). */}
        {bumpPackProducts.length > 0 && (
          <div>
            <h3 className="mb-4 text-lg font-semibold">Comprar bumps</h3>
            {/* Su propia campaña (BUMP_BONUS), no la de créditos: son types distintos y
                pueden estar activas por separado. */}
            {catalog.bumpBonusCampaign && (
              <div className="mb-4">
                <CampaignNotice campaign={catalog.bumpBonusCampaign} moneda="bumps" />
              </div>
            )}
            <BumpPackList
              packs={bumpPackProducts}
              isPro={proStatus.isPro}
              proExtraBumpsPercent={catalog.proExtraBumpsPercent}
              campaign={catalog.bumpBonusCampaign}
            />
          </div>
        )}

        {/* Canjear cupón — válido para cualquiera de las dos monedas según el tipo de cupón.
            Baja del primer puesto de la página a esta sección: sigue estando entero y
            funcionando igual, sólo que ya no le quita el sitio al saldo. */}
        <RedeemCouponForm token={token} />
      </section>

      {/*
        ── 3. GESTIONAR ───────────────────────────────────────────────────────
        Bump automático — no es dinero ni historial: es una configuración que el usuario
        deja puesta. Vivía enterrada en mitad de la sección de bumps, entre la compra y el
        historial. Se muestra SIEMPRE, también vacía: ocultarla dejaría la función invisible
        para quien no la ha usado nunca (mismo criterio que los historiales de abajo).
      */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold">Gestionar</h2>

        <div>
          <h3 className="mb-4 text-lg font-semibold">Bumps programados</h3>
          <BumpsProgramados token={token} inicial={programaciones.items} />
        </div>
      </section>

      {/*
        ── 4. HISTORIAL ───────────────────────────────────────────────────────
        Lo último, que es donde le corresponde: es detalle, se consulta a posteriori y casi
        nunca es el motivo de la visita. Siguen siendo DOS listas separadas (decisión de
        diseño: no fusionar dos ledgers paginados de modelos distintos — ver
        diseno-facturacion.md §17), pero ahora vecinas, que es como se comparan.

        UXV.6 (B5) — los dos se muestran SIEMPRE, también vacíos, con un estado vacío que
        ofrece salida. Y UXV.6 (M9) — paginados.
      */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold">Historial</h2>

        <div>
          <h3 className="mb-4 text-lg font-semibold">Créditos</h3>
          <HistorialCreditos
            token={token}
            inicial={{
              items: wallet.items,
              total: wallet.total,
              page: wallet.page,
              perPage: wallet.perPage,
              totalPages: wallet.totalPages,
            }}
          />
        </div>

        <div>
          <h3 className="mb-4 text-lg font-semibold">Bumps</h3>
          <HistorialBumps
            token={token}
            inicial={{
              items: bumpLedger.items,
              total: bumpLedger.total,
              page: bumpLedger.page,
              perPage: bumpLedger.perPage,
              totalPages: bumpLedger.totalPages,
            }}
          />
        </div>
      </section>
    </div>
  );
}
