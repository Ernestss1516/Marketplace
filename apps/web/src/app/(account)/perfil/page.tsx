import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Heart, MessageSquare, Package } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PerfilForm } from '@/components/perfil/PerfilForm';
import { SignOutButton } from '@/components/perfil/SignOutButton';
import { auth } from '@/lib/auth';
import { getMe } from '@/lib/api/usuarios';

export const metadata = { title: 'Mi perfil' };

export default async function PerfilPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect('/login');

  const user = await getMe(session.user.accessToken);

  const location = [user.city, user.province].filter(Boolean).join(', ');

  return (
    <div className="space-y-8">
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
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
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
        </div>
      </section>

      <Separator />

      {/* Sign out */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Sesión</h2>
        <SignOutButton />
      </section>
    </div>
  );
}
