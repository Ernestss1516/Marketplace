import Link from 'next/link';
import { BajaClient } from './BajaClient';

export const metadata = { title: 'Darse de baja de un aviso' };

/**
 * NOTIFICACIONES N5 — la baja de un clic, desde el pie del correo.
 *
 * ── PÚBLICA A PROPÓSITO ────────────────────────────────────────────────────
 *
 * Quien se da de baja no va a iniciar sesión para hacerlo, y los proveedores de
 * correo esperan un enlace que funcione al primer clic. La firma HMAC que viaja en
 * la URL es lo que sustituye a la sesión: sin el secreto del servidor no se puede
 * forjar, así que nadie puede dar de baja a otro.
 *
 * ── Y NO SE DA DE BAJA AL CARGAR ───────────────────────────────────────────
 *
 * La baja la ejecuta el botón, no el `useEffect`. Los clientes de correo y los
 * antivirus **visitan los enlaces** para analizarlos, y una baja automática al
 * cargar daría de baja a gente que nunca pulsó nada. Es un `POST` deliberado tras
 * una acción humana.
 */
export default async function BajaPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; c?: string; t?: string }>;
}) {
  const { u: userId, c: category, t: signature } = await searchParams;

  if (!userId || !category || !signature) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="mb-3 text-2xl font-bold">Enlace incompleto</h1>
        <p className="text-muted-foreground">
          Este enlace de baja no es válido. Puedes cambiar tus preferencias desde{' '}
          <Link href="/perfil" className="text-primary underline">
            tu perfil
          </Link>
          .
        </p>
      </div>
    );
  }

  return <BajaClient userId={userId} category={category} signature={signature} />;
}
