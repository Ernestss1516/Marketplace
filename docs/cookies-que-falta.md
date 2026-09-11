# Cookies — lo que falta, y no es código

> El sistema de consentimiento está **completo en código** (ráfagas 1, 2 y 3, en `main`).
> Quedan dos cosas, y ninguna se resuelve programando. Este documento existe para que no
> dependan de que alguien recuerde una conversación.
>
> Mientras falten, **la página de cookies sigue en BORRADOR** y el banner despliega su
> información en línea en vez de enlazar a ella. Nada está roto: está esperando.

---

## 1. Los cuatro datos que hay que MEDIR en un navegador

No se pueden leer del repositorio, y por eso no los pone el código: los deciden librerías
de terceros (Auth.js) o pasan dentro del marco incrustado de otro (Vimeo, YouTube,
MapTiler). Inventarlos sería declarar en un documento legal algo que nadie ha comprobado.

| # | Qué medir | Dónde aparece el hueco |
|---|---|---|
| 1 | Nombre y duración reales de la cookie **de sesión** de Auth.js | Tabla «Cookies propias» |
| 2 | Nombre y duración reales de la cookie **CSRF** | Tabla «Cookies propias» |
| 3 | Nombres y duraciones de las cookies **del flujo de Google** (state, PKCE, nonce) | Tabla «Cookies propias» |
| 4 | Qué escriben exactamente **Vimeo, YouTube y MapTiler** | Tabla «Contenido de terceros» |

**Cómo se miden** (una sola vez, ~20 minutos):

1. Abre la plataforma en una ventana privada.
2. Herramientas de desarrollo → pestaña **Aplicación** (o *Almacenamiento*) → **Cookies**.
3. Inicia sesión con correo y contraseña: apunta nombre exacto y caducidad de cada cookie
   nueva.
4. Repite entrando **con Google**: aparecen otras, temporales, del proceso OAuth.
5. Abre una página con vídeo y **acepta el contenido de terceros**. Mira las cookies de
   `vimeo.com` y `youtube-nocookie.com`. Con YouTube, apunta por separado **lo que
   aparece al cargar** y **lo que aparece al pulsar reproducir**: no es lo mismo, y la
   diferencia es justo lo que decidió retenerlo igual que a Vimeo.
6. Haz lo mismo con `/busqueda?view=mapa` para `api.maptiler.com`.

Lo único que ya se sabe del código: **la sesión dura 7 días**, alineada a mano con la
validez del token del servidor (`auth.config.ts:18-20`).

Las instrucciones están también **dentro de la propia página**, en dos recuadros, para
que quien la edite las tenga delante sin buscar este fichero.

---

## 2. El texto legal

Lo redacta asesoría (decisión D8). Cuatro apartados de la página están marcados con
`⚠️ PENDIENTE: texto de asesoría legal`:

- **Qué son las cookies** — en lenguaje llano, aclarando que también se cubre el
  almacenamiento en el dispositivo (`localStorage`), porque la ley habla de «almacenar
  información», no sólo de cookies.
- **Lo que NO hacemos** — revisar el apartado de telemetría propia y añadir la base
  jurídica (interés legítimo), el responsable, los plazos y cómo ejercer los derechos.
- **Borrar las cookies desde tu navegador** — instrucciones para Chrome, Firefox, Safari
  y Edge con sus enlaces oficiales.
- **Dudas** — responsable del tratamiento, dirección, contacto de privacidad y fecha de
  última actualización.

**El insumo técnico ya está escrito** y es lo que el código sí podía aportar: qué cookies
escribe la plataforma, qué terceros hay, qué categorías existen y para qué sirve cada
cosa. Sale de `docs/auditoria-consentimiento-cookies.md` §1, verificado contra el código.

Sigue pendiente, aparte de esto, **la política de privacidad** — documento mayor que
cubre todo el tratamiento (cuentas, anuncios, mensajería, facturación, moderación) y que
no es trabajo de estas ráfagas.

---

## 3. Cómo se cierra

1. Mide los cuatro datos y sustituye cada `⚠️ PENDIENTE` de las tablas.
2. Pega el texto de asesoría en los cuatro apartados marcados.
3. Borra el recuadro de aviso del principio y los dos de instrucciones.
4. **Publica la página** desde `/admin/paginas`.

Con el paso 4 basta: el botón «Más información» del banner empieza a llevar ahí
automáticamente, y la página entra en el sitemap sola. **No hay que tocar ningún ajuste**
— `cookiePolicyUrl` ya apunta a `/paginas/cookies`, y el backend sencillamente no lo
sirve mientras la página siga en borrador (`ConsentConfigService.policyUrlServible`).

Si algún día la política se aloja fuera, se cambia esa ruta en **Administración →
Cookies**; una URL externa se sirve tal cual, sin comprobaciones.

---

## 4. Las cinco decisiones legales, a validar

La arquitectura sigue el patrón RGPD estándar y no depende de cómo salgan, pero conviene
que asesoría las confirme por escrito:

| | Decisión | Si saliera al revés |
|---|---|---|
| **D1** | La telemetría propia no requiere consentimiento (interés legítimo: no toca el terminal) | Aparece una tercera categoría y el gate tiene que poder apagar `trackView` — trabajo real, no una casilla |
| **D4** | La cookie de consentimiento dura 6 meses | Se cambia una constante |
| **D5** | La versión del texto la sube el admin a mano | Se cambia cómo se deriva |
| **D7** | El `ConsentRecord` se conserva anonimizado al borrar la cuenta | Habría que borrarlo, y se pierde la prueba |
| **D8** | El texto lo redacta asesoría | — |

Y dos de implementación marcadas `[legal-a-confirmar]`: retener YouTube igual que Vimeo
(§1.4 del diseño) y que el preview del backoffice quede fuera del gate (§1.7).

---

## Dónde está todo

- `docs/auditoria-consentimiento-cookies.md` — el inventario legal, medido contra el código.
- `docs/diseno-consentimiento-cookies.md` — la arquitectura y las decisiones.
- La página: `/admin/paginas` → «Política de cookies» (en borrador).
- El texto del banner: **Administración → Cookies**.
