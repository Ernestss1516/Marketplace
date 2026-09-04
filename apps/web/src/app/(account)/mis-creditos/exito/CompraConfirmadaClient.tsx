'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2, RefreshCw, Coins, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IlustracionImagen } from '@/components/shared/IlustracionImagen';
import type { IlustracionResuelta } from '@/lib/ilustraciones';
import { getWallet, getBumpLedger } from '@/lib/api/billing';

/**
 * INVARIANTE DE SEGURIDAD: esta página NO concede créditos ni bumps ni
 * ejecuta ninguna lógica de negocio. El wallet se acredita exclusivamente por
 * la notificación online de Redsys (POST /webhooks/redsys). Ver
 * diseno-facturacion.md §7.5.
 *
 * Monetización ráfaga 4 — página compartida entre packs de créditos y de
 * bumps (ambos usan el urlOk por defecto de RedsysService.buildForm): muestra
 * los dos saldos, no sabe cuál de los dos se acaba de comprar.
 *
 * UXV.1 (A7) — antes esta página dejaba un spinner girando PARA SIEMPRE: no tenía
 * estado terminal, así que aunque el webhook ya hubiera acreditado, el usuario seguía
 * viendo "se está procesando" y tenía que pulsar "Actualizar saldo" a mano y comparar
 * cifras. Se replica el molde de `(public)/planes/exito`: detectar la condición
 * terminal, resolver a ✔ y ofrecer salidas de verdad (botones, no un enlace de texto).
 * Lo que planes/exito NO hace —y aquí sí— es sondear solo: su copy promete que la
 * página se actualiza sola y en realidad solo comprueba al montar.
 *
 * UXV.3 (A7-flujo) — y aquí está ese flujo. Quien llega porque no le llegaba el saldo
 * para bumpear o destacar UN anuncio concreto ya no aterriza en una hoja suelta: la
 * intención viajó en `?volver=`, colgada por el backend de la URL de vuelta del TPV (ver
 * `redsys/return-to.ts`, que la valida contra una allowlist), y la salida principal deja
 * de ser genérica para llevarle a terminar lo que iba a hacer. Sin intención —el usuario
 * entró a la cartera por su cuenta— las salidas son las de siempre.
 */

/** Cada cuánto se vuelve a preguntar por el saldo mientras el webhook no ha llegado. */
const POLL_INTERVAL_MS = 3000;
/** Cuánto se insiste antes de rendirse y ofrecer comprobación manual. */
const POLL_TIMEOUT_MS = 60_000;
/**
 * Ventana para considerar que un apunte `PACK_PURCHASE` del historial ES esta compra.
 * El redirect del TPV y la notificación del webhook llegan casi a la vez y en orden no
 * garantizado, así que no sirve comparar contra el saldo de la primera lectura (si el
 * webhook fue rápido, ya venía acreditado y nunca veríamos "subir" nada).
 * LIMITACIÓN CONOCIDA: dos compras del mismo usuario en menos de 15 min harían que la
 * segunda resolviese con el apunte de la primera. Los saldos mostrados son reales en
 * ambos casos, así que el daño es un ✔ prematuro, no un dato falso.
 */
const RECENT_PURCHASE_WINDOW_MS = 15 * 60_000;

type Phase = 'checking' | 'confirmed' | 'timeout';

export function CompraConfirmadaClient({
  ilustracion,
}: {
  ilustracion: IlustracionResuelta | null;
}) {
  const { data: session, status: sessionStatus } = useSession();

  const [balance, setBalance] = useState<number | null>(null);
  const [bumpBalance, setBumpBalance] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [checking, setChecking] = useState(false);

  const token = session?.user.accessToken;
  const startedAt = useRef<number>(Date.now());

  /**
   * UXV.3 (A7-flujo) — a dónde volver a terminar. Lo puso el BACKEND en la URL de éxito
   * al construir el formulario del TPV, después de validarlo contra su allowlist, así que
   * aquí no puede llegar un destino externo. Aun así se exige que empiece por `/` antes de
   * usarlo como `href`: esta página no debe ser el eslabón que confíe por costumbre.
   */
  const volverParam = useSearchParams().get('volver');
  const volver = volverParam && volverParam.startsWith('/') && !volverParam.startsWith('//')
    ? volverParam
    : null;

  /**
   * Una pasada: lee los dos saldos y los dos historiales y decide si la compra ya está
   * acreditada. Devuelve true cuando ha resuelto, para que el bucle deje de sondear.
   */
  const check = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    setChecking(true);
    try {
      const [wallet, bumps] = await Promise.all([
        getWallet(token),
        getBumpLedger(token).catch(() => null),
      ]);

      setBalance(wallet.balance);
      setBumpBalance(wallet.bumpBalance);

      // Condición terminal: existe un apunte de compra de pack (de créditos o de bumps)
      // suficientemente reciente como para ser el de esta compra. El webhook es el único
      // que los crea (ver la invariante de arriba), así que su presencia ES la
      // confirmación de que el pago se procesó.
      const cutoff = Date.now() - RECENT_PURCHASE_WINDOW_MS;
      const isRecentPurchase = (item: { type: string; createdAt: string }) =>
        item.type === 'PACK_PURCHASE' && new Date(item.createdAt).getTime() >= cutoff;

      const credited =
        wallet.items.some(isRecentPurchase) || (bumps?.items ?? []).some(isRecentPurchase);

      if (credited) {
        setPhase('confirmed');
        return true;
      }
      return false;
    } catch {
      // Fallo de red puntual: no se toca `phase`, el bucle lo reintenta.
      return false;
    } finally {
      setChecking(false);
    }
  }, [token]);

  // Bucle de sondeo: se detiene al confirmar o al agotar el tiempo. El usuario no tiene
  // que pulsar nada — que hubiera que hacerlo era exactamente el defecto A7.
  useEffect(() => {
    if (!token || phase !== 'checking') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const done = await check();
      if (cancelled || done) return;
      if (Date.now() - startedAt.current >= POLL_TIMEOUT_MS) {
        setPhase('timeout');
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `check` es estable (useCallback sobre `token`); `phase` reentra al bucle solo
    // cuando el usuario vuelve a "checking" desde el estado de timeout.
  }, [token, phase, check]);

  const balances = (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {balance !== null && (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
          <Coins className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            <strong>{balance}</strong> créditos
          </span>
        </div>
      )}
      {bumpBalance !== null && (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            <strong>{bumpBalance}</strong> bumps
          </span>
        </div>
      )}
    </div>
  );

  // Salidas comunes a todos los estados resueltos — botones, no un enlace de texto
  // suelto (molde planes/exito).
  //
  // UXV.3 (A7-flujo) — con intención de vuelta, ESA es la salida principal: el usuario no
  // vino a la cartera a mirar el saldo, vino porque no podía pagar una acción. Las otras
  // dos siguen ahí, degradadas a secundarias. Sin intención, mandan las de siempre.
  const exits = (
    <div className="flex flex-wrap justify-center gap-3">
      {volver ? (
        <>
          <Button asChild data-testid="volver-a-la-accion">
            <Link href={volver}>Volver a terminar</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/mis-creditos">Ver mi saldo</Link>
          </Button>
        </>
      ) : (
        <>
          <Button asChild>
            <Link href="/mis-creditos">Ver mi saldo</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/mis-anuncios">Ir a mis anuncios</Link>
          </Button>
        </>
      )}
    </div>
  );

  // Mientras Next-Auth resuelve la sesión
  if (sessionStatus === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  // Compra acreditada — estado TERMINAL
  if (phase === 'confirmed') {
    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center"
        data-testid="compra-confirmada"
      >
        {/* E7 — la ilustración ocupa el hueco del icono de confirmación (§8.1). */}
        <IlustracionImagen ilustracion={ilustracion} />
        <h1 className="text-3xl font-bold">¡Saldo añadido!</h1>
        <p className="max-w-sm text-muted-foreground">
          Tu pago se ha procesado y el saldo ya está en tu cuenta.
        </p>
        {balances}
        {exits}
      </div>
    );
  }

  // El webhook tarda más de lo normal — estado TERMINAL también: deja de girar y
  // ofrece comprobar a mano y salir.
  if (phase === 'timeout') {
    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center"
        data-testid="compra-pendiente"
      >
        <h1 className="text-3xl font-bold">¡Gracias por tu compra!</h1>
        <p className="max-w-sm text-muted-foreground">
          Tu pago está tardando un poco más de lo normal en confirmarse. No se pierde nada:
          en cuanto el banco lo confirme, el saldo aparecerá en tu cuenta.
        </p>
        {balances}
        <Button
          onClick={() => {
            startedAt.current = Date.now();
            setPhase('checking');
          }}
          disabled={checking}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Comprobando…' : 'Comprobar de nuevo'}
        </Button>
        {exits}
      </div>
    );
  }

  // Sondeando — transitorio y acotado (POLL_TIMEOUT_MS), nunca indefinido.
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <Loader2 className="h-14 w-14 animate-spin text-primary" />
      <h1 className="text-3xl font-bold">¡Gracias por tu compra!</h1>
      <p className="max-w-sm text-muted-foreground">
        Estamos confirmando tu pago. Esta página se actualiza sola en cuanto el saldo esté
        en tu cuenta.
      </p>
      {balances}
    </div>
  );
}
