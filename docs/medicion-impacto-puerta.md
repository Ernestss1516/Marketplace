# M2 — Medición del impacto de las reglas candidatas de la puerta

> **Qué es esto.** Una **medición**, no una decisión y no una implementación. Cuenta cuántos
> anuncios ACTIVOS existentes fallaría cada regla candidata de la futura puerta de validación,
> para que la elección «estricta vs tolerante» (D2/D4/D5 de
> [`docs/auditoria-puerta-validacion.md`](auditoria-puerta-validacion.md)) se tome con un número
> delante en vez de a ciegas.
>
> **Nada se ha cambiado.** El comando es de solo lectura: no escribe ni un anuncio, ni un schema,
> ni una fila. Su único efecto es imprimir una tabla.
>
> Fecha de esta corrida: 2026-08-13. Base: `marketplace` (desarrollo local).

---

## ⚠️ Lo primero, porque condiciona todo lo demás

**La base de desarrollo tiene 2 anuncios activos.** Con esa muestra, los números de abajo
**no dicen nada sobre producción** — describen esta base y nada más.

Esto no invalida la ráfaga: lo que queda entregado y verificado es **el método**. El comando
está listo para correr sobre datos reales el día que existan, y su salida trae los mismos avisos
impresos para que nadie confunda una corrida de desarrollo con una medición de verdad.

**Lo que M2 sí permite concluir hoy:** la decisión D2/D4/D5 **sigue sin poder tomarse con
fundamento**, y ahora se sabe por qué —no hay datos— en vez de sospecharlo. Es un resultado
honesto, aunque no sea el que se buscaba.

---

## La tabla

Sobre **2 anuncios ACTIVE** y 24 categorías, con la herencia **N niveles** ya vigente:

| Regla candidata | Fallan | % | Ejemplos |
|---|---:|---:|---|
| **1a.** Requeridos que faltan | 0 | 0,0 % | — |
| **1b.** Valores inválidos (opción / tipo) | 0 | 0,0 % | — |
| **1c.** Selects vinculados inválidos | 0 | 0,0 % | — |
| **1d.** Atributos huérfanos (ya no en el schema) | 0 | 0,0 % | — |
| **1e.** Atributos de otro tipo (`appliesTo`) | 0 | 0,0 % | — |
| **1·.** *Cualquier* incumplimiento de atributos | 0 | 0,0 % | — |
| **2.** Vendedor con el correo **sin verificar** | **2** | **100 %** | `cmsn8ffu8…`, `cmska8746…` |
| **3a.** Más de 15 fotos | 0 | 0,0 % | — |
| **3b.** Cero fotos (el mínimo que hoy no se exige) | 0 | 0,0 % | — |
| **5a.** Categoría inexistente / irresoluble | 0 | 0,0 % | — |
| **5b.** Categoría sin ningún atributo definido | 0 | 0,0 % | — |

### 4 — Límite TOTAL de anuncios por usuario

«Total» = todo menos `ARCHIVED` y `SOLD`. Un solo usuario tiene anuncios.

| Tope candidato | Usuarios que lo exceden | Anuncios «de más» |
|---:|---:|---:|
| 5 · 10 · 20 · 50 | 0 | 0 |

Con el criterio **actual** (solo `ACTIVE`, que es lo que ya se aplica hoy): 0 usuarios excedidos
con tope 5 y con tope 20.

---

## Cómo leer estos ceros

**Un `0` aquí no es «no hay problema»: es «no hay datos».** Con 2 anuncios, casi cualquier regla
da 0 por construcción.

Para que ese 0 no se confundiera con un detector roto, el comando ejerce **11 casos sintéticos**
(en memoria, sin tocar la base) con su caso bueno y su caso malo por cada detector: requerido
presente/ausente, opción válida/inventada, número válido/no numérico, booleano válido/basura,
vinculado coherente/incoherente/sin padre. **Los 11 discriminan**, así que los ceros de la tabla
son ceros de verdad sobre estos datos.

**El único dato que sobrevive a la muestra pequeña es el 2:** el 100 % de los anuncios activos
pertenece a vendedores sin el correo verificado. En una base de desarrollo eso es esperable —los
usuarios se crean a mano—, pero apunta a lo que la auditoría ya anticipaba: **«correo verificado
obligatorio» es la regla con más probabilidad de atrapar anuncios existentes**, y por tanto la que
más necesita medirse antes de encenderse.

---

## Qué se ha medido exactamente

### La herencia es la real, de N niveles

El schema efectivo de cada categoría sale del **pliegue de su cadena de ancestros**, usando las
mismas funciones que producción: `ancestorChainIn` para la cadena y `resolveEffectiveSchema`
plegado sobre ella. No es una reimplementación.

Esto importa: medir con una herencia de 2 niveles daría un número **falso** ahora que el árbol
admite 4 — un anuncio de una categoría profunda parecería incumplir atributos que en realidad
hereda del abuelo. Es el mismo riesgo R1 de la auditoría de profundidad, aplicado a la medición.

### El orden de validación es el de producción

Igual que `create()`: primero se pliega la cadena, después se filtra el schema por el tipo del
anuncio (`filterSchemaByType`), y sobre ese schema aplicable se valida. Un `required` marcado solo
para PRODUCT no cuenta contra un SERVICE.

### Dos sub-casos que producción trata igual y aquí se separan

`1d` (huérfanos) y `1e` (de otro tipo) son ambos, para `validateAttributeValues`, «claves
desconocidas» → 422. Se cuentan por separado a propósito, porque son problemas distintos y pueden
querer políticas distintas:

- **1d — huérfano**: el atributo ya no existe en el schema efectivo. Es dato muerto, normalmente
  resultado de renombrar o borrar un atributo (mapa §3.1).
- **1e — de otro tipo**: el atributo *sí* existe, pero está restringido al tipo contrario. Es un
  dato legítimo mal colocado, no basura.

### ⚠️ Lo único que no usa el código de producción

Los tres validadores (`validateRequired`, `validateAttributeValues`, `validateLinkedSelects`) son
**`private` de `ListingsService`**, que es un servicio de Nest con media docena de dependencias;
instanciarlo traería colas, Redis y Meilisearch a un script de lectura. Están **replicados campo
por campo**, cada uno citando su origen.

**El riesgo es real y queda anotado:** si alguien cambia el original y no la réplica, el recuento
deja de ser el verdadero. El propio informe lo imprime como aviso en cada corrida. Si M2 se
repitiera a menudo, la salida limpia sería extraer esos validadores a un módulo puro compartido
—como ya son `category.types.ts` o `bump-cooldown.ts`— pero eso es tocar producción, y M2 es
medición.

---

## El comando

```
pnpm --filter @marketplace/api gate-impact-report

# Contra otra base (producción, staging, una copia):
DATABASE_URL="postgresql://…" pnpm --filter @marketplace/api gate-impact-report
```

Vive en [`apps/api/src/commands/gate-impact-report.ts`](../apps/api/src/commands/gate-impact-report.ts),
junto a los demás comandos de diagnóstico y backfill (`reindex`, `geocode-backfill`,
`contact-reason-backfill`…), que es el molde del repo para scripts operativos.

**No es código de producción y no es la puerta.** Es un instrumento de medida; se puede borrar el
día que sobre sin que nada dependa de él.

Parámetros que se tocan en la cabecera del fichero: `TOPE_FOTOS` (hoy 15, el `@ArrayMaxSize` del
DTO) y `TOPES_TOTAL_CANDIDATOS` (hoy 5/10/20/50).

---

## Qué hace falta para que esto sirva de verdad

1. **Datos.** Producción, o una copia suya. Sin eso, cualquier corrida es una comprobación de que
   el instrumento funciona, no una medición.
2. **Fijar la definición de «total»** para la regla 4. Aquí se ha usado «todo menos ARCHIVED y
   SOLD» y se muestra en paralelo el criterio actual (solo ACTIVE) para poder comparar; si Ernest
   prefiere otra, es una línea del script.
3. **Volver a medir justo antes de encender cada regla**, no una vez y para siempre: el número
   cambia con el catálogo, y lo que decide la política es el número del día que se enciende.

## Lo que esta ráfaga NO ha hecho

No construye la puerta, no añade reglas, no toca ningún anuncio, ningún schema y ninguna
categoría. Las decisiones D2 (¿revalidar atributos?), D4 (¿a quién aplican las reglas nuevas?) y
D5 (grandfathering y mitigaciones) **siguen abiertas**, y hoy siguen sin poder decidirse con
datos.
