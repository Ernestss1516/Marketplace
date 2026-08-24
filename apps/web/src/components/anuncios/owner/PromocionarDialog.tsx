'use client';

import { useState, useEffect } from 'react';
import React from 'react';
import Link from 'next/link';
import { CalendarClock, Loader2, Star, CreditCard, Coins, TrendingUp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import {
  isCreditError,
  isCooldownError,
  isQuotaUnavailableError,
  formatRetryAfter,
  toBumpMessage,
  toFeaturedByCreditsMessage,
  toUserMessage,
} from '@/lib/api/client';
import {
  getCatalog,
  getWallet,
  getProStatus,
  featuredByCredits,
  createFeaturedCheckout,
  bumpListing,
  type CatalogPrice,
  type CatalogResponse,
  type ProStatus,
  type RedsysFormData,
} from '@/lib/api/billing';
import { RedsysRedirectForm } from '@/app/(account)/mis-creditos/_components/RedsysRedirectForm';
import { ProHint } from '@/components/pro/ProGate';
import { bumpCooldownTitle } from '@/lib/bump-cooldown';
import { bumpCostLabel, resolveBumpOffer } from './promocion';
import {
  cadenciaLabel,
  createBumpSchedule,
  fechaHoraPeninsular,
  updateBumpSchedule,
  type BumpScheduleSummary,
} from '@/lib/api/bump-schedules';
import type { BumpPricing } from '@/types';

/**
 * UXV.4 (TARJETA-D2) — el ÚNICO sitio donde se promociona un anuncio.
 *
 * Antes había dos botones sueltos en la fila de la tarjeta, «Destacar» y «Bump», y el
 * usuario tenía que deducir por su cuenta en qué se diferencian dos productos que se
 * parecen mucho. Aquí se eligen dentro del mismo diálogo, con su coste al lado, y la
 * tarjeta recupera el espacio que necesitaban dos botones.
 *
 * DEJA SITIO AL BUMP AUTOMÁTICO (proyecto 2) SIN DISEÑARLO: el diálogo ya está organizado
 * como «elige un producto de promoción → configúralo → paga», que es exactamente la forma
 * que necesita «programar bumps: cada X, a tal hora». Entrará como un `Producto` más en el
 * selector de arriba, con su propio bloque de configuración donde hoy están la duración y
 * el método de pago del destacado. Ni la tarjeta ni este componente tendrán que
 * reestructurarse para admitirlo.
 *
 * LO QUE NO ESTÁ AQUÍ: el bump GRATIS a un clic. Cuando el usuario tiene cuota Pro o saldo
 * de bumps no hay nada que elegir ni que cobrar, así que el control primario lo ejecuta
 * directo (ver `PromocionarControl`). Este diálogo es para cuando hay una decisión que
 * tomar.
 */

/**
 * Bump automático (D8) — «programar» entra como un producto MÁS del selector, que es
 * exactamente donde UXV.4 previó que entraría.
 *
 * Y ESO RESUELVE SOLO EL HALLAZGO DE LA AUDITORÍA: el menú `▾` de `PromocionarControl` solo
 * se pinta cuando el bump sale gratis, así que colgar ahí la configuración habría dejado
 * fuera justo a quien más querría programar —el que paga—. Pero el usuario de pago SÍ llega
 * a este diálogo, por el botón único «Promocionar». El problema no era que faltara una
 * entrada: era depender del `▾` como entrada única.
 */
type Producto = 'bump' | 'destacado' | 'programar';
type PayMethod = 'credits' | 'card';
/** H8.5b — vía del destacado: cuota gratuita de Pro vs. pagado (créditos/tarjeta). */
type FeatureMethod = 'quota' | 'paid';

interface Props {
  listing: { id: string };
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  /** Precios y bolsas del usuario. La tarjeta los recibe del servidor; la ficha los pide. */
  bumpPricing: BumpPricing;
  /** UXV.1 — instante en que el anuncio vuelve a ser bumpeable, servido por la API. */
  nextBumpAt?: string | null;
  /** Producto preseleccionado al abrir. */
  productoInicial?: Producto;
  /** Bump automático — la programación vigente del anuncio, si ya tiene una. */
  bumpSchedule?: BumpScheduleSummary | null;
  /**
   * UXV.3 (A7-flujo) — a dónde volver si el usuario sale de aquí a comprar créditos.
   */
  returnTo?: string;
}

export function PromocionarDialog({
  listing,
  token,
  open,
  onOpenChange,
  onSuccess,
  bumpPricing,
  nextBumpAt,
  productoInicial = 'bump',
  bumpSchedule,
  returnTo,
}: Props) {
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();

  const comprarCreditosHref = returnTo
    ? `/mis-creditos?volver=${encodeURIComponent(returnTo)}`
    : '/mis-creditos';

  const [producto, setProducto] = useState<Producto>(productoInicial);
  const [featuredPrices, setFeaturedPrices] = useState<CatalogPrice[]>([]);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [proStatus, setProStatus] = useState<ProStatus | null>(null);
  // E-6 — la cuota configurada, para contarle a un no-Pro lo que se pierde con su cifra real.
  const [cuotaDestacados, setCuotaDestacados] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [busy, setBusy] = useState(false);

  // Bump automático — la cadencia que se está configurando. Los valores por defecto salen de
  // la programación existente si la hay (editar) o de un arranque razonable: cada 3 días a
  // las 9:00, que es media mañana entre semana.
  const [intervalDays, setIntervalDays] = useState<number>(bumpSchedule?.intervalDays ?? 3);
  const [hourOfDay, setHourOfDay] = useState<number>(bumpSchedule?.hourOfDay ?? 9);

  const [selectedPriceId, setSelectedPriceId] = useState<string>('');
  const [payMethod, setPayMethod] = useState<PayMethod>('credits');
  const [featureMethod, setFeatureMethod] = useState<FeatureMethod>('paid');
  const [redsysFormData, setRedsysFormData] = useState<RedsysFormData | null>(null);

  const bumpOffer = resolveBumpOffer(bumpPricing, nextBumpAt);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setRedsysFormData(null);
    setProducto(productoInicial);

    Promise.all([
      getCatalog().catch(
        (): CatalogResponse => ({ products: [], bumpCreditCost: 5, proExtraBumpsPercent: 20 }),
      ),
      getWallet(token).catch(() => null),
      getProStatus(token).catch(() => null),
    ]).then(([catalog, wallet, status]) => {
      const prices = catalog.products
        .flatMap((p) => p.prices)
        .filter((pr): pr is CatalogPrice => pr.durationDays != null && pr.creditAmount == null)
        .sort((a, b) => (a.durationDays ?? 0) - (b.durationDays ?? 0));

      setFeaturedPrices(prices);
      setWalletBalance(wallet?.balance ?? 0);
      if (prices.length > 0) setSelectedPriceId(prices[0].priceId);
      setProStatus(status);
      setCuotaDestacados(catalog.proMonthlyFeaturedQuota ?? 0);
      // Default to the free quota when eligible — never overrides a later manual choice,
      // this only runs once when the dialog's data finishes loading.
      setFeatureMethod(status?.isPro && status.remaining > 0 ? 'quota' : 'paid');
      setLoading(false);
    });
  }, [open, token, productoInicial]);

  const canUseQuota = Boolean(proStatus?.isPro && (proStatus?.remaining ?? 0) > 0);
  const selectedPrice = featuredPrices.find((p) => p.priceId === selectedPriceId);
  const creditCost = selectedPrice?.creditCost ?? 0;
  const canPayByCredits = walletBalance >= creditCost;
  const showPaidOptions = !canUseQuota || featureMethod === 'paid';

  // ── Bump automático ───────────────────────────────────────────────────────
  /**
   * Crea la programación, o guarda la cadencia si el anuncio ya la tenía. El feedback va por
   * el canal único de UXV.3 (toast), como el resto de acciones puntuales de este diálogo.
   */
  async function submitProgramar() {
    setBusy(true);
    setError(null);
    await run(
      () =>
        bumpSchedule
          ? updateBumpSchedule(token, bumpSchedule.id, { intervalDays, hourOfDay })
          : createBumpSchedule(token, { listingId: listing.id, intervalDays, hourOfDay }),
      {
        successMessage: (s) =>
          `Bumps programados ${cadenciaLabel(s.intervalDays, s.hourOfDay)}. ` +
          `El primero, ${fechaHoraPeninsular(s.nextRunAt)}.`,
        onSuccess: () => {
          onOpenChange(false);
          onSuccess();
        },
        // Inline y no toast: el error trae contexto sobre lo que se está configurando, y
        // sacarlo del diálogo se lo llevaría fuera de donde el usuario está mirando
        // (regla FEEDBACK-D2 de UXV.3).
        onError: (err) => setError(toUserMessage(err)),
        callbackUrl: loginUrl,
      },
    );
    setBusy(false);
  }

  // ── Bump ──────────────────────────────────────────────────────────────────
  async function submitBump() {
    setBusy(true);
    setError(null);
    await run(() => bumpListing(token, listing.id), {
      // UXV.3 — mismo canal y mismo mensaje que el bump a un clic del control primario.
      successMessage: (result) =>
        result.paidWith === 'PRO_QUOTA'
          ? 'Bump aplicado. Gratis, con tu cuota mensual Pro.'
          : result.paidWith === 'BUMP_BALANCE'
            ? 'Bump aplicado. Gratis, de tu saldo de bumps.'
            : `Bump aplicado. Se han descontado ${result.cost} créditos.`,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
      onError: (err) => {
        if (isCreditError(err)) {
          setError(
            <>
              No tienes créditos suficientes para subir el anuncio.{' '}
              <Link href={comprarCreditosHref} className="underline hover:text-foreground">
                Comprar créditos
              </Link>
            </>,
          );
        } else if (isCooldownError(err)) {
          setError(`Ya has subido este anuncio, espera ${formatRetryAfter(err.retryAfter)}.`);
        } else {
          setError(toBumpMessage(err));
        }
      },
      callbackUrl: loginUrl,
    });
    setBusy(false);
  }

  // ── Destacado ─────────────────────────────────────────────────────────────
  async function submitDestacado() {
    setBusy(true);
    setError(null);

    if (featureMethod === 'quota') {
      await run(() => featuredByCredits(token, { listingId: listing.id, useQuota: true }), {
        successMessage: `Anuncio destacado ${proStatus?.quotaDurationDays ?? 7} días con tu cuota Pro.`,
        onSuccess: () => {
          onOpenChange(false);
          onSuccess();
        },
        onError: (err) => {
          if (isQuotaUnavailableError(err)) {
            // Rare (concurrency or stale state): don't dead-end the user — offer the
            // credits/card path right away instead of a generic error.
            setProStatus((prev) => (prev ? { ...prev, remaining: 0 } : prev));
            setFeatureMethod('paid');
            setError('Ya no tienes cuota disponible este mes. Puedes destacar con créditos o tarjeta:');
          } else {
            setError(toFeaturedByCreditsMessage(err));
          }
        },
        callbackUrl: loginUrl,
      });
      setBusy(false);
      return;
    }

    if (!selectedPrice) {
      setBusy(false);
      return;
    }

    if (payMethod === 'credits') {
      await run(
        () =>
          featuredByCredits(token, {
            listingId: listing.id,
            useQuota: false,
            priceId: selectedPrice.priceId,
          }),
        {
          successMessage: `Anuncio destacado ${selectedPrice.durationDays} días. Se han descontado ${creditCost} créditos.`,
          onSuccess: () => {
            onOpenChange(false);
            onSuccess();
          },
          onError: (err) => {
            if (isCreditError(err)) {
              setError(
                <>
                  No tienes créditos suficientes.{' '}
                  <Link href={comprarCreditosHref} className="underline hover:text-foreground">
                    Comprar créditos
                  </Link>
                </>,
              );
            } else {
              setError(toFeaturedByCreditsMessage(err));
            }
          },
          callbackUrl: loginUrl,
        },
      );
    } else {
      await run(() => createFeaturedCheckout(token, selectedPrice.priceId, listing.id), {
        onSuccess: (result) => {
          const { redsysFormData: data } = result as { redsysFormData: RedsysFormData };
          setRedsysFormData(data);
        },
        onError: (err) => setError(toFeaturedByCreditsMessage(err)),
        callbackUrl: loginUrl,
      });
    }

    setBusy(false);
  }

  if (redsysFormData) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>Redirigiendo al TPV</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Redirigiendo al TPV…</p>
            <RedsysRedirectForm formData={redsysFormData} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const bumpDisabled = bumpOffer.onCooldown;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Promocionar anuncio</DialogTitle>
          <DialogDescription>
            Dos formas de que te vean más. Puedes usarlas por separado.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── Qué producto ──────────────────────────────────────────────
                Aquí es donde entrará «Programar bumps» cuando llegue el bump
                automático: una opción más de esta lista, con su propio bloque de
                configuración debajo. */}
            <RadioGroup
              value={producto}
              onValueChange={(v) => {
                setProducto(v as Producto);
                setError(null);
              }}
              className="space-y-2"
              data-testid="promo-producto"
            >
              <div className="flex items-start space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                <RadioGroupItem
                  value="bump"
                  id="promo-bump"
                  className="mt-1"
                  disabled={bumpDisabled}
                />
                <Label htmlFor="promo-bump" className="flex-1 cursor-pointer">
                  <span className="flex items-center gap-1.5 font-medium">
                    <TrendingUp className="h-4 w-4" aria-hidden />
                    Subir al inicio
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Tu anuncio vuelve a lo más reciente de los listados.
                  </span>
                  <span className="mt-1 block text-xs font-medium" data-testid="promo-bump-coste">
                    {bumpDisabled && bumpOffer.until
                      ? bumpCooldownTitle(bumpOffer.until)
                      : bumpCostLabel(bumpPricing, bumpOffer)}
                  </span>
                </Label>
              </div>

              <div className="flex items-start space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                <RadioGroupItem value="destacado" id="promo-destacado" className="mt-1" />
                <Label htmlFor="promo-destacado" className="flex-1 cursor-pointer">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Star className="h-4 w-4" aria-hidden />
                    Destacar
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Tu anuncio aparece resaltado y en el bloque de promocionados durante
                    varios días.
                  </span>
                </Label>
              </div>
              {/* D8 — el bump automático, como un producto más. */}
              <div className="flex items-start space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                <RadioGroupItem value="programar" id="promo-programar" className="mt-1" />
                <Label htmlFor="promo-programar" className="flex-1 cursor-pointer">
                  <span className="flex items-center gap-1.5 font-medium">
                    <CalendarClock className="h-4 w-4" aria-hidden />
                    {bumpSchedule ? 'Editar bumps programados' : 'Programar bumps'}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {bumpSchedule
                      ? cadenciaLabel(bumpSchedule.intervalDays, bumpSchedule.hourOfDay)
                      : 'Que se suba solo cada cierto tiempo, mientras tengas saldo.'}
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {/* ── Configuración del bump automático ──────────────────────────── */}
            {producto === 'programar' && (
              <div className="space-y-4 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="programar-intervalo">Cada cuánto</Label>
                  <select
                    id="programar-intervalo"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(Number(e.target.value))}
                    data-testid="programar-intervalo"
                  >
                    {/* Desde 1 día: el mínimo NO es la hora que permitiría el cooldown.
                        24 bumps al día serían ~120 créditos diarios sin que nadie lo pida. */}
                    {[1, 2, 3, 5, 7, 14, 30].map((d) => (
                      <option key={d} value={d}>
                        {d === 1 ? 'Todos los días' : `Cada ${d} días`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="programar-hora">A qué hora</Label>
                  <select
                    id="programar-hora"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={hourOfDay}
                    onChange={(e) => setHourOfDay(Number(e.target.value))}
                    data-testid="programar-hora"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {`Sobre las ${String(h).padStart(2, '0')}:00`}
                      </option>
                    ))}
                  </select>
                  {/* D4 — la zona se dice, no se supone: el sistema programa en hora
                      peninsular. Y «sobre las» porque la pasada es horaria: prometer el
                      minuto exacto sería prometer una precisión que no existe. */}
                  <p className="text-xs text-muted-foreground">
                    Hora peninsular. Se aplicará dentro de esa hora, no al minuto exacto.
                  </p>
                </div>

                {/* D10 — el precio se lee EN VIVO al ejecutar cada turno. Decirlo aquí es la
                    contrapartida de no congelarlo: congelarlo crearía una segunda verdad del
                    precio y dejaría al usuario fuera de las rebajas de campaña. */}
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Cada subida cuesta lo mismo que una manual —ahora,{' '}
                  <strong>{bumpCostLabel(bumpPricing, bumpOffer)}</strong>— y se cobra al
                  aplicarse, así que el precio puede variar si cambia. Si te quedas sin saldo,
                  se pausa y te avisamos: no se cobra nada a medias.
                </p>
              </div>
            )}

            {/* ── Configuración del destacado (idéntica a la de antes) ───────── */}
            {producto === 'destacado' && (
              <>
                <Separator />

                {featuredPrices.length === 0 ? (
                  <p className="py-2 text-center text-sm text-muted-foreground">
                    No hay opciones de destacado disponibles.
                  </p>
                ) : (
                  <>
                    {canUseQuota && (
                      <div>
                        <p className="mb-3 text-sm font-medium">Cómo destacar</p>
                        <RadioGroup
                          value={featureMethod}
                          onValueChange={(v) => setFeatureMethod(v as FeatureMethod)}
                          className="space-y-2"
                        >
                          <div className="flex items-start space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                            <RadioGroupItem value="quota" id="method-quota" className="mt-1" />
                            <Label htmlFor="method-quota" className="flex-1 cursor-pointer">
                              <span className="block font-medium">
                                Destacar gratis — {proStatus?.quotaDurationDays ?? 7} días
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                Cuota Pro · te quedan {proStatus?.remaining} este mes
                              </span>
                            </Label>
                          </div>

                          <div className="flex items-start space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                            <RadioGroupItem value="paid" id="method-paid" className="mt-1" />
                            <Label htmlFor="method-paid" className="flex-1 cursor-pointer">
                              <span className="block font-medium">
                                Destacar con créditos o tarjeta
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                Elige la duración: 7, 14 o 30 días
                              </span>
                            </Label>
                          </div>
                        </RadioGroup>

                        {featureMethod === 'quota' && proStatus?.remaining === 1 && (
                          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Este es tu último destacado gratis de este mes.
                          </p>
                        )}

                        <Separator className="mt-6" />
                      </div>
                    )}

                    {/*
                      E-6 — AQUÍ ES DONDE MÁS DUELE NO SABERLO. Un no-Pro abría este diálogo
                      y veía SÓLO el precio: ninguna señal de que una suscripción Pro incluye
                      varios destacados gratis al mes. La opción «Destacar gratis» de arriba
                      sólo existe si ya hay cuota, así que el beneficio estaba invisible justo
                      para quien hay que convencer.

                      «SUSCRIBIÉNDOTE» y no «con Pro»: la cuota cuelga del ciclo de
                      facturación, y un Pro concedido por el equipo no la tiene (D-1).
                    */}
                    {!canUseQuota && !proStatus?.isPro && cuotaDestacados > 0 && (
                      <div className="rounded-md border border-dashed p-3">
                        <ProHint testId="promocionar-quota-upsell">
                          Suscribiéndote a Pro tendrías {cuotaDestacados} destacado
                          {cuotaDestacados === 1 ? '' : 's'} gratis cada mes.
                        </ProHint>
                      </div>
                    )}

                    {showPaidOptions && (
                      <>
                        <div>
                          <p className="mb-3 text-sm font-medium">Duración</p>
                          <RadioGroup
                            value={selectedPriceId}
                            onValueChange={setSelectedPriceId}
                            className="space-y-2"
                          >
                            {featuredPrices.map((pr) => {
                              const eurFormatted = new Intl.NumberFormat('es-ES', {
                                style: 'currency',
                                currency: pr.currency,
                              }).format(pr.amount);
                              return (
                                <div
                                  key={pr.priceId}
                                  className="flex items-center space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary"
                                >
                                  <RadioGroupItem value={pr.priceId} id={`dur-${pr.priceId}`} />
                                  <Label
                                    htmlFor={`dur-${pr.priceId}`}
                                    className="flex flex-1 cursor-pointer items-center justify-between"
                                  >
                                    <span>{pr.durationDays} días</span>
                                    <span className="flex items-center gap-3 text-sm text-muted-foreground">
                                      <span className="flex items-center gap-1">
                                        <Coins className="h-3.5 w-3.5" />
                                        {pr.originalCreditCost != null && (
                                          <span className="line-through opacity-60">
                                            {pr.originalCreditCost}
                                          </span>
                                        )}
                                        {pr.creditCost ?? '—'} cr.
                                        {pr.discountPercent != null && (
                                          <span className="font-medium text-amber-600">
                                            -{pr.discountPercent}%
                                          </span>
                                        )}
                                      </span>
                                      <span className="text-xs">o</span>
                                      <span className="flex items-center gap-1">
                                        <CreditCard className="h-3.5 w-3.5" />
                                        {eurFormatted}
                                      </span>
                                    </span>
                                  </Label>
                                </div>
                              );
                            })}
                          </RadioGroup>
                          {featuredPrices.some((pr) => pr.discountPercent != null) && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              El descuento aplica solo al pagar con créditos.
                            </p>
                          )}
                        </div>

                        <Separator />

                        <div>
                          <p className="mb-3 text-sm font-medium">Método de pago</p>
                          <RadioGroup
                            value={payMethod}
                            onValueChange={(v) => setPayMethod(v as PayMethod)}
                            className="space-y-2"
                          >
                            <div className="flex items-center space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                              <RadioGroupItem value="credits" id="pay-credits" />
                              <Label
                                htmlFor="pay-credits"
                                className="flex flex-1 cursor-pointer items-center justify-between"
                              >
                                <span className="flex items-center gap-2">
                                  <Coins className="h-4 w-4 text-muted-foreground" />
                                  Créditos
                                </span>
                                <span
                                  className={`text-sm ${
                                    canPayByCredits ? 'text-muted-foreground' : 'text-destructive'
                                  }`}
                                >
                                  Saldo: {walletBalance} cr.
                                </span>
                              </Label>
                            </div>

                            <div className="flex items-center space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                              <RadioGroupItem value="card" id="pay-card" />
                              <Label
                                htmlFor="pay-card"
                                className="flex flex-1 cursor-pointer items-center justify-between"
                              >
                                <span className="flex items-center gap-2">
                                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                                  Tarjeta bancaria
                                </span>
                                {selectedPrice && (
                                  <span className="text-sm text-muted-foreground">
                                    {new Intl.NumberFormat('es-ES', {
                                      style: 'currency',
                                      currency: selectedPrice.currency,
                                    }).format(selectedPrice.amount)}
                                  </span>
                                )}
                              </Label>
                            </div>
                          </RadioGroup>

                          {payMethod === 'credits' && !canPayByCredits && creditCost > 0 && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Necesitas {creditCost - walletBalance} créditos más.{' '}
                              <Link
                                href={comprarCreditosHref}
                                className="underline hover:text-foreground"
                              >
                                Comprar créditos
                              </Link>
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {producto === 'programar' ? (
            <Button onClick={submitProgramar} disabled={busy || loading} data-testid="promo-confirmar-programar">
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarClock className="mr-2 h-4 w-4" />
              )}
              {bumpSchedule ? 'Guardar cambios' : 'Programar'}
            </Button>
          ) : producto === 'bump' ? (
            <Button onClick={submitBump} disabled={busy || loading || bumpDisabled} data-testid="promo-confirmar-bump">
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <TrendingUp className="mr-2 h-4 w-4" />
              )}
              {bumpOffer.free ? 'Subir gratis' : `Subir por ${bumpPricing.bumpCreditCost} créditos`}
            </Button>
          ) : (
            <Button
              onClick={submitDestacado}
              disabled={
                busy ||
                loading ||
                featuredPrices.length === 0 ||
                (showPaidOptions &&
                  (!selectedPriceId || (payMethod === 'credits' && !canPayByCredits)))
              }
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Star className="mr-2 h-4 w-4" />
              )}
              {featureMethod === 'quota'
                ? 'Destacar gratis'
                : payMethod === 'credits'
                  ? 'Destacar con créditos'
                  : 'Pagar con tarjeta'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
