import Link from 'next/link';
import { Coins, Crown, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { CatalogResponse, ProStatus } from '@/lib/api/billing';
import { costeLabel, equivalenciasDeSaldo } from './saldo';

/**
 * MIS-CRÉDITOS RÁFAGA B — LA FRANJA DE SALDO: lo primero de la página, porque es lo que
 * TODOS vienen a ver.
 *
 * EL DEFECTO QUE CIERRA (auditoría §1.2 y §5.3): lo primero tras el título era el formulario
 * de canjear cupón. Una caja de texto para quien YA TRAE un código —una minoría— ocupaba el
 * sitio de la cifra que busca el 100 % de las visitas, y para ver las dos monedas había que
 * bajar media página porque estaban separadas por una lista de packs y un historial entero.
 *
 * LAS TRES BOLSAS, JUNTAS Y EN ORDEN DE CONSUMO. No es una decisión estética: al bumpear, el
 * backend gasta primero la cuota Pro, luego el saldo de bumps y sólo después los créditos
 * (`BillingService.bump`, tres niveles encadenados). La página ya lo decía con palabras
 * —«se gastan antes que los créditos… después de tu cuota mensual gratis»— mientras enseñaba
 * dos de los tres números y escondía el tercero en otra pantalla. Aquí se ven los tres.
 *
 * Se renderiza en el SERVIDOR: no tiene estado ni interacción, sólo lee lo que la página ya
 * pidió. Ni un byte de JavaScript por enseñar tres cifras.
 */
export function ResumenSaldo({
  balance,
  bumpBalance,
  proStatus,
  catalog,
}: {
  balance: number;
  bumpBalance: number;
  proStatus: ProStatus;
  catalog: CatalogResponse;
}) {
  const { bump, destacado } = equivalenciasDeSaldo(balance, catalog);

  /**
   * LA CUOTA SÓLO SE ENSEÑA SI EXISTE DE VERDAD.
   *
   * Un Pro CONCEDIDO por el equipo es Pro sin suscripción, y la cuota mensual cuelga de un
   * ciclo de facturación que ahí no existe (D-1, documentado en la auditoría Pro). Pintarle
   * «0 de 0 restantes» sería inventarle una carencia: no es que se le hayan agotado, es que
   * la cuota no le aplica. Mismo criterio que ya sigue el aviso de `/mis-anuncios`.
   */
  const tieneCuota = proStatus.limit > 0 || proStatus.bumpQuota.limit > 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="resumen-saldo">
      {/* ── Créditos ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-1 pt-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Coins className="h-4 w-4 text-primary" aria-hidden />
            Créditos
          </p>
          <p className="text-3xl font-bold" data-testid="saldo-creditos">
            {balance}
          </p>
          {/*
            EL SALDO CON SENTIDO. «150 créditos» no dice nada por sí solo; «para 30 bumps o
            5 destacados de 7 días» sí. Los costes salen del catálogo —ya rebajados si hay
            una campaña activa—, así que esta línea se abarata sola cuando el precio baja, y
            de paso ANUNCIA la rebaja, que era otra cosa que la página callaba.
          */}
          <p className="text-xs text-muted-foreground" data-testid="saldo-equivalencias">
            {bump.veces == null ? (
              <>Ahora mismo un bump no cuesta créditos.</>
            ) : (
              <>
                Para {bump.veces} bump{bump.veces === 1 ? '' : 's'} ({costeLabel(bump)} cada uno)
                {destacado?.veces != null && (
                  <>
                    {' '}o {destacado.veces} destacado{destacado.veces === 1 ? '' : 's'} de{' '}
                    {destacado.dias} días ({costeLabel(destacado)})
                  </>
                )}
                .
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {/* ── Bumps ────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-1 pt-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="h-4 w-4 text-primary" aria-hidden />
            Bumps gratis
          </p>
          {/* Monetización ráfaga 2 — SIEMPRE visible, aunque sea 0: ocultarlo escondería
              que la función existe a quien nunca compró ni canjeó un cupón de bumps. */}
          <p className="text-3xl font-bold" data-testid="saldo-bumps">
            {bumpBalance}
          </p>
          <p className="text-xs text-muted-foreground">
            No caducan. Al bumpear se gastan antes que los créditos.
          </p>
        </CardContent>
      </Card>

      {/* ── Pro ──────────────────────────────────────────────────────────── */}
      {/*
        LA CONDICIÓN PRO, DICHA Y NO DEDUCIDA (auditoría §4.4). `isPro` llegaba a esta página
        y se usaba SÓLO para elegir qué variante del bonus pintar dentro de las tarjetas de
        pack: un Pro deducía su plan porque las tarjetas decían «por ser Pro» en vez de «con
        Pro te llevarías». Sin packs activos en el catálogo no habría visto NI UNA señal de
        su plan en toda la pantalla.

        A un no-Pro no se le pinta una tercera tarjeta vacía: la columna simplemente no
        existe y la rejilla se reparte entre dos. El sitio de vender Pro son las tarjetas de
        pack, que ya lo hacen con el bonus concreto de cada pack (E-5).
      */}
      {proStatus.isPro && (
        <Card className="border-amber-500/40" data-testid="resumen-pro">
          <CardContent className="space-y-1 pt-6">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Crown className="h-4 w-4 text-amber-500" aria-hidden />
              Plan Pro
            </p>
            {tieneCuota ? (
              <>
                <p className="text-3xl font-bold" data-testid="saldo-cuota-bumps">
                  {proStatus.bumpQuota.remaining}
                  <span className="ml-1 text-base font-normal text-muted-foreground">
                    de {proStatus.bumpQuota.limit} bumps
                  </span>
                </p>
                {/* Misma redacción que `/perfil/suscripcion`, que es la otra pantalla donde
                    se cuentan estas cuotas: dos formas de decirlo serían dos verdades. */}
                <p className="text-xs text-muted-foreground">
                  Gratis este mes, y {proStatus.remaining} de {proStatus.limit} destacados. Es
                  lo primero que se gasta al bumpear.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">Activo</p>
                <p className="text-xs text-muted-foreground">
                  Tienes las ventajas Pro. La cuota mensual va con la suscripción, así que a un
                  Pro concedido por el equipo no le aplica.
                </p>
              </>
            )}
            <p className="pt-1 text-xs">
              <Link href="/perfil/suscripcion" className="font-medium text-primary underline hover:no-underline">
                Ver mi suscripción
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
