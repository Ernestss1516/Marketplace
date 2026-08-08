'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * UXV.5 (A4) — impedir que se pierdan cambios al salir.
 *
 * EL DEFECTO: el editor no avisaba de nada. Pinchar cualquier enlace descartaba en
 * silencio todo lo escrito. Con el shell de UXV.2 esto pasó de molestia a necesidad: el
 * menú de la cuenta está ahora SIEMPRE a la vista, a un clic de distancia de perder el
 * trabajo.
 *
 * POR QUÉ SE INTERCEPTA EL CLIC Y NO SE USA UN «router event»: el App Router de Next.js no
 * expone eventos de navegación (`router.events` era del Pages Router y no existe aquí), así
 * que no hay un punto oficial donde frenar una transición en curso. Lo que sí se puede es
 * atajar el CLIC antes de que la transición empiece: se escucha en fase de captura, se mira
 * si el destino es otra ruta de la aplicación, y se pregunta.
 *
 * Cubre las dos formas de irse:
 *  - navegación interna (un `<Link>`, que en el DOM es un `<a>`) → diálogo propio;
 *  - cerrar la pestaña, recargar o ir a una URL externa → `beforeunload`, que es lo único
 *    que el navegador permite y solo enseña su aviso genérico.
 */
export function useUnsavedChanges(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // En una ref además de en el estado: el listener se registra una vez y necesita leer el
  // valor VIGENTE, no el que hubiera cuando se registró.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Cerrar pestaña / recargar / salir del sitio.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Los navegadores modernos ignoran el texto y enseñan el suyo; asignar returnValue
      // sigue siendo lo que activa el aviso.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Navegación interna.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current) return;
      // Respeta los gestos que abren en otra pestaña: ahí no se pierde nada.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
        return;
      }

      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || anchor.target === '_blank') return;

      const destino = new URL(anchor.href, window.location.href);
      if (destino.origin !== window.location.origin) return; // lo coge beforeunload
      if (destino.pathname === window.location.pathname) return; // no se va a ninguna parte

      e.preventDefault();
      e.stopPropagation();
      setPendingHref(destino.pathname + destino.search);
    }

    // CAPTURA: hay que llegar antes que el manejador de `<Link>`, que en burbujeo ya
    // habría lanzado la transición.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return {
    /** Destino que el usuario intentó abrir con cambios pendientes, o null. */
    pendingHref,
    /** Se queda donde está y sigue editando. */
    cancelNavigation: () => setPendingHref(null),
    /** Descarta los cambios y se va. */
    confirmNavigation: () => {
      const href = pendingHref;
      setPendingHref(null);
      dirtyRef.current = false;
      if (href) router.push(href);
    },
    /** Para salidas que NO son un enlace (el botón «Cancelar» del editor). */
    requestNavigation: (href: string) => {
      if (dirtyRef.current) setPendingHref(href);
      else router.push(href);
    },
  };
}
