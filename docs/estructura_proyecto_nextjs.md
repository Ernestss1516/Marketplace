# Estructura del proyecto frontend — Next.js (App Router)

> **Alcance:** este árbol cubre **únicamente el frontend** (Next.js).
> El backend (NestJS) es un proyecto y repositorio separado: contiene toda la
> lógica de negocio y expone la API que este frontend consume. Next.js aquí es
> **capa de presentación + BFF ligero**; no aloja reglas de negocio.

```
marketplace-web/                      # Frontend Next.js (repo separado del backend NestJS)
│
├── public/                           # Assets estáticos servidos tal cual
│   ├── images/
│   ├── icons/
│   └── fonts/
│
├── src/
│   │
│   ├── app/                          # App Router: rutas, layouts y SEO
│   │   │
│   │   ├── (public)/                 # ── GRUPO PÚBLICO ── SSR/ISR, SEO crítico
│   │   │   ├── layout.tsx            # Layout público (header, footer, nav)
│   │   │   ├── page.tsx              # Home / portada
│   │   │   ├── [categoria]/          # Listado por categoría
│   │   │   │   ├── page.tsx
│   │   │   │   └── [subcategoria]/
│   │   │   │       └── page.tsx
│   │   │   ├── anuncio/
│   │   │   │   └── [slug]/           # Ficha de anuncio (SSR — máximo SEO)
│   │   │   │       ├── page.tsx
│   │   │   │       └── opengraph-image.tsx
│   │   │   ├── busqueda/             # Resultados de búsqueda + facetas
│   │   │   │   └── page.tsx
│   │   │   └── [vendedor]/           # Perfil público de un vendedor
│   │   │       └── page.tsx
│   │   │
│   │   ├── (auth)/                   # ── GRUPO AUTENTICACIÓN ── client-side
│   │   │   ├── layout.tsx
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   ├── registro/
│   │   │   │   └── page.tsx
│   │   │   └── recuperar/
│   │   │       └── page.tsx
│   │   │
│   │   ├── (account)/                # ── GRUPO ÁREA PRIVADA DEL USUARIO ──
│   │   │   ├── layout.tsx            # Protegido por sesión
│   │   │   ├── mis-anuncios/
│   │   │   │   └── page.tsx
│   │   │   ├── publicar/             # Crear / editar anuncio
│   │   │   │   └── page.tsx
│   │   │   ├── mensajes/             # Mensajería comprador ↔ vendedor
│   │   │   │   └── page.tsx
│   │   │   ├── favoritos/
│   │   │   │   └── page.tsx
│   │   │   └── perfil/
│   │   │       └── page.tsx
│   │   │
│   │   ├── (admin)/                  # ── GRUPO BACKOFFICE ── SPA-like, sin SSR/SEO
│   │   │   ├── layout.tsx            # Protegido por ROL admin (client-side)
│   │   │   └── admin/
│   │   │       ├── page.tsx          # Dashboard / métricas
│   │   │       ├── anuncios/         # Moderación de anuncios
│   │   │       │   └── page.tsx
│   │   │       ├── usuarios/         # Gestión de usuarios
│   │   │       │   └── page.tsx
│   │   │       ├── reportes/         # Reportes y denuncias
│   │   │       │   └── page.tsx
│   │   │       ├── categorias/       # Gestión del árbol de categorías
│   │   │       │   └── page.tsx
│   │   │       └── ajustes/
│   │   │           └── page.tsx
│   │   │
│   │   ├── api/                      # Route handlers: SOLO BFF/proxy — NO negocio
│   │   │   ├── revalidate/           # Webhook de revalidación ISR
│   │   │   │   └── route.ts
│   │   │   └── og/                   # Generación de imágenes Open Graph
│   │   │       └── route.ts
│   │   │
│   │   ├── layout.tsx                # Root layout (providers, fuentes, metadata base)
│   │   ├── globals.css
│   │   ├── not-found.tsx             # 404
│   │   ├── error.tsx                 # Error boundary global
│   │   ├── loading.tsx               # Estado de carga global
│   │   ├── sitemap.ts                # Sitemap dinámico (SEO)
│   │   └── robots.ts                 # robots.txt (SEO)
│   │
│   ├── components/                   # Componentes React reutilizables
│   │   ├── ui/                       # Primitivos (shadcn/ui): button, input, dialog…
│   │   ├── layout/                   # Header, Footer, Navbar, Sidebar
│   │   ├── anuncios/                 # AnuncioCard, AnuncioGrid, GaleriaFotos
│   │   ├── busqueda/                 # SearchBar, FiltrosPanel, Facetas
│   │   ├── forms/                    # Formularios (publicar, login, perfil…)
│   │   └── admin/                    # Componentes del backoffice (DataTable, charts…)
│   │
│   ├── lib/                          # Lógica de cliente y utilidades
│   │   ├── api/                      # Cliente HTTP hacia la API de NestJS
│   │   │   ├── client.ts             # Instancia base (fetch/axios) con auth e interceptores
│   │   │   ├── anuncios.ts           # Llamadas al recurso anuncios
│   │   │   ├── usuarios.ts
│   │   │   ├── busqueda.ts
│   │   │   └── mensajes.ts
│   │   ├── auth/                     # Helpers de sesión (Auth.js / NextAuth)
│   │   │   └── config.ts
│   │   ├── validations/              # Esquemas Zod (validación de formularios)
│   │   └── utils/                    # Formateadores (precio, fecha), helpers varios
│   │
│   ├── hooks/                        # Custom hooks (useDebounce, useAnuncios, useSession…)
│   │
│   ├── types/                        # Tipos TypeScript compartidos (DTOs de la API)
│   │
│   ├── config/                       # Constantes, categorías, configuración de entorno
│   │
│   ├── styles/                       # Estilos / extensiones de Tailwind
│   │
│   └── middleware.ts                 # Protección de rutas (account/admin) por sesión y rol
│
├── .env.local                        # Variables de entorno (URL de la API NestJS, claves…)
├── .env.example                      # Plantilla de variables (sin secretos)
├── next.config.js                    # Configuración de Next (imágenes, rewrites, headers)
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Decisiones clave reflejadas en la estructura

1. **Route groups para separar contextos.** Los paréntesis `(public)`, `(auth)`,
   `(account)` y `(admin)` agrupan rutas con su propio layout y comportamiento
   **sin añadir segmentos a la URL**. Así conviven en un único proyecto el front
   público (renderizado en servidor, SEO) y el backoffice (client-side, sin SEO),
   tal y como se decidió, sin duplicar proyectos.

2. **El backoffice vive aquí, pero aislado.** El grupo `(admin)` tiene su propio
   layout protegido por rol y se comporta como una SPA (componentes de cliente,
   tablas interactivas). No paga SSR ni SEO porque no lo necesita.

3. **`api/` es solo BFF, no negocio.** Los route handlers se limitan a tareas de
   presentación (revalidación ISR, imágenes OG, algún proxy). Toda la lógica de
   negocio vive en NestJS y se consume desde `lib/api/`.

4. **SEO de primera clase.** `sitemap.ts`, `robots.ts`, `opengraph-image.tsx` y
   las fichas de anuncio bajo SSR cubren la indexabilidad, que es el canal
   principal de captación.

5. **`middleware.ts`** centraliza la protección de rutas: exige sesión para
   `(account)` y rol de administrador para `(admin)`.

## Si más adelante separas el backoffice

Si el panel de administración crece o necesita aislamiento estricto de seguridad,
basta con extraer el grupo `(admin)` a un proyecto SPA independiente (Vite + React)
que consuma la misma API de NestJS. La frontera ya está limpia, así que la
migración sería de bajo coste.
