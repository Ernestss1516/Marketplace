# Diseño — listas de IPs y teléfonos, y el filtro ampliado de `/admin/anuncios`

> Dos cosas que se piden juntas y son de naturaleza distinta:
>
> **A.** Cambiar los detectores `IP` y `PHONE` de **heurística** (encuentra cualquiera) a
> **lista de coincidencia** (salta con valores concretos que alguien marcó).
> **B.** Ampliar el filtro de `/admin/anuncios`.
>
> Base: el motor de detección ya implementado (`docs/diseno-listas-bloqueo.md`, ráfagas
> 0/A/B/C en `main`) y el punto 5 (`lastLoginIp`, `lastOwnerIp`).
>
> **Cero código.** Todo verificado en el repo, con fichero y línea.

---

## 0. Cuatro hallazgos que cambian el encargo

### 0.1 La mitad de la parte B ya está hecha

`/admin/anuncios` **ya busca por título, descripción, slug e id**:

```ts
// admin.service.ts:533
...(q?.trim() && {
  OR: [
    { title:       { contains: q.trim(), mode: 'insensitive' } },
    { description: { contains: q.trim(), mode: 'insensitive' } },
    { slug:        { contains: q.trim(), mode: 'insensitive' } },
    { id: q.trim() },
  ],
}),
```

Y la **última IP** también, como filtro propio y **exacto** (`admin.service.ts:541`).

De los seis campos que pide el encargo, **cuatro ya funcionan**. Lo que falta de verdad es
**teléfono**, **municipio** y **provincia**. La parte B es mucho más pequeña de lo que parece.

### 0.2 La IP NO puede entrar en el buscador de texto

Es la trampa de la parte B, y hay una barrera viva que la vigila. 5b dejó escrito:

> «coincidencia EXACTA. Un `contains` sobre «10.0.0.1» traería «110.0.0.10», y en una
> investigación de multicuenta eso no es un falso positivo cualquiera — **es señalar a quien
> no es**.» — `admin.service.ts:1168`

Meter `lastOwnerIp` dentro del `OR` de `q` sería exactamente eso. **La IP se queda en su
parámetro propio y exacto**, y el test «y es coincidencia EXACTA, no "contiene"» de
`ultima-ip-orden.e2e-spec.ts` lo garantiza.

### 0.3 El banco de pruebas nunca llegó a medir nada

Las ráfagas A y B acaban de entrar. **El contador de `GET /admin/detection/stats` arranca en
cero**, y `badWordList` está vacía en la base local. Así que:

> **Esta decisión NO se apoya en datos.** No se puede decir «la heurística tenía muchos
> falsos positivos» porque nadie la ha visto correr. Lo que hay son falsos positivos
> **nombrados y razonados** (el anuncio de router con su `192.168.1.1`, la referencia de
> nueve dígitos), no medidos.
>
> Cambiar los detectores ahora es legítimo —**ha cambiado lo que se quiere**, no lo que se
> ha medido— pero conviene decirlo así y no disfrazarlo de conclusión del banco de pruebas.
> Tiene una consecuencia práctica: **borrar un detector cierra la puerta a medirlo**, y eso
> pesa distinto para IP que para teléfono (§A.2).

### 0.4 La IP por lista NO necesita tabla, y eso simplifica medio diseño

La detección de texto **tiene que persistirse** porque no se puede reescanear la tabla entera
en cada carga de una lista (es la razón entera de `ListingDetection`, §3.3 del diseño del
punto 6).

La coincidencia por lista de IPs **no tiene ese problema**: es
`lastOwnerIp IN (…)` — una comparación de una **columna** contra un array, que Postgres
resuelve directamente. Se puede **derivar en cada lectura** sin recorrer nada y sin
persistir. Ver §A.5.

---

## 1. La asimetría, que es real y hay que respetarla

| | `IP` por lista | `PHONE` por lista |
|---|---|---|
| **Qué mira** | `User.lastLoginIp`, `Listing.lastOwnerIp` — **metadatos** | `title`, `description`, `Listing.phone` — **contenido** |
| **Cómo compara** | Igualdad **exacta** de cadena | Reconocer un teléfono en texto libre y **normalizar** los dos lados |
| **Se puede derivar en SQL** | **Sí** (`IN`) | **No** — hay que leer el texto |
| **Sujeto** | Usuario **y** anuncio | Anuncio |

No son dos configuraciones del mismo mecanismo: son dos mecanismos. Forzarlos a la misma
forma —una tabla para los dos, o un `scan(text)` para los dos— haría el trabajo más feo en
las dos mitades.

---

# PARTE A — Los detectores de lista

## A.2 Reemplazar o convivir, resuelto uno por uno

### `IP` (texto) → **RETIRAR**

El detector actual (`ip.detector.ts`) busca IPv4 en el título y la descripción. La pregunta
que hay que hacerse no es «¿cuántos falsos positivos tiene?» sino **«¿qué pregunta responde,
y quién la hacía?»**.

> **Nadie articuló nunca para qué sirve saber que hay una IP en una descripción.** El
> detector de teléfonos sí tiene un caso de uso escrito y defendible —el vendedor esquiva
> `GET /listings/:id/phone`, que exige login (§0.2 del diseño del punto 6)—. El de IPs no
> tiene equivalente: una IP en el texto de un anuncio suele ser **producto** (el router),
> no señal.

**Se retira**, y su enum `IP` se elimina. Las filas `ListingDetection` que dejó se borran en
la misma migración: el reemplazo entero las quitaría al editar cada anuncio, pero los que
nadie toque las conservarían para siempre — y una fila de un detector que ya no existe es
basura que confunde al moderador.

Coste asumido conscientemente: **se pierde la opción de medirlo**. Se acepta porque medir
algo que no responde a ninguna pregunta no cambiaría la decisión.

### `PHONE` (texto) → **CONVIVE** con `PHONE_LIST`

Aquí la recomendación es la contraria, y por la misma prueba: **las dos preguntas existen y
son distintas**.

- `PHONE` (heurística): *«este vendedor está publicando un teléfono fuera del campo que la
  plataforma le da»*. Es **evasión de un control que ya está puesto**. Un número que nadie
  ha marcado nunca sigue siendo evasión.
- `PHONE_LIST`: *«este número concreto ya nos ha dado problemas»*. Es **reincidencia**.

Retirar la heurística mataría la detección de evasión, que es el único caso de uso que el
punto 6 llegó a justificar desde el dominio. Y **convivir es barato**, porque el mecanismo de
dos modos ya está construido:

> `PHONE` se queda en **AVISAR** —donde nació— y ahí sus falsos positivos no le cuestan un
> anuncio a nadie. `PHONE_LIST` puede ascender a **BLOQUEAR** desde el primer día, porque su
> criterio no es una heurística: es una lista que alguien escribió a mano.

Ése es exactamente el reparto para el que se construyó el ascenso.

### El reconocedor se REUSA, no se reescribe

Las dos versiones necesitan lo mismo: *reconocer un teléfono español dentro de texto libre en
cualquier formato*. Eso ya vive en `phone.detector.ts`, con su patrón razonado (prefijo
opcional, hasta dos separadores entre dígitos, guardas en los extremos contra tiradas más
largas).

Se extrae a una función pura y **la usan los dos detectores**:

```
reconocerTelefonos(texto) → string[]          ← formas NORMALIZADAS (9 dígitos, sin prefijo)

PHONE       : emite una detección por cada número reconocido
PHONE_LIST  : emite sólo si el número reconocido está EN LA LISTA
```

**Lo que cambia entre los dos es el criterio de disparo, y nada más.** Es el mismo principio
que hizo barata la ráfaga B: un detector devuelve hallazgos y no decide qué pasa después.

## A.3 Las listas

Molde `badWordList`, verificado: `Setting` con `value: Json` (`schema.prisma:1295`), un
`string[]`, editable en caliente desde `/admin/ajustes`, con su clave en `SETTING_KEYS`.

```
Setting['blockedIps']    : string[]   — «10.0.0.5», «203.0.113.9»
Setting['blockedPhones'] : string[]   — «654123456», «+34 600 111 222»
```

### Se guardan TAL COMO SE ESCRIBEN; se normaliza al comparar

Es la lección de la ráfaga C, y se hereda entera: `rule` tiene que ser reconocible para quien
escribió la regla. Guardar normalizado reescribiría lo que el admin tecleó y le costaría
identificar su propia entrada en un aviso.

**La forma canónica del teléfono es de nueve dígitos, sin prefijo**: `+34 654 123 456`,
`0034654123456` y `654-12-34-56` normalizan todos a `654123456`. Se aplica a los dos lados
—entrada de la lista y número reconocido en el texto— y por eso casan en cualquier formato.

**La IP se compara exacta**, con `trim` y nada más. Nada de `contains`, por §0.2.

### Entradas inertes: la pantalla las marca, como en la ráfaga C

Una entrada que no puede casar nunca —`no-es-un-telefono`, `10.0.0.999`, una IP con ceros a
la izquierda— se guarda igual y **no filtra nada**. Es el mismo fail-open silencioso que la
ráfaga C acaba de cerrar en la lista de palabras, y la respuesta es la que ya está montada:
`entradas-inertes.ts` señala cuáles son, junto al campo, antes de que el admin se entere por
el efecto.

Aquí la regla es más fácil que allí: una entrada es válida si **normaliza a un teléfono ES de
nueve dígitos** / **a una IPv4 con los cuatro octetos en 0-255**. Se puede reusar la
validación de octetos que `ip.detector.ts` ya tiene.

### Los modos

Cada detector conserva su entrada en `Setting['detectionModes']` (ráfaga B). El ascenso
—cambiar un valor, no reescribir nada— vale igual para los nuevos. Estado propuesto al nacer:

| Detector | Modo | Por qué |
|---|---|---|
| `WORD` | `BLOCK` | Sin cambios |
| `PHONE` (evasión) | `WARN` | Sin cambios — sus falsos positivos siguen sin medir |
| `PHONE_LIST` | `WARN` | Ver abajo |
| `IP_LIST` | `WARN` | Ver §A.4 |

> **Nacen avisando aunque su criterio sea explícito**, y no por inercia: el riesgo ya no es
> el patrón sino **la lista mal escrita**. Una IP mal copiada o un teléfono que alguien
> marcó por error bloquean a quien no toca, y en el caso de `IP_LIST` bloquean por un dato
> —la IP— que `pendientes.md` §6 declara **posiblemente falsificable** mientras la topología
> del proxy no se verifique. Ascender es un clic; se hace cuando la lista tenga dueño y unas
> semanas de uso.

## A.4 Dónde corre cada uno

### `PHONE_LIST` — donde ya corre todo

En `publish()` y al editar, con el motor. **No hay nada que construir**: es un detector más
en el array de `DetectionEngine`, y hereda el reemplazo entero, el fail-open, el eje propio
de P1, la ficha y los filtros.

**Lo único nuevo: se amplía lo que se escanea a `Listing.phone`.** Hoy `DetectableText` son
dos campos (`detection.types.ts:61`), y el número que el vendedor puso en su campo legítimo
no se mira. Para la evasión daba igual —ahí el campo es el sitio correcto— pero para la
reincidencia no: si `654123456` está marcado, da lo mismo dónde lo haya escrito.

Consecuencia que hay que decir: `DetectionField` gana `PHONE` como valor, y **el detector
`PHONE` heurístico NO debe mirar ese campo** — un número en su sitio no es evasión de nada.
Es decir, los dos detectores escanean conjuntos de campos distintos, y eso va escrito en cada
uno.

### `IP_LIST` — el punto de captura, y por qué es delicado

La última IP se escribe en dos sitios, los dos verificados y los dos **fail-open a propósito**:

```
auth.service.ts:240   anotarInicioDeSesion(userId, ip)   ← el usuario entra
listing-owner-activity.service.ts:60   touch(listingId, ip)   ← el dueño gestiona su anuncio
```

Evaluar la lista **al capturar** es lo correcto para el aviso: es el único momento en que se
puede reaccionar, y no al revés (consultar).

**Pero el `touch` tiene un contrato que no se puede romper.** Está escrito:

> «Anotar la actividad no puede tumbar la acción. Si el vendedor archiva su anuncio y esto
> falla, el anuncio queda archivado.» — `listing-owner-activity.service.ts:37`

Y hay un problema de proporción encima: `touch` se llama en **cada** gestión del dueño —
bump, pausa, renovación—, no sólo al cambiar contenido. Un `IP_LIST` en `BLOCK` mandaría a
revisión un anuncio **por hacer un bump**, que es una acción que no toca el texto.

De ahí la recomendación de §A.3: **`IP_LIST` nace en `WARN`**, y su consecuencia de estado —si
alguna vez asciende— se aplica con el mismo cuidado que la ráfaga B: sólo `ACTIVE →
PENDING_REVIEW`, nunca lanzando, y con la puerta de salida ya construida (editar libera si no
queda motivo).

## A.5 El usuario: qué significa avisar, y qué NO se hace

**Un usuario no tiene `PENDING_REVIEW`.** Existe `User.requiresReview`, que manda a revisión
todos sus anuncios futuros, y sería la traducción natural de «bloquear un usuario».

> **El sistema NO debe escribirlo.** Es la lección de P1 repetida: `requiresReview` lo pone
> una persona desde `PATCH /admin/users/:id/requires-review` y se audita nominalmente
> (`USER_REQUIRE_REVIEW`, `admin.service.ts:1521`). Si el sistema lo escribiera, un moderador
> que lo quite se lo encuentra puesto otra vez en el siguiente login del usuario — y además
> `AuditLog.actorId` es NOT NULL con FK a `User` (`schema.prisma:1259`): **no hay actor
> «sistema»** al que apuntarle el cambio.
>
> Es exactamente por lo que el aviso del punto 6 no vive en `watched`.

**Por tanto: en el usuario, `IP_LIST` sólo AVISA.** El staff ve la señal y decide si marca
`requiresReview` él, que es un clic que ya existe. La máquina señala; la persona decide.

### Y el aviso se DERIVA, no se persiste

Aquí está la simplificación de §0.4. La comprobación es
`lastLoginIp ∈ Setting['blockedIps']` — una columna contra un array:

```
/admin/usuarios?ipEnLista=true   →   where: { lastLoginIp: { in: listaDeIps } }
/admin/anuncios?ipEnLista=true   →   where: { lastOwnerIp: { in: listaDeIps } }
```

Ventajas sobre persistir, y son las que deciden:

1. **Nunca se queda obsoleto.** Quitar una IP de la lista deja de marcar **al instante**, en
   todo el histórico. Con filas persistidas habría que barrerlas, y hasta entonces el
   backoffice señalaría a gente por una regla que ya nadie mantiene. Para una **lista de
   bloqueo** eso no es un detalle: es la diferencia entre poder rectificar y no poder.
2. **No hace falta una tabla nueva.** La alternativa era un `UserDetection` espejo de
   `ListingDetection`, con sus escrituras, su reemplazo, su `Cascade` y su migración — todo
   para responder algo que la base ya sabe responder de una consulta.
3. **Es listable igual**, que era la razón entera de persistir las de texto.

Lo que se pierde: **no queda histórico** («esta IP estuvo marcada en marzo»). Se acepta —
`AuditLog` ya registra los cambios del ajuste, así que el *quién y cuándo cambió la lista* sí
está; lo que no hay es una foto por usuario, y nadie la ha pedido.

En la **ficha** del usuario y del anuncio, un distintivo junto al dato de la IP que ya pinta
`DatoIp` (5b), con su mismo aviso RC.1 pegado: esa IP **puede estar falsificada** mientras la
topología del proxy no se verifique.

## A.6 Lo que se hereda sin tocar

- `ListingDetection` sigue sirviendo para `PHONE_LIST` (es una detección de texto como las
  demás), y **no** para `IP_LIST` (§A.5).
- **El eje propio de P1**: ninguna detección mueve `triage` ni `watched`. Sin excepciones.
- **Fail-open**, reemplazo entero, un detector caído no arrastra a los demás.
- **La puerta de salida** de la ráfaga B: editar un `PENDING_REVIEW` que ya no dispara nada
  lo devuelve a ACTIVE. Vale igual para `PHONE_LIST`.

---

# PARTE B — El filtro de `/admin/anuncios`

## B.1 Lo que falta, campo por campo

| Campo | Hoy | Propuesta |
|---|---|---|
| título, descripción, slug, id | **ya está** (`q`, `contains` insensible) | sin cambios |
| última IP (`lastOwnerIp`) | **ya está** (`ip=`, **exacto**) | sin cambios — y **no** se mete en `q` (§0.2) |
| teléfono (`phone`) | no | parámetro propio, **normalizado** — ver abajo |
| municipio (`city`) | no | parámetro propio, `contains` insensible |
| provincia (`province`) | no | parámetro propio, `contains` insensible |

### Municipio y provincia: **sí se puede**

Verificado: `Listing.city` y `Listing.province` existen como columnas
(`schema.prisma:647-648`). Y hay algo mejor —**ya están indexadas juntas**:

```prisma
@@index([province, city])   // schema.prisma:785
```

Así que el filtro más natural (provincia, y dentro de ella municipio) **entra sobre un índice
que ya está puesto**. No hace falta medir nada ni añadir nada.

**Parámetros propios y NO dentro del `OR` de `q`**, y es una decisión: «anuncios **de**
Toledo» y «anuncios que **mencionan** Toledo» son preguntas distintas, y meter `city` en el
buscador de texto haría que buscar una palabra que además es un topónimo devolviera un revoltijo
de las dos.

### Teléfono: hace falta una columna normalizada

Es el único que no es trivial, y conviene decir por qué. `Listing.phone` guarda **lo que
escribió el vendedor**: `654 123 456`, `654123456`, `+34 654-12-34-56`. Un filtro exacto
falla en cuanto los formatos no coinciden, y un `contains` con los dígitos sueltos no puede
casar contra una columna que lleva separadores.

Buscar teléfonos de verdad exige **comparar formas normalizadas**, y eso en SQL exige que la
forma normalizada esté **en una columna**:

```
Listing.phoneNormalized  String?   ← 9 dígitos, sin prefijo ni separadores. @@index
```

Se escribe donde se escribe `phone` (alta y edición, los dos caminos), con la **misma función
de normalización** que usan los detectores de teléfono. Una función, tres consumidores.

De regalo, `PHONE_LIST` puede comprobar el campo `phone` con un `IN` sobre esa columna en vez
de leerlo y normalizarlo en memoria.

> **Alternativa evaluada y descartada**: normalizar `Listing.phone` al guardar, sin columna
> nueva. Cambiaría **lo que se le enseña al comprador** —el vendedor escribió su número con
> espacios y se le pintaría pegado— y perdería un dato de presentación para ganar uno de
> búsqueda. La columna derivada cuesta menos.

## B.2 Rendimiento: lo que ya está medido y lo que no hace falta medir

El coste del `contains` insensible **ya está razonado y aceptado** en el código
(`admin.service.ts:522-531`), con su umbral escrito: pasadas las ~100.000 filas o los ~300 ms,
la salida es un índice GIN con `pg_trgm` sobre `title` **sin cambiar la consulta**.

De lo nuevo:

- `province` / `city` — sobre `@@index([province, city])`. Nada que medir.
- `phoneNormalized` — igualdad sobre una columna indexada. Nada que medir.
- `ipEnLista` — un `IN` sobre `lastOwnerIp`, que **no tiene índice** hoy. Es el único
  candidato, y va **a EXPLAIN antes de decidir**: es el criterio con el que F2 añadió un
  índice y con el que E2 decidió **no** añadirlo. Con listas de bloqueo de decenas de
  entradas y el volumen actual, lo más probable es que no haga falta.

---

## 2. El plan — tres ráfagas

### Ráfaga B1 — el filtro *(la más acotada, y va primera)*

Teléfono (con su columna normalizada), municipio y provincia. **Sólo lectura: no cambia la
conducta de nada.**

Va primera a propósito: **da al staff las herramientas para construir las listas antes de que
las listas existan.** Sin poder buscar por teléfono, ¿de dónde salen los números de
`blockedPhones`? De mirar denuncias a mano. Con el filtro, de una consulta.

**Barreras**: buscar por provincia trae los de esa provincia y no los que la mencionan en el
texto · el teléfono casa **en cualquier formato** (la columna normalizada) · la IP **sigue
siendo exacta** — el test de 5b sigue verde sin tocarlo.

### Ráfaga A1 — la lista de IPs

`Setting['blockedIps']`, el filtro derivado `ipEnLista` en las **dos** listas (usuarios y
anuncios), el distintivo en las dos fichas, y el detector `IP` de texto **retirado** con su
limpieza de filas.

**Barreras**: una IP en la lista marca a su usuario **y** a sus anuncios · quitarla de la
lista **deja de marcar al instante** (la prueba de que se deriva y no se persiste) · marcar a
un usuario **no** le pone `requiresReview` ni le toca nada — sólo avisa · las filas del
detector `IP` retirado desaparecen · P1 intacto.

**Mutaciones**: persistir la marca en vez de derivarla → cae la de «deja de marcar al
instante» · escribir `requiresReview` desde el sistema → cae la de «sólo avisa».

### Ráfaga A2 — la lista de teléfonos

El reconocedor extraído a función pura, `PHONE_LIST` usándolo, `Setting['blockedPhones']`,
`Listing.phone` incorporado a lo escaneado, y el marcado de entradas inertes.

**Barreras**: un número de la lista salta **en cualquier formato** del texto (`654 123 456`,
`+34 654123456`) · salta también si está en el **campo** `phone` · `PHONE` heurístico **NO**
mira el campo `phone` (un número en su sitio no es evasión) · los dos detectores conviven sin
pisarse sobre el mismo anuncio · una entrada inerte se marca en la pantalla.

**Mutaciones**: `PHONE_LIST` compara sin normalizar → cae la de los formatos · el reconocedor
se duplica en vez de compartirse → cae una barrera de fuente (molde de la de 7a).

---

## 3. Lo que hay que decidir antes de empezar

1. **¿Se retira de verdad el detector `IP` de texto?** Es la única decisión irreversible del
   documento —borra un detector y sus filas— y se toma **sin datos** (§0.3). Si hay dudas, la
   alternativa barata es dejarlo en `WARN` una temporada y retirarlo cuando el contador diga
   algo. Recomendación: retirarlo, porque no responde a ninguna pregunta que alguien haga.
2. **¿`PHONE_LIST` nace en `WARN` o en `BLOCK`?** Aquí se propone `WARN`, pero el argumento en
   contra es razonable: su criterio no es una heurística. La duda no es el patrón, es **la
   lista mal escrita**. Un mes en avisar lo resuelve.
3. **¿La lista de IPs bloquea anuncios, o sólo avisa?** Recomendado: sólo avisa, porque
   `touch` se dispara con acciones que no tocan el contenido (un bump) y porque la IP puede
   estar falsificada (`pendientes.md` §6, RC.1). Bloquear por un dato que sabemos que puede
   mentir es lo que RC.1 pide no hacer.
4. **¿Se busca por teléfono también en `/admin/usuarios`?** `User.phone` existe y es privado.
   No entra aquí; es el mismo trabajo si algún día se pide.
