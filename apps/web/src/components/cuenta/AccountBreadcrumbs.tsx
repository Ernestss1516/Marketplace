'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';
import { resolveAccountTrail } from '@/config/account-nav';

/**
 * UXV.2 (M1) — migas de la zona de cuenta, derivadas del pathname en el SHELL.
 *
 * Se resuelven aquí y no en cada página por dos razones, y la segunda pesa más:
 * (1) veinte páginas no tendrían que aprender a orientar al usuario — eso es trabajo del
 * contenedor; (2) migas repartidas por veinte ficheros divergen del menú, que es
 * exactamente la clase de defecto que esta ráfaga cierra. Menú y migas salen de la misma
 * tabla (`config/account-nav.ts`), así que no pueden contradecirse.
 *
 * En las raíces de sección no pinta nada (`resolveAccountTrail` devuelve `[]`): ahí el
 * menú ya marca dónde estás y una miga «Inicio / Mis anuncios» sería ruido. Aparecen
 * cuando hay algo que el menú no puede contar — que estás DENTRO de una sección.
 */
export function AccountBreadcrumbs() {
  const pathname = usePathname();
  return <Breadcrumbs items={resolveAccountTrail(pathname)} className="mb-4" />;
}
