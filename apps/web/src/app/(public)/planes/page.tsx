import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCatalog, type CatalogPrice, type CatalogResponse } from '@/lib/api/billing';
import { CheckoutButton } from './_components/CheckoutButton';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Planes',
  description: 'Elige el plan que mejor se adapta a tus necesidades.',
};

/**
 * UXV.6 (M4) — lo que ve un Pro sale AHORA del catálogo (`catalog.proBenefits`), derivado
 * en el backend de los `Setting` que de verdad conceden cada ventaja. La lista que había
 * aquí escrita a mano prometía «estadísticas» y «soporte prioritario» y **callaba los dos
 * beneficios que más se notan**: los destacados gratis al mes y la cuota de bumps. Un admin
 * podía cambiar esas cuotas y la página de precios seguía diciendo lo mismo.
 *
 * Esto es solo el respaldo para cuando el catálogo no responde: lo mínimo cierto que se
 * puede afirmar sin conocer los ajustes.
 */
const FREE_FEATURES_FALLBACK = [
  'Fotos incluidas',
  'Mensajería con compradores',
  'Perfil público',
];

const PRO_FEATURES_FALLBACK = [
  'Más anuncios activos',
  'Destacados y bumps gratis cada mes',
  'Estadísticas avanzadas de tus anuncios',
  'Soporte prioritario',
];

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
}

function monthlyEquivalent(price: CatalogPrice): string {
  if (price.interval === 'YEAR') {
    return formatPrice(price.amount / 12, price.currency) + '/mes';
  }
  return formatPrice(price.amount, price.currency) + '/mes';
}

export default async function PlanesPage() {
  const catalog = await getCatalog().catch(
    (): CatalogResponse => ({ products: [], bumpCreditCost: 5, proExtraBumpsPercent: 20 }),
  );

  // UXV.6 (M4) — derivados del catálogo; el respaldo solo entra si la API no responde.
  const proFeatures = catalog.proBenefits?.length ? catalog.proBenefits : PRO_FEATURES_FALLBACK;
  const freeFeatures = catalog.freeBenefits?.length ? catalog.freeBenefits : FREE_FEATURES_FALLBACK;

  const proProduct = catalog.products.find((p) => p.type === 'RECURRING');
  const monthlyPrice = proProduct?.prices.find((p) => p.interval === 'MONTH');
  const yearlyPrice = proProduct?.prices.find((p) => p.interval === 'YEAR');

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Elige tu plan</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Empieza gratis. Actualiza cuando lo necesites.
        </p>
      </div>

      <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-3">
        {/* ── Free ── */}
        <Card className="flex flex-col">
          <CardHeader>
            <h2 className="text-2xl font-semibold leading-none tracking-tight">Gratis</h2>
            <CardDescription>Para empezar a vender</CardDescription>
            <p className="mt-2 text-3xl font-bold">0 €</p>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-2">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" asChild>
              <Link href="/registro">Crear cuenta gratis</Link>
            </Button>
          </CardFooter>
        </Card>

        {/* ── Pro mensual ── */}
        {monthlyPrice ? (
          <Card className="flex flex-col border-primary">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold leading-none tracking-tight">Pro</h2>
                <Badge>Mensual</Badge>
              </div>
              <CardDescription>Para vendedores habituales</CardDescription>
              <p className="mt-2 text-3xl font-bold">
                {formatPrice(monthlyPrice.amount, monthlyPrice.currency)}
                <span className="text-base font-normal text-muted-foreground">/mes</span>
              </p>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2">
                {proFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <CheckoutButton priceId={monthlyPrice.priceId} label="Hazte Pro" />
            </CardFooter>
          </Card>
        ) : null}

        {/* ── Pro anual ── */}
        {yearlyPrice ? (
          <Card className="flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold leading-none tracking-tight">Pro</h2>
                <Badge variant="secondary">Anual</Badge>
              </div>
              <CardDescription>
                Ahorra{' '}
                {monthlyPrice
                  ? Math.round(
                      (1 - yearlyPrice.amount / (monthlyPrice.amount * 12)) * 100,
                    ) + ' %'
                  : 'más'}
              </CardDescription>
              <p className="mt-2 text-3xl font-bold">
                {formatPrice(yearlyPrice.amount, yearlyPrice.currency)}
                <span className="text-base font-normal text-muted-foreground">/año</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {monthlyEquivalent(yearlyPrice)}
              </p>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2">
                {proFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <CheckoutButton priceId={yearlyPrice.priceId} label="Hazte Pro anual" />
            </CardFooter>
          </Card>
        ) : null}

        {/* Fallback: no Pro plans seeded */}
        {!proProduct && (
          <Card className="col-span-2 flex flex-col items-center justify-center p-10 text-center text-muted-foreground">
            <p>Los planes Pro no están disponibles en este momento.</p>
          </Card>
        )}
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        ¿Ya eres Pro?{' '}
        <Link href="/perfil/suscripcion" className="underline hover:text-foreground">
          Ver mi suscripción
        </Link>
      </p>
    </div>
  );
}
