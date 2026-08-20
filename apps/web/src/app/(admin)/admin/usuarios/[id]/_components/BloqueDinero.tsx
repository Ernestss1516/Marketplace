'use client';

/**
 * FICHA DE USUARIO U3 — EL BLOQUE DE DINERO. **SÓLO ADMIN.**
 *
 * EL GATE ES REAL, NO COSMÉTICO, y conviene decir dónde está: **en el backend**.
 * Los datos de este bloque (saldo, bumps, entitlements con su procedencia,
 * transacciones) salen de `GET /admin/billing/users/:id`, que es ADMIN por el
 * `@MinRole(Role.ADMIN)` de la clase de su controlador. El detalle que sí ve un
 * MODERATOR —`GET /admin/users/:id`— **no incluye dinero**, y nunca lo incluyó.
 *
 * Por eso este componente ni siquiera se monta para un MODERATOR: la ficha no lo
 * renderiza y, en consecuencia, esa petición no se hace. Y si alguien la hiciera
 * a mano, recibiría un 403. El dato no llega al cliente por ninguna vía —que es
 * lo que pedía D-3—, en vez de llegar y esconderse con CSS.
 *
 * POR QUÉ EL DINERO ES ADMIN DENTRO DE UNA SECCIÓN MODERATOR: porque ya lo era.
 * `/admin/facturacion` es ADMIN y `/admin/usuarios` es MODERATOR; juntar las dos
 * vistas en una ficha no debía ensanchar de rebote quién ve saldos y pagos.
 * Ver docs/diseno-ficha-usuario.md §4.1 y §7 (D-3).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  debitAdminBalance,
  getAdminUserBillingDetail,
  grantAdminBumps,
  grantAdminCredits,
  grantAdminPro,
  revokeAdminPro,
  type AdminUserBillingDetail,
} from '@/lib/api/admin-billing';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const MOTIVO_MINIMO = 5;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Los entitlements PRO vigentes, partidos por PROCEDENCIA. */
function separarPro(detalle: AdminUserBillingDetail) {
  const pro = detalle.entitlements.filter((e) => e.type === 'PRO_SUBSCRIPTION');
  return {
    dePago: pro.filter((e) => e.subscriptionId !== null),
    manuales: pro.filter((e) => e.subscriptionId === null),
  };
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="text-right font-medium">{valor}</span>
    </div>
  );
}

/** Un formulario de cantidad + motivo. Los cuatro movimientos de saldo son iguales. */
function FormularioSaldo({
  testId,
  etiquetaBoton,
  variante,
  onEnviar,
  guardando,
}: {
  testId: string;
  etiquetaBoton: string;
  variante?: 'default' | 'destructive';
  onEnviar: (amount: number, reason: string) => void;
  guardando: boolean;
}) {
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const valido = Number(cantidad) >= 1 && motivo.trim().length >= MOTIVO_MINIMO;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <input
        type="number"
        min={1}
        value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
        placeholder="Cantidad"
        className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
        data-testid={`${testId}-cantidad`}
      />
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo (obligatorio)"
        className="h-9 min-w-[14rem] flex-1 rounded-md border bg-background px-2 text-sm"
        data-testid={`${testId}-motivo`}
      />
      <Button
        size="sm"
        variant={variante}
        disabled={!valido || guardando}
        onClick={() => {
          onEnviar(Number(cantidad), motivo.trim());
          setCantidad('');
          setMotivo('');
        }}
        data-testid={`${testId}-enviar`}
      >
        {etiquetaBoton}
      </Button>
    </div>
  );
}

export function BloqueDinero({ userId, token }: { userId: string; token: string }) {
  const [detalle, setDetalle] = useState<AdminUserBillingDetail | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Conceder Pro
  const [proHasta, setProHasta] = useState('');
  const [proMotivo, setProMotivo] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDetalle(await getAdminUserBillingDetail(token, userId));
    } catch (err) {
      setError(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar',
      );
    } finally {
      setCargando(false);
    }
  }, [token, userId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function ejecutar(accion: () => Promise<unknown>, mensaje?: (r: unknown) => string) {
    if (guardando) return;
    setGuardando(true);
    setAviso(null);
    try {
      const r = await accion();
      if (mensaje) setAviso(mensaje(r));
      await cargar();
    } catch (err) {
      alert(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error en la acción',
      );
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return (
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando datos económicos...
        </div>
      </section>
    );
  }

  if (error || !detalle) {
    return (
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error ?? 'Sin datos'}
        </div>
      </section>
    );
  }

  const { dePago, manuales } = separarPro(detalle);
  const saldo = detalle.wallet?.balance ?? 0;
  const bumps = detalle.wallet?.bumpBalance ?? 0;

  return (
    <div className="space-y-4" data-testid="bloque-dinero">
      {/* ── Pro: el hecho, la PROCEDENCIA y el vencimiento ────────────────── */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Plan Pro
        </h2>

        {dePago.length === 0 && manuales.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="pro-sin-plan">
            Sin Pro activo.
          </p>
        ) : (
          <div className="space-y-2" data-testid="pro-vigente">
            {dePago.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>Pro de pago</Badge>
                <span className="text-muted-foreground">
                  hasta {formatDateTime(e.expiresAt)}
                </span>
              </div>
            ))}
            {manuales.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary" data-testid="pro-manual">
                  Pro concedido por el equipo
                </Badge>
                <span className="text-muted-foreground">
                  hasta {formatDateTime(e.expiresAt)}
                </span>
              </div>
            ))}
            {/* D-1, dicho con su nombre en vez de con un cero confuso. */}
            {dePago.length === 0 && manuales.length > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="pro-sin-cuota">
                Sin cuota mensual: las gratuidades de destacados y bumps cuelgan de un ciclo de
                facturación, y una concesión del equipo no lo tiene.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
          <div>
            <label htmlFor="pro-hasta" className="mb-1 block text-xs text-muted-foreground">
              Conceder Pro hasta
            </label>
            <input
              id="pro-hasta"
              type="date"
              value={proHasta}
              onChange={(e) => setProHasta(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              data-testid="pro-conceder-hasta"
            />
          </div>
          <input
            value={proMotivo}
            onChange={(e) => setProMotivo(e.target.value)}
            placeholder="Motivo (obligatorio)"
            className="h-9 min-w-[14rem] flex-1 rounded-md border bg-background px-2 text-sm"
            data-testid="pro-conceder-motivo"
          />
          <Button
            size="sm"
            // La fecha es OBLIGATORIA también aquí: el backend la exige, y un
            // botón que promete lo que va a fallar es una promesa rota.
            disabled={!proHasta || proMotivo.trim().length < MOTIVO_MINIMO || guardando}
            onClick={() =>
              void ejecutar(() =>
                grantAdminPro(token, userId, {
                  expiresAt: new Date(proHasta).toISOString(),
                  reason: proMotivo.trim(),
                }),
              ).then(() => {
                setProHasta('');
                setProMotivo('');
              })
            }
            data-testid="pro-conceder"
          >
            Conceder Pro
          </Button>

          {/* REVOCAR SÓLO SI HAY UN PRO MANUAL. Para un Pro de pago el botón no
              aparece: quitarle el entitlement a quien paga le retiraría lo
              comprado sin cancelar su cobro, y el backend lo rechaza. */}
          {manuales.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              disabled={guardando}
              onClick={() => {
                const motivo = window.prompt('Motivo de la revocación (mínimo 5 caracteres):');
                if (!motivo || motivo.trim().length < MOTIVO_MINIMO) return;
                void ejecutar(() => revokeAdminPro(token, userId, { reason: motivo.trim() }));
              }}
              data-testid="pro-revocar"
            >
              Revocar Pro del equipo
            </Button>
          )}
        </div>
      </section>

      {/* ── Saldo ─────────────────────────────────────────────────────────── */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Saldo
        </h2>
        <div className="divide-y">
          <Fila etiqueta="Créditos" valor={<span data-testid="saldo-creditos">{saldo}</span>} />
          <Fila etiqueta="Bumps" valor={<span data-testid="saldo-bumps">{bumps}</span>} />
        </div>

        {aviso && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="dinero-aviso">
            {aviso}
          </p>
        )}

        <div className="mt-4 space-y-3 border-t pt-3">
          <div>
            <p className="mb-1 text-xs font-medium">Créditos</p>
            <div className="space-y-2">
              <FormularioSaldo
                testId="creditos-dar"
                etiquetaBoton="Dar"
                guardando={guardando}
                onEnviar={(amount, reason) =>
                  void ejecutar(() => grantAdminCredits(token, userId, { amount, reason }))
                }
              />
              <FormularioSaldo
                testId="creditos-quitar"
                etiquetaBoton="Quitar"
                variante="destructive"
                guardando={guardando}
                onEnviar={(amount, reason) =>
                  void ejecutar(
                    () => debitAdminBalance(token, userId, 'credits', { amount, reason }),
                    (r) => {
                      const { debitedAmount } = r as { debitedAmount: number };
                      // Si el suelo actuó, se dice — no se finge que se quitó
                      // lo pedido.
                      return debitedAmount < amount
                        ? `Se descontaron ${debitedAmount} créditos: era todo el saldo disponible.`
                        : `Se descontaron ${debitedAmount} créditos.`;
                    },
                  )
                }
              />
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium">Bumps</p>
            <div className="space-y-2">
              <FormularioSaldo
                testId="bumps-dar"
                etiquetaBoton="Dar"
                guardando={guardando}
                onEnviar={(amount, reason) =>
                  void ejecutar(() => grantAdminBumps(token, userId, { amount, reason }))
                }
              />
              <FormularioSaldo
                testId="bumps-quitar"
                etiquetaBoton="Quitar"
                variante="destructive"
                guardando={guardando}
                onEnviar={(amount, reason) =>
                  void ejecutar(
                    () => debitAdminBalance(token, userId, 'bumps', { amount, reason }),
                    (r) => {
                      const { debitedAmount } = r as { debitedAmount: number };
                      return debitedAmount < amount
                        ? `Se descontaron ${debitedAmount} bumps: era todo el saldo disponible.`
                        : `Se descontaron ${debitedAmount} bumps.`;
                    },
                  )
                }
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Quitar saldo descuenta como mucho lo que hay: nunca deja el saldo en negativo. No
            distingue lo comprado de lo concedido — el monedero guarda un saldo, no lotes.
          </p>
        </div>

        <Link
          href={`/admin/facturacion/usuarios/${userId}`}
          className="mt-3 inline-block text-xs text-muted-foreground hover:underline"
          data-testid="enlace-facturacion"
        >
          Ver el detalle de facturación completo →
        </Link>
      </section>
    </div>
  );
}
