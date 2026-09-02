# Marketplace — Plataforma de compraventa de segunda mano

## Estado del proyecto

El MVP (fases 0-5) está **completado**. El estado detallado de lo implementado vive
en `docs/estado-tecnico.md`. El plan de trabajo vigente es
`docs/Hoja_de_ruta_rafagas_Hito2.docx`.

## Propósito
Marketplace C2C (entre particulares) tipo Milanuncios: publicar, buscar y
contactar para comprar/vender productos y servicios. Es una plataforma
**intensiva en lectura (read-heavy)** y fuertemente dependiente del **SEO**.

## Stack
- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui
- **Backend:** NestJS + TypeScript
- **Datos:** PostgreSQL + Prisma
- **Caché:** Redis
- **Búsqueda:** Meilisearch
- **Colas:** BullMQ (sobre Redis)

## Estructura del monorepo
- `apps/web/` — Frontend Next.js (ver su propio CLAUDE.md)
- `apps/api/` — Backend NestJS (ver su propio CLAUDE.md)
- `docs/` — Documentación del proyecto (informe, estructuras, hojas de ruta)

## Reglas de arquitectura (INNEGOCIABLES)
- **NestJS es la única fuente de verdad de la lógica de negocio.** Ninguna regla
  de negocio vive en Next.
- **Next.js es solo presentación + BFF.** Consume la API de Nest; no implementa
  negocio.
- **PostgreSQL es la fuente de verdad de los datos.** Meilisearch solo para
  búsqueda; Redis solo para caché y colas.
- **El trabajo pesado va a colas BullMQ**, nunca inline en la petición HTTP
  (procesado de imágenes, reindexado, notificaciones).
- **Solo los anuncios en estado ACTIVE se indexan** en Meilisearch.

## Convenciones de código
- TypeScript en modo estricto en todo el monorepo.
- **Código en inglés** (nombres, comentarios). **Contenido de cara al usuario y
  rutas públicas en español** (p. ej. `/anuncio`, `/busqueda`, `/publicar`).
- Validación de entrada siempre vía DTOs en el backend.

## Comandos
- Infraestructura local: `docker-compose up -d` (Postgres, Redis, Meilisearch, MinIO)
- Frontend: trabajar dentro de `apps/web` (ver su CLAUDE.md)
- Backend: trabajar dentro de `apps/api` (ver su CLAUDE.md)
- Reconstruir índice de búsqueda: `pnpm --filter @marketplace/api reindex`
- Geocodificar anuncios sin coordenadas: `pnpm --filter @marketplace/api geocode-backfill`
- (Ajustar según el gestor de paquetes del workspace.)

## Flujo de Git
- Ramas cortas por fase o ráfaga (p. ej. `fase-2-auth`); fusionar a `main` al
  completar.
- **`git pull` al empezar cada sesión, `git commit` + `git push` al terminar.**
- Nunca dejar trabajo sin commitear si se va a continuar en otra máquina.

## Avisos
- Mantener Next.js actualizado (parches de seguridad del App Router).
- Los secretos (`.env`) **nunca** se suben a Git; hay un `.env.example` como
  plantilla y cada máquina tiene su `.env` local.

### Windows + Docker Desktop: usar `127.0.0.1`, nunca `localhost`
En los `.env` locales, las conexiones a los contenedores (Postgres, Redis,
Meilisearch, MinIO) van **siempre a `127.0.0.1`**, no a `localhost`.

Motivo: Node resuelve `localhost` a `::1` **primero** (`dns.lookup` devuelve
`[::1, 127.0.0.1]`), y el reenvío de puertos IPv6 de Docker Desktop se degrada en
esta máquina: **acepta el `connect` y corta la conexión al primer byte enviado**.
El resultado son `read ECONNRESET` / `write ECONNABORTED` (errno `-4077` / `-4079`)
en bucle, porque el cliente reconecta y vuelve a romperse. Con ioredis la traza
apunta a `Redis.js sendCommand → event_handler.js`, lo que hace parecer un fallo
de código cuando es de red.

Cómo diagnosticarlo en 10 segundos (el `connect` no basta, hay que **enviar datos**):
```
node -e "const n=require('net');for(const h of ['127.0.0.1','::1']){const s=n.connect({host:h,port:6379});s.on('connect',()=>s.write('PING\r\n'));s.on('data',d=>{console.log(h,'OK',d.toString().trim());s.destroy()});s.on('error',e=>console.log(h,'ROTO',e.code))}"
```
Si `127.0.0.1` responde `+PONG` y `::1` da `ECONNRESET`, es esto.

Ya ha ocurrido tres veces (Postgres, luego Redis, luego las imágenes de MinIO);
afecta por igual a los cuatro servicios. Por eso la config de desarrollo y de
test usa `127.0.0.1` de forma fija, en vez de depender del reenvío IPv6.

**Aplica también a `apps/web`, no solo a `apps/api`.** Next hace `fetch` del lado
del servidor: `/_next/image` va a buscar la imagen a MinIO desde el proceso de
Node, así que sufre exactamente el mismo ECONNRESET y devuelve **500**. Dos
consecuencias que hay que respetar:

- `remotePatterns` (`apps/web/src/lib/image-domains.ts`) debe incluir
  `127.0.0.1`, o `next/image` rechaza el dominio aunque la red funcione.
- **`S3_PUBLIC_URL` debe estar en `127.0.0.1` ANTES de subir imágenes.** La URL
  pública se construye al subir (`R2Service.publicUrl(key)`) y **se guarda
  entera en la base de datos** (`ListingImage.url`, `Listing.video*Url`,
  `SponsoredAd.imageUrl`, `HomepageConfig.blocks`…). Cambiar la variable no
  reescribe lo ya guardado: las imágenes viejas se quedan apuntando a
  `localhost:9000` y siguen dando 500. Si ya ha pasado, reescribirlas en la BD de
  desarrollo:

```sql
UPDATE "ListingImage" SET url = replace(url, 'localhost:9000', '127.0.0.1:9000')
WHERE url LIKE '%localhost:9000%';
-- ídem en Listing.videoUrl/videoPosterUrl/videoPreviewUrl, SponsoredAd.imageUrl
-- y HomepageConfig.blocks (jsonb: replace sobre ::text y recast a ::jsonb).
```

Después hay que **reindexar** (`pnpm --filter @marketplace/api reindex`): los
documentos de Meilisearch llevan el `thumbnailUrl` copiado, así que las tarjetas
de búsqueda seguirían con la URL vieja aunque Postgres ya esté corregido.

Aparte: si el backend entra en ese bucle, conviene comprobar que no quedan
procesos `node` huérfanos de sesiones anteriores (`Get-Process node`) — mantienen
sockets muertos abiertos contra Redis y siguen quemando CPU indefinidamente.

### Antes de arrancar el backend: liberar el 3001
Un backend que quedó corriendo de una sesión anterior provoca
`EADDRINUSE :::3001` y el nuevo no arranca. Con el backend caído, el frontend
devuelve `SyntaxError: Unexpected end of JSON input` en `/api/auth/session`
(respuesta vacía) — es un síntoma del backend ausente, no un fallo de auth.

```powershell
Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue |
  Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

## Documentación de referencia
- `docs/estado-tecnico.md` — estado real implementado: módulos, decisiones técnicas, deuda pendiente.
- `docs/contratos-api.md` — resumen de alto nivel de la API; detalle en Swagger (`/api/docs`).
- El resto de `docs/` contiene documentos de diseño y planificación del MVP (históricos).
