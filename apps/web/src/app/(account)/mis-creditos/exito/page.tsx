'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Loader2, RefreshCw, Coins, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getWallet } from '@/lib/api/billing';

/**
 * INVARIANTE DE SEGURIDAD: esta página NO concede créditos ni bumps ni
 * ejecuta ninguna lógica de negocio. El wallet se acredita exclusivamente por
 * la notificación online de Redsys (POST /webhooks/redsys). Ver
 * diseno-facturacion.md §7.5.
 *
 * Monetización ráfaga 4 — página compartida entre packs de créditos y de
 * bumps (ambos usan el urlOk por defecto de RedsysService.buildForm): muestra
 * los dos saldos, no sabe cuál de los dos se acaba de comprar.
 */
export default function MisCreditosExitoPage() {
  const { data: session, status: sessionStatus } = useSession();

  const [balance, setBalance] = useState<number | null>(null);
  const [bumpBalance, setBumpBalance] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const token = session?.user.accessToken;

  const checkBalance = useCallback(async () => {
    if (!token) return;
    setChecking(true);
    try {
      const wallet = await getWallet(token);
      setBalance(wallet.balance);
      setBumpBalance(wallet.bumpBalance);
    } catch {
      // Keep balances as null — don't show a stale 0
    } finally {
      setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) checkBalance();
  }, [token, checkBalance]);

  if (sessionStatus === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="relative">
        <Loader2 className="h-14 w-14 animate-spin text-primary" />
      </div>

      <h1 className="text-3xl font-bold">¡Gracias por tu compra!</h1>

      <p className="max-w-sm text-muted-foreground">
        Tu pago se está procesando. El saldo aparecerá en tu cuenta en unos instantes.
      </p>

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

      <Button onClick={checkBalance} disabled={checking} variant="outline" className="gap-2">
        <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
        {checking ? 'Actualizando…' : 'Actualizar saldo'}
      </Button>

      <p className="text-sm text-muted-foreground">
        <Link href="/mis-creditos" className="underline hover:text-foreground">
          Ir a mi saldo
        </Link>
      </p>
    </div>
  );
}
