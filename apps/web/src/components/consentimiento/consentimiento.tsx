'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
 * consentimiento. El peor caso posible de este diseño es no cargar un tercero.
 *
 * ─── POR QUÉ NO HAY UN PROVEEDOR EN EL LAYOUT RAÍZ ──────────────────────────────
 *
 * Lo hubo, y **rompía la hidratación en producción**. Anidar un segundo Client Component
 * que envuelve `{children}` dentro del `SessionProvider` hacía que React, al hidratar,
 * montara una SEGUNDA copia del árbol junto a la primera: la página entera duplicada,
 * con dos cabeceras y dos de cada botón. Lo cazó la batería (`auth-friction`, «resolved
 * to 2 elements») y sólo en `next start` — en `next dev` React se recupera y no se nota.
 *
 * La lección, que conviene no repetir en la ráfaga 2 con el banner: **el layout raíz es
 * la superficie más delicada de la app, y un consentimiento que sólo leen dos
 * componentes no tiene por qué pasar por ella.**
 *
 * Así que cada gate es AUTÓNOMO: lee la cookie por su cuenta. Para que al conceder en uno
 * reaccionen los demás de la página, se emite un evento de navegador — el molde que el
 * repo ya usa para hablar entre piezas sueltas (`AUTH_EXPIRED_EVENT`,
 * `lib/api/client.ts:12`).
 *
 * ─── EL ESTADO INICIAL, Y EL PARPADEO QUE SE ACEPTA ─────────────────────────────
 *
 * El primer render del cliente devuelve lo MISMO que el servidor (`null`, «no se sabe»),
 * y la cookie se lee en un efecto tras montar. Es el molde literal de `BannerList`
 * (`components/banners/BannerList.tsx:64-70`), que documenta el mismo trade-off: «acepta
 * un flash breve» a cambio de no romper la hidratación.
 *
 * El flash es de un frame y **sólo lo ve quien YA consintió** (marcador → contenido). El
 * CLS es cero porque el marcador mide exactamente lo que el contenido que lo sustituye.
 * Quien no consintió no ve parpadeo ninguno.
 */

/** El evento con el que un gate avisa a los demás de que la cookie cambió. */
export const CONSENT_CHANGED_EVENT = 'marketplace:consent-changed';

/**
 * Override de zona: «aquí todo está concedido». Sólo lo enciende el backoffice.
 *
 * Un contexto y no un `prop` porque lo que decide es la ZONA, no cada componente: un
 * `prop` es algo que alguien olvida en la siguiente superficie o copia a una pública.
 * Por defecto `false`, así que **una zona que no diga nada retiene** — fail-closed.
 */
const TodoConcedidoContext = createContext(false);

export interface EstadoConsentimiento {
  /** ¿Ya se leyó la cookie? Antes de esto no se sabe nada, y no saber es no consentir. */
  cargado: boolean;
  /** ¿Está consentida esta categoría? */
  permite: (categoria: Categoria) => boolean;
  /** Concede una categoría: escribe la cookie, avisa a los demás gates y registra la prueba. */
  conceder: (categoria: Categoria) => void;
}

/**
 * EL BACKOFFICE VE LOS TERCEROS SIN MARCADOR (D-nueva-3).
 *
 * El editor de bloques previsualiza con el MISMO `VideoBlockRenderer` que el sitio
 * público (`VideoBlockEditor.tsx:72`). Sin esto, un editor que acaba de pegar una URL de
 * Vimeo vería un marcador en vez de su vídeo — absurdo: acaba de pedir ese vídeo,
 * explícitamente, escribiendo su dirección.
 *
 * Se sostiene porque el backoffice no es una superficie publicada, no se cachea, y quien
 * está dentro ha solicitado expresamente ese contenido.
 */
export function ConsentTodoConcedido({ children }: { children: React.ReactNode }) {
  return <TodoConcedidoContext.Provider value>{children}</TodoConcedidoContext.Provider>;
}

/**
 * El estado del consentimiento, leído del navegador. Sin proveedor y sin configuración:
 * cualquier componente que lo pida obtiene la verdad de la cookie.
 */
export function useConsent(): EstadoConsentimiento {
  const todoConcedido = useContext(TodoConcedidoContext);
  const [consentimiento, setConsentimiento] = useState<Consentimiento | null>(null);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    if (todoConcedido) return;

    const releer = () => setConsentimiento(leerConsentimiento());
    releer();
    setCargado(true);

    // Dos gates en la misma página (un vídeo y un mapa, o dos vídeos): conceder en uno
    // tiene que abrir el otro sin recargar.
    window.addEventListener(CONSENT_CHANGED_EVENT, releer);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, releer);
  }, [todoConcedido]);

  const conceder = useCallback(
    (categoria: Categoria) => {
      const previas = leerConsentimiento();
      if (previas?.categorias.includes(categoria)) return;

      const categorias = [...(previas?.categorias ?? []), categoria];
      // Una concesión sobre una decisión anterior es un cambio, no una primera vez: la
      // prueba tiene que distinguirlos.
      const action = previas ? 'UPDATED' : 'GRANTED';

      // SE ESCRIBE LA COOKIE PRIMERO Y SIN ESPERAR AL SERVIDOR: la voluntad del usuario
      // se respeta ya, en este frame. El registro va detrás y puede fallar sin que nada
      // se rompa — el `id` queda en `null` y la cookie sigue siendo válida.
      const base: Consentimiento = {
        version: VERSION_TEXTO,
        categorias,
        fecha: Math.floor(Date.now() / 1000),
        id: previas?.id ?? null,
      };
      escribirConsentimiento(base);
      setConsentimiento(base);
      window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));

      /**
       * SIN TOKEN, Y LA FILA QUEDA SIN `userId` — que es el caso NORMAL: el
       * consentimiento se da casi siempre antes de iniciar sesión, en la primera visita.
       *
       * Atarlo al usuario exigiría la sesión aquí, y traerla significaba `useSession()`
       * (ESM que jest no transforma, y que obligaría a mockear next-auth en cada test
       * que monte un vídeo) o un proveedor en el layout raíz — que es exactamente lo que
       * rompía la hidratación. El enlace anónimo → logueado llega en la ráfaga 2 a
       * través del `id` de la cookie, que es justamente para lo que ese campo existe.
       */
      void registrarConsentimiento({
        action,
        categories: categorias,
        policyVersion: VERSION_TEXTO,
      }).then((id) => {
        if (!id) return;
        const conId = { ...base, id };
        escribirConsentimiento(conId);
        setConsentimiento(conId);
      });
    },
    [],
  );

  if (todoConcedido) {
    return { cargado: true, permite: () => true, conceder: () => undefined };
  }

  return {
    cargado,
    permite: (categoria) => consentimiento?.categorias.includes(categoria) ?? false,
    conceder,
  };
}
