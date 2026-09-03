'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import type { BrandingLogos } from '@/lib/api/branding';
import { getBrandingLive } from '@/lib/api/branding-admin';
import { ZonaDeMarca, type ZonaInfo } from './_components/ZonaDeMarca';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

/**
 * LA MARCA — `/admin/marca`. Solo ADMIN.
 *
 * QUÉ RESUELVE. Hasta L1 la marca era una constante de build: todas las instancias del
 * mismo código se llamaban igual y se veían igual, y entrar en el backoffice no decía
 * en CUÁL estabas. Aquí se suben los tres logos —público, backoffice y blog—, uno por
 * zona e independientes entre sí.
 *
 * TRES TARJETAS IGUALES Y NINGÚN BOTÓN DE «GUARDAR», al revés que la portada: cada
 * subida es una operación completa en el servidor (sube el fichero, escribe el ajuste,
 * limpia el anterior y revalida la caché del sitio). No hay borrador que confirmar, así
 * que un botón de guardar sólo podría mentir sobre cuándo pasan las cosas.
 *
 * LA PANTALLA SE REPUEBLA CON LA RESPUESTA, no con lo que se mandó: los tres endpoints
 * devuelven el estado ENTERO de la marca, así que subir el logo público repinta también
 * las otras dos zonas — que es justo lo que hace falta ver, porque las dos caen a él
 * mientras no tengan el suyo.
 *
 * Ver `docs/diseno-logos.md` §5, §6 y §8.
 */

const ZONAS: readonly ZonaInfo[] = [
  {
    zone: 'public',
    titulo: 'Público',
    donde: 'La cabecera del sitio: portada, búsqueda, fichas, y la zona de cuenta.',
  },
  {
    zone: 'backoffice',
    titulo: 'Backoffice',
    donde:
      'La cabecera de este panel y su menú de móvil. Es lo que dice de un vistazo a qué instancia corresponde el backoffice que tienes delante.',
  },
  {
    zone: 'blog',
    titulo: 'Blog',
    donde: 'La cabecera mientras se lee el blog. Fuera de /blog vuelve el logo público.',
  },
];

export default function AdminMarcaPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [logos, setLogos] = useState<BrandingLogos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setLogos(await getBrandingLive());
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cargar la marca',
      );
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Marca</h1>
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
        <Button variant="outline" size="sm" onClick={() => void cargar()}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!logos) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Marca</h1>
        <div className="space-y-4">
          {ZONAS.map((z) => (
            <div key={z.zone} className="h-56 animate-pulse rounded-md border bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold">Marca</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Un logo por zona, independientes. Ninguna zona se queda sin marca: si una no
        tiene el suyo se muestra el público, y si tampoco hay público, el nombre del
        sitio. Lo que se ve aquí es lo que está viendo la gente. Para confirmar cómo está
        montada esta instalación,{' '}
        <Link href="/admin/instancia" className="text-primary hover:underline">
          Instancia
        </Link>
        .
      </p>

      <div className="space-y-4" data-testid="marca-zonas">
        {ZONAS.map((info) => (
          <ZonaDeMarca
            key={info.zone}
            info={info}
            logos={logos}
            token={token}
            onChange={setLogos}
          />
        ))}
      </div>
    </div>
  );
}
