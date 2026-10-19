# SPEC 02 — Terreno con relieve y física del balón en pendientes

> **Status:** Aprobado
> **Depends on:** SPEC 01
> **Date:** 2026-10-19
> **Objective:** Reemplazar el suelo plano `y = 0` por un terreno con colinas y desniveles (malla de alturas) sobre el que el balón rebota con la normal, rueda cuesta abajo y se detiene solo cuando la pendiente lo permite, probado en el campo de prueba con un interruptor plano/relieve.

---

## Por qué existe este spec

Se quiere un primer hoyo de FootGolf muy cuidado y con relieve en todo el recorrido. Hoy el suelo es el plano `y = 0` en la simulación, en el render, en la sombra, en la cámara y en el paisaje. Meter el relieve junto con la copa, el par, el minimapa y los obstáculos haría un spec enorme donde lo más riesgoso (la física en pendientes) bloquearía todo lo demás.

Por eso el trabajo se divide en tres specs, cada uno verificable y funcional por sí solo:

1. **SPEC 02 (este):** terreno con relieve y su física, probado en el campo de prueba.
2. **SPEC 03:** el hoyo jugable de punta a punta (diseño, copa, par, conteo de golpes, minimapa, fuera de límites, tarjeta final).
3. **SPEC 04:** obstáculos con colisión (árboles y rocas con rebote), lago con penalización y bunkers.

### Decisiones ya tomadas para los specs siguientes

Se registran aquí para no perderlas. Cada uno se vuelve a abrir con `/spec`, donde se cierran los puntos pendientes.

**SPEC 03 — hoyo jugable**

- Hoyo **par 4 de ~280 m con dogleg suave**, con relieve moderado en todo el recorrido.
- Se apega al reglamento oficial de FootGolf (https://www.footgolf.sport/footgolf-rules/):
  - Copa de **50 a 52 cm de diámetro y mínimo 28 cm de profundidad** (regla 3-2-10). El balón es talla 5, con radio 0.11 m, igual que el actual.
  - El balón cuenta como embocado solo cuando **todo él está por debajo del borde del suelo**; si rebota y sale, no cuenta (3-3-3).
  - Par de 3 a 5 (1-1-1). Pateo fuera de límites: **+1 golpe y se repite desde el último punto** (3-2-14, 4-1-13).
  - Caja del tee de 2 m de fondo y mínimo 3 m de ancho (3-2-16). Green: zona marcada, o 3 m alrededor de la copa (3-2-8).
- **Selector de tipo de golpe** con las teclas Q/E: Potente (35 m/s), Largo (24 m/s), Corto (14 m/s) y Putt (7 m/s, rodado y sin elevación). Cada uno escala la barra de golpe y fija su elevación.
- Zonas del hoyo: fairway, rough, bunkers, fuera de límites (OB) y un **lago**. El lago es opcional por hoyo (no todos los hoyos lo llevan); este primero sí lo lleva.
- Minimapa del campo con la posición del balón y la de la copa. Pendientes de definir en su spec: orientación, tamaño y si se amplía.
- Conteo de golpes y par de campo. Pendientes de definir en su spec: tarjeta final, límite de golpes y guardado del mejor resultado.

**SPEC 04 — obstáculos con colisión**

- Árboles y rocas con colisión y rebote del balón; bunkers; lago con penalización. El procedimiento de la penalización de agua y el modelo de colisión de los árboles se definen en su spec.
- Hoy los árboles, la casa club y los postes del paisaje son solo visuales y el balón los atraviesa.

---

## Alcance

**Dentro:**

- Terreno como **malla de alturas** (`Terrain`) generada por código a partir de lomas y depresiones definidas como datos, con celda de 1 m, interpolación bicúbica y normal en cualquier punto.
- Relieve de prueba «moderado» en el campo actual: desnivel total de 11 m, pendientes del fairway hasta 6.8°, del rough hasta 17.1° y de la arena hasta 8.9°, con el tee plano. Eñ campo puede llegar  a tener lomas pequeñas, que no es el caso de un terreno de golf tradicional pero si de futgolf, lo que nos da la opcion de tener obstaculos o secciones del terreno con hasta 90° 
- Contacto del balón con el suelo según la altura y la normal del terreno (vuelo, rebote, rodadura, detención).
- Rebote con la normal del terreno: impacto con restitución y fricción de Coulomb, generalizado a una normal cualquiera.
- Rodadura en pendientes: aceleración por la gravedad tangencial, resistencia de rodadura, condición de reposo por pendiente y despegue en las cimas.
- Malla del terreno en pantalla, con color por superficie, normales suaves y bordes que enlazan con el suelo plano lejano.
- Balón, sombra, cámara y paisaje (árboles, casa club, postes y bandera) asentados sobre la altura del terreno.
- La vista previa del golpe y la traza siguen el terreno (ya usan la simulación).
- Altura máxima del HUD medida sobre el terreno.
- Interruptor plano/relieve en el panel de depuración.
- Pruebas unitarias de terreno y de física en pendientes.

**Fuera de alcance (para specs futuros):**

- Hoyo, copa, par, golpes, minimapa, fuera de límites y tarjeta (SPEC 03).
- Colisión con árboles, rocas y demás objetos; lago; bunkers como obstáculo con reglas (SPEC 04).
- Mapa de superficies en 2D por polígonos o máscara. Aquí las superficies siguen siendo las franjas por `z` del SPEC 01; el SPEC 03 las reemplaza por un mapa del hoyo.
- Elevación del golpe medida respecto a la pendiente. Aquí sigue medida respecto al horizonte, como en el SPEC 01.
- Cambios de relieve en caliente (edición del terreno) y exportar o importar mapas de alturas.
- Hierba, bordes, olas, texturas, normal map o cualquier mejora visual del suelo más allá del color por superficie.

---

## Modelo de datos

Convenciones (las del SPEC 01): SI, ejes de Three.js (`x` derecha, `y` arriba, `z` hacia la cámara), rumbo 0 hacia `-z`, paso fijo de `1/240 s` con RK4. Ahora la altura del suelo es `terrain.heightAt(x, z)` y ya no `0`. El balón toca el terreno cuando el centro está a un radio `r` de la superficie medido sobre la normal.

```ts
// src/physics/types.ts  (se agrega)
interface TerrainBounds { minX: number; maxX: number; minZ: number; maxZ: number }

interface Terrain {
  readonly bounds: TerrainBounds;
  heightAt(x: number, z: number): number;   // m; fuera de bounds vale 0
  normalAt(x: number, z: number): Vec3;     // unitaria, y > 0
  slopeDegAt(x: number, z: number): number; // ángulo con la horizontal, 0..90
}
```

```ts
// src/world/terrain.ts
interface HillDef {
  x: number; z: number;        // centro, m
  radiusX: number; radiusZ: number; // semiejes de la elipse, m
  height: number;              // m; negativo = depresión
  rotationDeg?: number;        // giro de la elipse sobre y; 0 si falta
}

interface FlatZone { x: number; z: number; radius: number; blend: number } // plano dentro de radius, sube suave en blend

interface TerrainDef {
  bounds: TerrainBounds;
  cell: number;        // m, separación de la malla de alturas (1)
  edgeFade: number;    // m, distancia en que el relieve baja a 0 en los bordes de bounds
  flatZones: FlatZone[];
  hills: HillDef[];
}

function buildTerrain(def: TerrainDef): Terrain;
const FLAT_TERRAIN: Terrain; // y = 0 en todas partes, normal (0,1,0)
```

Forma de una loma: `height · (1 − s²)²` con `s² = (u/radiusX)² + (v/radiusZ)²` si `s² < 1`, y 0 fuera (soporte compacto y continuidad en la pendiente). Las lomas se suman; la altura se multiplica por `smoothstep` de cada zona plana y del desvanecido del borde, y se muestrea en una cuadrícula de `cell` metros.

Relieve de prueba (valores iniciales, `src/world/testTerrain.ts`; se afinan al jugar):

```ts
const TEST_TERRAIN_DEF: TerrainDef = {
  bounds: { minX: -200, maxX: 200, minZ: -360, maxZ: 120 },
  cell: 1,
  edgeFade: 25,
  flatZones: [{ x: 0, z: 0, radius: 12, blend: 20 }], // el tee
  hills: [
    { x: -80, z: -70,  radiusX: 95, radiusZ: 80, height: 5 },                 // loma amplia en el fairway
    { x:  75, z: -100, radiusX: 90, radiusZ: 95, height: 7, rotationDeg: 20 }, // loma con la pendiente más fuerte del fairway
    { x:   0, z: -168, radiusX: 75, radiusZ: 45, height: -4 },                // valle en el rough
    { x: -35, z: -172, radiusX: 30, radiusZ: 28, height: 5 },                 // montículo empinado en el rough
    { x: -60, z: -240, radiusX: 70, radiusZ: 55, height: 4 },                 // loma en la arena
    { x:  90, z: -230, radiusX: 80, radiusZ: 70, height: 6 },                 // loma en la arena
  ],
};
```

Geometría de contacto: el terreno se trata, en cada contacto, como el plano tangente en el punto bajo el balón (válido porque el relieve es suave y las pendientes llegan a 20° como máximo). La distancia con signo es `d = (y − heightAt(x, z)) · n.y` y hay contacto cuando `d ≤ r`.

Constantes de rodadura (en `src/physics/simulation.ts`; las dos primeras ya existen):

- `ROLLING_THRESHOLD = 0.5` m/s: velocidad normal tras un rebote por debajo de la cual el balón pasa a rodar.
- `STOP_SPEED = 0.05` m/s: velocidad tangencial por debajo de la cual el balón puede detenerse.
- `TAKEOFF_THRESHOLD = 0.3` m/s (nueva): si al rodar la velocidad apunta hacia afuera de la nueva superficie más que esto, el balón despega.

Física en pendiente. Con `n` la normal, `g⃗ = (0, −g, 0)`, `f = momentOfInertiaFactor = 2/3`:

- Gravedad tangencial: `g_t = g⃗ − (g⃗·n) n`; su módulo es `g · sin θ`.
- Aceleración por pendiente al rodar sin deslizar: `a_pendiente = g_t / (1 + f)` (0.6 de la de un bloque que se desliza).
- Resistencia de rodadura: módulo `μr · g · cos θ`, opuesta a la velocidad tangencial.
- Reposo: el balón se detiene solo si `|a_pendiente| ≤ μr · g · cos θ`, es decir `tan θ ≤ μr · (1 + f)`. Ángulos de reposo: fairway 5.7°, rough 22.6°, arena 45°.
- Rebote: el SPEC 01 con la normal `n` en lugar de `ŷ` (restitución sobre `v·n`, impulso de fricción sobre el deslizamiento del punto de contacto, y el spin cambia en consecuencia).

Hay un archivo nuevo de pruebas por cada tema (`tests/terrain.test.ts` y `tests/slopes.test.ts`). `SimConfig` agrega `terrain: Terrain` (obligatorio).

Archivos (todos los que aparecen o cambian):

```text
src/physics/types.ts        // + TerrainBounds, Terrain
src/physics/simulation.ts   // contacto, rebote y rodadura con terreno; SimConfig.terrain
src/world/terrain.ts        // nuevo: buildTerrain, FLAT_TERRAIN
src/world/testTerrain.ts    // nuevo: TEST_TERRAIN_DEF
src/world/field.ts          // las franjas planas dejan de dibujarse como planos
src/world/scenery.ts        // árboles, casa, postes y bandera sobre heightAt
src/render/scene.ts         // malla del terreno, sombra sobre el terreno
src/game/gameLoop.ts        // terreno en config, balón sobre el suelo, cámara, apexHeight, setTerrain
src/ui/debugPanel.ts        // interruptor plano/relieve
tests/terrain.test.ts       // nuevo
tests/slopes.test.ts        // nuevo
tests/physics.test.ts       // los helpers reciben FLAT_TERRAIN
```

---

## Plan de implementación

1. En `src/physics/types.ts` agregar `TerrainBounds` y `Terrain`. Crear `src/world/terrain.ts` solo con `FLAT_TERRAIN`. Agregar `terrain` a `SimConfig` y pasar `FLAT_TERRAIN` en `gameLoop.ts` y en los helpers de `tests/physics.test.ts`. Sin cambio de comportamiento. Verificación: `npm test` pasa con las 65 pruebas actuales y el juego se ve y se juega igual.
2. Implementar `buildTerrain` en `terrain.ts`: lomas con soporte compacto, zonas planas, desvanecido de bordes, malla de alturas y `heightAt` bicúbica (Catmull-Rom), `normalAt` por diferencias centrales de 0.25 m y `slopeDegAt`. Crear `tests/terrain.test.ts` (valores en los nodos, continuidad, normal unitaria con `y > 0`, altura de una loma, bordes en 0). Verificación: `npm test` pasa.
3. Crear `src/world/testTerrain.ts` con `TEST_TERRAIN_DEF` y pruebas de sus límites (desnivel, pendientes por franja, tee plano, bordes en 0, tiempo de construcción). Todavía no se usa en el juego. Verificación: `npm test` pasa.
4. Contacto de vuelo con el terreno en `simulation.ts`: condición `(y − heightAt) · n.y ≤ r`, interpolación del instante de contacto y `simulateFlight` con el mismo criterio. Reemplazar `isGroundContact` por una versión que use la normal y no el signo de `v.y`. Crear `tests/slopes.test.ts` con un terreno analítico de plano inclinado (una implementación de `Terrain` en la prueba). Verificación: `npm test` pasa y con `FLAT_TERRAIN` los resultados son idénticos a los del SPEC 01.
5. Generalizar `applyBounce` a una normal cualquiera (restitución sobre `v·n`, fricción tangencial, spin) y su uso en el vuelo. Pruebas: el caso plano coincide con el del SPEC 01; en una pendiente de 20° el rebote sale por la normal y pierde energía. Verificación: `npm test` pasa.
6. Rodadura en pendientes en `simulation.ts`: gravedad tangencial con el factor `1/(1+f)`, resistencia `μr·g·cosθ`, condición de reposo, reinicio de la rodadura cuando la pendiente supera el ángulo de reposo y despegue por `TAKEOFF_THRESHOLD`. Pruebas con el plano inclinado y una cima. Verificación: `npm test` pasa y las pruebas de rodadura plana del SPEC 01 dan lo mismo.
7. Cambiar `config.terrain` a `buildTerrain(TEST_TERRAIN_DEF)` en `gameLoop.ts` y dibujar la malla en `scene.ts`: vértices cada 2 m muestreados del terreno, normales suaves, color por superficie según `surfaceAt(z)`, y planos planos de borde fuera de `bounds` en lugar de las tres franjas actuales. El balón arranca en `heightAt + r`, y al reiniciar con R vuelve a ese punto. Verificación: se ven las lomas y el balón rueda y se detiene sobre ellas sin flotar ni hundirse.
8. Asentar lo demás sobre el terreno: sombra pegada a la altura y a la normal del terreno, cámara a `heightAt + 1.6 m` bajo su propia posición para que nunca quede bajo el suelo, árboles, casa, postes y bandera del paisaje con base en `heightAt`, y altura máxima del HUD medida sobre el terreno. Verificación: la sombra sigue las lomas, la cámara no atraviesa el suelo y el paisaje no flota.
9. Agregar a `debugPanel.ts` el interruptor plano/relieve y `setTerrain` en `gameLoop.ts`: cambia `config.terrain`, reconstruye la malla en pantalla, reasienta el balón a `heightAt + r` y, si la pendiente supera el ángulo de reposo, lo deja en `rolling` con velocidad 0. Verificación: el mismo tiro cae en lugares distintos con relieve y con el campo plano.

---

## Criterios de aceptación

- [ ] `npm test` pasa con todas las pruebas, incluidas las 65 del SPEC 01 con `FLAT_TERRAIN`, y con resultados idénticos a los de antes en suelo plano.
- [ ] Con `FLAT_TERRAIN` el juego se comporta igual que antes de este spec (mismo alcance y mismo rebote para el mismo tiro).
- [ ] `heightAt` devuelve exactamente la altura de la malla en los nodos (error menor a 1e-9) y la normal es unitaria con `y > 0` en todo `bounds`.
- [ ] `heightAt` no tiene saltos: entre dos puntos separados 0.01 m la altura cambia menos de 0.01 m.
- [ ] Fuera de `bounds` la altura es 0 y la normal es `(0, 1, 0)`, y en los bordes de `bounds` la altura es 0.
- [ ] En `TEST_TERRAIN_DEF` el desnivel total (máxima menos mínima altura) es de 12 m o menos.
- [ ] En `TEST_TERRAIN_DEF` la pendiente máxima es de 8° en la franja de fairway, de 20° en la de rough y de 10° en la de arena.
- [ ] En `TEST_TERRAIN_DEF` la pendiente a menos de 8 m del tee es menor a 1° y la altura en el tee es 0.
- [ ] Construir `TEST_TERRAIN_DEF` tarda menos de 1 s.
- [ ] Prueba: un balón soltado desde 10 m sobre un plano inclinado de 20° toca el suelo en el instante esperado y su velocidad normal tras el rebote es `restitución · |v·n|` (error menor al 1 %).
- [ ] Prueba: en un rebote sobre una pendiente la energía total (traslación más rotación) tras el impacto es menor que antes.
- [ ] Prueba: un balón que rueda en un plano inclinado de 5° sobre arena acelera cuesta abajo con `g·sinθ/(1+f) − μr·g·cosθ` (error menor al 2 %).
- [ ] Prueba: un balón en reposo sobre fairway con 4° se queda detenido (`stopped`) y sobre fairway con 8° empieza a rodar y no se detiene hasta que la pendiente baja.
- [ ] Prueba: un balón en reposo sobre arena con 20° se queda detenido.
- [ ] Prueba: un balón que rueda sobre una cima convexa con suficiente velocidad despega (`flying`) y vuelve a tocar el suelo más adelante.
- [ ] Prueba: la energía mecánica (cinética, de rotación y potencial) de un balón que rueda cuesta abajo no aumenta de un paso al siguiente más allá de la tolerancia numérica.
- [ ] Prueba: la vista previa del golpe coincide con el vuelo real del mismo golpe en `TEST_TERRAIN_DEF` (a menos de 10 cm).
- [ ] La malla del terreno se ve en pantalla con las lomas y el valle, con los colores de césped, rough y arena en su franja, sin huecos ni escalones visibles con los planos de borde.
- [ ] Con el balón rodando o detenido sobre cualquier punto del campo, la distancia entre su centro y `heightAt + r` es de 2 cm o menos.
- [ ] La sombra del balón queda pegada al terreno y la cámara nunca queda bajo el suelo al pasar sobre una loma.
- [ ] Los árboles, la casa, los postes y la bandera tienen la base a 5 cm o menos de `heightAt`.
- [ ] La altura máxima del HUD se mide sobre el terreno bajo el balón y no sobre `y = 0`.
- [ ] El interruptor plano/relieve del panel de depuración hace que el mismo tiro aterrice en un lugar distinto, y con «plano» el resultado coincide con el del SPEC 01.
- [ ] Al cambiar el terreno con el balón detenido, el balón queda sobre la nueva superficie, y si la pendiente supera el ángulo de reposo empieza a rodar.
- [ ] El juego mantiene 60 fps o más en un navegador de escritorio moderno con la malla del terreno en pantalla.

---

## Decisiones tomadas y descartadas

- **Sí:** dividir el trabajo en 3 specs (relieve, hoyo jugable, obstáculos). El relieve cambia el contacto con el suelo en simulación, render y paisaje, y es lo más riesgoso. **No:** 2 specs con el relieve dentro del hoyo, porque dejaría la física en pendientes bloqueando la copa y el conteo de golpes.
- **Sí:** relieve en todo el hoyo, no solo en el green. Fue la elección del usuario, aun sabiendo que exige reescribir el contacto con el suelo.
- **Sí:** malla de alturas generada por código a partir de lomas y depresiones como datos. La altura y la normal salen de un solo lugar para física, render y minimapa. **No:** función analítica pura (difícil de diseñar a mano para un hoyo concreto). **No:** archivo de imagen o malla externa (agrega un flujo de trabajo aparte y binarios al repositorio).
- **Sí:** interpolación bicúbica (Catmull-Rom) con celda de 1 m. **No:** bilinear, porque sus normales saltan en cada celda y el balón vibraría al rodar y se verían facetas.
- **Sí:** lomas de soporte compacto con forma `h·(1 − s²)²`. Valen 0 fuera de su radio, son continuas en la pendiente y se suman sin efectos lejanos.
- **Sí:** relieve «moderado» (desnivel de 11 m, fairway hasta 6.8°, rough hasta 17.1°, arena hasta 8.9°, tee plano). **No:** «suave» (casi plano) ni «marcado» (el balón rodaría muy lejos y los tiros serían difíciles de predecir). Los valores se afinaron en un script para cumplir los límites.
- **Sí:** física completa en pendientes: rebote con la normal, rodadura con gravedad tangencial y reposo por ángulo. **No:** simplificada sin aceleración por la pendiente, porque los putts no «leerían» la inclinación.
- **Sí:** factor `1/(1 + f)` en la aceleración al rodar (`f = 2/3` del cascarón esférico). Una esfera que rueda sin deslizar acelera menos que un bloque que resbala.
- **Sí:** el ángulo de reposo es `tan θ = μr · (1 + f)`. En fairway da 5.7°, por lo que el fairway del campo de prueba (hasta 6.8°) tiene zonas donde el balón no se detiene; es un efecto buscado.
- **Sí:** tratar el terreno como el plano tangente en cada contacto. Es suficiente para pendientes de hasta 20° y radios de lomas de 28 m o más. **No:** colisión esfera-malla exacta, que es mucho más compleja y no se nota con este relieve.
- **Sí:** despegue en las cimas con `TAKEOFF_THRESHOLD = 0.3 m/s`. Sin él, el balón seguiría pegado al suelo al pasar por una cima convexa.
- **Sí:** la elevación del golpe sigue medida respecto al horizonte. Medirla respecto a la pendiente se deja para otro spec.
- **Sí:** las superficies siguen siendo franjas por `z`. El mapa de superficies en 2D llega con el hoyo del SPEC 03.
- **Sí:** malla en pantalla con vértices cada 2 m, muestreados de la malla de 1 m. Suficiente para el relieve y mantiene los 60 fps.
- **Sí:** el relieve baja a 0 en los bordes de `bounds` y fuera de ellos hay planos planos. Así la malla enlaza con el suelo lejano sin escalones.
- **Sí:** interruptor plano/relieve en el panel de depuración, para comparar el mismo tiro. **No:** campo con relieve únicamente.
- **Sí:** la altura máxima del HUD se mide sobre el terreno bajo el balón. Medirla contra `y = 0` daría valores sin sentido sobre una loma.
- **Sí:** los valores numéricos del relieve y de la física (lomas, `TAKEOFF_THRESHOLD`, radio de las zonas planas) son valores iniciales de afinación y no son parte del contrato salvo donde un criterio los cite.

---

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| El balón vibra o «camina» al rodar sobre la malla | Interpolación bicúbica con normales continuas; pruebas de distancia al suelo menor a 2 cm; condición de reposo explícita |
| El balón nunca se detiene en pendientes cercanas al ángulo de reposo (arrastre eterno) | Condición de reposo analítica `tan θ ≤ μr(1+f)`; el fairway de prueba solo supera el reposo en zonas puntuales; prueba de que se detiene bajo 4° |
| El balón atraviesa el terreno a 35 m/s | Paso de 1/240 s mueve el balón 0.15 m, menor que su radio de 0.11 m más la tolerancia de la pendiente; contacto con interpolación del instante; prueba de rebote en pendiente |
| Pendiente tratada como plano tangente falla en cambios bruscos (cimas agudas) | Lomas con radios de 28 m o más y pendiente máxima de 20°; criterio de despegue por velocidad normal |
| Más de 190 000 vértices de malla bajan los fps | Malla de render cada 2 m (unos 48 000 vértices) y una sola malla; criterio de 60 fps |
| Z-fighting entre la malla y los planos de borde | Planos de borde solo fuera de `bounds`, y bordes enlazados en altura 0 |
| La sombra o la cámara atraviesan el terreno al pasar por una loma | Sombra sobre `heightAt` y normal; cámara a `heightAt(x, z) + 1.6 m` bajo su propia posición |
| Cambiar de cuerpo celeste o de terreno deja al balón flotando o hundido | `setTerrain` reasienta el balón a `heightAt + r` y reevalúa si debe rodar |

---

## Lo que **no** está en este spec

- Hoyo, copa, par, golpes, minimapa, fuera de límites y tarjeta final (SPEC 03).
- Colisión con árboles, rocas y otros objetos, lago y bunkers como obstáculo (SPEC 04).
- Mapa de superficies en 2D (SPEC 03).
- Elevación del golpe respecto a la pendiente.
- Edición, importación o exportación del terreno.
- Texturas, hierba o cualquier mejora visual del suelo más allá del color por superficie.
- Persistencia de cualquier tipo, sonido, menús, táctil y multijugador (siguen fuera, como en el SPEC 01).

Cada uno de estos puntos, si se hace, va en su propio spec.
