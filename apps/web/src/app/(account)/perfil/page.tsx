import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Heart, MessageSquare, Package, Receipt } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PerfilForm } from '@/components/perfil/PerfilForm';
import { SignOutButton } from '@/components/perfil/SignOutButton';
import { ArchivarCuentaButton } from '@/components/perfil/ArchivarCuentaButton';
import { ExportarDatosPanel } from '@/components/perfil/ExportarDatosPanel';
import { PreferenciasCorreoPanel } from '@/components/perfil/PreferenciasCorreoPanel';
import { auth } from '@/lib/auth';
import { getMe, getMyExports, getEmailPreferences } from '@/lib/api/usuarios';
import { getActiveBanners } from '@/lib/api/banners';
import { BannerList } from '@/components/banners/BannerList';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Mi perfil' };

export default async function PerfilPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/perfil'));

  /**
   * LOS TRES EN PARALELO, no en fila.
   *
   * `getMe` y `getMyExports` eran dos `await` ENCADENADOS, y ninguno de los dos
   * depende del otro: los dos necesitan solo el token. Colgar el banner detrás
   * habría hecho TRES viajes en serie para pintar una página que la gente abre
   * para cambiarse el nombre. Con el `Promise.all` son tres viajes a la vez y la
   * página queda más rápida que antes de esta ráfaga, no más lenta.
   *
   * Los `.catch` reparten quién puede tumbar la página y quién no, y ese reparto
   * NO cambia respecto a lo que había:
   *
   *  - `getMe` sigue SIN red: sin usuario no hay perfil que pintar.
   *  - BORRADO DE CUENTAS C6 — las exportaciones conservan el suyo. Es una
   *    sección secundaria: si su API falla, ese bloque sale vacío —el botón sigue
   *    ahí— y no que el usuario se quede sin perfil. Mismo criterio que las
   *    llamadas paralelas de la ficha de vendedor.
   *  - El banner, igual: decorativo, nunca tumba nada.
   */
  const [user, exportaciones, banners, preferenciasCorreo] = await Promise.all([
    getMe(session.user.accessToken),
    getMyExports(session.user.accessToken).catch(() => []),
    getActiveBanners('PERFIL').catch(() => []),
    // N5 — si falla, el panel no se pinta y ya está: unas casillas de correo no
    // pueden tumbar el perfil entero. Mismo criterio que las exportaciones.
    getEmailPreferences(session.user.accessToken).catch(() => null),
  ]);

  const location = [user.city, user.province].filter(Boolean).join(', ');

  return (
    <div className="space-y-8">
      {/*
        AQUÍ EL BANNER VA EL PRIMERO, y es la excepción a la regla de «debajo de
        la cabecera» que siguen las otras cuatro de la zona.

        Esta página no abre con un <h1> de sección sino con una CABECERA DE
        IDENTIDAD —avatar, nombre, correo— seguida del aviso de correo sin
        verificar, que es un aviso de verdad y del propio usuario. Meter el banner
        entre esas dos cosas partiría la identidad de su aviso y pondría un
        mensaje de la plataforma donde el usuario espera leer algo suyo.

        Hijo directo del `space-y-8`, sin margen propio (§3.3).
      */}
      {banners.length > 0 && <BannerList banners={banners} />}

      {/* Header */}
      <div className="flex items-center gap-5">
        <Avatar className="h-16 w-16 text-xl">
          <AvatarImage src={user.avatarUrl} alt={user.name} />
          <AvatarFallback>{user.name[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold">{user.name}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          {location && (
            <p className="text-sm text-muted-foreground">{location}</p>
          )}
        </div>
      </div>

      {/* Email verification notice */}
      {!user.emailVerified && (
        <div className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Tu correo electrónico <strong>{user.email}</strong> no está verificado.
            Revisa tu bandeja de entrada para confirmar tu cuenta.
            {/* TODO: añadir botón "Reenviar verificación" cuando exista POST /auth/resend-verification */}
          </span>
        </div>
      )}

      <Separator />

      {/* Edit form */}
      <section>
        <h2 className="mb-5 text-lg font-semibold">Editar perfil</h2>
        <PerfilForm initialUser={user} token={session.user.accessToken} />
      </section>

      <Separator />

      {/* Quick links */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Mi actividad</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link href="/mis-anuncios">
              <Package className="mr-2 h-4 w-4" />
              Mis anuncios
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/mensajes">
              <MessageSquare className="mr-2 h-4 w-4" />
              Mensajes
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/favoritos">
              <Heart className="mr-2 h-4 w-4" />
              Favoritos
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/perfil/facturacion">
              <Receipt className="mr-2 h-4 w-4" />
              Datos de facturación
            </Link>
          </Button>
        </div>
      </section>

      <Separator />

      {/* Sign out */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Sesión</h2>
        <SignOutButton />
      </section>

      <Separator />

      {/*
        BORRADO DE CUENTAS C6 — la otra cara del cierre de cuenta.

        JUSTO ANTES de «Cerrar mi cuenta», y el orden es la decisión: quien está
        pensando en irse tiene delante, primero, la forma de llevarse sus cosas.
        Ponerlo después sería ofrecer el paracaídas cuando ya se ha saltado.
      */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Llévate tus datos</h2>
        <p className="mb-4 max-w-prose text-sm text-muted-foreground">
          Preparamos un archivo con todo lo que has generado: tu perfil, tus anuncios y sus
          fotos, tus conversaciones, tus valoraciones y tus facturas en PDF. Tarda un poco y
          te avisaremos cuando esté listo para descargar.
        </p>
        <ExportarDatosPanel token={session.user.accessToken} inicial={exportaciones} />
      </section>

      <Separator />

      {/*
        NOTIFICACIONES N5 — LA VÁLVULA DEL CORREO.
        Sólo lista lo que de verdad se puede apagar; lo crítico ni aparece, y una
        nota al pie del panel explica por qué.
      */}
      <section>
        {preferenciasCorreo && (
          <PreferenciasCorreoPanel
            token={session.user.accessToken}
            inicial={preferenciasCorreo}
          />
        )}
      </section>

      <Separator />

      {/*
        BORRADO DE CUENTAS C2 — el gesto de irse.

        AL FINAL Y EN SU PROPIA SECCIÓN, separado de «Cerrar sesión»: son dos
        botones que suenan parecido y hacen cosas muy distintas, y el que se pulsa
        todos los días no debe estar pegado al que se pulsa una vez. El texto de
        apoyo dice lo que el diálogo desarrolla, para que nadie lo abra sin saber
        qué hay dentro.
      */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Cerrar mi cuenta</h2>
        <p className="mb-4 max-w-prose text-sm text-muted-foreground">
          Dejarás de tener acceso y tus anuncios se retirarán del buscador. Tu cuenta se
          guarda, no se destruye: escribe a soporte si quieres recuperarla.
        </p>
        <ArchivarCuentaButton token={session.user.accessToken} />
      </section>
    </div>
  );
}
