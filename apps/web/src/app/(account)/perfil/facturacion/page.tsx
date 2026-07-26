import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { FacturacionForm } from '@/components/perfil/FacturacionForm';
import { auth } from '@/lib/auth';
import { getMe } from '@/lib/api/usuarios';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata: Metadata = { title: 'Datos de facturación' };

export default async function FacturacionPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/perfil/facturacion'));

  const user = await getMe(session.user.accessToken);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Datos de facturación</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Completa tus datos fiscales para poder recibir facturas de tus compras en la plataforma
          (suscripción Pro, packs de créditos o bumps, y destacados).
        </p>
      </div>

      <FacturacionForm initialUser={user} token={session.user.accessToken} />
    </div>
  );
}
