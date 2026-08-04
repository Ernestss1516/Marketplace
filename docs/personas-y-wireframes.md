# Personas y wireframes — MVP

> **HISTÓRICO — MVP completado (fases 0-5)**
> Este documento recoge los arquetipos de usuario y wireframes de bloques del diseño
> previo a la implementación. **Las personas siguen siendo referencia válida y vigente**
> —no caducan con el código—, y son el insumo natural de las fases 9.1 (navegación) y 9.2
> (interfaz y estilo), todavía pendientes. Plan vigente:
> `docs/Hoja_de_ruta_rafagas_Hito5-9.docx`; pendientes: `docs/pendientes.md`.
>
> **Nota (auditoría 2026-08-04):** donde el texto remite funciones al futuro («fase 6»), ya
> están construidas — favoritos (lo que apuntaba Nerea) y la reputación/gestión avanzada (lo
> que apuntaba Quim) existen desde los Hitos 3 y 7. Léase como diseño de su momento.

> **Propósito:** guiar las decisiones de diseño del frontend con arquetipos de
> usuario y el esqueleto de contenido de las pantallas clave. Las personas son
> propuestas de arquetipo; conviene validarlas con investigación real cuando se
> disponga de ella. Los wireframes aquí son estructura de bloques (contenido y
> jerarquía), el paso previo a los wireframes visuales de baja fidelidad.

## 1. Personas

El marketplace tiene dos lados, y en un C2C una misma persona suele ser comprador
y vendedor en momentos distintos. Se separan por la intención dominante. Hay dos
personas **primarias** (de ellas depende el bucle de valor) y dos **secundarias**.

### Primarias

#### Marta, 38 — vendedora ocasional

- **Contexto:** madre con dos hijos, trabaja a jornada completa, usa el móvil para casi todo. Nivel digital medio.
- **Cuándo usa la app:** ratos sueltos, casi siempre desde el sofá con el móvil; las fotos las hace con la cámara del teléfono.
- **Objetivos:** deshacerse de la ropa y los juguetes que se le han quedado pequeños a los niños; que publicar le lleve dos minutos.
- **Frustraciones:** formularios largos, rellenar muchos campos, gente que pregunta y no aparece, quedadas que se caen.
- **Comportamiento:** publica varias cosas de golpe, pone pocas fotos, responde cuando puede.
- **Cita:** «Si tardo más de cinco minutos en subir algo, lo dejo para otro día… y ese día no llega.»

#### Javier, 45 — comprador con necesidad

- **Contexto:** acaba de mudarse; necesita amueblar y equipar la casa sin gastar de más. Usa móvil y portátil.
- **Cuándo usa la app:** busca de forma intencional, comparando varias opciones antes de decidir.
- **Objetivos:** encontrar un artículo concreto (un sofá, una lavadora) en buen estado, cerca y de un vendedor fiable.
- **Frustraciones:** anuncios sin fotos o sin datos clave, precios poco claros, no saber si el vendedor es de fiar, desplazamientos largos.
- **Comportamiento:** filtra por categoría y zona, lee descripciones a fondo, valora la cercanía y la reputación.
- **Cita:** «Si no hay fotos buenas y no sé dónde está, ni pregunto.»

### Secundarias

#### Nerea, 26 — cazadora de gangas

- **Contexto:** joven, muy digital, le gusta la moda y la decoración de segunda mano. Vive en el móvil.
- **Cuándo usa la app:** navega sin buscar nada concreto, por entretenimiento y oportunidad.
- **Objetivos:** descubrir chollos y piezas únicas a buen precio; regatear forma parte del juego.
- **Frustraciones:** resultados poco frescos, falta de novedades, no poder filtrar bien por precio.
- **Comportamiento:** explora mucho, guarda mentalmente, sensible al precio, contacta rápido cuando algo le encaja.
- **Cita:** «Entro a mirar y siempre acabo encontrando algo que no sabía que quería.»

#### Quim, 52 — vendedor recurrente

- **Contexto:** restaura muebles y pequeños electrodomésticos como afición que le da ingresos. Cómodo con la tecnología.
- **Cuándo usa la app:** de forma regular, gestionando varios anuncios a la vez.
- **Objetivos:** mantener su catálogo visible y al día, vender con continuidad.
- **Frustraciones:** republicar manualmente, falta de visibilidad cuando hay mucha oferta, gestionar muchas conversaciones.
- **Comportamiento:** cuida fotos y descripciones, renueva anuncios, responde rápido.
- **Cita:** «Para mí esto no es vaciar el trastero, es casi una tienda; necesito que se me vea.»

### Cómo usar estas personas

Diseña primero para **Marta y Javier**. Las frustraciones de Marta defienden un flujo
de publicación muy corto (clave para la oferta); las de Javier defienden fichas con
buenas fotos, datos claros y señales de confianza (clave para la demanda). Nerea y
Quim no deben condicionar el MVP, pero conviene no cerrarles la puerta: Nerea apunta
a la futura función de favoritos, y Quim a la gestión avanzada y la reputación
(ambas, fase 6).

---

## 2. Wireframes (estructura de bloques)

### Prioridad de pantallas

1. **Ficha de anuncio** — donde se decide el contacto y la que más tráfico de SEO recibe.
2. **Formulario de publicación** — el flujo más crítico para la oferta; si publicar cuesta, no hay anuncios.
3. **Resultados de búsqueda** — donde el comprador escanea y filtra.
4. **Home** — primera impresión y punto de entrada.

El chat, «mis anuncios» y login/registro son más estándar y admiten un wireframe ligero posterior.

### Ficha de anuncio

De arriba a abajo, en prioridad descendente (pensado mobile-first):

- Galería de fotos — protagonista, ocupa la parte superior.
- Título, precio y estado (Activo / Reservado).
- **Botón de contacto prominente** — en móvil, fijo en la parte inferior, siempre visible.
- Datos clave / atributos de la categoría (desde el `attributeSchema`).
- Descripción.
- Ubicación aproximada — mapa pequeño, zona, no dirección exacta.
- Bloque del vendedor — nombre, antigüedad, enlace al perfil.
- Anuncios relacionados — al final.

### Formulario de publicación

Pensado para reducir fricción, idealmente por pasos:

1. Elegir categoría (determina los atributos).
2. Fotos — lo primero que importa; permite subir varias de golpe.
3. Título, descripción y precio (con opción «Gratis» / «A convenir»).
4. Atributos propios de la categoría (generados desde el schema).
5. Ubicación.
6. Previsualización y publicar.

Transversal: **guardado como borrador** para que nadie pierda lo escrito.

### Resultados de búsqueda

- Barra de búsqueda (persistente arriba).
- Filtros — lateral en escritorio, panel desplegable en móvil.
- Rejilla de tarjetas de anuncio (foto, título, precio, ubicación).
- Orden (relevancia, precio, fecha) y paginación.
- Estado vacío con llamada a la acción cuando no hay resultados.

### Home

- Buscador protagonista.
- Acceso a categorías principales.
- Anuncios recientes / destacados.
- Llamada a publicar.

### Decisiones de dominio antes de wireframear

- **Mobile-first:** Marta y Nerea viven en el móvil; diseña primero para pantalla pequeña.
- **Contacto siempre visible:** en la ficha, la acción de contactar no debe exigir scroll; es la que mueve el negocio.
- **Confianza:** fotos, antigüedad del vendedor y ubicación aproximada son las señales que convencen a Javier.

---

## 3. Siguiente paso

Convertir estos esqueletos en **wireframes de baja fidelidad** de las cuatro
pantallas prioritarias, y redactar un par de **escenarios** (Marta publicando el
abrigo de su hija; Javier buscando un sofá a 15 km) que pongan a prueba los flujos.
Es el terreno propio de tu metodología de diseño centrado en el usuario sobre este
andamiaje.
