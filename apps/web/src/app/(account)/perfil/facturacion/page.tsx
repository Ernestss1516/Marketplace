import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Separator } from '@/components/ui/separator';
import { FacturacionForm } from '@/components/perfil/FacturacionForm';
import { FacturasPanel } from '@/components/perfil/FacturasPanel';
import { auth } from '@/lib/auth';
import { getMe } from '@/lib/api/usuarios';
import {
  getFacturables,
  getInvoiceEligibility,
  getMyInvoices,
  type Facturable,
  type InvoiceDto,
  type InvoiceEligibility,
} from '@/lib/api/facturacion';
import { getActiveBanners } from '@/lib/api/banners';
import { BannerList } from '@/components/banners/BannerList';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata: Metadata = { title: 'Datos de facturación' };

const EMPTY_ELIGIBILITY: InvoiceEligibility = {
  canRequest: false,
  reason: 'MISSING_FISCAL_DATA',
  hasFiscalData: false,
  facturableCount: 0,
};

export default async function FacturacionPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/perfil/facturacion'));

  const token = session.user.accessToken;

  const [user, eligibility, facturables, invoices, banners] = await Promise.all([
    getMe(token),
    getInvoiceEligibility(token).catch((): InvoiceEligibility => EMPTY_ELIGIBILITY),
    getFacturables(token).catch((): Facturable[] => []),
    getMyInvoices(token).catch((): InvoiceDto[] => []),
    getActiveBanners('PERFIL_FACTURACION').catch(() => []),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Datos de facturación</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Completa tus datos fiscales para poder recibir facturas de tus compras en la plataforma
          (suscripción Pro, packs de créditos o bumps, y destacados).
        </p>
      </div>

      {/* Hijo directo del `space-y-8`: el espaciado ya lo da el contenedor, así
          que aquí NO va el `mb-6` de las páginas públicas — pondría un hueco
          doble. Ver docs/diseno-banners-ubicaciones.md §3.3. */}
      {banners.length > 0 && <BannerList banners={banners} />}

      <FacturacionForm initialUser={user} token={token} />

      <Separator />

      <FacturasPanel
        token={token}
        eligibility={eligibility}
        facturables={facturables}
        invoices={invoices}
      />
    </div>
  );
}
