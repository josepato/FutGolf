# SPEC 03 — El hoyo jugable: green, copa y conteo de golpes

> **Status:** Borrador (v2: lago en el hoyo y elevación fijada por tipo de golpe; puntos abiertos al final)
> **Depends on:** SPEC 01, SPEC 02
> **Date:** 2026-10-19
> **Objective:** Pasar del campo de prueba a un primer hoyo par 4 de ~280 m con dogleg suave, con tee, fairway, rough, bunkers, un lago, fuera de límites y un green con copa reglamentaria, donde el jugador puede terminar el hoyo embocando el balón, con conteo de golpes, penalización por fuera de límites y por agua, selector de tipo de golpe, minimapa y resultado final contra el par.

---

## Por qué existe este spec

Hasta el SPEC 02 el balón vuela, rebota y rueda sobre un terreno con relieve, pero no hay nada que jugar: no hay meta, no se cuentan golpes y las superficies son franjas por `z`. Este spec convierte el campo de prueba en un **hoyo de FootGolf completo y terminable**, apegado al reglamento oficial (https://www.footgolf.sport/footgolf-rules/), que es el primer momento en que el juego tiene un objetivo.

Retoma las decisiones que el SPEC 02 dejó registradas para este spec (confirmadas por el usuario) y cierra o propone los puntos que allí quedaron pendientes (ver «Puntos abiertos»). **Esta versión deja el lago en el hoyo 1**, como se decidió, y con eso la penalización de agua pasa a este spec; el SPEC 04 conserva los obstáculos con colisión y las reglas de bunker.

El campo de prueba del SPEC 02 **se conserva** como segundo campo seleccionable en el panel de depuración: sigue siendo la forma de comparar física plana contra relieve y de probar cambios sin jugar un hoyo entero.

---

## Alcance

**Dentro:**

- **Hoyo 1**: par 4 de ~280 m con dogleg suave a la derecha, definido como datos (`HoleDef`). El lago es opcional por hoyo (`lakes` puede ir vacío); el Hoyo 1 sí lo lleva.
- **Mapa de superficies en 2D** `surfaceAt(x, z)` que reemplaza las franjas por `z` en el hoyo: tee, fairway, rough, green, bunker, agua y fuera de límites (OB).
- **Lago** con su física (el balón que cae al agua se frena casi en seco) y penalización de +1 golpe, repitiendo desde el último punto de golpeo.
- **Caja del tee** dibujada (2 m de fondo por 3 m de ancho, reglamento 3-2-16), con el balón colocado dentro.
- **Terreno del hoyo** (`HOLE_TERRAIN_DEF`) con relieve moderado en todo el recorrido, tee plano y green con pendientes suaves para poder leer los putts.
- **Green**: superficie nueva `green` (rueda más rápido que el fairway), de ~14 m de radio alrededor de la copa.
- **Copa reglamentaria**: 51 cm de diámetro y 28 cm de profundidad; el balón cuenta como embocado solo cuando **todo él está por debajo del borde del suelo**; si rebota y sale, no cuenta.
- **Bandera** en la copa (reemplaza la del paisaje de prueba).
- **Conteo de golpes** y **par** del hoyo, visibles en el HUD.
- **Fuera de límites**: +1 golpe y se repite desde el último punto de golpeo.
- **Selector de tipo de golpe** con Q/E: Potente (35 m/s), Largo (24 m/s), Corto (14 m/s) y Putt (7 m/s, rodado y sin elevación). Cada tipo escala la barra de golpe y **fija su elevación**.
- **Minimapa** del hoyo con superficies, copa y balón.
- **Fin de hoyo**: pantalla de resultado (golpes, par, nombre del resultado) y reinicio del hoyo.
- **Selector de campo** en el panel de depuración: Hoyo 1 / Campo de prueba.
- Pruebas unitarias de la copa, el mapa de superficies, las reglas de golpes y el terreno del hoyo.

**Fuera de alcance (para specs futuros):**

- Colisión con árboles, rocas y otros objetos (SPEC 04). Los árboles siguen siendo solo visuales.
- Reglas especiales de bunker (SPEC 04). Aquí el bunker es solo una zona de arena con su física.
- Opciones de penalización de agua más allá de repetir el golpe (por ejemplo, dropear en el punto de entrada): se deja para otro spec.
- Varios hoyos, tarjeta de 9 o 18 hoyos, selección de hoyo.
- Guardado del mejor resultado o de cualquier dato (sigue sin haber persistencia).
- Minimapa ampliable, rotación del minimapa y marcado de distancias.
- Putt con ayuda de lectura del green más allá de las curvas y flechas ya existentes.
- Sonido, menús, táctil y multijugador.
- Editor de hoyos o carga de hoyos desde archivo.

---

## Modelo de datos

Convenciones (las de los SPEC 01 y 02): SI, ejes de Three.js (`x` derecha, `y` arriba, `z` hacia la cámara), rumbo 0 hacia `-z`, paso fijo de `1/240 s`. El balón es talla 5, radio `r = 0.11 m`.

### Superficies

Se agregan las superficies `green` y `water` a `SurfaceId` y `SURFACES` (valores iniciales de afinación):

```ts
green: { id: 'green', restitution: 0.6, slidingFriction: 0.3, rollingResistance: 0.035 },
water: { id: 'water', restitution: 0.05, slidingFriction: 1.0, rollingResistance: 1.5 },
```

El agua se trata como una superficie física muy absorbente: el balón apenas rebota y se frena en menos de un metro, así que "se hunde" sin simular fluidos. Quedar detenido sobre `water` es lo que dispara la penalización.

Ángulo de reposo en el green: `tan θ = μr · (1 + f) = 0.035 · 1.667`, es decir 3.3°. Por eso el green nunca debe pasar de ~3° de pendiente (un balón en una pendiente mayor no se detiene).

El fuera de límites (`ob`) **no es una superficie física**: el balón rueda y rebota sobre rough, y la zona OB solo decide la penalización. Se modela aparte, no como `SurfaceId`.

### Hoyo

```ts
// src/world/hole.ts
interface Vec2 { x: number; z: number }

interface Cup {
  position: Vec2;
  radius: number;   // 0.255 m (diámetro 51 cm; reglamento: 50 a 52 cm)
  depth: number;    // 0.28 m (reglamento: mínimo 28 cm)
}

interface Ellipse { x: number; z: number; radiusX: number; radiusZ: number; rotationDeg?: number }

interface HoleDef {
  name: string;
  par: number;                 // 3 a 5
  tee: Vec2;                   // punto de patada inicial
  teeHeadingDeg: number;       // rumbo inicial hacia el hoyo
  centerline: Vec2[];          // línea de juego, del tee al centro del green
  fairwayHalfWidth: number;    // m a cada lado de la línea de juego
  roughHalfWidth: number;      // m; más allá empieza OB
  green: { center: Vec2; radius: number };
  cup: Cup;
  bunkers: Ellipse[];
  lakes: Ellipse[];            // vacío si el hoyo no lleva lago
  terrain: TerrainDef;         // relieve del hoyo (SPEC 02)
}

interface HoleMap {
  surfaceAt(x: number, z: number): SurfaceId;  // 'fairway' | 'rough' | 'sand' | 'green' | 'water'
  isOutOfBounds(x: number, z: number): boolean;
  distanceToCup(x: number, z: number): number;
}

function buildHole(def: HoleDef): { def: HoleDef; terrain: Terrain; map: HoleMap };
```

Prioridad de `surfaceAt`: green (dentro de su radio) > agua (dentro de algún lago) > bunker (dentro de alguna elipse) > fairway (a menos de `fairwayHalfWidth` de la línea de juego) > rough. `isOutOfBounds` es verdadero a más de `roughHalfWidth` de la línea de juego y no dentro del green.

### Hoyo 1 (valores iniciales de afinación)

```ts
const HOLE_1: HoleDef = {
  name: 'Hoyo 1',
  par: 4,
  tee: { x: 0, z: 0 },
  teeHeadingDeg: 0,
  // Tramo recto de 160 m y codo a la derecha de ~40° hacia el green (117 m): ~277 m en total.
  centerline: [{ x: 0, z: 0 }, { x: 0, z: -160 }, { x: 75, z: -250 }],
  fairwayHalfWidth: 20,
  roughHalfWidth: 45,
  green: { center: { x: 75, z: -250 }, radius: 14 },
  cup: { position: { x: 75, z: -250 }, radius: 0.255, depth: 0.28 },
  bunkers: [
    { x: -14, z: -150, radiusX: 9, radiusZ: 16 },              // bunker de la zona de caída, lado interior
    { x: 62, z: -246, radiusX: 7, radiusZ: 5, rotationDeg: 30 }, // bunker de green, izquierda
    { x: 90, z: -258, radiusX: 8, radiusZ: 5, rotationDeg: -20 }, // bunker de green, derecha
  ],
  // Lago al lado izquierdo de la aproximación (centro a ~27 m de la línea de juego, borde más cercano a ~16 m), que obliga a
  // decidir entre arriesgar sobre el agua o ir por el lado derecho del green.
  lakes: [{ x: 28, z: -236, radiusX: 11, radiusZ: 14, rotationDeg: 20 }],
  terrain: HOLE_1_TERRAIN_DEF,
};
```

El relieve (`HOLE_1_TERRAIN_DEF`, en `src/world/hole1.ts`) usa `TerrainDef` del SPEC 02 con celda de 1 m, tee plano, una depresión de ~0.8 m bajo el lago (para que se vea hundido), desnivel total de 12 m o menos y pendientes de fairway de 6° o menos y de rough de 15° o menos (más suaves que el campo de prueba, que busca estresar la física). El green va **plano en 3 m alrededor de la copa** (`FlatZone` de radio 3 m y mezcla de 4 m, por la zona reglamentaria de 3 m) y con pendiente de 3° o menos en todo su radio, con una caída suave (~1.5° a 2.5°) para que los putts se lean.

El campo de prueba del SPEC 02 se envuelve como un `HoleDef` degenerado solo para poder elegirlo en el mismo selector, o se mantiene como una segunda entrada del selector de campo (se decide en la implementación; ver el plan).

### Copa y embocado

La copa es un cilindro vertical hundido en el terreno, centrado en `cup.position`. Modelo de contacto (la copa es una discontinuidad de la altura y se trata aparte del terreno suave del SPEC 02):

- Sea `d` la distancia horizontal del centro del balón al centro de la copa y `R = cup.radius`, `r = 0.11`.
- **Fuera de la copa** (`d ≥ R + r`): el suelo es el terreno normal.
- **Sobre el borde** (`R − r < d < R + r`): el balón se apoya en el aro de la copa. La altura de su centro sobre el plano del borde es `sqrt(r² − (d − R)²)`, y la normal de contacto apunta del punto del aro al centro del balón. Es la geometría de una esfera sobre un círculo.
- **Sobre el hueco** (`d ≤ R − r`): no hay suelo hasta el fondo, a `cup.depth` por debajo del borde. El balón cae.
- **Dentro** (centro del balón por debajo de `heightAt − r`, es decir, toda la esfera bajo el plano del borde): el balón queda **embocado** (`holed`) en cuanto su altura cae por debajo de ese plano y su centro sigue a `d ≤ R − r`. No hay forma de salir después: el balón se detiene al fondo.

Si el balón pasa deprisa sobre la copa, el modelo del aro lo deja pasar o lo rebota (no cae si no tiene tiempo de bajar): el efecto de que un putt rápido «salta» la copa sale del propio modelo sin una regla de velocidad aparte. Se verifica con pruebas (ver criterios).

`SimConfig` agrega `cup?: Cup` (opcional; sin copa, como el campo de prueba, no hay embocado) y `surfaceAt: (x, z) => SurfaceId` en lugar de la búsqueda por `z`. El estado del balón agrega `holed` a `flying | rolling | stopped`.

### Tipos de golpe

Selector con Q/E (anterior/siguiente). Cada tipo fija la **velocidad máxima** y la **elevación**; la barra de golpe de 3 clics sigue escalando la velocidad desde 0 hasta la máxima del tipo según el poder, y la precisión sigue desviando el rumbo como en el SPEC 01:

| Tipo | Velocidad máx. | Elevación (valor inicial) | Uso |
| --- | --- | --- | --- |
| Potente | 35 m/s | 15° | salida desde el tee |
| Largo | 24 m/s | 25° | segundo golpe largo |
| Corto | 14 m/s | 40° | aproximación y sobre agua o bunker |
| Putt | 7 m/s | 0° | en el green; rodado |

Las velocidades y que cada tipo fija su elevación están decididas; los grados de cada elevación son valores iniciales de afinación. **Cambio respecto al SPEC 01:** la elevación deja de salir del punto de contacto vertical (`elevationDeg(contactY)`) y la fija el tipo de golpe. El selector de punto de contacto sigue controlando el spin (backspin o topspin con la `y`, efecto lateral con la `x`), pero no la elevación; en Putt no hay spin (golpe rodado). El tipo de golpe elegido, su velocidad máxima y su elevación se muestran en el HUD, y el selector de contacto deja de mostrar la elevación.

### Reglas de golpes

Estado de juego (en `src/game/holeRules.ts`, puro y sin Three.js ni DOM para probarlo):

```ts
interface HoleState {
  strokes: number;          // golpes contados, con penalizaciones
  lastRest: Vec3;           // último punto de golpeo (donde está el balón antes de golpear)
  status: 'playing' | 'holed';
  lastEvent: 'none' | 'ob' | 'water' | 'holed';
}
```

- Cada golpe lanzado suma 1 a `strokes`. `lastRest` se guarda justo antes de lanzar.
- Si el balón se detiene en OB (`isOutOfBounds(x, z)` verdadero al pasar a `stopped`): `strokes += 1` y el balón vuelve a `lastRest` (reglamento 3-2-14 y 4-1-13: +1 y se repite desde el último punto).
- Si el balón se detiene sobre `water` (`surfaceAt` devuelve `water`): `strokes += 1` y el balón vuelve a `lastRest`, igual que en OB. El agua frena al balón en menos de un metro, así que se evalúa al detenerse sin reglas aparte.
- Si el balón queda `holed`: `status = 'holed'` y termina el hoyo. El embocado se confirma cuando el balón deja de moverse dentro de la copa.
- El resultado se nombra por diferencia con el par: −3 albatros, −2 eagle, −1 birdie, 0 par, +1 bogey, +2 doble bogey, otra diferencia: «+N».
- Con 1 golpe, siempre «Hoyo en uno».

El `lastRest` y las penalizaciones (OB y agua) se evalúan solo cuando el balón queda `stopped` (no mientras vuela o rueda), para que un balón que cruza OB y regresa por rodadura no sea penalizado. Un balón que vuela sobre el lago sin tocarlo no recibe penalización.

### Minimapa

Canvas 2D de ~180 × 220 px. Muestra la vista cenital del hoyo con las superficies (colores como en el 3D, el lago en azul), el OB como zona oscura, la copa con una banderita, el balón como un punto y la línea de la dirección de golpe. Orientación fija con el tee abajo y el green arriba (el hoyo se encaja en el recuadro con un margen). Se dibuja sobre un canvas fuera de pantalla una vez y solo se repinta el balón y la línea de dirección. Se ubica en la esquina inferior izquierda arriba del selector de contacto; si estorba, se mueve en la implementación.

### Pantalla de fin de hoyo

Al `holed`: panel centrado con «Hoyo 1 · Par 4», los golpes, el nombre del resultado («Birdie», «Par», etc.) y la indicación «R o Enter: jugar de nuevo». R reinicia el hoyo en cualquier momento (golpes a 0, balón en el tee); es la misma tecla que ya regresa el balón al origen en el SPEC 01, que ahora además pone `strokes` a 0.

### Archivos

```text
src/physics/types.ts        // + 'green' y 'water' en SurfaceId; Cup; estado 'holed'; SimConfig.cup y surfaceAt
src/physics/surfaces.ts     // + superficies green y water
src/physics/simulation.ts   // contacto con la copa, estado holed, surfaceAt(x, z) en lugar de por z
src/world/hole.ts           // nuevo: HoleDef, buildHole, mapa de superficies, OB
src/world/hole1.ts          // nuevo: HOLE_1 y HOLE_1_TERRAIN_DEF
src/world/field.ts          // las franjas pasan a ser el mapa del campo de prueba
src/world/scenery.ts        // corredor de juego y bandera siguen el hoyo activo
src/render/scene.ts         // color por surfaceAt(x, z); copa y bandera; bunkers, lago y OB; caja del tee
src/game/holeRules.ts       // nuevo: HoleState, golpes, OB y agua, resultado
src/game/shot.ts            // tipos de golpe (velocidad máxima y elevación fijas por tipo)
src/game/gameLoop.ts        // reglas de hoyo, selector de golpe, reinicio, cambio de campo
src/ui/hud.ts               // golpes, par, tipo de golpe
src/ui/contactSelector.ts   // deja de mostrar la elevación (la fija el tipo de golpe)
src/ui/minimap.ts           // nuevo
src/ui/holeResult.ts        // nuevo: pantalla de fin de hoyo
src/ui/debugPanel.ts        // selector de campo
tests/hole.test.ts          // nuevo: mapa de superficies, OB, terreno del hoyo
tests/cup.test.ts           // nuevo: contacto y embocado
tests/holeRules.test.ts     // nuevo: golpes, penalización, resultado
tests/shotTypes.test.ts     // nuevo
```

---

## Plan de implementación

1. **Superficies `green` y `water` y `surfaceAt(x, z)`.** Agregar `green` y `water` a `SurfaceId` y `SURFACES`. Cambiar la búsqueda de superficie de `surfaceTypeAt(position)` por `SimConfig.surfaceAt(x, z)` y pasar en el campo de prueba una función equivalente a las franjas por `z`. Sin cambio de comportamiento. Verificación: `npm test` pasa con todas las pruebas y el juego se juega igual.
2. **`HoleDef`, `buildHole` y el mapa de superficies.** Crear `src/world/hole.ts` con prioridades green > agua > bunker > fairway > rough, distancia a la polilínea y `isOutOfBounds`. Pruebas en `tests/hole.test.ts` (puntos conocidos del Hoyo 1 en cada zona, OB, agua, simetría respecto a la línea de juego). Verificación: `npm test` pasa.
3. **Terreno del Hoyo 1.** Crear `src/world/hole1.ts` con `HOLE_1` y `HOLE_1_TERRAIN_DEF` y pruebas de sus límites (desnivel, pendientes por zona, tee plano, plano en 3 m alrededor de la copa, pendiente máxima del green, depresión bajo el lago, tiempo de construcción). Todavía no se usa en el juego. Verificación: `npm test` pasa.
4. **Copa en la simulación.** Contacto con el aro, caída al hueco y estado `holed` en `simulation.ts` (con `SimConfig.cup` opcional). Pruebas en `tests/cup.test.ts`: un putt lento centrado emboca, uno rápido salta la copa, uno que roza el aro sale, un balón por el borde cae o gira según el caso, y con `cup` ausente no cambia nada. Verificación: `npm test` pasa y con `cup` ausente los resultados son idénticos a los del SPEC 02.
5. **Reglas de golpes.** Crear `src/game/holeRules.ts` con golpes, `lastRest`, penalización por OB y por agua y nombre del resultado, puro y sin DOM. Pruebas en `tests/holeRules.test.ts`. Verificación: `npm test` pasa.
6. **Tipos de golpe.** En `src/game/shot.ts` agregar los cuatro tipos con velocidad máxima y elevación, y que `computeShot` los use. Selector Q/E en `gameLoop.ts`. Quitar la elevación del selector de contacto y ajustar las pruebas del SPEC 01 que la usan. Pruebas en `tests/shotTypes.test.ts` (velocidad y elevación iniciales por tipo, putt sin elevación ni spin). Verificación: `npm test` pasa y con «Potente» y poder 100 % la velocidad inicial es 35 m/s.
7. **Hoyo en pantalla.** Selector de campo en `debugPanel.ts` y `setField` en `gameLoop.ts` (terreno, mapa de superficies, copa y reglas). Color por `surfaceAt(x, z)` en la malla, copa y bandera dibujadas, bunkers, lago y OB visibles, caja del tee dibujada, corredor de juego del paisaje siguiendo la línea del hoyo, árboles fuera del corredor. El balón arranca en el tee del hoyo. Verificación: se ve el hoyo completo desde el tee, con dogleg, green, bunkers y lago, y los dos campos son seleccionables.
8. **Juego completo.** Integrar las reglas en el bucle: contar golpes al lanzar, evaluar OB y agua al detenerse y repetir, detectar `holed` y terminar el hoyo. HUD con golpes, par y tipo de golpe. Verificación: se puede jugar un hoyo de punta a punta, incluyendo un tiro fuera de límites, uno al agua y un embocado.
9. **Minimapa y pantalla de resultado.** `src/ui/minimap.ts` y `src/ui/holeResult.ts`; R reinicia el hoyo. Verificación: el minimapa sigue al balón y marca la copa; al embocar aparece el resultado y R reinicia.
10. **Afinación.** Jugar el hoyo varias veces con distintos tipos de golpe y ajustar la longitud, el ancho, el relieve del green y la velocidad del green hasta que los putts se lean y el par 4 sea alcanzable pero no trivial. Verificación: criterios de jugabilidad de abajo.

---

## Criterios de aceptación

- [ ] `npm test` pasa con todas las pruebas existentes (SPEC 01 y 02), salvo las que dependían de la elevación por punto de contacto, que se actualizan por el cambio de tipos de golpe, y con resultados idénticos de la simulación en el campo de prueba y con `FLAT_TERRAIN`.
- [ ] Con `cup` ausente, el comportamiento de la simulación es idéntico al del SPEC 02.
- [ ] `surfaceAt(x, z)` devuelve `green` dentro del radio del green, `water` dentro del lago, `sand` dentro de un bunker, `fairway` a 20 m o menos de la línea de juego y `rough` entre 20 y 45 m; y `isOutOfBounds` es verdadero a más de 45 m de la línea de juego fuera del green (pruebas con puntos concretos).
- [ ] La línea de juego del Hoyo 1 mide entre 270 y 290 m del tee al centro del green.
- [ ] El giro del dogleg es de entre 30° y 50° hacia la derecha.
- [ ] En `HOLE_1_TERRAIN_DEF` el desnivel total es de 12 m o menos, la pendiente máxima en fairway es de 6° o menos y en rough de 15° o menos.
- [ ] En el Hoyo 1 el tee es plano (pendiente menor a 1° a menos de 8 m) y a altura 0.
- [ ] En el Hoyo 1 el terreno es plano (menos de 1°) en 3 m alrededor de la copa y la pendiente en todo el green es de 3° o menos.
- [ ] Construir el hoyo (terreno incluido) tarda menos de 1 s.
- [ ] La copa mide 0.255 m de radio y 0.28 m de profundidad.
- [ ] Prueba: un balón que rueda a 0.5 m/s y pasa por el centro de la copa queda `holed`.
- [ ] Prueba: un balón que rueda a 7 m/s por el centro de la copa no queda `holed` (la salta o rebota).
- [ ] Prueba: un balón que pasa rozando el borde, con el centro a más de `R + r` del centro de la copa, no queda `holed` y su trayectoria no cambia.
- [ ] Prueba: un balón que cae al hueco no sale de la copa (la altura de su centro nunca supera el plano del borde después de quedar `holed`).
- [ ] Prueba: `holed` solo ocurre cuando todo el balón está por debajo del plano del borde.
- [ ] Prueba: un putt de 2 m en el green llano y recto, con la velocidad justa, emboca; con la mitad de esa velocidad no llega, y con el doble pasa de largo.
- [ ] El lago del Hoyo 1 queda a 15 m o más de la línea de juego en su punto más cercano, a 30 m o más del centro del green y por completo dentro del rough (a menos de 45 m de la línea de juego), y no cubre el tee ni la copa.
- [ ] Prueba: un balón que cae en el lago frena en menos de 1.5 m y queda `stopped` sobre `water`.
- [ ] Prueba: un balón que se detiene sobre `water` suma 1 golpe de penalización y vuelve al último punto de golpeo; uno que vuela sobre el lago sin tocarlo no es penalizado.
- [ ] Prueba: el conteo de golpes suma 1 por golpe lanzado.
- [ ] Prueba: un balón que se detiene en OB suma 1 golpe de penalización y vuelve al último punto de golpeo; un balón que cruza OB rodando y regresa a la zona de juego no es penalizado.
- [ ] Prueba: el resultado se nombra bien para −3, −2, −1, 0, +1, +2 y +4 respecto al par, y «Hoyo en uno» con 1 golpe.
- [ ] Prueba: las velocidades iniciales de Potente, Largo, Corto y Putt con poder 100 % y precisión 100 % son 35, 24, 14 y 7 m/s.
- [ ] Prueba: Putt tiene elevación 0° y sin backspin, aunque el selector de contacto marque otra cosa.
- [ ] Prueba: la elevación inicial de Potente, Largo y Corto es la de su tipo (15°, 25° y 40°) sin importar el punto de contacto vertical, que solo cambia el backspin.
- [ ] Se puede jugar un hoyo de punta a punta con el selector de golpe, el minimapa y el contador de golpes, con penalización al caer en el agua o salir de límites, y al embocar aparece la pantalla de resultado con golpes, par y nombre del resultado.
- [ ] R reinicia el hoyo (golpes a 0, balón en el tee, tipo de golpe en Potente) y quita la pantalla de resultado.
- [ ] El selector de campo cambia entre Hoyo 1 y el campo de prueba sin recargar la página, y el campo de prueba sigue sin copa ni conteo de golpes.
- [ ] El minimapa muestra el hoyo completo con las superficies, la copa y la posición del balón, y el balón se mueve en él al jugar.
- [ ] La copa y la bandera se dibujan en la posición de la copa, a 5 cm o menos de `heightAt` en su base, y el balón embocado se ve dentro de la copa.
- [ ] El lago se ve en azul en la malla y en el minimapa, hundido respecto al terreno de alrededor, y la caja del tee (2 m × 3 m) se ve dibujada con el balón dentro.
- [ ] Los árboles no quedan en el corredor de juego del hoyo (a menos de `fairwayHalfWidth` de la línea de juego).
- [ ] El juego mantiene 60 fps o más con el Hoyo 1 en pantalla.
- [ ] Jugabilidad: un par 4 es alcanzable en 4 golpes con Potente + Largo + Corto + Putt sin precisión perfecta, y no en 2 golpes desde el tee (verificado jugando).

---

## Decisiones tomadas y descartadas

- **Sí:** un solo hoyo bien terminado antes que varios. Cada hoyo adicional es solo datos (`HoleDef`) una vez que existe el motor. **No:** tarjeta de 9 o 18 hoyos en este spec.
- **Sí:** par 4 de ~280 m con dogleg suave y relieve moderado en todo el recorrido (decisión del SPEC 02).
- **Sí:** copa de 51 cm de diámetro y 28 cm de profundidad, y embocado solo con todo el balón bajo el borde (reglamento 3-2-10 y 3-3-3).
- **Sí:** copa modelada como un aro y un hueco, con el contacto esfera-círculo. El «saltar la copa» sale solo de la geometría. **No:** una regla de velocidad máxima de captura, que sería una constante arbitraria y no se parecería a un balón real (rodar a 7 m/s no cae, aunque pase por el centro).
- **Sí:** el balón embocado ya no sale. Se detiene al fondo y termina el hoyo. **No:** simular el rebote en el fondo de la copa (no aporta al juego).
- **Sí:** el green es plano en 3 m alrededor de la copa (reglamento 3-2-8, zona de 3 m) y tiene como máximo 3° de pendiente en todo su radio, por debajo del ángulo de reposo del green (3.3°).
- **Sí:** superficie `green` nueva, con menos resistencia de rodadura que el fairway. **No:** reutilizar `fairway` para el green: los putts rodarían demasiado poco para leerse.
- **Sí:** el mapa de superficies se define por reglas geométricas (distancia a la línea de juego, elipses de bunker, círculo del green). **No:** máscara en imagen ni polígonos dibujados a mano: más difíciles de cambiar y de probar.
- **Sí:** OB no es una superficie física, solo una zona que decide la penalización, evaluada cuando el balón queda detenido. **No:** penalizar en cuanto cruza el límite, porque un balón que cruza y regresa rodando sería castigado injustamente.
- **Sí:** OB penaliza con +1 golpe y se repite desde el último punto de golpeo (reglamento 3-2-14 y 4-1-13).
- **Sí:** selector Q/E con cuatro tipos de golpe (Potente 35, Largo 24, Corto 14, Putt 7 m/s), decisión del SPEC 02. Cada tipo fija también su elevación; el selector de punto de contacto manda solo en el spin (y no cuenta en Putt).
- **Sí:** el hoyo 1 lleva un lago (decisión del usuario); el lago es opcional por hoyo (`lakes` puede ir vacío). El SPEC 02 dejaba la penalización de agua al SPEC 04; pasa a este spec porque el lago ya está en el hoyo.
- **Sí:** el agua es una superficie física muy absorbente (`water`) y la penalización se evalúa al quedar detenido, igual que OB: +1 golpe y se repite desde el último punto de golpeo. **No:** simular fluidos ni rebotes en el agua. **No:** dropear en el punto de entrada (más reglas y más interfaz; se deja para otro spec).
- **Sí:** la elevación la fija el tipo de golpe y el selector de contacto solo controla el spin (decisión del usuario: «cada uno escala la barra de golpe y fija su elevación»). **No:** dejar que el contacto siga cambiando la elevación: dos controles pelearían por la misma variable.
- **Sí:** el campo de prueba del SPEC 02 se conserva con su selector. Es la herramienta de comparación y de pruebas, no se retira.
- **Sí:** minimapa de orientación fija y tamaño fijo; sin ampliación ni rotación. **No:** hacerlo ampliable en este spec (queda como mejora).
- **Sí:** las constantes numéricas de este spec (geometría del hoyo, relieve, bunkers, velocidades de golpe, `SURFACES.green`) son valores iniciales de afinación y no son parte del contrato salvo donde un criterio los cite.

---

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| El modelo del aro hace que la copa sea imposible o demasiado fácil | Pruebas de velocidad (0.5 m/s emboca, 7 m/s salta) y de putt de 2 m; afinación jugando en el paso 10; el radio de la copa sigue el reglamento y no se toca |
| El balón se queda en el borde del aro y no cae ni sale (equilibrio inestable) | La normal del aro empuja al balón hacia fuera o hacia dentro según la posición; prueba de balón detenido sobre el aro; si ocurre, se resuelve con un empujón mínimo hacia el hueco al quedar a `d < R` y velocidad casi cero |
| La discontinuidad de la copa desestabiliza el paso fijo (balón rápido pasa «a través» del hueco) | A 7 m/s el balón avanza 0.03 m por paso y el hueco mide 0.51 m; contacto con interpolación del instante del SPEC 02; prueba de balón rápido |
| Green con pendiente demasiado fuerte: los putts no se detienen | Límite de 3° y prueba de que un balón detenido en cualquier punto del green se mantiene `stopped` |
| El OB castiga un balón que sale al rough y regresa | Evaluar OB solo al quedar `stopped`; prueba específica |
| 280 m puede ser demasiado largo con los tipos de golpe (el máximo de Potente a 15° vuela menos de lo que parece, aun con rodadura) | Paso de afinación (10): ajustar la longitud, las elevaciones y la resistencia del fairway; el criterio de jugabilidad manda sobre los 280 m |
| El lago desbalancea el hoyo o no se puede evitar | Lago a un lado, a 15 m o más de la línea de juego, con el lado derecho del green libre |
| Hoyo demasiado difícil o fácil | Paso de afinación jugable (10) y criterio de jugabilidad explícito; los números del hoyo no son contrato |
| Minimapa roba atención o tapa controles | Tamaño fijo y pequeño, ubicación ajustable en la implementación |
| El conteo de golpes y las reglas se mezclan con el bucle de juego y no se pueden probar | `holeRules.ts` puro, sin Three.js ni DOM, con pruebas propias |

---

## Puntos abiertos (a cerrar antes de aprobar)

**Ya cerrados con las notas del usuario (v2):** el lago va en el hoyo 1 y es opcional por hoyo; la barra de golpe escala la velocidad máxima de cada tipo y cada tipo fija su elevación; la caja del tee del reglamento se incluye (dibujada).

1. **Penalización de agua:** propuesta +1 golpe y repetir desde el último punto (igual que OB). El reglamento oficial también admite dropear cerca del punto de entrada. ¿Basta con repetir?
2. **Elevaciones por tipo:** propuesta Potente 15°, Largo 25°, Corto 40° y Putt 0° (se afinan jugando). ¿Tienes grados en mente?
3. **Límite de golpes:** ¿hay un máximo por hoyo (por ejemplo 10) tras el cual se recoge el balón, o se juega sin límite? Propuesta: sin límite en este spec.
4. **Tarjeta final y mejor resultado:** aquí solo hay un hoyo con su pantalla de resultado. Guardar el mejor resultado requiere persistencia, que hoy no existe. Propuesta: dejarlo para después.
5. **Minimapa:** propuesta esquina inferior izquierda, 180 × 220 px y orientación fija, sin ampliar. ¿Prefieres que gire con el rumbo de golpe o que se amplíe al hacer clic?
6. **Reglas de bunker:** propuesta tratarlas en el SPEC 04; aquí el bunker es solo arena con su física.

---

## Lo que **no** está en este spec

- Colisión con árboles, rocas y demás objetos (SPEC 04).
- Reglas especiales de bunker y otras opciones de penalización de agua (SPEC 04 o posterior).
- Varios hoyos, tarjeta de varios hoyos y selección de hoyo.
- Guardado de resultados o de cualquier dato.
- Minimapa ampliable o rotatorio y marcado de distancias.
- Editor de hoyos o carga de hoyos desde archivos.
- Sonido, menús, táctil y multijugador (siguen fuera, como en el SPEC 01 y 02).

Cada uno de estos puntos, si se hace, va en su propio spec.
