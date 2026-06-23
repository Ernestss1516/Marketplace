# Estructura del proyecto backend — NestJS

> **HISTÓRICO — MVP completado (fases 0-5)**
> Este documento recoge el árbol de diseño previo a la implementación. El estado
> real del código (módulos, decisiones, deuda técnica) está en `docs/estado-tecnico.md`.
> Plan vigente: `docs/Hoja_de_ruta_rafagas_Hito2.docx`.

> **Alcance:** este árbol cubre **únicamente el backend** (NestJS).
> Es la **única fuente de verdad de la lógica de negocio** y expone la API que
> consume el frontend Next.js. Aquí viven las reglas, la persistencia (PostgreSQL
> vía Prisma), la caché (Redis), las colas (BullMQ) y la búsqueda (Meilisearch).

```
marketplace-api/                       # Backend NestJS (repo separado del frontend)
│
├── prisma/                            # Capa de datos — modelo único de verdad
│   ├── schema.prisma                  # Esquema de tablas y relaciones
│   ├── migrations/                    # Migraciones versionadas
│   └── seed.ts                        # Datos iniciales (categorías, roles…)
│
├── src/
│   │
│   ├── main.ts                        # Bootstrap: CORS, pipes globales, Swagger
│   ├── app.module.ts                  # Módulo raíz: importa dominio + infraestructura
│   │
│   ├── modules/                       # ── MÓDULOS DE DOMINIO (lógica de negocio) ──
│   │   │
│   │   ├── auth/                      # Autenticación y autorización
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/            # JWT, local
│   │   │   ├── guards/                # JwtAuthGuard
│   │   │   └── dto/                   # LoginDto, RegisterDto…
│   │   │
│   │   ├── users/                     # Usuarios y perfiles
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   └── dto/
│   │   │
│   │   ├── listings/                  # ANUNCIOS — núcleo del dominio
│   │   │   ├── listings.module.ts
│   │   │   ├── listings.controller.ts
│   │   │   ├── listings.service.ts    # Crear/editar/publicar; emite eventos de indexado
│   │   │   └── dto/                   # CreateListingDto, UpdateListingDto, FilterDto
│   │   │
│   │   ├── categories/                # Árbol de categorías y atributos por categoría
│   │   │   ├── categories.module.ts
│   │   │   ├── categories.controller.ts
│   │   │   ├── categories.service.ts
│   │   │   └── dto/
│   │   │
│   │   ├── search/                    # Integración con Meilisearch
│   │   │   ├── search.module.ts
│   │   │   ├── search.controller.ts
│   │   │   ├── search.service.ts      # Indexado + resolución de consultas
│   │   │   └── dto/                   # SearchQueryDto (texto, filtros, facetas)
│   │   │
│   │   ├── messaging/                 # Mensajería comprador ↔ vendedor
│   │   │   ├── messaging.module.ts
│   │   │   ├── messaging.controller.ts
│   │   │   ├── messaging.gateway.ts   # Gateway WebSocket (tiempo real)
│   │   │   ├── messaging.service.ts
│   │   │   └── dto/
│   │   │
│   │   ├── favorites/                 # Anuncios guardados / favoritos
│   │   │   ├── favorites.module.ts
│   │   │   ├── favorites.controller.ts
│   │   │   └── favorites.service.ts
│   │   │
│   │   ├── reviews/                   # Valoraciones y reputación
│   │   │   ├── reviews.module.ts
│   │   │   ├── reviews.controller.ts
│   │   │   └── reviews.service.ts
│   │   │
│   │   ├── media/                     # Subida y procesado de imágenes (S3 / R2)
│   │   │   ├── media.module.ts
│   │   │   ├── media.controller.ts
│   │   │   └── media.service.ts       # Encola el procesado pesado en BullMQ
│   │   │
│   │   ├── moderation/                # Moderación de contenido (auto + manual)
│   │   │   ├── moderation.module.ts
│   │   │   ├── moderation.controller.ts
│   │   │   └── moderation.service.ts
│   │   │
│   │   └── admin/                     # Endpoints de backoffice (protegidos por rol)
│   │       ├── admin.module.ts
│   │       ├── admin.controller.ts
│   │       └── admin.service.ts
│   │
│   ├── common/                        # ── TRANSVERSAL (reutilizable) ──
│   │   ├── decorators/                # @CurrentUser, @Roles
│   │   ├── guards/                    # RolesGuard (protección por rol)
│   │   ├── interceptors/              # Logging, transformación de respuesta, caché
│   │   ├── filters/                   # Filtros de excepciones (formato de error)
│   │   ├── pipes/                     # Validación / transformación
│   │   └── dto/                       # DTOs base: paginación, respuesta estándar
│   │
│   ├── infra/                         # ── INFRAESTRUCTURA (integraciones) ──
│   │   ├── prisma/
│   │   │   ├── prisma.module.ts
│   │   │   └── prisma.service.ts      # Cliente Prisma inyectable
│   │   ├── redis/
│   │   │   ├── redis.module.ts
│   │   │   └── redis.service.ts       # Caché de listados y fichas
│   │   ├── queue/                     # BullMQ sobre Redis
│   │   │   ├── queue.module.ts
│   │   │   └── processors/            # Workers: imágenes, indexado, notificaciones
│   │   │       ├── image.processor.ts
│   │   │       ├── indexing.processor.ts
│   │   │       └── notification.processor.ts
│   │   └── meilisearch/
│   │       ├── meilisearch.module.ts
│   │       └── meilisearch.service.ts # Cliente del motor de búsqueda
│   │
│   └── config/                        # Configuración tipada
│       ├── configuration.ts
│       └── env.validation.ts          # Validación de variables de entorno
│
├── test/                              # Tests e2e
├── .env
├── .env.example
├── nest-cli.json
├── tsconfig.json
├── package.json
└── README.md
```

## Decisiones clave reflejadas en la estructura

1. **Tres zonas bien separadas.** `modules/` (dominio y lógica de negocio),
   `common/` (transversal: guards, interceptores, filtros) e `infra/`
   (integraciones con Prisma, Redis, BullMQ y Meilisearch). Cada cosa en su sitio,
   que es lo que da la mantenibilidad buscada.

2. **Un módulo por dominio.** Cada módulo encapsula su `controller` (rutas),
   `service` (lógica), `dto` (contratos de entrada/salida) y, donde aplica,
   `entities`. Es el patrón canónico de NestJS y el que mejor escala.

3. **Prisma como única capa de datos.** El `schema.prisma` es el modelo de verdad;
   `PrismaService` se inyecta en los servicios que lo necesiten. Aquí encaja el
   uso de `jsonb` para los atributos variables por categoría.

4. **La búsqueda, encapsulada.** `search/` habla con Meilisearch: cuando
   `listings.service` crea o edita un anuncio, emite un evento que encola el
   reindexado; las consultas devuelven IDs que luego se hidratan desde PostgreSQL.

5. **Trabajo pesado fuera del ciclo de petición.** `infra/queue/` (BullMQ sobre
   Redis) procesa imágenes, reindexados y notificaciones en *workers*, para no
   bloquear el hilo de Node ni penalizar la latencia.

6. **Tiempo real en mensajería.** `messaging.gateway.ts` expone un Gateway
   WebSocket para el chat, mientras el `controller` cubre las operaciones REST.

7. **Backoffice protegido por rol.** El `RolesGuard` de `common/guards` y el
   módulo `admin/` sirven los endpoints del panel de administración que consume
   el grupo `(admin)` del frontend.

## Cómo se conecta con el frontend

| Frontend (Next.js) | Backend (NestJS) |
|---|---|
| `lib/api/anuncios.ts` | `modules/listings` |
| `lib/api/usuarios.ts` | `modules/users` |
| `lib/api/busqueda.ts` | `modules/search` |
| `lib/api/mensajes.ts` | `modules/messaging` |
| `(account)/publicar` | `listings` + `media` (subida de fotos) |
| `(admin)/*` | `modules/admin` (protegido por `RolesGuard`) |
| Auth.js / sesión | `modules/auth` (emite y valida JWT) |

El frontend nunca contiene reglas de negocio: solo llama a estos módulos a través
del cliente HTTP en `lib/api/`. Toda decisión —validaciones, permisos, qué se
indexa, qué se cachea— vive en este backend.
