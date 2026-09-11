'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { registrarConsentimiento } from '@/lib/api/consentimiento';
import { VERSION_TEXTO, type Categoria } from '@/lib/consentimiento/constantes';
import {
  escribirConsentimiento,
  leerConsentimiento,
  type Consentimiento,
} from '@/lib/consentimiento/cookie';

/**
 * COOKIES RÁFAGA 1 — EL ESTADO DEL CONSENTIMIENTO EN EL NAVEGADOR.
 *
 * Ver docs/diseno-consentimiento-cookies.md §1.2 y §2.
 *
 * ─── POR QUÉ ESTO VIVE EN EL CLIENTE Y NO EN EL SERVIDOR ────────────────────────
 *
 * Porque las rutas que pintan terceros están cacheadas con ISR (`revalidate = 3600` en
 * `paginas/[slug]/page.tsx:10` y `blog/[slug]/page.tsx:14`). **Una respuesta cacheada es
 * la misma para todos**, así que no puede llevar dentro la decisión de un usuario
 * concreto: o se rompe el ISR —y con él el rendimiento y el SEO de una plataforma
 * read-heavy— o se le sirve a un visitante el consentimiento de otro, que es peor que no
 * tener gate porque incumple en silencio.
 *
 * Y no se pierde nada, porque **el HTML cacheado ya es el correcto por defecto**: sin
 * consentimiento el estado es «no se carga», así que el marcador ES lo que va en la
 * página estática. El cliente no quita un iframe que ya estaba; lo AÑADE si hay
 * consentimiento. El orden importa — lo contrario sería «cargar y ocultar», que es
 * exactamente lo que el consentimiento previo prohíbe. El peor caso posible de este
 * diseño es no cargar un tercero; nunca cargarlo de más.
 *
 * ─── EL ESTADO INICIAL, Y EL PARPADEO QUE SE ACEPTA ─────────────────────────────
 *
 * El primer render del cliente devuelve lo MISMO que el servidor (`null`, «no se sabe»),
 * y la cookie se lee en un efecto tras montar. Es el molde literal de `BannerList`
 * (`components/banners/BannerList.tsx:64-70`), que documenta el mismo trade-off: «acepta
 * un flash breve» a cambio de no romper la hidratación.
 *
 * Aquí el flash es de un frame y **sólo lo ve quien YA consintió** (marcador → contenido).
 * El CLS es cero porque el marcador mide exactamente lo que el contenido que lo sustituye.
 * En la dirección contraria —quien no consintió— no hay parpadeo ninguno: el marcador ya
 * estaba pintado y se queda.
 */

interface ValorContexto {
  /** ¿Ya se leyó la cookie? Antes de esto no se sabe nada, y no saber es no consentir. */
  cargado: boolean;
  /** ¿Está consentida esta categoría? */
  permite: (categoria: Categoria) => boolean;
  /** Concede una categoría: escribe la cookie y registra la prueba. */
  conceder: (categoria: Categoria) => void;
}

const ConsentContext = createContext<ValorContexto | null>(null);

/**
 * Lo que ve un componente montado FUERA del proveedor: nada consentido.
 *
 * Fail-closed a propósito. Un olvido al montar el proveedor tiene que degradar hacia «no
 * se carga el tercero» —un marcador de más—, nunca hacia «se carga sin consentimiento»,
 * que sería el incumplimiento. El fallo tiene que caer del lado seguro sin que nadie
 * tenga que acordarse.
 */
const SIN_PROVEEDOR: ValorContexto = {
  cargado: true,
  permite: () => false,
  conceder: () => undefined,
};

/**
 * Lo que ve el backoffice (D-nueva-3).
 *
 * El editor de bloques previsualiza con el MISMO `VideoBlockRenderer` que el sitio
 * público (`VideoBlockEditor.tsx:72`), así que sin esto un editor que acaba de pegar una
 * URL de Vimeo vería un marcador en lugar de su vídeo — absurdo: acaba de pedir ese
 * vídeo, explícitamente, escribiendo su dirección.
 *
 * Se resuelve aquí, en el layout, y no con un `prop` que alguien olvidaría o copiaría a
 * una superficie pública. El backoffice no es una superficie publicada, no se cachea, y
 * quien está dentro ha solicitado expresamente ese contenido.
 */
const TODO_CONCEDIDO: ValorContexto = {
  cargado: true,
  permite: () => true,
  conceder: () => undefined,
};

export function useConsent(): ValorContexto {
  return useContext(ConsentContext) ?? SIN_PROVEEDOR;
}

export function ConsentProvider({
  children,
  concedidoSiempre = false,
  token,
}: {
  children: React.ReactNode;
  /** Sólo para el backoffice — ver `TODO_CONCEDIDO`. */
  concedidoSiempre?: boolean;
  /**
   * El `accessToken` de la sesión, si la hay, para que la prueba quede atada al usuario.
   *
   * LLEGA COMO `prop` DESDE EL LAYOUT, y no de `useSession()`, por dos razones que
   * apuntan al mismo sitio: el layout raíz YA resuelve la sesión en servidor
   * (`layout.tsx:77`), así que el hook sería una segunda fuente del mismo dato; y
   * `next-auth/react` es ESM puro, que jest no transforma — importarlo aquí obligaría a
   * mockear next-auth en CADA test que monte un componente con terceros dentro. Es el
   * molde del repo: el servidor resuelve y el dato baja hecho.
   *
   * Sin token la fila se registra igual, sin `userId`: es el caso NORMAL, porque el
   * consentimiento se da casi siempre antes de iniciar sesión.
   */
  token?: string;
}) {
  const [consentimiento, setConsentimiento] = useState<Consentimiento | null>(null);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    if (concedidoSiempre) return;
    setConsentimiento(leerConsentimiento());
    setCargado(true);
  }, [concedidoSiempre]);

  const conceder = useCallback(
    (categoria: Categoria) => {
      const previas = consentimiento?.categorias ?? [];
      if (previas.includes(categoria)) return;

      const categorias = [...previas, categoria];
      // Una concesión sobre una decisión anterior es un cambio, no una primera vez: la
      // prueba tiene que distinguirlos.
      const action = consentimiento ? 'UPDATED' : 'GRANTED';

      // SE ESCRIBE LA COOKIE PRIMERO Y SIN ESPERAR AL SERVIDOR: la voluntad del usuario
      // se respeta ya, en este frame. El registro va detrás y puede fallar sin que nada
      // se rompa — el `id` queda en `null` y la cookie sigue siendo válida.
      const base: Consentimiento = {
        version: VERSION_TEXTO,
        categorias,
        fecha: Math.floor(Date.now() / 1000),
        id: consentimiento?.id ?? null,
      };
      escribirConsentimiento(base);
      setConsentimiento(base);

      void registrarConsentimiento({
        action,
        categories: categorias,
        policyVersion: VERSION_TEXTO,
        token,
      }).then((id) => {
        if (!id) return;
        const conId = { ...base, id };
        escribirConsentimiento(conId);
        setConsentimiento(conId);
      });
    },
    [consentimiento, token],
  );

  const valor = useMemo<ValorContexto>(
    () =>
      concedidoSiempre
        ? TODO_CONCEDIDO
        : {
            cargado,
            permite: (categoria) => consentimiento?.categorias.includes(categoria) ?? false,
            conceder,
          },
    [concedidoSiempre, cargado, consentimiento, conceder],
  );

  return <ConsentContext.Provider value={valor}>{children}</ConsentContext.Provider>;
}
