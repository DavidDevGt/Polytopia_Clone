# Terranova — Guía de dirección de arte (v0.3)

Identidad: **una maqueta de juguete a pleno sol**. Un mundo cálido en
miniatura — dioramas nítidos, materiales mate, una sola luz de mediodía, mar
brillante alrededor — leído desde una UI de cristal oscuro que desaparece
cuando no se necesita. Inspiración en los principios (no en las formas) de
Polytopia, Dorfromantik, Bad North, Islanders y Mini Motorways: claridad ante
todo, pocas siluetas, mucha intención.

La fuente de verdad ejecutable es `src/render/palette.ts`. Este documento
explica el porqué.

## 1. Luz

- **Un solo sol, arriba a la izquierda.** Todo volumen ilumina su cara oeste
  (`LIGHT_FACE = 0.78`) y sombrea la sureste (`DARK_FACE = 0.55`). Sin
  excepciones: casas, montañas, torres y bloques de terreno comparten factores.
- **Sombras de contacto**, no proyectadas: una elipse suave
  (`rgba(20,24,38,0.28)`) bajo cada prop. Es el "ambient occlusion" del juego.
- **Atmósfera de día**: gradiente de cielo (azul → celeste pálido), glow
  cálido radial tras el tablero, nubes blancas a la deriva, y un wash
  `soft-light` cálido muy suave con viñeta al 14 %. El tablero nunca flota
  en un vacío: una **falda de océano** soleado se extiende más allá de los
  bordes del mapa, así el mundo lee como isla en un mar brillante.

## 2. Color

- **Terreno saturado pero nunca neón**; las sombras son frías (derivan por
  `shade()`, nunca a negro puro).
- **Los colores de equipo son sagrados**: rojo/azul/oro/violeta solo aparecen
  en cosas que un jugador posee (banderas, techos, bordes, unidades). El
  terreno jamás los usa — así la lectura de propiedad es instantánea.
- Primarios de mundo: pradera `#a4c964`→`#b5d16d`, bosque `#8db956`, roca
  `#a9a4b5`, arena `#ecd9a0`, agua costera `#54c6ec`, océano `#2b85c0`.
- El agua varía poco entre casillas (±4 %): el mar debe leer como una masa,
  no como parches.
- UI: tinta `#0e1119`, cristal `rgba(18,21,34,0.82)` con blur, texto marfil
  `#f0ede4`, acentos oro `#ffcf5c` (acción principal) y coral (peligro).

## 3. Forma y escala

- **Siluetas primero**: cada cosa debe reconocerse por contorno en 24 px.
  Guerrero = escudo redondo + espada en alto; arquero = capucha + arco con
  flecha; jinete = caballo al trote + lanza con banderín; defensor = yelmo
  completo + escudo torre. Nada comparte silueta.
- **Los soldados son personajes, no fichas** (proporciones chibi): la cabeza
  es ~45 % de la figura — las cabezas grandes cargan el encanto Y se leen a
  distancia de mapa. Cuerpo de dos tonos (sol al oeste, sombra al este, la
  misma ley que las casas), pies que anclan, cinturón que corta la silueta,
  beso de sol en la cabeza.
- **Bloques de color 60/30/10**: el color de equipo domina el cuerpo (60),
  acero/madera neutros llevan el equipo (30), piel y acentos oro el resto
  (10). La propiedad se lee antes que el rol; el rol antes que el detalle.
- **Una pose por rol**: el guerrero se planta en guardia, el arquero vigila
  con la flecha lista, el jinete va a medio trote (pata delantera en el
  aire), el defensor se atrinchera tras el escudo. El oficio se lee en la
  postura sin leer ningún tooltip.
- **Tres estados de ánimo en cejas** (`determined`/`calm`/`stoic`): guerrero
  y jinete decididos, arquero sereno, defensor imperturbable. Dos puntos y
  dos trazos bastan para dar alma.
- La barra de vida solo aparece en unidades heridas: un ejército sano se lee
  limpio. La ★ de veterano vive en la esquina noroeste, libre de espadas,
  arcos, lanzas y crestas.
- Diamante base 64×32, bloques extruidos 11 px. Props entre 0.5 y 1.5 tiles de
  alto; solo capillas/capiteles superan el tile (foco visual merecido).
- **Imperfección controlada**: todo prop toma jitter determinista de
  `tileHash(index, salt)` — posición, tamaño, tono, nieve. Dos casillas nunca
  se ven idénticas, y el mismo mapa siempre se ve igual (misma semilla, misma
  imagen).

## 4. Materiales y elementos

- **Terreno**: tapa con variación de tono por hash + textura mínima (matas de
  hierba, flores 12 %, motas de roca). Orillas con banda de **arena** donde la
  tierra toca agua.
- **Agua**: el material vivo. Ondas quadráticas a la deriva, destellos de sol
  intermitentes, **espuma pulsante** pegada a la costa, océano hundido 5 px y
  más oscuro que la costa.
- **Montañas**: 2 picos por casilla (principal + secundario) con cara lit/
  sombra, nieve opcional por hash, base integrada con sombra de contacto.
- **Bosques**: 2–3 coníferas GORDAS de dos capas con tronco — pocas y grandes
  para que la silueta domine la casilla —, tamaños y posiciones por hash,
  balanceo suave por viento (`sin(now/1100)`).
- **Ciudades que crecen casa a casa**: plaza de tierra siempre; cada nivel
  añade una casa visible (Nv1 2 casas → Nv4+ 5 casas), Nv2+ murallas
  frontales, Nv3+ **torreón** con almenas y estandarte colgante; capital =
  torreón alto con friso dorado y ★. El nivel se lee desde el mapa sin abrir
  ningún panel. Bandera ondeante en toda ciudad.
- **Recursos como miniaturas**: árbol frutal cargado, res pastando, veta con
  cristal que destella, banco de peces saltando dentro de anillos de agua.
- **Niebla = nubes BLANCAS** (regla Polytopia): lo inexplorado es un manto de
  nubes esponjosas (`fog1/fog2` claros) con billows por hash, sombra fría en
  el borde sur y deriva lenta. La oscuridad queda prohibida: el mundo invita
  a explorar, no amenaza.

## 5. Movimiento

Regla: **nada aparece ni cambia instantáneamente.**

- Unidades: bob idle senoidal, deslizamiento con ease-in-out al mover,
  embestida con anticipación y follow-through al atacar, **flash blanco** al
  recibir daño, pop `easeOutBack` al reclutar, estallido+anillo al morir.
- Mundo: banderas al viento, copas balanceándose, agua y espuma pulsando,
  destello del mineral. Cámara con easing y sacudida decreciente.
- UI: todo entra con `--ease-pop` (spring corto); hover eleva 1 px; el botón
  de turno irradia oro; log y paneles nunca "aparecen": nacen.

## 6. Iconografía

Familia única en SVG inline (`ICON` en `main.ts`): grid 24, trazo 2, puntas
redondeadas, `currentColor`. Estrella (economía), espada (ataque), escudo
(defensa), flecha (movimiento), diana (alcance), corazón (vida), personas
(población), bandera (captura), casa (ciudad). Prohibido mezclar estilos.

## 7. HUD — mobile first

El juego se diseña para un teléfono en la mano; el escritorio es la versión
ensanchada, nunca al revés.

- **El pulgar manda**: todo control táctil mide ≥ 44 px; el botón de turno es
  una píldora dorada en la zona del pulgar derecho, con `safe-area-inset`.
- **Gestos nativos**: un dedo toca (seleccionar/mover/atacar) o arrastra
  (paneo); dos dedos pellizcan (zoom) y panean por su punto medio. Todo por
  Pointer Events — el mismo código sirve mouse, lápiz y dedo. El navegador
  no recibe ningún gesto (`touch-action: none`).
- **El inspector es una bottom sheet**: aparece solo cuando hay unidad o
  ciudad seleccionada, con asa de arrastre, y se retira al tocar el vacío.
  En landscape se acopla a la derecha. Mientras está abierta, la selección
  es la acción primaria: el botón de turno se aparta.
- **Ajustes tras ⚙**: semilla, modo y nueva partida viven en un desplegable;
  la barra superior solo lleva chip de jugador, turno y estrellas.
- Sin hover no hay pronóstico flotante ni atajos de teclado: esa capa solo
  existe en escritorio (`pointer: coarse` la apaga).
- El copy dice «toca», nunca «haz clic».

- **Jerarquía**: (1) el mundo, (2) el botón dorado de turno, (3) la barra de
  estado, (4) el inspector. Nada compite con el tablero: paneles de cristal
  oscuro translúcido con blur que se funden con la escena.
- El inspector es contextual: muestra solo lo tocado; los overlays (log,
  minimapa, pronóstico) flotan sobre el mundo sin marcos opacos. La ayuda
  (atajos, cómo ganar) vive en paneles plegables cerrados por defecto.
- El minimapa habla el mismo idioma que el mundo: lo inexplorado es blanco
  nube, nunca negro.
- Victoria = **secuencia**, no modal: confeti, título con pop, mapa final
  revelado, barras de estadísticas animadas por jugador, medallas (MVP,
  Fundador, Conquistador) y cronología de hitos con entrada escalonada.

## 8. Deudas asumidas (siguiente pase de arte)

- Ríos con meandros y puentes → requieren soporte en `core` (hidrología en la
  generación), no solo pintura.
- Estructuras narrativas (faros, ruinas, molinos) → entrarán con las mejoras
  de casilla del árbol tecnológico, para que cada edificio cuente una regla.
- Animación de caminar por pasos (hoy es deslizamiento) y muerte con cuerpo
  que cae (hoy partículas) → cuando haya sprites por dirección.
