# Diseño — la última IP (punto 5)

> El diseño corto del punto 5 del lote de retoques: guardar y enseñar la **última IP de
> inicio de sesión** de un usuario y la **última IP de gestión del propietario** de un
> anuncio, con su fecha/hora, y poder filtrar y ordenar por ellas.
>
> Base: `docs/auditoria-retoques-backoffice.md` §5 · el login · F2 (el marco de filtros y
> orden) · la ficha y la lista de usuarios.
>
> **Cero código.** Todo lo que se afirma está leído en el repo, con fichero y línea.

---

## 0. El veredicto, y un hallazgo que cambia uno de los bloques

| Bloque | Qué sale |
|---|---|
| **1. Modelo** | **Persistir, no derivar** — y no es una preferencia: el login **no escribe `AuditLog`**, así que no hay nada de donde derivar |
| **2. Captura** | El molde de IP ya existe (`@Ip()` + `trust proxy`). Dos huecos: el **login social no recibe la IP**, y la gestión del dueño son **~9 sitios** |
| **3. Reconciliación** | **El enunciado y la auditoría se equivocaban de sujeto.** El `ip` que `GET /admin/users/:id` filtra **no es del usuario: es del MODERADOR que actuó sobre él**. No se bendice — **se arregla** |
| **4. Filtrar y ordenar** | La lista de usuarios no tiene eje de orden; hay que **traer** el marco de F2. Con un cuidado que nadie ha mencionado: los `NULL` |
| **5. Plan** | **Dos ráfagas**: backend (modelo + captura + el arreglo) y después UI |

---

## 1. El modelo

### Persistir, y la razón es de hecho, no de gusto

El enunciado deja abierto si derivar del `AuditLog` o persistir en la fila. **La pregunta
está resuelta por el código:**

- **`AuthService.login`, `adminLogin` y `loginWithGoogle` no escriben ni una fila de
  `AuditLog`.** Grep sobre `auth.service.ts`: cero apariciones de `auditLog`. La IP que
  reciben (`auth.controller.ts:26-37`) se usa **sólo para el rate limit**
  (`auth:login:ip:${ip}`) y se descarta.
- Y `AuditLog` no podría servir aunque escribiera: su `action` documenta 30 acciones
  **administrativas**, ninguna de sesión.

Así que «última IP de inicio» **no existe en ninguna parte** y no se puede derivar de nada.
Se persiste.

Y aunque existiera, derivarla sería mal negocio para lo que el punto pide: ordenar N
usuarios por su último login sobre una tabla de eventos exige un `MAX(createdAt)` por
usuario —una subconsulta correlacionada o un `DISTINCT ON`— que no se indexa como se indexa
una columna. Ordenar y filtrar es la mitad de este punto.

### Los cuatro campos

```
User.lastLoginAt      DateTime?     User.lastLoginIp        String?
Listing.lastOwnerActionAt DateTime? Listing.lastOwnerActionIp String?
```

Nullable los cuatro: nacen vacíos para todo lo existente y **no hay backfill posible** —el
dato no existía—. Es el mismo grandfathering que `triage` resolvió con un `@default`, pero
aquí ni siquiera hay un valor honesto que poner.

### Por qué NO se reusa `Listing.updatedAt`, verificado

Es la tentación evidente y está mal. `updatedAt` lo mueve **cualquier** escritura de la
fila, y hoy la mueven al menos:

- la edición de **staff** (`AdminService.updateListing`) — P3a, 2a y 2b;
- el cambio de estado de staff, la etiqueta interna, el borrado de `needsRevalidation`;
- la transición automática `REVIEWED → EDITED`.

`updatedAt` responde «¿cuándo cambió esta fila?». El punto 5 pregunta «¿cuándo actuó **su
dueño**?». Son preguntas distintas y la respuesta a la primera es, con frecuencia, «un
moderador».

---

## 2. La captura

### La IP: se reusa el molde, no se inventa uno

`@Ip()` de Nest sobre `req.ip`, con `app.set('trust proxy', trustProxyHops)`
(`main.ts:29-30`). **No hay ni un acceso manual a `x-forwarded-for` en todo el backend**, y
no se va a estrenar aquí: lo usan ya `AuditLog`, los rate limits de auth, el de contacto,
el de revelar teléfono y el conteo de vistas.

> **La deuda que este punto hereda entera.** `pendientes.md` §6 (RC.1, `[SEGURIDAD]`): el
> valor de `trust proxy` **no está verificado contra la topología real**, y si el proxy
> reenvía el `X-Forwarded-For` del cliente en vez de sobrescribirlo, la IP es
> **falsificable a voluntad**. Hoy eso sólo degrada un rate limit con red de seguridad
> global. Aquí la IP pasa a ser un dato de moderación con el que alguien tomará decisiones
> sobre personas. No se puede cerrar sin desplegar (§1 de `pendientes.md`), así que **la
> pantalla tiene que decir lo que sabe y lo que no** — ver §6.

### Usuario: los tres logins, y uno no recibe la IP

`login` y `adminLogin` ya la reciben. **`loginWithGoogle` no**:
`auth.controller.ts:61` llama `this.authService.loginWithGoogle(dto)` sin `@Ip()`. Sin
tocarlo, quien entra sólo con Google tendría «última IP» perpetuamente vacía — y es
justamente una cuenta barata de crear, o sea la que más interesa a una investigación
antifraude.

**La escritura no puede tumbar el login.** Es el camino más caliente y menos perdonable de
la aplicación: si anotar la IP falla, se entra igual. Mismo criterio fail-open que
`BadWordService` («la moderación no puede bloquear el flujo»). Y va **después** de emitir
el token, nunca dentro de la validación de credenciales.

### Anuncio: qué es «gestión del propietario»

Inventario real de `listings.controller.ts`, clasificado:

| Endpoint | ¿Gestión? | Por qué |
|---|---|---|
| `POST /listings` (crear) | **Sí** | La primera interacción; da un valor inicial en vez de `null` |
| `PATCH :id` (editar) | **Sí** | |
| `POST :id/publish` | **Sí** | |
| `POST :id/pause` · `reactivate` · `archive` | **Sí** | |
| `POST :id/renew` | **Sí** | |
| `POST :id/bump` | **Sí** | *(vive en `BillingService.bump`, otro módulo — ver abajo)* |
| `POST :id/reserve` | **Sí** | Mueve el anuncio de estado; es el dueño decidiendo |
| `POST :id/deals` · `DELETE :id/deals/:dealId` | **Sí, discutible** | Es el dueño actuando sobre su anuncio. Se propone incluirlos; es el borde razonable de discusión |
| `DELETE :id` (descartar borrador) | **No** | La fila desaparece: escribirle una IP no sirve para nada |
| `GET :id/phone` · `GET mine/*` · `GET :id/contacts` | **No** | **Ver no es gestionar** |
| `POST :slug/view` | **No** | Es de quien mira, no del dueño |

### Cómo se engancha: `touch(listingId, ip)`, explícito

Un servicio pequeño con un método, llamado desde cada acción de la lista. Nueve llamadas,
**una regla**. Alternativas descartadas:

- **Un interceptor.** El repo lo prohíbe para `AuditLog` por un motivo que aquí no aplica
  (necesita el `before`), pero aparece otro: un interceptor necesita saber **qué rutas
  cuentan**, y eso es una segunda lista que puede divergir de los endpoints — el defecto de
  R1. *(Un decorador por endpoint lo evitaría, pero es más maquinaria de la que el problema
  pide.)*
- **Meterlo en el `data` de cada `prisma.listing.update`.** Son las mismas nueve manos, y
  varias acciones (los tratos) no actualizan la fila del anuncio.

**Dos propiedades que salen gratis de hacerlo explícito:**

1. **El camino de staff no lo escribe, por construcción.** `ListingsService.update()`
   empieza con `assertOwnership`; `AdminService.updateListing` es otro método y no llama a
   `touch`. Es exactamente el reparto que P3a hizo con `triage` — el eje del dueño lo mueve
   el dueño. Si el staff lo escribiera, el dato diría «el vendedor estuvo aquí» cuando
   quien estuvo fue un moderador: **peor que no tenerlo**.
2. **El bump automático tampoco.** `bump-auto.processor` llama a
   `billing.bump(schedule.listingId, schedule.userId)` sin IP —no hay petición HTTP—, así
   que con la IP como parámetro **obligatorio del llamante**, el cron no puede escribirla
   ni por descuido. El dueño programó el bump hace semanas; no está actuando ahora.

---

## 3. La reconciliación — y aquí el enunciado se equivoca de sujeto

### Lo que la auditoría dijo, y lo que resulta ser

La auditoría (§8) anotó que `GET /admin/users/:id` sirve `AuditLog.ip` a MODERATOR por un
`include` sin `select` (`admin.service.ts:1164-1171`), contradiciendo la exclusión
explícita de F1 en `listForResource` (`audit-log.service.ts:58-71`). Eso es cierto. Lo que
faltaba es **de quién es esa IP**, y el propio código lo dice:

```ts
// AuditLogs where this user is the SUBJECT (actions taken AGAINST them).
where: { resourceType: 'User', resourceId: id }
```

y en el esquema, `AuditLog.actorId` es **quien ejecutó la acción**, con FK a `User` y NOT
NULL — «las 65 escrituras del proyecto pasan una persona: no existe actor sistema» (E1).
Ese actor es **siempre staff**.

> **Conclusión: el `ip` que ahí se filtra NO es la del usuario que se está mirando. Es la
> del MODERADOR que le suspendió, le cambió el rol o le concedió un Pro.** La fuga no
> expone al investigado: **expone al investigador, a todos sus colegas.**

Y eso es exactamente lo que F1 escribió al excluirla, palabra por palabra: «no es historia
del anuncio sino **rastro de seguridad de una persona**, y auditar personas es otra pantalla
con otro rol».

### El veredicto

**La decisión de privacidad de §6 NO cubre `AuditLog.ip`, y por tanto la fuga se ARREGLA,
no se bendice.** Son dos datos distintos con dos sujetos distintos:

| | `User.lastLoginIp` / `Listing.lastOwnerActionIp` | `AuditLog.ip` |
|---|---|---|
| ¿De quién? | Del **usuario investigado** | Del **staff que actuó** |
| ¿Para qué? | Antifraude: multicuenta, evasión de baneo | Rastro de seguridad interno |
| ¿Quién debe verla? | **MODERATOR+** (decisión de §6) | Quien audite al staff — **otra pantalla, otro rol** |

El arreglo es de una línea: `getUserDetail` deja de usar `include` y pasa a un `select`
explícito, **el mismo que ya devuelve `listForResource`** (`AuditLogEntry`: `id`, `action`,
`before`, `after`, `createdAt`, `actor`). Con eso los dos lectores del historial dicen lo
mismo, y lo dicen por decisión.

*(Y de paso deja de servir `before`/`after` completos sin filtrar… que sí deben servirse:
son la historia del recurso. El único campo que sobra es `ip`.)*

**La barrera del arreglo tiene que buscar la IP en la respuesta entera serializada**, no
campo a campo — molde literal del test del saldo de U3, que existe justamente porque un
dato se puede colar anidado.

---

## 4. Filtrar y ordenar

### La lista de usuarios no ordena — hay que TRAER el marco

`listUsers` tiene `orderBy: { createdAt: 'desc' }` **clavado**
(`admin.service.ts:1031`), y `ListAdminUsersDto` sólo declara `status`, `role`, `q`, `page`
y `perPage`. **No hay eje de orden ninguno.**

F2 lo resolvió para anuncios con un molde que se replica tal cual: un
`Record<string, OrderByInput>` (`admin.service.ts:316-330`), un campo `order` en el DTO, y
la traducción a la URL en `filtros-url.ts`. Para usuarios **hay que traerlo**, no
extenderlo: el `ORDER_BY` existente es de `Listing` y no vale.

### Los ejes que se añaden

| Dónde | Qué | Cómo |
|---|---|---|
| Usuarios | `order`: `recent` (alta, el de hoy) · **`last-login-desc`** · `last-login-asc` | Molde `ORDER_BY` de F2 |
| Usuarios | Filtro `ip` | Un campo en el DTO, una línea en el `where` |
| Anuncios | Filtro `ip` | Lo mismo — F2 dejó escrito que un eje nuevo entra así, y P1 ya lo ejerció sin que la forma cambiara |

### El cuidado que nadie ha mencionado: los `NULL`

`lastLoginAt` nace **NULL para todo el mundo**, y en Postgres un `ORDER BY ... DESC` pone
los `NULL` **primero**. Sin decir nada, «ordenar por última conexión» pondría arriba
exactamente a quien nunca ha entrado — lo contrario de lo que el moderador pidió. Prisma lo
resuelve con `nulls: 'last'`; hay que escribirlo, y hay que probarlo, porque es el tipo de
cosa que se ve una vez en producción y se atribuye a otra causa.

### El índice: medir, no suponer

Precedente doble y explícito: F2 **midió con `EXPLAIN` y sí añadió** dos índices (servían la
consulta por defecto de una pantalla); E2 **midió y NO añadió** el de `triage` (sólo corría
al filtrar a mano, y era un índice que toda escritura ensucia).

`[lastLoginAt]` sobre `User` cae del lado de F2 **si** ese orden pasa a ser el de entrada de
la pantalla, y del lado de E2 si es un orden opcional. Se mide antes de decidir, y se
escribe el umbral. El filtro por `ip` es de valor puntual sobre una tabla pequeña: casi
seguro no lo necesita, pero se mide igual.

---

## 5. El plan — dos ráfagas

Se parten porque no comparten naturaleza ni riesgo.

**5a — el dato (backend).** Migración de los cuatro campos · la captura en los **tres**
logins (incluido el social, que hoy no recibe la IP) · el `touch` en las nueve acciones del
dueño · **el arreglo de `AuditLog.ip`** en `getUserDetail`.

**5b — verlo (backend ligero + UI).** El eje de orden traído a la lista de usuarios · los
dos filtros por IP · la fecha/hora en la lista y en las dos fichas · el aviso de RC.1 · la
medición con `EXPLAIN`.

El arreglo de la fuga va en **5a** y no espera a 5b: es un dato personal saliendo por una
puerta que nadie decidió abrir, y no depende de nada de lo demás.

### Las barreras

| | Qué fija |
|---|---|
| **B1** | El dueño edita su anuncio → `lastOwnerActionAt/Ip` se escriben |
| **B2** | **El STAFF edita ese mismo anuncio → NO se mueven.** Las dos direcciones, molde literal de P3a con `EDITED` |
| **B3** | **VER no es gestionar**: abrir la ficha, pedir el teléfono o consultar las estadísticas no los mueven |
| **B4** | El **bump automático** (cron) no los mueve — el dueño no está actuando |
| **B5** | Iniciar sesión escribe `lastLoginAt/Ip`, **por los tres caminos** (correo, panel y Google) |
| **B6** | Si anotar la IP falla, **el login sigue funcionando** |
| **B7** | Ordenar por última conexión funciona **y los que nunca entraron van al final**, no al principio |
| **B8** | **`GET /admin/users/:id` ya no devuelve `AuditLog.ip`** — buscada en la respuesta ENTERA serializada, no campo a campo |

**Mutaciones que deben matar:** llamar a `touch` desde el camino de staff → cae B2; llamarlo
en un `GET` → cae B3; pasar la IP en el bump del cron → cae B4; volver al `include` en
`getUserDetail` → cae B8; quitar `nulls: 'last'` → cae B7.

---

## 6. La decisión de privacidad, anotada como consciente

> **La última IP de inicio de sesión de un usuario y la última IP de gestión de un anuncio
> son visibles a MODERATOR+.** No llevan el gate ADMIN del saldo (U3/D-3). Queda escrito el
> porqué, aunque suponga exponer un dato personal a un piso más ancho.

- **Base legal:** interés legítimo en la prevención del fraude y del abuso en una plataforma
  C2C — multicuenta, evasión de baneo, denunciantes en serie.
- **Finalidad, única:** moderación. No marketing, no analítica, no perfilado.
- **Acceso:** MODERATOR y ADMIN. **Nunca** el usuario final, nunca el perfil público, nunca
  un endpoint fuera de `/admin`.
- **Por qué no ADMIN-only:** quien investiga el fraude es el moderador. Un dato antifraude
  que sólo ve quien no modera no protege a nadie y empuja a pedirlo por otro canal. El gate
  de U3 protege una **relación comercial** (saldo, pagos, procedencia del Pro): otra
  categoría de dato y otro oficio.
- **Minimización:** se guarda **sólo la última**, nunca un historial. Es la versión mínima
  que responde la pregunta antifraude, y la que menos se parece a un registro de
  movimientos.
- **Lo que esta decisión NO cubre:** `AuditLog.ip`, que es la IP del **staff**. Ver §3 — se
  arregla, no se bendice.
- **La honestidad sobre el dato (RC.1):** mientras la topología del proxy no esté
  verificada, la IP **puede estar falsificada**. La pantalla lo dice. Una IP que puede
  mentir y se presenta como hecho es peor que no tenerla.

---

## 7. Lo que hace falta decidir antes de empezar

1. **¿Los tratos (`deals`) cuentan como gestión?** Propuesta: sí. Es el borde razonable de
   discusión y no cambia nada del mecanismo.
2. **¿«Última conexión» pasa a ser el orden POR DEFECTO de `/admin/usuarios`,** o se queda
   como opción? De eso depende si el índice se justifica (F2) o no (E2).

Todo lo demás —el modelo, la captura, el arreglo de la fuga, el marco de orden, las
barreras— sale de lo ya construido y no depende de ninguna preferencia.
