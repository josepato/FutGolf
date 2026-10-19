# SPEC 01 — Física del balón y golpe con barra en un campo de prueba

> **Status:** Aprobado
> **Depends on:** Ninguna (primer spec del proyecto)
> **Date:** 2026-10-14
> **Objective:** Construir en el navegador un campo de prueba 3D donde el jugador apunta, elige el punto de contacto en el balón, golpea con una barra de poder y precisión, y el balón vuela, rebota y rueda con física realista (gravedad, arrastre, Magnus, viento, superficies y distintos cuerpos celestes).

---

## Por qué existe este spec

Todo el juego depende de que el balón se comporte de forma creíble y de que el golpe sea entendible. Se valida primero en un campo de prueba, sin hoyos ni obstáculos, para que los specs siguientes (hoyo jugable, obstáculos, 18 hoyos) se apoyen en una base ya verificada con pruebas numéricas.

Hoja de ruta del proyecto (cada punto es un spec propio):

1. **SPEC 01 (este):** física + golpe + campo de prueba.
2. SPEC 02: un hoyo jugable (green, hoyo, conteo de golpes).
3. SPEC 03: obstáculos (agua, trampas de arena, árboles).
4. SPEC 04: los 18 hoyos, tarjeta de marcador y ambientación de campo de golf.

---

## Alcance

**Dentro:**

- Proyecto web con TypeScript + Three.js + Vite, en la raíz del repositorio.
- Escena 3D: campo de prueba plano con tres franjas de superficie (césped corto, rough, arena), cielo y luz básicos, balón de fútbol, cámara detrás del balón.
- Modelo físico propio del balón: gravedad, arrastre del aire, efecto Magnus, viento constante, rebote con pérdida de energía y spin, rodadura con fricción hasta detenerse.
- Selector de cuerpo celeste que cambia gravedad y densidad del aire: Mercurio, Venus, Tierra, Luna, Marte, Júpiter.
- Control de rumbo con teclado (A/D o flechas izquierda/derecha).
- Selector de punto de contacto: dibujo 2D del balón con un punto arrastrable con el mouse (define altura/elevación y efecto lateral).
- Barra de golpe de 3 clics (iniciar, fijar poder, fijar precisión).
- HUD tras cada tiro: distancia, altura máxima, tiempo de vuelo y velocidad inicial. Traza dibujada del tiro anterior. Flecha de viento.
- Panel de depuración con: cuerpo celeste, velocidad del viento y dirección del viento.
- Ciclo de juego: el balón queda donde se detiene; la tecla R lo regresa al origen.
- Pruebas unitarias de la física con Vitest contra casos analíticos.

**Fuera de alcance (para specs futuros):**

- Hoyos, green, conteo de golpes, marcador (SPEC 02 y 04).
- Agua, árboles, trampas de arena como obstáculos con reglas de juego (SPEC 03). Aquí la arena es solo una superficie con otro coeficiente de rebote y fricción.
- Los 18 hoyos y ambientación de campo de golf (SPEC 04).
- Selección de cuerpo celeste por hoyo o por campo (aquí es solo el panel de depuración).
- Ráfagas de viento aleatorias.
- Persistencia (guardar partidas, récords, configuración).
- Soporte táctil/móvil y gamepad.
- Multijugador, sonido, música, menús, pantalla de inicio.
- Pendientes del terreno (el campo de prueba es plano).
- Sol y Plutón como cuerpos celestes.

---

## Modelo de datos

Convenciones:

- Unidades SI: metros, segundos, kilogramos, radianes.
- Ejes (los de Three.js): `x` derecha, `y` arriba, `z` hacia la cámara. El origen del campo está en el punto de patada inicial. El rumbo `0` apunta hacia `-z`.
- El suelo es el plano `y = 0`.
- Paso de simulación fijo de `1/240 s`, integrado con RK4. El render interpola.

```ts
// src/physics/types.ts
type Vec3 = { x: number; y: number; z: number };

interface BallState {
  position: Vec3;          // m, centro del balón
  velocity: Vec3;          // m/s
  angularVelocity: Vec3;   // rad/s
  phase: 'idle' | 'flying' | 'rolling' | 'stopped';
}

interface BallSpec {       // balón de fútbol talla 5
  mass: 0.43;              // kg
  radius: 0.11;            // m
  dragCoefficient: 0.25;   // Cd, valor inicial ajustable
  momentOfInertiaFactor: 2 / 3; // cascarón esférico: I = (2/3) m r²
}

interface CelestialBody {
  id: 'mercury' | 'venus' | 'earth' | 'moon' | 'mars' | 'jupiter';
  name: string;
  gravity: number;         // m/s²
  airDensity: number;      // kg/m³ en la superficie
}

interface SurfaceType {
  id: 'fairway' | 'rough' | 'sand';
  restitution: number;     // e: fracción de velocidad normal que se conserva
  slidingFriction: number; // μ de Coulomb en el impacto
  rollingResistance: number; // μr: desaceleración al rodar = μr · g
}

interface Wind {
  speed: number;           // m/s
  headingDeg: number;      // 0 = hacia -z, crece en sentido horario visto desde arriba
}

interface ContactPoint {   // punto golpeado, en el disco unitario del balón visto desde atrás
  x: number;               // -1..1: negativo = efecto a un lado, positivo = al otro
  y: number;               // -1..1: negativo = bajo el centro (globo, backspin), positivo = sobre el centro (raso, topspin)
}

interface ShotInput {
  headingDeg: number;      // rumbo elegido con el teclado
  power: number;           // 0..1, fijado con el 2º clic
  accuracy: number;        // -1..1, fijado con el 3º clic; 0 = centro perfecto
  contact: ContactPoint;
}

interface ShotResult {     // lo que muestra el HUD
  distance: number;        // m, horizontal entre origen del tiro y primer contacto con el suelo
  apexHeight: number;      // m
  flightTime: number;      // s
  launchSpeed: number;     // m/s
  trace: Vec3[];           // puntos de la trayectoria para dibujar
}
```

Tabla de cuerpos celestes (valores iniciales, viven en `src/physics/bodies.ts`):

| id | gravity (m/s²) | airDensity (kg/m³) | Nota |
| --- | --- | --- | --- |
| `mercury` | 3.70 | 0 | Sin atmósfera: sin arrastre ni Magnus |
| `venus` | 8.87 | 65 | Aire muy denso |
| `earth` | 9.81 | 1.225 | Referencia |
| `moon` | 1.62 | 0 | Sin atmósfera: sin arrastre ni Magnus |
| `mars` | 3.71 | 0.020 | Aire muy tenue |
| `jupiter` | 24.79 | 1.33 | Valores a 1 bar de presión, tratado como si hubiera suelo |

Tabla de superficies (valores iniciales, viven en `src/physics/surfaces.ts`, ajustables al jugar):

| id | restitution | slidingFriction | rollingResistance |
| --- | --- | --- | --- |
| `fairway` | 0.75 | 0.35 | 0.06 |
| `rough` | 0.45 | 0.60 | 0.25 |
| `sand` | 0.15 | 0.80 | 0.60 |

Conversión de golpe a velocidad inicial (valores iniciales, en `src/game/shot.ts`):

- Velocidad de salida: `launchSpeed = power · 35 m/s` (máximo).
- Elevación base del tiro: `3°`; cada unidad de `contact.y` negativo suma hasta `+37°` más (balón más abajo = más globo); `contact.y` positivo baja la elevación hasta `0°`.
- Spin: `contact.y` genera backspin (negativo) o topspin (positivo) y `contact.x` genera spin lateral. El spin máximo es `60 rad/s` en cada eje.
- Precisión: `accuracy` desvía el rumbo real hasta `±8°` respecto al elegido.
- Estos números son valores iniciales de afinación y se documentan en `src/game/shot.ts`. No son parte del contrato de aceptación salvo donde un criterio los cite.

Fuerzas durante el vuelo:

- Gravedad: `m · g` hacia abajo.
- Arrastre: `0.5 · ρ · Cd · A · |v_rel|² ` opuesto a la velocidad relativa al aire, con `v_rel = v − viento` y `A = π r²`.
- Magnus: `0.5 · ρ · CL · A · |v_rel|²` en la dirección de `ω × v_rel`, con `CL = 1 / (2 + 1/S)` y `S = r · |ω| / |v_rel|`.
- Con `ρ = 0` no hay arrastre ni Magnus. El viento no tiene efecto.

Rebote y rodadura:

- Impacto con el suelo: la componente normal se multiplica por `−restitution`. La componente tangencial usa un impulso de fricción de Coulomb con `slidingFriction`, que también modifica el spin.
- Cuando la velocidad normal tras el rebote es menor que `0.5 m/s` el balón pasa a `rolling`: desacelera con `rollingResistance · g` y su spin se acopla a la velocidad de rodadura.
- El balón pasa a `stopped` cuando su velocidad es menor que `0.05 m/s`.
- La superficie se decide por la coordenada `z` del balón: tres franjas de ancho fijo, definidas en `src/world/field.ts`.

Archivos nuevos (todos):

```text
package.json
tsconfig.json
vite.config.ts
index.html
src/main.ts
src/physics/types.ts
src/physics/bodies.ts
src/physics/surfaces.ts
src/physics/simulation.ts      // integración RK4, fuerzas, rebote, rodadura
src/game/shot.ts               // ShotInput -> velocidad y spin iniciales
src/game/gameLoop.ts           // paso fijo + interpolación, ciclo del balón
src/world/field.ts             // franjas de superficie
src/render/scene.ts            // Three.js: campo, balón, cielo, cámara, traza
src/ui/hud.ts                  // resultado del tiro, flecha de viento
src/ui/contactSelector.ts      // balón 2D con punto arrastrable
src/ui/powerBar.ts             // barra de 3 clics
src/ui/debugPanel.ts           // cuerpo celeste y viento
tests/physics.test.ts
```

---

## Plan de implementación

1. Crear el proyecto Vite + TypeScript, instalar `three` y `vitest`, con `index.html` y `src/main.ts` que muestra un canvas vacío. Verificación: `npm run dev` abre una página sin errores en consola.
2. Crear `src/render/scene.ts` y `src/world/field.ts`: campo plano con las tres franjas de color, cielo, luz, balón estático y cámara detrás del balón. Verificación: se ven las tres franjas y el balón.
3. Crear `src/physics/types.ts`, `bodies.ts` y `surfaces.ts` con los tipos y las tablas de este spec.
4. Crear `src/physics/simulation.ts` solo con gravedad e integración RK4. Crear `tests/physics.test.ts` con las pruebas de caída libre y de alcance sin aire. Verificación: `npm test` pasa.
5. Agregar arrastre y viento a `simulation.ts`, y sus pruebas. Verificación: `npm test` pasa.
6. Agregar el efecto Magnus a `simulation.ts`, y sus pruebas (en la Luna no curva; con backspin el balón llega más alto y más lejos que sin spin; con spin lateral la trayectoria se desvía hacia el lado correcto).
7. Agregar rebote, rodadura y detención con las tres superficies, y sus pruebas. Verificación: `npm test` pasa.
8. Crear `src/game/gameLoop.ts` y conectar simulación y render: lanzar el balón con un `ShotInput` fijo desde código. Verificación: se ve volar, rebotar y detenerse al balón, y la tecla R lo regresa al origen.
9. Crear `src/game/shot.ts` y la entrada de rumbo con A/D o flechas, con línea guía en el suelo. Verificación: el rumbo cambia la dirección del tiro.
10. Crear `src/ui/contactSelector.ts`: balón 2D con punto arrastrable que produce `ContactPoint`. Verificación: mover el punto cambia elevación y efecto del siguiente tiro.
11. Crear `src/ui/powerBar.ts`: barra de 3 clics (o barra espaciadora) que produce `power` y `accuracy`, y disparar el tiro al tercer clic. Verificación: un tiro completo con el mouse funciona de principio a fin.
12. Crear `src/ui/hud.ts`: distancia, altura máxima, tiempo de vuelo y velocidad inicial tras cada tiro, traza del tiro anterior y flecha de viento.
13. Crear `src/ui/debugPanel.ts`: selector de cuerpo celeste y control de velocidad y dirección del viento, conectados a la simulación.

---

## Criterios de aceptación

- [ ] `npm install && npm run dev` arranca el juego sin errores ni advertencias en la consola del navegador.
- [ ] `npm test` ejecuta las pruebas de física y todas pasan.
- [ ] Prueba: sin aire (`ρ = 0`) y sin spin, un tiro a 20 m/s y 45° sobre `fairway` aterriza a `v²·sin(2θ)/g` del origen con error menor al 1 % en la Tierra, y también en la Luna.
- [ ] Prueba: un balón soltado desde 10 m sin aire toca el suelo en `√(2h/g)` s con error menor al 1 %.
- [ ] Prueba: con aire, el mismo tiro alcanza una distancia menor que sin aire.
- [ ] Prueba: con backspin el balón alcanza una altura máxima mayor que sin spin con el mismo tiro; con spin lateral su posición final se desvía hacia el lado esperado.
- [ ] Prueba: en la Luna y en Mercurio (`ρ = 0`) el spin no modifica la trayectoria de vuelo.
- [ ] Prueba: un viento constante de 10 m/s desplaza lateralmente el punto de aterrizaje en el sentido del viento.
- [ ] Prueba: tras un rebote en `fairway` la energía cinética total es menor que antes del impacto.
- [ ] Prueba: el balón llega a `phase = 'stopped'` en las tres superficies, y se detiene en menos distancia en `sand` que en `rough` y en `rough` que en `fairway` con el mismo tiro de rodadura.
- [ ] Con A/D o las flechas el rumbo cambia y la línea guía en el suelo gira en consecuencia.
- [ ] Arrastrar el punto en el selector de contacto hacia abajo produce un tiro más alto que con el punto al centro, y hacia un lado produce curva hacia ese lado (verificable con la traza).
- [ ] La barra de golpe necesita exactamente 3 clics: el 1.º inicia la subida, el 2.º fija el poder y el 3.º fija la precisión durante la bajada, tras lo cual sale el tiro.
- [ ] Si el jugador no hace el 3.er clic y la barra llega abajo, el tiro sale con la desviación máxima de precisión.
- [ ] Un tiro con poder 1.0 en la Tierra sale con velocidad inicial de 35 m/s (mostrado en el HUD).
- [ ] Tras cada tiro el HUD muestra distancia, altura máxima, tiempo de vuelo y velocidad inicial, y se dibuja la traza del tiro anterior.
- [ ] El balón se queda donde se detiene y el siguiente tiro parte desde ahí; la tecla R lo regresa al origen.
- [ ] Cambiar el cuerpo celeste en el panel hace que el mismo tiro (mismo `ShotInput`) tenga alcance distinto: mayor en la Luna que en la Tierra y menor en Júpiter que en la Tierra.
- [ ] La flecha de viento del HUD apunta en el sentido configurado en el panel.
- [ ] Mantiene 60 fps o más en un navegador de escritorio moderno durante un tiro.

---

## Decisiones tomadas y descartadas

- **Sí:** TypeScript + Three.js + Vite. Three.js es el estándar de 3D web, Vite da arranque rápido y TypeScript atrapa errores numéricos.
- **No:** Unity, Godot y pygame. Obligan a instalar un editor o no se prueban fácil desde terminal.
- **Sí:** física escrita por nosotros, sin motor de física genérico. El efecto Magnus, el spin en el rebote y la densidad del aire por planeta no vienen resueltos en motores genéricos y queremos controlarlos.
- **Sí:** integración RK4 con paso fijo de 1/240 s. Es estable con velocidades de 35 m/s y reproducible para las pruebas.
- **Sí:** vista 3D con cámara detrás del balón. Altura, parábola y efecto se aprecian mejor que en 2D.
- **No:** vista 2D cenital o lateral. No muestran bien la combinación de altura y desvío lateral.
- **Sí:** barra de 3 clics (iniciar, poder, precisión). Es el estándar de los juegos de golf y es lo que pidió el usuario.
- **No:** arrastre estilo honda. No es lo que se pidió.
- **Sí:** punto de contacto con un dibujo del balón. Se entiende al instante y da la precisión de elegir en qué parte se golpea.
- **No:** controles deslizantes y tipos de pateo predefinidos. Menos intuitivos o menos precisos.
- **Sí:** cuerpos celestes con gravedad y densidad del aire. Es coherente físicamente: sin aire no hay arrastre ni Magnus.
- **No:** el Sol y Plutón. El Sol no tiene superficie y es injugable (274 m/s²). Plutón no aporta casos distintos a los ya incluidos.
- **Sí:** Júpiter tratado con valores a 1 bar. Es una convención; se juega como si hubiera suelo.
- **Sí:** viento constante ajustable. Es reproducible para verificar; las ráfagas aleatorias quedan para después.
- **Sí:** superficies como tres franjas del campo de prueba. Permiten ver el cambio al rodar de una a otra. Las reglas de obstáculos (agua, árboles) van en el SPEC 03.
- **Sí:** el balón se queda donde se detiene y R lo regresa. Es el ciclo real del golf y permite probar rodadura desde distintas superficies.
- **Sí:** mouse + teclado únicamente. Táctil y gamepad duplican el trabajo de UX.
- **Sí:** pruebas con Vitest contra casos analíticos, más HUD y traza. Así la física se verifica con números y no solo a ojo.
- **Sí:** los coeficientes numéricos (Cd, superficies, 35 m/s, ángulos y spin máximos) son valores iniciales de afinación documentados en código, no parte del contrato salvo donde un criterio los cite.
- **Sí:** el proyecto se divide en 4 specs porque la idea completa no cabe en una oración y cruza más de cuatro dominios (física, controles, obstáculos, campos).

---

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| El modelo de Magnus (`CL = 1/(2+1/S)`) es aproximado y puede dar curvas exageradas con spin alto | Spin máximo limitado a 60 rad/s; los coeficientes son constantes ajustables y hay pruebas que fijan el signo y el orden de magnitud |
| Rebote con spin inestable o balón que vibra al detenerse | Umbral de paso a `rolling` en 0.5 m/s de velocidad normal y a `stopped` en 0.05 m/s; pruebas de detención en las tres superficies |
| Venus (65 kg/m³) y Júpiter (24.79 m/s²) producen tiros extremos | Se aceptan como comportamiento correcto; el panel permite volver a la Tierra y los criterios solo exigen comparaciones relativas |
| Paso fijo y render a otra frecuencia causan saltos visuales | Interpolación entre el estado anterior y el actual en el render |
| Precisión de la barra depende de la velocidad del reloj del navegador | La barra se mueve con tiempo real (`performance.now`), no con fotogramas |

---

## Lo que **no** está en este spec

- Hoyos, green, conteo de golpes y marcador.
- Agua, árboles y trampas de arena con reglas de juego.
- Los 18 hoyos y la ambientación de campo de golf.
- Selección de cuerpo celeste por hoyo o campo.
- Ráfagas de viento aleatorias.
- Pendientes del terreno.
- Persistencia de cualquier tipo.
- Táctil, gamepad, sonido, música y menús.
- Multijugador.

Cada uno de estos puntos, si se hace, va en su propio spec.
