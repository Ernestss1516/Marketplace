# Diseño — motor de detección con dos modos: avisar y bloquear (punto 6)

> El último punto del lote, y el grande. Un **motor de detección** con **detectores**
> (palabras, IPs, teléfonos) y **dos modos** (AVISAR / BLOQUEAR), que corre **al publicar
> y al editar** —cerrando el hueco de que editar no re-modera— e integrado con la etiqueta
> interna de P1 **sin fundir sus ejes**.
>
> Base: `docs/auditoria-retoques-backoffice.md` §6 · `BadWordService` · `PreModerationService` ·
> P1 (`docs/diseno-etiqueta-interna.md`) · F1 (las señales de la ficha).
>
> **Cero código.** Todo verificado en el repo, con fichero y línea.

---

## 0. Los cuatro hallazgos que reformulan el punto

Antes del diseño, lo que la lectura del código cambia respecto al enunciado.

### 0.1 El fail-open del tokenizador es MÁS ancho de lo que dice el enunciado

El enunciado avisa de que el tokenizador parte las IPs. Es cierto —y verificado—, pero el
agujero no es de las IPs: es de **toda entrada que contenga algo que no sea `[a-z0-9]`**.

```ts
// bad-word.service.ts:45
private tokenize(text: string): Set<string> {
  return new Set(this.normalize(text).split(/[^a-z0-9]+/).filter(Boolean));
}
// bad-word.service.ts:30
return normalizedWords.some((w) => tokens.has(w));   // ← igualdad EXACTA contra un token
```

El texto se parte en tokens alfanuméricos y **cada entrada de la lista se compara entera
contra un token completo**. De ahí:

| Entrada que un admin puede escribir hoy | Tokens del texto | ¿Casa? |
|---|---|---|
| `192.168.1.1` | `192`, `168`, `1` | **nunca** |
| `654 123 456` | `654`, `123`, `456` | **nunca** |
| `dinero facil` (dos palabras) | `dinero`, `facil` | **nunca** |
| `100%-garantizado` | `100`, `garantizado` | **nunca** |
| `estafa` | `estafa` | sí |

**Sólo funcionan las entradas de una única palabra alfanumérica.** Y nada lo dice: la
pantalla de ajustes acepta el texto, lo guarda y responde que sí
(`admin/ajustes/page.tsx:46`); su descripción promete «Si una palabra de esta lista aparece
en el título o descripción, el anuncio pasa a estado "En revisión"»
(`admin/ajustes/page.tsx:419`) sin distinguir cuáles pueden aparecer y cuáles no.

> **Esto no es una limitación teórica que el punto 6 vaya a evitar: es un fallo silencioso
> vivo hoy.** Cualquiera que haya escrito una entrada de dos palabras cree que filtra y no
> filtra. Es la definición de fail-open, y tiene consecuencias en el plan (§5.4).

### 0.2 `Listing.phone` EXISTE, y está tras una puerta

```
Listing.phone            schema.prisma:657   ← teléfono PUBLICADO del anuncio
GET /listings/:id/phone  listings.controller.ts:211
  → @UseGuards(JwtAuthGuard)                 ← autenticado
  → nunca viaja en GET /:slug                listings.controller.ts:208-210
```

Esto **cambia qué significa detectar un teléfono en la descripción**. No es «los teléfonos
están prohibidos» —la plataforma ofrece uno, y publicarlo es legítimo—. Es:

> **El vendedor está esquivando la puerta.** Hay un campo para el teléfono que exige login
> para verlo; escribirlo en la descripción lo hace visible a cualquiera sin identificarse.

Un detector de teléfonos no persigue contenido prohibido, persigue **evasión de un control
que ya existe**. Y de eso se sigue que su primera respuesta razonable no es sacar el anuncio
del escaparate, sino avisar — al staff hoy, y algún día al vendedor («tienes un campo para
esto»). Refuerza «avisar primero» desde el propio dominio, no sólo por prudencia.

### 0.3 Los cuatro caminos a PENDING_REVIEW: verificado, y los cuatro viven en `publish()`

El enunciado pregunta si el filtro es «uno de los 4». Lo es, y los otros tres también están
en el mismo sitio:

```
publish()                                     listings.service.ts:478
  1. hasBadWords(title, description)          listings.service.ts:491   fail-OPEN
     → PENDING_REVIEW
  2..4 preModeration.reviewTriggerFor()       listings.service.ts:520   fail-CLOSED
     → USER | CATEGORY | PLATFORM             pre-moderation.service.ts:137
```

La asimetría de fallo está razonada en el código y **se hereda tal cual** (§2.5): si el
filtro falla se pierde una heurística; si la moderación previa falla se salta una política
que alguien encendió a mano (`pre-moderation.service.ts:106-112`).

Ninguno de los cuatro se persiste al disparar. Por eso la ficha F1 los presenta como
**señales de ahora**, no como causa (`admin.service.ts:654-661`) — un matiz que este diseño
tiene que respetar (§3.3).

### 0.4 El hueco de editar está documentado en el propio código, por P1

No hay que deducirlo. `listing-triage.ts:66-70` lo dice con todas las letras:

> «hoy la edición del dueño no cambia `status`, no vuelve a pasar por el filtro de palabras
> y no consulta la moderación previa —el filtro y el disparador sólo corren en `publish()`—,
> así que **un anuncio ACTIVE se puede reescribir entero sin que se entere nadie**. Ésta es
> la única señal que el staff va a recibir.»

Verificado en las dos rutas de edición:

| Camino | Re-modera | Qué sí toca |
|---|---|---|
| Dueño — `ListingsService.update` (`:319`) | **no** | `triage: triageAfterOwnerEdit()` (`:400`), `clearIfCompliant` (`:425`) |
| Staff — `AdminService.updateListing` (`:765`) | **no** | nada del triaje: «AQUÍ NO HAY `triage`» (`:807`) |

P3a y 2a no lo cerraron, y no era su trabajo. Es el de este punto.

---

## 1. El sistema actual, en una página

```
Setting['badWordList']  : Json = string[]        schema.prisma:1295
   ↑ /admin/ajustes → texto por líneas, trim + toLowerCase   admin/ajustes/page.tsx:18-24
   ↓
BadWordService.hasBadWords(title, description)   bad-word.service.ts:17
   · normalize: NFD, sin diacríticos, minúsculas, trim       :37
   · tokenize:  split(/[^a-z0-9]+/)                          :45
   · match:     normalizedWords.some(w => tokens.has(w))     :30
   · FAIL-OPEN por contrato escrito: si falla → false        :7-9, :31
   ↓
publish() → targetStatus = 'PENDING_REVIEW'      listings.service.ts:495
getAdminListing() → moderationSignals.palabraProhibida       admin.service.ts:645
```

**Cinco propiedades que hay que conservar o cambiar a propósito**, no por accidente:

1. **Sólo `title` y `description`.** Ni atributos, ni `phone`, ni ciudad.
2. **Fail-open.** Contrato escrito, dos veces. Moderar nunca frena publicar.
3. **Sólo en `publish()`.** El hueco de §0.4.
4. **Semántica de token exacto.** El fallo de §0.1.
5. **La lista es un `string[]` en `Setting`**, editable en caliente sin despliegue.

---

## 2. El motor

### 2.1 Un detector es una función pura sobre texto

```
Detector
  id:      'WORD' | 'IP' | 'PHONE'
  scan(campos: {title, description}, config) → Deteccion[]

Deteccion
  detector: el id
  field:    'TITLE' | 'DESCRIPTION'
  match:    el fragmento exacto encontrado
  rule:     qué regla casó (la entrada de la lista, para WORD; el id del patrón para el resto)
```

Lo que hace que esto sea un motor y no tres `if` es que **el detector no decide qué pasa
después**. Devuelve hallazgos. El modo —quién bloquea y quién avisa— es una capa por encima,
y es lo que permite que ascender un patrón sea cambiar un valor y no reescribir nada (§2.4).

**Los detectores NO comparten tokenizador.** Es la corrección central del punto:

| Detector | Cómo reconoce | Por qué no tokeniza |
|---|---|---|
| `WORD` | Tokens alfanuméricos, igualdad exacta — **idéntico a hoy** | Es la semántica que ya está en producción; cambiarla es otra ráfaga (§5.4) |
| `IP` | Patrón sobre el texto **crudo**, con validación de rango (0-255 por octeto) | Un token nunca contiene puntos |
| `PHONE` | Patrón sobre el texto **crudo**, tolerante a espacios, puntos, guiones y prefijo | Un token nunca contiene separadores |

> Meter `192.168.1.1` en `badWordList` no es «una forma menos elegante de hacerlo». Es una
> forma que **casa cero veces** y que nadie ve fallar. Los detectores nuevos existen para
> eso, no por arquitectura.

### 2.2 Los detectores nuevos, y sus falsos positivos REALES

Nombrarlos ahora es la mitad del argumento de «avisar primero». No son hipotéticos.

**`IP` — IPv4 en el texto.** Cuatro grupos de 1-3 dígitos separados por puntos, con cada
octeto en 0-255 (sin el rango, `999.999.999.999` casaría y `1.2.3.4` también).

Falso positivo real, y es incómodo de bueno:

> **Alguien vende un router y escribe «configuración en 192.168.1.1».** Es un anuncio
> impecable, la IP es parte de la descripción del producto, y un detector en modo BLOQUEAR
> lo sacaría del escaparate.

Otros: versiones de firmware (`1.2.3.4`), referencias numéricas con puntos.

**`PHONE` — teléfono español en el texto.** Móvil `6xx`/`7xx` y fijo `8xx`/`9xx`, nueve
dígitos, con o sin `+34`/`0034`, admitiendo espacios, puntos y guiones entre grupos.

Falsos positivos reales:

> **Cualquier tirada de nueve dígitos que empiece por 6, 7, 8 o 9.** Una referencia de
> pieza, un número de bastidor parcial, un código de producto. Y a la inversa, el detector
> **no** verá `seis cinco cuatro...` escrito en letra, que es evasión deliberada.

Un detector que se equivoca en las dos direcciones es exactamente el que **no** puede nacer
bloqueando.

**Lo que NINGUNO de los dos hace en la ráfaga A:** perseguir ofuscación (dígitos en letra,
caracteres unicode parecidos, «llámame al seis-cinco…»). Es una carrera armamentística y
empezarla antes de saber cuánto acierta el patrón simple es construir sobre nada.

### 2.3 Los dos modos

Cada detector tiene un modo. **Uno solo** — no es una lista de excepciones:

```
AVISAR   → deja una detección. NO toca `status`. El staff la ve; el anuncio no se entera.
BLOQUEAR → deja una detección Y manda a PENDING_REVIEW (exactamente lo que hace hoy WORD).
```

`BLOQUEAR` es **`AVISAR` + una consecuencia**. Los dos dejan el mismo rastro, lo que
significa que ascender un detector no cambia lo que el staff ve, sólo lo que le pasa al
anuncio. Y que degradar de vuelta a `AVISAR` no pierde nada.

Estado inicial, y no es negociable:

| Detector | Modo al nacer | Por qué |
|---|---|---|
| `WORD` | **BLOQUEAR** | Es lo que hace HOY. Nacer en AVISAR sería apagar en silencio un filtro que alguien configuró |
| `IP` | **AVISAR** | Nunca ha corrido. No hay ni un dato sobre cuánto se equivoca |
| `PHONE` | **AVISAR** | Ídem |

### 2.4 El ascenso

Un `Setting` con el modo de cada detector:

```
Setting['detectionModes'] = { WORD: 'BLOCK', IP: 'WARN', PHONE: 'WARN' }
```

Ascender es **cambiar ese valor desde `/admin/ajustes`**. No se reescribe el detector, no se
despliega, y se puede deshacer.

**ADMIN, no MODERATOR.** Mismo criterio que `preModerationAllListings`, que ya es ADMIN
(`pre-moderation.service.ts:84`): poner un detector en BLOQUEAR cambia lo que le ocurre a
los vendedores de toda la plataforma. Elegir qué ramas entran en la cola es moderar; decidir
que a partir de ahora un patrón despublica es una política.

**Con qué evidencia se asciende, dicho sin inflar.** La pantalla puede enseñar, por
detector, **en cuántos anuncios vivos está disparando ahora mismo**. Eso es todo lo que un
contador puede dar.

> **Eso NO es una tasa de falsos positivos, y llamarlo así sería mentir.** Para medirla de
> verdad hace falta que alguien juzgue cada detección («esto era un teléfono de verdad» /
> «esto era una referencia»), y eso es un modelo más grande: un veredicto por detección.
> Está propuesto como ráfaga opcional (§5.5), fuera del camino crítico.
>
> Lo que la ráfaga A entrega de verdad es **un banco de pruebas donde mirar**: el staff filtra
> por detector, abre veinte anuncios y ve con sus ojos cuántos eran ruido. Es poco y es
> honesto; un número con tres decimales sacado de un contador sería mucho y falso.

### 2.5 El fallo

Se hereda la asimetría existente, y se extiende con una regla nueva:

- **Si el motor falla, nadie bloquea.** Fail-open, molde `BadWordService`
  (`bad-word.service.ts:7-9`). Publicar y editar no dependen de que la detección funcione.
- **Si un detector falla, los demás siguen.** Un patrón mal formado no puede apagar el
  filtro de palabras. Cada `scan` va acotado.
- **`PreModerationService` NO se toca.** Sigue fail-closed y sigue siendo el otro camino.
  El motor no lo absorbe: son cosas distintas —uno mira el texto, el otro mira políticas
  sobre personas y categorías— y fundirlos obligaría a un contrato de fallo común que a uno
  de los dos le vendría mal.

### 2.6 Dónde NO va: la cola

La detección corre **inline**, no en BullMQ. La regla del proyecto es que el trabajo pesado
se encola, y esto no lo es: tres expresiones regulares sobre dos campos de texto. La parte
cara es leer la configuración de `Setting`, y **eso ya se hace hoy inline en `publish()`**
(`bad-word.service.ts:19`). El motor lee su configuración **una vez por ejecución** para los
tres detectores, no una por detector — que es una lectura menos que hoy si se contara por
detector.

Encolarla tendría además un coste de corrección: si la detección es asíncrona, un anuncio en
modo BLOQUEAR se publicaría ACTIVE y se despublicaría segundos después. Peor que no
detectar.

---

## 3. La integración con P1 — el aviso sin fundir los ejes

### 3.1 Lo que P1 dejó montado, verificado

```
ListingTriage   NEW | REVIEWED | EDITED    schema.prisma:80    ← se excluyen entre sí
Listing.triage                             schema.prisma:701
Listing.watched Boolean @default(false)    schema.prisma:710   ← ORTOGONAL, con @@index :795
```

Y las reglas que lo gobiernan:

- `MANUAL_TRIAGE_TARGETS = ['NEW', 'REVIEWED']` — **`EDITED` no se puede poner a mano**
  (`listing-triage.ts:39`), porque afirma un hecho y sólo el sistema sabe si ocurrió.
- `watched` **sólo se pone a mano**, desde `setListingTriage` (`admin.service.ts:683`), y se
  audita nominalmente con `LISTING_TRIAGE_CHANGE`.
- El método «no toca `status` ni `needsRevalidation`… La ortogonalidad no es una propiedad
  que emerja sola: es que aquí no se escribe nada más que estas dos columnas»
  (`admin.service.ts:669-673`).

### 3.2 Las tres opciones, y por qué se descartan dos

**(a) El aviso es un `watched: true`.** ❌

Dos razones independientes, cualquiera de las dos basta:

1. **Colisiona con una decisión humana.** `watched` significa «el staff decidió vigilar
   esto». Si el sistema lo escribe, un moderador que quite la vigilancia se la encuentra
   puesta otra vez en la siguiente edición — y no hay forma de distinguir «lo vigilo yo» de
   «lo puso una regex». Se pierde el dato que hacía útil el eje.
2. **No hay actor.** `AuditLog.actorId` es `String` NOT NULL con FK a `User`
   (`schema.prisma:1259`), y el propio esquema deja escrito que la transición automática de
   P1 no se audita precisamente porque «`actorId` exige una persona» (`schema.prisma:1242`).
   Un `watched` automático o rompe la auditoría de ese campo o se escribe sin traza, y las
   dos cosas son peores que no hacerlo.

**(b) El aviso es un valor de `triage`.** ❌

Lo prohíbe P1 de frente. `triage` responde «¿alguien del staff lo ha mirado?». Que una regex
encuentre un teléfono **no es haberlo mirado, ni es que el dueño lo haya editado**. Meterlo
ahí obligaría a un cuarto valor que se excluye con los otros tres, y entonces un anuncio
`REVIEWED` que dispara un detector tendría que dejar de ser `REVIEWED` — destruyendo el
juicio del staff con un hallazgo automático. Es exactamente el colapso de ejes que P1 existe
para impedir.

**(c) Un eje propio, ortogonal a los dos.** ✅

El aviso responde a una tercera pregunta —**«¿qué ha encontrado el sistema en el texto de
este anuncio?»**— que no es ni «¿lo ha mirado el staff?» ni «¿lo vigilamos?». Un anuncio
puede ser `REVIEWED`, no vigilado y tener una detección de teléfono: significa que un humano
lo dio por bueno *sabiendo* que hay un teléfono. Las tres respuestas son compatibles y las
tres hacen falta.

### 3.3 La forma del eje: una tabla hija, no un booleano ni un cálculo al vuelo

Dentro de (c) hay tres formas posibles. Esta es la decisión de verdad del bloque.

**(c1) Un booleano `Listing.hasDetections`.** ❌ Es listable y barato, pero **no dice qué se
encontró**. F1 existe entera para lo contrario: «no fingir, mostrar el dato». Un moderador
que ve una bombilla encendida y tiene que releer la descripción buscando qué la encendió no
está mejor que ahora.

**(c2) Derivarlo en cada lectura, como `palabraProhibida`.** ❌ — y es la opción tentadora,
porque **ya existe ese precedente**: la ficha F1 calcula la señal en vivo y no la persiste
(`admin.service.ts:645`). Es honesto y no se queda obsoleto nunca.

> Pero **no es listable**. La pregunta que hace útil el modo avisar es «enséñame TODO lo que
> tiene una detección», y responderla en vivo obliga a recorrer la tabla de anuncios entera
> ejecutando tres detectores por fila, en cada carga de la lista. El precedente de F1
> funciona porque es **una** ficha; no escala a un listado, y el modo avisar sin listado es
> un aviso que nadie lee.

**(c3) `ListingDetection`, una fila por hallazgo.** ✅

```
model ListingDetection
  id          String   @id
  listingId   String                     ← FK a Listing, onDelete: Cascade
  detector    DetectorId                 ← WORD | IP | PHONE
  field       DetectionField             ← TITLE | DESCRIPTION
  match       String                     ← el fragmento encontrado
  rule        String?                    ← la entrada de la lista que casó (WORD); null en los demás
  createdAt   DateTime @default(now())

  @@index([listingId])
  @@index([detector])
```

**Es listable, se explica sola, y cada fila es la evidencia** que el staff necesita para
juzgar. Cubre las tres cosas que el enunciado pide del aviso: qué patrón, dónde, y que el
staff pueda juzgarlo.

**El riesgo de lo persistido es quedarse obsoleto, y se cierra por construcción:**

> **Las detecciones se REEMPLAZAN ENTERAS en cada ejecución.** Borrar las de ese anuncio e
> insertar las del texto actual, en la misma escritura. Molde literal del reemplazo completo
> de tags de B2 (`listings.service.ts:376-381`) y de `ListingImagesService.sync`.
>
> Nunca hay detecciones «viejas»: siempre son el producto de la última pasada sobre el texto
> que hay ahora. El dueño quita el teléfono y la detección desaparece sola — sin que nadie
> tenga que acordarse de limpiarla, que es como se pudren los flags puestos a mano.

**`Cascade` aquí es lo correcto, y conviene decir por qué no contradice a B1.** B1 protegió
`Report`, `Conversation` y `Review` del borrado del anuncio porque **describen hechos entre
personas** y tienen valor propio. Una detección no: es un **derivado del texto del anuncio**,
recalculable, sin valor fuera de él. Muerto el anuncio, la detección no significa nada.
(Y es la relación contraria a `Report.reviewId`, que sigue en `Cascade` **debiendo** ser
`SetNull` — ver `pendientes.md`.)

**El dato personal, dicho a la cara.** Una detección de teléfono guarda un teléfono en una
tabla nueva. Se hace, y estas son las tres razones:

1. **No es una divulgación nueva.** Ese número está en la **descripción pública** del
   anuncio, legible por cualquiera sin identificarse — que es justamente el problema que el
   detector señala. La detección es un índice a texto ya público, no un secreto extraído.
2. **Sin el fragmento no se puede juzgar**, y juzgar es todo el propósito del modo avisar.
3. **Muere con el anuncio** (`Cascade`) y **se reemplaza en cada edición**: no sobrevive al
   texto del que salió.

Acceso: MODERATOR+, heredado del segmento donde se enseña. Es la misma decisión consciente
que 5a tomó con la IP, y se anota igual.

### 3.4 Cómo llega al staff

**En la ficha del anuncio** (F1) — junto a `moderationSignals`, que es donde ya vive la señal
de palabra prohibida. Cada detección con su detector, su campo y su fragmento.

Y una nota que la ficha tiene que dar, porque F1 no miente sobre lo que sabe:

> `moderationSignals` son señales de **ahora** y no la causa de que el anuncio esté en la
> cola (`admin.service.ts:654-659`). Las detecciones son distintas: **sí** son el resultado
> de la última pasada real sobre este texto. Conviene que la ficha las presente separadas de
> las señales, no mezcladas, porque su garantía es otra.

**En la lista** — un filtro booleano `?hasDetections=true` en `/admin/anuncios`, molde
literal de `hasReports` y `needsRevalidation`, que ya existen y ya son booleanos
(`list-admin-listings.dto.ts:135,142`). Y un filtro por detector, `?detector=PHONE`, que es
lo que convierte la lista en el banco de pruebas: «enséñame los cien donde el detector de
teléfonos ha disparado».

**Sin desnormalizar todavía.** El filtro se resuelve con una relación (`detections: { some:
{} }`), que se apoya en el índice de `listingId`. Si eso resulta caro **se mide con `EXPLAIN
ANALYZE` y entonces se decide** si hace falta un booleano denormalizado — el mismo criterio
que F2 aplicó para añadir un índice y que E2 aplicó para **no** añadirlo. Denormalizar antes
de medir es inventarse un problema y además crea una segunda verdad que mantener.

---

## 4. Dónde corre — y el cambio de comportamiento que hay que anunciar

### 4.1 Los tres puntos de ejecución

| Camino | ¿Corre? | ¿Reemplaza detecciones? | ¿Puede cambiar `status`? |
|---|---|---|---|
| `publish()` (`listings.service.ts:478`) | sí (ya lo hace) | **sí** | **sí** — como hoy |
| `update()` del DUEÑO (`:319`) | **sí — nuevo** | **sí** | **sí, en modo BLOQUEAR** |
| `updateListing()` del STAFF (`admin.service.ts:765`) | **sí — nuevo** | **sí** | **NO, nunca** |

### 4.2 La regla que no se puede romper: «editar limpia, pero nunca frena»

Está escrita en el código, y es la asimetría más importante del mecanismo de edición
(`listings.service.ts:413-420`):

> «Editar es LA VÍA DE SALIDA de un anuncio marcado: frenar aquí dejaría al vendedor
> encerrado — no puede publicar porque no cumple, y no puede arreglarlo porque no le dejan
> editar.»

De ahí, la regla dura de este diseño:

> **La detección al editar NUNCA rechaza la edición.** No lanza, no devuelve 422, no impide
> guardar. Como mucho **cambia el destino** (`ACTIVE → PENDING_REVIEW`) de una edición que
> **ya se ha guardado**.

Es lo mismo que hace `publish()` hoy: no rechaza, re-enruta. Y es lo que permite que un
vendedor que se equivocó pueda quitar el teléfono y salir — si editar pudiera fallar por
tener un teléfono, el que ya lo tenía no podría quitarlo.

### 4.3 Por qué el staff NO dispara el bloqueo

Mismo criterio que P3a estableció para `EDITED` y que 5a estableció para la IP del dueño: el
camino del staff **no afirma cosas del vendedor**. Un moderador que edita una descripción
para **quitar** un teléfono no puede provocar que el anuncio se despublique por su propia
mano.

Pero **sí re-ejecuta los detectores**, y ahí está el matiz que hace que la separación sea
limpia:

- Las **detecciones** son un hecho sobre el texto actual → las refresca quien escriba el
  texto, sea quien sea. Si el moderador quitó el teléfono, la detección tiene que morir.
- El **cambio de `status`** es una consecuencia sobre el vendedor → sólo lo dispara el
  vendedor.

Dos cosas, dos dueños. Es la misma separación que `update()` ya hace entre el mecanismo y la
anotación (`listings.service.ts:386-397`).

### 4.4 El cambio de comportamiento, anunciado

Cerrar el hueco de §0.4 **cambia lo que la plataforma hace**. Hay que decirlo, no deslizarlo:

> **Hoy**, un anuncio ACTIVE se puede reescribir entero —meter un teléfono, meter una
> palabra de la lista— y no pasa absolutamente nada.
>
> **Después de la ráfaga A**, esa reescritura deja detecciones que el staff ve. El anuncio
> sigue ACTIVE. Cambia quién se entera, no qué le pasa al anuncio.
>
> **Después de la ráfaga B**, si un detector ha ascendido a BLOQUEAR, esa reescritura puede
> devolver un anuncio ACTIVE a PENDING_REVIEW. **Eso sí es nuevo para el vendedor**: su
> anuncio desaparece del escaparate a media vida, por una edición.

Y aquí está la propiedad que ordena el plan entero:

> **La ráfaga A cierra el hueco en el modo más seguro que existe.** Con todo en AVISAR
> —salvo WORD, que ya bloqueaba en `publish()` y sigue igual—, correr la detección al editar
> **no puede despublicar nada**. El cambio arriesgado (que editar despublique) queda
> separado del cambio estructural (que editar se mire), y llega después, con datos.

Nota deliberada: en la ráfaga A, **`WORD` en modo BLOQUEAR tampoco despublica al editar**.
Su modo gobierna `publish()` como hoy; que la edición pueda re-enrutar es una capacidad que
se enciende en la ráfaga B junto con el ascenso. Si no, la ráfaga A estaría colando el cambio
de comportamiento arriesgado por la puerta de atrás para el único detector que hoy bloquea.

---

## 5. El plan

### 5.1 Ráfaga 0 — el motor, sin cambiar nada

Extraer `DetectionEngine` con la interfaz `Detector`. `BadWordService` pasa a ser el detector
`WORD` **con su semántica intacta**: mismos tokens, misma igualdad exacta, mismo fail-open,
mismo modo BLOQUEAR, mismos dos campos. `publish()` llama al motor. La ficha F1 sigue
recibiendo su señal.

**Cero cambio de comportamiento observable.** Es la ráfaga que hace sitio.

**Barreras:**
- Los tests de palabras prohibidas que ya existen (`moderacion-previa.e2e-spec.ts` §4,
  `admin.e2e-spec.ts`) pasan **sin tocarlos**. Es la barrera principal: si hay que editarlos,
  el comportamiento cambió.
- El fail-open sigue vivo: con el motor reventando, `publish()` deja ACTIVE.
- La convivencia con `PreModerationService` no cambia: los dos siguen pudiendo mandar a
  revisión sin pisarse.
- **Mutación:** que el detector WORD normalice distinto (p. ej. sin quitar diacríticos) → cae
  el test de palabras con tildes.

### 5.2 Ráfaga A — AVISAR: el banco de pruebas ⟵ *la grande*

1. `ListingDetection` + su migración. Reemplazo completo por anuncio.
2. Detectores `IP` y `PHONE`, **nacidos en AVISAR**.
3. `Setting['detectionModes']`, leído por el motor. Sin pantalla de edición todavía
   (la edición del modo es la ráfaga B; aquí el valor existe y se respeta).
4. **La detección corre en `publish()`, en `update()` del dueño y en `updateListing()` del
   staff** — cerrando el hueco de §0.4. Nadie cambia `status` salvo `publish()`, como hoy.
5. Las detecciones en la ficha F1, separadas de `moderationSignals`.
6. Filtros `?hasDetections=` y `?detector=` en `/admin/anuncios`.

**Barreras:**
- **La barrera del punto entero:** un anuncio ACTIVE se edita metiendo un teléfono → aparece
  la detección **y el anuncio SIGUE ACTIVE**. Las dos mitades en la misma prueba: sin la
  segunda, la ráfaga habría colado el cambio arriesgado.
- **La barrera del fail-open que este punto viene a cerrar:** meter `192.168.1.1` en
  `badWordList` **no** detecta nada (el detector WORD no puede, y así está diseñado), y el
  detector `IP` **sí** lo detecta sobre el mismo texto. Es la afirmación exacta de §0.1, y la
  que demuestra que los detectores nuevos no son azúcar.
- El dueño quita el teléfono al editar → **la detección desaparece**. Contra el flag podrido.
- El STAFF edita quitando el teléfono → la detección desaparece **y el `status` no se mueve**
  (§4.3). Molde de las barreras de dos direcciones de 5a y P3a.
- La ortogonalidad de P1 sigue en pie: una detección **no** mueve `triage` ni `watched`. Se
  mide sobre un anuncio `REVIEWED` no vigilado — sigue `REVIEWED` y sigue no vigilado.
- Editar nunca falla por una detección, ni siquiera con el motor reventando.
- **Mutaciones:** que la detección al editar toque `status` → cae la barrera principal · que
  el reemplazo sea aditivo en vez de completo → cae la de «desaparece» con detecciones
  duplicadas · que el aviso escriba `watched: true` → cae la de ortogonalidad · que el camino
  del staff cambie `status` → cae la de las dos direcciones.

### 5.3 Ráfaga B — BLOQUEAR y el ascenso

1. La edición de `detectionModes` en `/admin/ajustes`, **ADMIN** (§2.4).
2. El contador por detector, presentado como lo que es (§2.4) y no como una tasa.
3. **Modo BLOQUEAR efectivo para IP/PHONE** en `publish()`.
4. **Y la capacidad nueva: en modo BLOQUEAR, la edición del DUEÑO re-enruta ACTIVE →
   PENDING_REVIEW.** Es el cambio de comportamiento de §4.4, y llega aquí a propósito.

**Barreras:**
- Ascender `PHONE` a BLOQUEAR y publicar con teléfono → PENDING_REVIEW. Degradarlo a AVISAR
  → ACTIVE con detección. **El mismo anuncio, los dos modos**: es la prueba de que ascender
  es cambiar un valor y no otro camino de código.
- ACTIVE + edición que mete un teléfono + PHONE en BLOQUEAR → PENDING_REVIEW. **Y la edición
  se guardó igualmente** (§4.2): el texto nuevo está en la fila.
- El vendedor **puede editar para salir**: quita el teléfono de un PENDING_REVIEW → la
  edición pasa, la detección muere. Sin esto, la ráfaga B construye una trampa.
- El staff en BLOQUEAR sigue sin mover `status`.
- **Mutaciones:** que editar lance en vez de re-enrutar → cae la del texto guardado y la de
  la vía de salida · que el modo se lea de una constante en vez del `Setting` → cae la de los
  dos modos sobre el mismo anuncio.

### 5.4 Ráfaga C — el fail-open de la lista de palabras (§0.1)

Aparte, y **después**, por una razón que importa: arreglar el emparejamiento multi-palabra
**refuerza un detector que está en BLOQUEAR** sin haber pasado por el banco de pruebas. Un
admin que escribió `dinero facil` hace meses —y a quien nunca le funcionó— se encontraría de
golpe con anuncios yéndose a revisión.

Orden correcto, y es el orden entero de la ráfaga:

1. **Primero enseñar el daño**: la pantalla de ajustes marca qué entradas **no casan nunca
   hoy** y por qué. Sin cambiar el emparejamiento. El admin ve su lista real.
2. **Después** arreglarlo, con la lista ya revisada por quien la escribió.

Cambiar las dos cosas a la vez es exactamente lo que este proyecto lleva pagando cada vez que
lo ha hecho.

### 5.5 Ráfagas opcionales, fuera del camino crítico

- **Veredictos por detección** (§2.4): el staff marca «acierto» / «ruido». Es lo único que
  convierte el contador en una tasa de falsos positivos de verdad. Grande; sólo si el banco
  de pruebas demuestra que hace falta.
- **`attributes` como campo escaneado**: es un `jsonb` con claves arbitrarias y valores que
  pueden ser números o enums. Hay que decidir **qué claves son texto libre** antes de
  escanearlas, y eso es una pregunta de catálogo, no de detección.
- **Avisar al VENDEDOR**, no sólo al staff: «tienes un campo para el teléfono». Es la
  respuesta que §0.2 sugiere y probablemente reduce el problema más que bloquear.
- **Ofuscación** (dígitos en letra, unicode): sólo con datos del banco de pruebas que digan
  que el patrón simple ya acierta y que la gente lo está esquivando.

### 5.6 El orden, y por qué

```
0 (motor, invisible) → A (AVISAR + cerrar el hueco) → B (BLOQUEAR + ascenso) → C (el fail-open de la lista)
```

**A antes que B** es el requisito del enunciado y coincide con lo que el código pide: los dos
detectores nuevos tienen falsos positivos reales y nombrados (§2.2), y no hay un solo dato
sobre su frecuencia.

**A cierra el hueco de editar**, que es el cambio estructural, **en el modo en que ese cambio
no puede hacer daño**. B añade la consecuencia. Separarlos es lo que permite que, si algo se
rompe, se sepa cuál de los dos fue.

**C al final** porque toca el único detector que ya bloquea, y hacerlo antes sería endurecer
en silencio lo que este punto viene a hacer visible.

---

## 6. Lo que hay que decidir antes de empezar

1. **¿`WORD` se queda con dos campos o el motor escanea más?** El diseño mantiene
   `title + description` en la ráfaga A por paridad exacta con hoy. Ampliar es una decisión
   de producto, no del motor.
2. **¿Los modos van por detector o por entrada?** Aquí: **por detector**, porque es lo que el
   punto 6 necesita (IP y PHONE son un patrón cada uno) y porque por entrada obligaría a
   convertir `badWordList` de `string[]` a objetos — migración de datos por una capacidad que
   nadie ha pedido.
3. **¿El contador del ascenso cuenta anuncios o detecciones?** Anuncios vivos con al menos
   una detección de ese detector: es la magnitud que corresponde a la decisión («a cuántos
   anuncios afectaría ascender esto»).
4. **¿La detección corre en `create()`?** No: un DRAFT no está publicado y `create` no tiene
   destino que re-enrutar. Corre en `publish()` y en las ediciones. Si se quisiera avisar al
   vendedor antes de publicar (§5.5), ahí sí tendría sentido — y sería otra conversación.
