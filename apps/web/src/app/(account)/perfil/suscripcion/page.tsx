import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Crown, Package, Star, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { auth } from '@/lib/auth';
import { getMySubscriptions, getMyEntitlements, getProStatus, type ProStatus } from '@/lib/api/billing';
import { SuscripcionActions } from './_components/SuscripcionActions';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata: Metadata = { title: 'Mi suscripción' };

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  CANCELING: 'Cancelándose',
  CANCELED: 'Cancelada',
  PAST_DUE: 'Pago pendiente',
};

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ACTIVE: 'default',
  CANCELING: 'secondary',
  CANCELED: 'outline',
  PAST_DUE: 'destructive',
};

export default async function SuscripcionPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/perfil/suscripcion'));

  const token = session.user.accessToken;

  const [subscriptions, entitlements, proStatus] = await Promise.all([
    getMySubscriptions(token).catch(() => []),
    getMyEntitlements(token).catch(() => []),
    getProStatus(token).catch(
      (): ProStatus => ({
        isPro: false,
        limit: 0,
        used: 0,
        remaining: 0,
        bumpQuota: { limit: 0, used: 0, remaining: 0 },
      }),
    ),
  ]);

  const isPro = entitlements.some(
    (e) => e.type === 'PRO_SUBSCRIPTION' && !e.revokedAt,
  );

  const activeSubscription = subscriptions[0] ?? null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Mi suscripción</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestiona tu plan y estado de facturación.
        </p>
      </div>

      {/* Current plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Crown
              className={`h-6 w-6 ${isPro ? 'text-primary' : 'text-muted-foreground'}`}
            />
            <div>
              <CardTitle>{isPro ? 'Plan Pro' : 'Plan Gratuito'}</CardTitle>
              <CardDescription>
                {isPro ? 'Acceso a todas las funciones Pro' : 'Funciones básicas'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        {activeSubscription && (
          <CardContent className="space-y-4">
            <Separator />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Estado: </span>
                <Badge variant={STATUS_VARIANTS[activeSubscription.status] ?? 'outline'}>
                  {STATUS_LABELS[activeSubscription.status] ?? activeSubscription.status}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Período actual: </span>
                <span className="font-medium">
                  {new Date(activeSubscription.currentPeriodStart).toLocaleDateString('es-ES')}{' '}
                  –{' '}
                  {new Date(activeSubscription.currentPeriodEnd).toLocaleDateString('es-ES')}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Importe: </span>
                <span className="font-medium">
                  {new Intl.NumberFormat('es-ES', {
                    style: 'currency',
                    currency: String(activeSubscription.price.currency),
                  }).format(Number(activeSubscription.price.amount))}
                  {activeSubscription.price.interval
                    ? `/${activeSubscription.price.interval === 'MONTH' ? 'mes' : 'año'}`
                    : ''}
                </span>
              </div>
            </div>

            {proStatus.isPro && (
              <>
                <Separator />
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-amber-500" />
                    <span className="text-muted-foreground">Destacados gratis: </span>
                    <span className="font-medium">
                      {proStatus.remaining} de {proStatus.limit} restantes este mes
                    </span>
                  </div>
                  {/* UXV.6 (M12) — la cuota de BUMPS es un beneficio Pro igual que la de
                      destacados, y aquí no aparecía: el único sitio donde se veía era
                      incrustada en el texto del botón de la tarjeta. */}
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-amber-500" />
                    <span className="text-muted-foreground">Bumps gratis: </span>
                    <span className="font-medium">
                      {proStatus.bumpQuota.remaining} de {proStatus.bumpQuota.limit} restantes
                      este mes
                    </span>
                  </div>
                  {proStatus.periodEnd && (
                    <div>
                      <span className="text-muted-foreground">Se renueva: </span>
                      <span className="font-medium">
                        {new Date(proStatus.periodEnd).toLocaleDateString('es-ES')}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeSubscription.status === 'ACTIVE' ||
            activeSubscription.status === 'CANCELING' ? (
              <SuscripcionActions
                subscription={activeSubscription}
                token={token}
              />
            ) : null}
          </CardContent>
        )}
      </Card>

      {/* No active plan */}
      {!activeSubscription && !isPro && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <Package className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              No tienes ningún plan activo. Actualiza a Pro para desbloquear más funciones.
            </p>
            <Button asChild>
              <Link href="/planes">Ver planes</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
