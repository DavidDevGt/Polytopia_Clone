# Terranova — Documento de diseño y auditoría (v0.2)

Este documento registra la auditoría del prototipo v0.1, las decisiones del
rediseño v0.2 y —igual de importante— **lo que se decidió NO construir y por
qué**. La meta de la v0.2 es un _vertical slice_: pocas mecánicas, cada una
completa, legible y con una razón de existir.

---

## 1. Auditoría del prototipo v0.1

| #   | Problema                                                                                        | Gravedad | Impacto                                                                      | Causa                          | Solución (v0.2)                                                                                                                                                           | Prioridad |
| --- | ----------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **No existía combate.** Las unidades solo bloqueaban casillas                                   | Crítica  | El género es "eXterminate"; sin combate no hay juego                         | Alcance del scaffold inicial   | Combate determinista con pronóstico exacto, contraataques, bonos de terreno, flanqueo y veteranía                                                                         | P0        |
| 2   | **Captura instantánea al pisar** aldeas/ciudades                                                | Alta     | Eliminaba toda decisión defensiva: un jinete ganaba la partida por velocidad | Simplificación v0.1            | Capturar consume el turno completo de la unidad quieta sobre el objetivo → ventana de reacción para el defensor                                                           | P0        |
| 3   | **Economía sin decisiones**: ingresos fijos por ciudad, las estrellas solo compraban unidades   | Alta     | Un único uso del dinero = ninguna tensión económica                          | Modelo mínimo                  | Cosecha de recursos (pagar ★ ↔ población ↔ nivel ↔ ingresos/fronteras) compite con reclutar; mantenimiento por unidad extra                                               | P0        |
| 4   | **Sin condición de victoria**                                                                   | Alta     | Partidas sin final                                                           | Alcance v0.1                   | Dominación: perder la capital elimina; el último vivo gana                                                                                                                | P0        |
| 5   | **Sin niebla de guerra**                                                                        | Alta     | Información perfecta → sin exploración ni sorpresa                           | Alcance v0.1                   | Fog de dos niveles (inexplorado / explorado sin visión) por jugador, persistido en el estado                                                                              | P1        |
| 6   | **Sin oponente**: hotseat obligatorio                                                           | Alta     | Imposible jugar solo; sin presión                                            | Alcance v0.1                   | IA por objetivos, determinista y pura (`nextAiAction`)                                                                                                                    | P1        |
| 7   | **Mapa de ruido sal-y-pimienta**: agua por random walk, montañas/bosques espolvoreados al azar  | Media    | Los mapas parecían aleatorios, no diseñados; sin continentes ni cordilleras  | Random walk + shuffle uniforme | Campos fBm de elevación+humedad con falloff radial y umbrales por cuantiles; asentamientos restringidos al continente principal (capitales siempre conectadas por tierra) | P1        |
| 8   | **Render plano y sin vida**: diamantes de color sólido, cero animación, feedback instantáneo    | Media    | "Parece un placeholder" — sin game feel                                      | Renderer mínimo                | Bloques extruidos con caras laterales, agua animada, tweens de movimiento/embestida, partículas de daño, sacudida de cámara, banderas ondeando, viñeta                    | P1        |
| 9   | **UI sin jerarquía**: una barra con todo mezclado, sin inspector, sin log, errores en una línea | Media    | Información imposible de escanear; cero descubribilidad                      | HUD v0.1 mínimo                | Barra superior (identidad/estado/controles), inspector lateral contextual, log de eventos, minimapa, pronóstico de combate, banner de turno, toasts, atajos y ayuda       | P1        |
| 10  | `moveUnit` hacía O(unidades) `find` por vecino en el BFS; vecinos recalculados en cada llamada  | Baja     | Irrelevante en 16×16, bloqueante para mapas grandes                          | Código directo                 | Tabla de vecinos precomputada por tamaño + set de ocupación por consulta; benchmarks (`npm run bench`) para vigilar regresiones                                           | P2        |
| 11  | Los tests fijaban valores mágicos del formato de mapa (p. ej. `wet <= floor(n*ratio)`)          | Baja     | Tests frágiles ante cambios legítimos                                        | Aserciones literales           | Aserciones por propiedades (proporciones con tolerancia, conectividad, contigüidad)                                                                                       | P2        |

Lo que **sí** estaba bien y se conservó: núcleo puro/determinista con
`applyAction`, RNG sembrado, ESLint imponiendo la pureza, tests junto a cada
regla. Esa base es la razón de que este rediseño cupiera en una iteración.

---

## 2. Pilares de diseño

1. **Cada turno, una pregunta.** Si un turno se juega en piloto automático,
   el sistema que lo permite está mal diseñado.
2. **Información perfecta táctica, imperfecta estratégica.** El combate es
   100 % predecible (pronóstico exacto antes de confirmar); el mapa y el
   enemigo no lo son (niebla). La tensión viene de lo que no ves, no de dados.
3. **Pocos sistemas, completos.** Antes de añadir un sistema nuevo, el
   anterior debe generar decisiones por sí mismo.

### Las preguntas que produce cada sistema

- _¿Expando o fortifico?_ → capturar exige un turno inmóvil y expone a la
  unidad; el mantenimiento castiga ejércitos grandes con pocas ciudades.
- _¿Ataco o ahorro?_ → las estrellas compran unidades **o** población; cada
  cosecha es una unidad que no reclutas y viceversa.
- _¿Exploro o desarrollo?_ → la niebla esconde aldeas (expansión gratuita a
  futuro) pero explorar gasta los movimientos que curarían/defenderían.
- _¿Economía o ventaja militar?_ → subir una ciudad a nivel 3 amplía fronteras
  (más recursos, más visión), pero ese metal costó 4★ que eran un jinete.

---

## 3. Combate

Fórmula (en `src/core/combat.ts`), sin azar:

```
fuerzaAtaque  = ATQ · (vida/vidaMáx) · (1 + 0.1·aliados adyacentes al defensor)
fuerzaDefensa = DEF · (vida/vidaMáx) · bonoTerreno
dañoAlDefensor  = round( fuerzaAtaque/(fuerzaAtaque+fuerzaDefensa) · ATQ · 4.5 )   (mín. 1)
contraataque    = round( fuerzaDefensa/(…) · DEF · 4.5 )   solo si sobrevive y te alcanza
```

- **Bono de terreno**: bosque ×1.3 · ciudad propia ×1.5 · capital ×1.8.
- **Flanqueo/apoyo**: +10 % por aliado adyacente al defensor. Rodear importa.
- **Contraataque**: castiga el ataque frontal; los arqueros (alcance 2) lo
  esquivan contra cuerpo a cuerpo — su razón de existir.
- **Avance**: el cuerpo a cuerpo que mata ocupa la casilla → abre brechas y
  también sobreextiende (riesgo/recompensa).
- **Veteranía**: 2 bajas → +5 vida máx. y curación completa. Proteger a una
  unidad experimentada se vuelve una decisión.
- **Descanso**: la unidad que no actúa cura +2 (+4 en territorio propio):
  fortificar es una acción real, no pasividad. **Bajo asedio (enemigo
  adyacente) no hay curación** — sin esta regla, un defensor en la capital
  (×1.8) se curaba más rápido de lo que cualquier ejército razonable podía
  dañarlo y las partidas podían no terminar (lo detectaron las simulaciones
  IA-vs-IA, ver §6).

### Matriz de balance

| Unidad   | Coste | Vida | ATQ | DEF | MOV | ALC | Rol                                      | Counter natural              | Sinergia                      |
| -------- | ----: | ---: | --: | --: | --: | --: | ---------------------------------------- | ---------------------------- | ----------------------------- |
| Guerrero |    2★ |   10 |   2 |   2 |   1 |   1 | Línea barata, capturador                 | Defensor (muro)              | Carne de flanqueo             |
| Arquero  |    3★ |    8 |   2 |   1 |   1 |   2 | Daño sin represalia                      | Jinete (lo caza)             | Detrás de guerreros           |
| Jinete   |    3★ |   10 |   2 |   1 |   2 |   1 | Flanco, cazar arqueros, capturas rápidas | Defensor en ciudad           | Remata lo que el arquero abre |
| Defensor |    3★ |   15 |   1 |   3 |   1 |   1 | Guarnición, muro de paso                 | Arquero (lo desgasta gratis) | Ancla que cubre arqueros      |

El ciclo guerrero→defensor→arquero→jinete→guerrero no tiene estrategia
dominante: cada compra fuerte tiene un depredador barato.

---

## 4. Economía

- **Ingresos**: por ciudad, `1 + nivel` (+1 capital).
- **Mantenimiento**: cada unidad por encima de 1 por ciudad cuesta 1★/turno.
  La expansión militar sin base económica se autolimita (y la IA lo respeta).
- **Crecimiento**: cosechar un recurso dentro de las fronteras cuesta ★
  (fruta/caza/pesca 2★ → +1 pob.; metal 4★ → +2 pob.). Con `nivel+1` de
  población la ciudad sube: más ingresos, y a nivel 3 las fronteras pasan de
  radio 1 a 2 (más recursos y visión). Los recursos son **finitos**: cada
  ciudad tiene un techo natural y expandirse vuelve a importar.
- **Aldeas → ciudades**: la única vía de expansión. Capturarlas exige un turno
  vulnerable dentro de la niebla de otro.

## 5. Mapa

`elevación = fBm(4 octavas) · falloff radial` y `humedad = fBm(3 octavas)`.
Umbrales tomados de **cuantiles reales** del campo (no constantes mágicas):
las proporciones agua/montaña/bosque se cumplen en cualquier semilla. El agua
sin tierra adyacente se hunde a océano (costas naturales, lagos interiores);
las montañas emergen en crestas contiguas (cordilleras); los asentamientos se
restringen al mayor componente conexo transitable → **todas las capitales son
alcanzables por tierra en cualquier semilla** (test lo garantiza).

## 6. IA

`nextAiAction(state)` es pura y determinista: devuelve una acción cada vez y
el llamador la aplica hasta recibir `endTurn` (cada acción consume un recurso
finito → terminación garantizada, testeada). Prioridades: capturar lo pisado →
peleas favorables según el pronóstico real (el mismo que ve el jugador) →
avanzar hacia aldeas / ciudades enemigas (solo con ventaja numérica) /
enemigos visibles, con defensores guarneciendo → cosechar el mejor
población/★ → reclutar rotando roles hasta ~2 unidades por ciudad.

Con el ejército al tope económico la IA "se compromete": marcha sobre la
capital enemiga en lugar de perseguir unidades (sin esto, dos IAs cautelosas
se miraban eternamente). Validación: simulaciones completas IA-vs-IA en 8
semillas — 7 terminan por dominación en 29–99 turnos. **Limitación conocida**:
en mapas con un istmo de una casilla, una guarnición veterana puede taponar el
paso indefinidamente contra esta IA (un humano lo rompe con arqueros, que
disparan sin contraataque por encima del bloqueo); se resolverá con órdenes de
grupo/asedio en el hito de IA táctica.

## 7. Decisiones de recorte (y por qué)

| Pedido                          | Decisión           | Razón                                                                                                                                                                                       |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moral + fatiga                  | **No**             | Se solapan con vida/veteranía/curación: tres medidores que cuentan la misma historia emborronan el pronóstico exacto (pilar 2). Volverán solo si aportan una decisión que la vida no cubra. |
| Zonas de control                | **Aplazado**       | Con movimiento 1–2 y mapas 16×16, el bloqueo físico de casillas ya crea frentes. ZOC entra cuando haya mapas grandes y movimiento 3+.                                                       |
| Altura/ríos como reglas         | **Aplazado**       | La elevación ya existe en la generación; exponerla como regla de combate exige comunicarla en el render (flechas, previews) — se hará junto al rediseño de tiles con sprites.               |
| Desiertos/pantanos/biomas extra | **Aplazado**       | Biomas sin regla propia son solo pintura; cada terreno nuevo debe traer una decisión (pantano = movilidad, desierto = economía).                                                            |
| Árbol tecnológico               | **Siguiente hito** | Es el sistema correcto para desbloquear montaña/agua transitables, nuevas unidades y economía avanzada; necesita el slice actual estable primero.                                           |
| Colas de acciones / undo        | **Aplazado**       | El motor de eventos + estado inmutable lo hacen casi gratis; es pulido de UX, no mecánica.                                                                                                  |

## 8. Rendimiento

- Tabla de vecinos precomputada y cacheada por tamaño de mapa (ruta más
  caliente: BFS, visibilidad, IA).
- `reachableTiles` usa un set de ocupación O(1) en lugar de `find` O(n).
- Visibilidad cacheada por referencia de estado en la UI (se recalcula solo
  cuando el estado cambia, no por frame).
- Render: un solo canvas, sin allocations relevantes por frame (partículas
  reutilizan arrays), viñeta/gradientes por frame son 3 fills.
- `npm run bench` (Vitest bench): generación 16/48, BFS y visibilidad en
  48×48, `endTurn` y decisión de IA — para detectar regresiones antes de
  subir el tamaño de mapa.

## 9. Roadmap

1. Árbol tecnológico (desbloquea montaña/navegación, unidades T2, economía).
2. Tribus con identidad (tecnología inicial + paleta + regla propia).
3. ZOC + reglas de altura/ríos junto al paso a sprites.
4. Guardado/replay (serializar estado + lista de acciones — el motor ya lo permite).
5. Sonido ambiental + música adaptativa; accesibilidad (daltonismo, tamaños).
