'use client';

import { useSession } from 'next-auth/react';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';

/**
 * UXV.2 / SHELL-D3 (M3) — el camino de vuelta desde `/planes`.
 *
 * `/planes` se queda en `(public)`: es una página de captación con `metadata` propia y
 * su `MainNav pageType="PLANES"`, y tiene que seguir siendo visitable sin sesión.
 * Duplicarla dentro del shell de cuenta habría creado dos superficies de precios que se
 * desincronizan.
 *
 * El precio de esa decisión es que quien llega desde su cuenta —«Ver planes» en
 * `/perfil/suscripcion`, «Hazte Pro» en Estadísticas, o la entrada del propio menú—
 * cambia de shell a mitad de una tarea de gestión: el menú lateral desaparece y no había
 * ninguna vuelta. Esto la pone, y solo para quien tiene sesión: al visitante anónimo no
 * se le habla de «mi cuenta».
 *
 * Es el componente de migas compartido, no un enlace suelto: la vuelta se lee igual aquí
 * que dentro de la zona de cuenta.
 */
export function VolverACuenta() {
  const { status } = useSession();
  if (status !== 'authenticated') return null;

  return (
    <div className="container mx-auto px-4 pt-4">
      <Breadcrumbs
        home={{ name: 'Mi cuenta', href: '/mis-anuncios' }}
        items={[{ name: 'Planes' }]}
      />
    </div>
  );
}
