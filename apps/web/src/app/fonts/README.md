# Inter — de dónde sale este fichero

`inter-latin-wght-normal.woff2` (48 256 bytes) es el **subset latin, eje `wght`, estilo normal**
del variable font de Inter. Lo carga [`../layout.tsx`](../layout.tsx) con `next/font/local`.

## Por qué está en el repo

Antes se traía de `next/font/google`, que **descarga en tiempo de build**. Un runner de CI que no
alcance `fonts.gstatic.com` tumba el build entero (`ETIMEDOUT` tras 3 reintentos), y con él
Playwright. Ver `docs/auditoria-deuda-test-ci.md` §3.

## Procedencia exacta (cómo reproducirlo)

```
npm pack @fontsource-variable/inter          # 5.3.0
tar -xzf fontsource-variable-inter-5.3.0.tgz \
    package/files/inter-latin-wght-normal.woff2 \
    package/LICENSE
```

`@fontsource-variable/inter` empaqueta los ficheros que publica Google Fonts, sin pasar por Google
al instalar. De las tres variantes latin que trae —`opsz`, `standard` y `wght`— **la correcta es
`wght`**: es la que `next/font/google` pedía con esta configuración. Los ejes extra (`opsz`) sólo
se sirven si se piden con la opción `axes`, y aquí no se pedían.

Que es el mismo fichero se comprueba en el `@font-face` que declara el propio paquete
(`package/wght.css`), idéntico al que servía Google:

```
font-weight: 100 900;
font-display: swap;
unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,
               U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,
               U+FEFF,U+FFFD
```

**Itálica: no.** No se incluye `inter-latin-wght-italic.woff2` porque nada del proyecto pide la
itálica de Inter por nombre; el navegador sintetiza el `<em>` como ya lo hacía. Si algún día se
quiere la itálica real, se añade el segundo fichero y `src` pasa a ser un array con
`{ path, style: 'italic' }`.

## Lo único que cambió de verdad: los subsets NO precargados

Medido comparando el CSS que emiten los dos builds, no deducido de la configuración.

`subsets: ['latin']` en `next/font/google` **no** quería decir «sólo el fichero latin». Quería decir
«**precarga** el latin»: Google devolvía **siete** `@font-face` de la familia `Inter` —latin,
latin-ext, cyrillic, cyrillic-ext, greek, greek-ext y vietnamese—, cada uno con su `unicode-range`.
Sólo el latin se precargaba (48 432 B); los otros seis (171 KB en total) los pedía el navegador
**sólo si aparecía un carácter de su rango**.

Ahora hay **un** `@font-face`, sin `unicode-range`. Consecuencias, dichas enteras:

- **Lo que se descarga en una página normal es lo mismo**: el fichero latin, precargado. 48 256 B
  ahora, 48 432 B antes. El latin cubre todo el castellano —vocales acentuadas, `ñ`, `ü`, `¿`, `¡`,
  comillas tipográficas, guiones largos y `€`— y toda la interfaz del sitio. Ahí no cambia nada.
- **Lo que sí cambia**: un texto de usuario con caracteres fuera del latin-1 —un nombre polaco
  (`ł`), checo (`ř`), turco (`ğ`), o un título en cirílico o griego— antes se pintaba en Inter
  (el navegador bajaba el subset correspondiente) y ahora cae al **fallback de Arial**. Sigue
  leyéndose bien, no salen cuadraditos: Arial cubre esos alfabetos. Es una **inconsistencia
  tipográfica** en esas cadenas concretas, no un texto roto.

**Por qué se aceptó y no se arregló aquí.** `next/font/local` no sabe declarar un `unicode-range`
por fichero: `src` acepta un array, pero `declarations` se aplica a todos por igual, así que dos
subsets con la misma familia/peso/estilo se pisarían en vez de repartirse. Las salidas serían
escribir los siete `@font-face` a mano en `globals.css` (un segundo mecanismo en paralelo al que
`next/font` existe para gestionar) o servir el `InterVariable.woff2` completo de rsms (~350 KB
**precargados** en cada visita, en un sitio que vive del SEO y de la primera pintada). Las dos
cuestan más de lo que arreglan para un marketplace en castellano.

Si algún día pesa lo bastante —basta con que se note en los anuncios—, la vía es el `globals.css` a
mano con los ficheros de subset que hagan falta, que ya están en el mismo paquete de origen.

## Licencia

Inter es **SIL Open Font License 1.1** — redistribuible con el software siempre que se acompañe del
aviso de copyright y de la licencia. Por eso está aquí [`OFL.txt`](./OFL.txt), copiado sin cambios
del paquete de origen. **No borrar**: sin él, tener el `.woff2` en el repo incumple la licencia.

Copyright 2016 The Inter Project Authors — https://github.com/rsms/inter
