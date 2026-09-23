# AGENTS.md — Проектировщик дровяной печи из кирпичей (stoveBuilder2)

Полное техническое описание проекта для его точного воссоздания с нуля.

---

## 1. Назначение

Одностраничное веб-приложение (Three.js) — 3D-конструктор дровяной печи, складываемой
из кирпичей. Работает **полностью офлайн** (никаких внешних сетевых запросов), интерфейс
на русском языке, сохранение проекта в YAML-файле `.stove`.

Ключевые требования к математике (из исходного промпта):

1. Базовый модуль (ячейка сетки) — **0.625 юнита = 62.5 мм**.
2. Кирпич 250×125×65 мм → в юнитах Three.js строго **2.5 × 0.65 × 1.25**
   (длина × высота × ширина; с растворным швом 120→125 мм).
3. Сетка на полу с шагом **ровно 0.625**.
4. Снап при отпускании мыши: X/Z кратны **0.625** (края кирпича — точно на линиях
   сетки, с учётом ориентации/поворота), Y — шаг ряда строго **0.65**
   (1-й ряд: центр Y=0.325, 2-й ряд: Y=0.975; кирпичи не врезаются).
5. Кирпичи — строгие параллелепипеды, матовый тёмно-красный, выделенный — оранжевый,
   чёрные рёбра EdgesGeometry (как на чертеже).
6. Вращение X/Y/Z ровно на 90°, после вращения снап пересчитывается по новому AABB.
7. Сохранение/загрузка YAML: позиции и повороты, загрузка восстанавливает строго
   по координатам (без переснапа).
8. Кирпич, созданный кнопкой «Создать кирпич» (или клавишей **C**), появляется
   **вне существующих кирпичей, но рядом** (не перекрывает другие; на пустой
   сцене — в центре).

Единицы: **1 unit = 100 мм**. Углы в YAML — радианы, кратны π/2.

---

## 2. Структура проекта

```
stoveBuilder2/
├── index.html              — единственная точка входа, все подключения локальные
├── промт печка              — исходный промпт-ТЗ (перечитывать при изменении требований)
├── AGENTS.md               — этот файл
├── js/
│   ├── libs/
│   │   ├── three.min.js         (Three.js r128, ~603 KB, UMD)
│   │   ├── OrbitControls.js     (официальный контрол, ~26 KB, THREE.OrbitControls)
│   │   └── js-yaml.min.js       (js-yaml ~4.x, ~39 KB, глобальный jsyaml)
│   └── app/
│       └── app.js                — весь код приложения (одна IIFE, ~700 строк, без комментариев)
└── css/
    ├── libs/                     — пусто (внешние CSS не используются)
    └── app/
        └── style.css             — все стили (~70 строк)
```

Правила:

- **Никаких CDN и внешних URL.** Промпт упоминает CDN, но требование «работать без
  интернета» приоритетнее: библиотеки скачиваются в `js/libs/` и подключаются
  относительными путями. В `index.html` не должно быть ни одного `http(s)://`.
- Порядок подscripts в конце `<body>` обязателен:
  `three.min.js` → `OrbitControls.js` → `js-yaml.min.js` → `app/app.js`.
- Стиль: весь код без комментариев, `'use strict'`, ванильный ES5
  (var / function, без стрелок, классов, импортов), UI-тексты на русском.
- Проверка синтаксиса: `node --check js/app/app.js`.

---

## 3. Физические/математические константы (app.js, начало IIFE)

```js
var GRID  = 0.625;   // шаг сетки X/Z, юнитов (62.5 мм)
var ROW   = 0.65;    // высота ряда Y, юнитов (65 мм)
var MAGNET= 0.3;     // радиус магнита к соседям, юнитов
var HALF_PI = Math.PI / 2;

var BRICK_TYPES = {
  standard: { id:'standard', label:'Стандартный 250×125×65', w:2.5, h:0.65, d:1.25 },
  half:     { id:'half',     label:'Половинный 125×125×65',  w:1.25, h:0.65, d:1.25 }
};
// w — длина (по X в базовой ориентации), h — высота (Y), d — ширина (Z).
// half — укороченная по длине версия (1.25 = 2 модуля), ширина та же 1.25.

var BRICK_COLOR        = 0xa84531; // матовый тёмно-красный
var SELECTED_COLOR     = 0xe0762c; // оранжевый при выделении
var EDGE_COLOR         = 0x000000; // чёрные рёбра, ВСЕГДА (в т.ч. у выделенного)
var EMISSIVE_SELECTED  = 0x441c00; // лёгкий тёплый подсвет выделенного
```

Вспомогательные функции:

```js
function clean(v)        { return Math.round(v * 1e6) / 1e6; }          // борьба с float-мусором
function snapTo(v, step) { return Math.round(v / step) * step; }
function normalizeAngle(a){ return Math.round(a / HALF_PI) * HALF_PI; }  // углы → кратны 90°
function fmt(v)          { return v.toFixed(2); }                        // вывод позиции в UI
function deg(a)          { /* rad → deg, нормализация в [0,360), Math.round */ }
function round3(v)       { return Math.round(v * 1000) / 1000; }        // значения в YAML
```

Замечание: `Math.round(-0.5) === -0` (округление к +∞) — для Y это не проблема,
потому что отрицательный min.y принудительно обнуляется (см. snapBrick).

---

## 4. Сцена (функция init)

- `THREE.Scene`, фон `scene.background = 0x8fb0d3` (светло-голубое небо).
- Камера `PerspectiveCamera(55, aspect, 0.1, 500)`, старт `position.set(14, 9, 16)`.
- Рендерер: `WebGLRenderer({ antialias: true })`, `setSize(innerWidth, innerHeight)`,
  `setPixelRatio(min(devicePixelRatio, 2))`, тени включены
  (`shadowMap.enabled`, `PCFSoftShadowMap`), canvas — в `#viewport`.
- Свет:
  - `AmbientLight(0xffffff, 0.45)`;
  - `DirectionalLight(0xfff2dd, 0.85)` из `(18, 30, 12)`, `castShadow`,
    `shadow.mapSize 2048×2048`, ортокамера теней ±40 (left/right/top/bottom),
    near 1, far 100.
- Пол: `PlaneGeometry(200,200)`, `MeshLambertMaterial 0xc9c4b8`, повёрнут
  `rotation.x = -π/2`, `receiveShadow`.
- Две сетки (GridHelper, side=DoubleSide у GridHelper по умолчанию):
  - **акцентная**: `GridHelper(60, 24, 0xc2c8d0, 0xd0d5dc)` → шаг 2.5 юнита
    (каждая 4-я линия основной), `position.y = 0.01`;
  - **основная**: `GridHelper(60, 96, 0x3f4a58, 0x556072)` → **60/96 = 0.625**
    — ровно базовый модуль, `position.y = 0.02`.
- `OrbitControls(camera, renderer.domElement)`:
  - `target (0, 1.5, 0)`, `enableDamping true`, `dampingFactor 0.08`;
  - `mouseButtons: { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }`
    — **левая кнопка не для орбиты** (её обрабатывает приложение);
  - `maxPolarAngle = π*0.495`, `minDistance 3`, `maxDistance 120`.
- `raycaster = new THREE.Raycaster()`.
- Цикл: `renderer.setAnimationLoop(animate)`, где `animate()` =
  `controls.update(); renderer.render(scene, camera);`.
- `window resize`: пересчёт `camera.aspect`, `updateProjectionMatrix`, `setSize`.

---

## 5. Модель кирпича (createBrick)

Объект кирпича: `{ mesh, edges, def, type }`, в `mesh.userData.brick` — обратная
ссылка (её читает pickBrick).

- Геометрия: `BoxGeometry(def.w, def.h, def.d)` — строгий параллелепипед.
- Материал: `MeshLambertMaterial({ color: BRICK_COLOR })` (матовый, без бликов),
  `castShadow` и `receiveShadow = true`.
- Рёбра: `EdgesGeometry(geometry)` → `LineSegments` с
  `LineBasicMaterial({ color: EDGE_COLOR })`, добавлены **как ребёнок mesh**
  (`mesh.add(edges)`), поэтому наследуют трансформации.
- Позиция:
  - если передана `opts.position = [x,y,z]` (finite-числа) — ставится **точно**
    (загрузка YAML — без переснапа, требование «строго по координатам»);
  - иначе спавн: `spawnPosition(def)` — ищет ближайшую к центру свободную точку
    **спиралью по кольцам сетки GRID** от `(0, h/2, 0)`: кандидаты
    `(i*GRID, h/2, j*GRID)`, обход колец `r = 0,1,2,…` (периметр
    `max(|i|,|j|) === r`, i-внешний цикл), точка свободна, если AABB нового
    кирпича **строго не пересекает** AABB существующих (касание граней допустимо).
    На пустой сцене возвращает центр `[0, 0.325, 0]`; при занятом центре — первая
    свободная клетка рядом (кратная 0.625, т.е. уже «на сетке»).
    AABB существующих кешируются в массив `boxes` на один вызов.
  - `addStandardBrick()` = `selectBrick(createBrick({ type:'standard' }))` —
    общая функция для кнопки «Создать кирпич» и клавиши **C**.
- Поворот: `opts.rotation = [rx,ry,rz]` — каждый компонент через
  `normalizeAngle` (кратность 90°), затем `quaternion.setFromEuler`.
- `scene.add`, `bricks.push`, `applySelectionVisual`, `updateUI`.
- При создании снап **НЕ вызывается** (иначе half-кирпич: 0.625 не кратен 0.05
  в старой схеме; и точность загрузки была бы нарушена).

Удаление:

- `disposeBrick(brick)` — снять edges, `dispose()` всех геометрий/материалов,
  `scene.remove`.
- `removeBrick(brick)` — если удаляемый в drag — сбросить drag и вернуть
  `controls.enabled = true`; убрать из `bricks`, сбросить `selected`, dispose.
- `clearBricks()` — сброс drag/selected, освободить все (используется при загрузке).

---

## 6. AABB и снап (ядро математики)

### getAABB(brick)

Вручную обходит 8 углов локального бокса `(±w/2, ±h/2, ±d/2)`, применяет
`mesh.matrixWorld` (предварительно `mesh.updateMatrixWorld(true)`), возвращает
`{ min: Vector3, max: Vector3 }`. Это **объём в мировых осях** — он корректно
переставляет размеры при любом повороте, кратном 90°.

### snapBrick(brick, axes) — axes: строка из 'x','y','z' (по умолчанию 'xyz')

```js
box = getAABB(brick);
hx = (box.max.x - box.min.x) / 2;  // половины AABB, а НЕ def.* —
hy = (box.max.y - box.min.y) / 2;  // автоматически учитывают поворот
hz = (box.max.z - box.min.z) / 2;

// X/Z: минимум AABB — на сетку 0.625, затем центр = min + half
// → КРАЯ кирпича всегда точно на линиях сетки (стык-в-стык)
if ('x' in axes) pos.x = clean(snapTo(box.min.x, GRID) + hx);
if ('z' in axes) pos.z = clean(snapTo(box.min.z, GRID) + hz);

// Y: низ AABB — на сетку ряда 0.65; пол (min.y<0) — жёстко 0
if ('y' in axes) {
  minY = snapTo(box.min.y, ROW);
  if (minY < 0) minY = 0;
  pos.y = clean(minY + hy);
}
```

Проверенные эталонные значения (стандартный кирпич, базовая ориентация):
`min = (-1.25, 0, -0.625)`, `max = (1.25, 0.65, 0.625)`;
1-й ряд `pos.y = 0.325`, 2-й ряд `pos.y = 0.975`.
После X-поворота (лёг на бок) `hy = 0.625` и т.д. — значения пересчитываются
через AABB, зашивать размеры вручную не нужно.

Снап вызывается:

- при отпускании мыши — внутри `magnetSnap` (сначала `'xyz'`, в конце ещё раз `'xz'`);
- при `pointermove` во время драга (`'xz'` или `'y'` при Shift) — живое выравнивание;
- после любого поворота (`rotateBrick` → `'xyz'`);
- при `liftBrick` (PageUp/Down) и колесе во время драга → `'y'`.

### Магнит (метод pointerup, порядок операций)

`magnetSnap(brick)`:

1. `snapBrick(brick, 'xyz')` — базовое выравнивание по сеткам.
2. **Опора сверху (Y):** среди соседей, чей XZ-бокс **строго пересекается**
   (`ob.max.x > box.min.x && box.max.x > ob.min.x`, аналогично по Z), взять
   `delta = ob.max.y - box.min.y` с минимальным `|delta| ≤ MAGNET (0.3)`;
   применить `pos.y += delta` — кирпич встаёт точно на верхнюю грань соседа
   (например, 0 → 0.65 при `|delta|=0.65`… нет: delta считается от текущего
   низа; после шага 1 низ обычно уже на 0.65-сетке, delta близок к 0 или ±0.65;
   реально срабатывает, когда низ «висит» рядом с верхом соседа ≤ 0.3).
3. **Выравнивание X, затем Z** — `magnetAxisDelta(brick, box, axis)`:
   - отбор соседей: пересечение по второй горизонтальной оси **и** по Y
     (`ob.max.y >= box.min.y && box.max.y >= ob.min.y` — включая касание);
   - 4 кандидата дельты на оси: `ob.max − box.min`, `ob.min − box.max`
     (стык-в-стык), `ob.min − box.min`, `ob.max − box.max` (выравнивание граней);
   - выбирается кандидат с минимальным `|delta| ≤ 0.3`; применяется сдвиг,
     AABB пересчитывается, затем та же процедура для второй оси.
4. Финальный `snapBrick(brick, 'xz')` — сохранить кратность 0.625
   (магнитные сдвиги сохраняют её, но это страховка), `updateUI()`.

Работают типовые сценарии: встык к соседу (x: 0 → 2.5 при соседе в 0 и своём
начальном 2.7 после сеточного снапа), постановка сверху (y: 0.4 → 0.65… → 0.975),
выравнивание граней (x: 0.2 → 0).

---

## 7. Управление

### Мышь (bindPointer)

- **pointerdown (ЛКМ, на canvas):**
  - `setNDC(clientX, clientY)` — NDC от размеров `window`;
  - `pickBrick()` — raycast только по `bricks[].mesh`
    (`intersectObjects(meshes, false)`, `userData.brick` → объект);
  - промах → `selectBrick(null)` (клик по пустому месту снимает выделение);
  - попадание → `selectBrick(brick)`, создаётся drag:
    горизонтальная `Plane(normal (0,1,0), constant = -pos.y)` на высоте центра
    кирпича, `startPoint` — пересечение луча с плоскостью (fallback — текущая
    позиция), `startPos/startY/startNDCy/startClientX/Y/shift/moved`;
    **`controls.enabled = false`** (орбита не мешает), курсор `grabbing`.
- **pointermove (на window):**
  - если drag активен и кирпич удалён из `bricks` — drag сбросить;
  - флаг `moved` ставится при смещении > 3 px от начальной точки;
  - при смене `shiftKey` на лету — ребейз плоскости/стартов (см. код);
  - **без Shift:** рейкаст луча в плоскость драга,
    `pos.x/z = startPos + (пересечение − startPoint)`, затем `snapBrick('xz')`;
  - **с Shift:** `pos.y = startY + (NDC.y − startNDCy) * 8`, затем `snapBrick('y')`;
  - каждый шаг: `pos.y = clean(...)`, `updateUI()` (позиция видна в панели);
  - если drag нет — наведение: курсор `move` при попадании на кирпич.
- **pointerup (на window, button 0):** если drag —
  `magnetSnap(drag.brick)`, `controls.enabled = true`, курсор `default`,
  `drag = null`, `updateUI()`. **Это и есть «снап при отпускании».**
- **wheel (на canvas):** только во время drag — шаг на ряд:
  `dir = deltaY > 0 ? -1 : 1; pos.y += dir * def.h` (0.65), `snapBrick('y')`,
  обновить `startY/startNDCy`; `preventDefault`, `{ passive: false }`.

### Клавиатура (bindKeyboard, на window)

Игнор при зажатых Ctrl/Meta/Alt.

| Клавиша | Действие |
|---|---|
| ← → ↑ ↓ | орбита камеры: `orbitCamera(±0.12, 0)` / `orbitCamera(0, ∓0.08)` — сдвиг theta/phi в сферических координатах вокруг `controls.target`, phi зажат в [0.15, π·0.495], `makeSafe()` |
| Esc | `selectBrick(null)` |
| c | `addStandardBrick()` — создать кирпич (дубль кнопки «Создать кирпич»); работает всегда, до проверок `!selected`/drag |
| PageUp / PageDown | `liftBrick(±1)`: `pos.y ± def.h` + `snapBrick('y')` (только если нет drag) |
| Delete / Backspace | `removeBrick(selected)` (приоритет выше вращений; игнор при drag) |
| x | `rotateBrick(selected, 'x')` |
| y или r | `rotateBrick(selected, 'y')` |
| z | `rotateBrick(selected, 'z')` |

Вращения недоступны, пока ничего не выделено или идёт drag.
`var lower = k.toLowerCase()` вычисляется сразу после Esc — обработчик `c`
идёт до `PageUp` и до `if (!selected) return`.

### rotateBrick — поворот ровно на 90° с пересчётом снапа

```js
q = Quaternion.setFromAxisAngle(axis, HALF_PI);
quaternion.premultiply(q);            // поворот в МИРОВЫХ осях (не локальных!)
rotation.setFromQuaternion(quaternion);
rotation.x/y/z = normalizeAngle(...); // каждая компонента → кратна 90°
quaternion.setFromEuler(rotation);    // пересборка
snapBrick(brick, 'xyz');              // пересчёт по НОВОМУ AABB
```

`premultiply` даёт предсказуемые Euler-тройки (проверено):

- старт 0/0/0 → X: **90/0/0** → Y: **90/0/270** → Z: **0/90/0**;
- `R`/`Y` с базы → **0/90/0**.

---

## 8. Выделение (applySelectionVisual / selectBrick)

- Выделенный: `material.color = SELECTED_COLOR` (оранжевый 0xe0762c),
  `material.emissive = EMISSIVE_SELECTED` (0x441c00).
- Снятый: цвет обратно `BRICK_COLOR`, emissive `0x000000`.
- **Рёбра всегда `EDGE_COLOR` (0x000000)** — по ТЗ швы видны как на чертеже.
- `selectBrick(brick)`: если тот же объект — просто обновить визуал/UI;
  иначе снять визуал с предыдущего, назначить нового, оба обновить.

---

## 9. UI (index.html + updateUI)

### HTML-каркас (точные id и тексты)

- `#viewport` — под canvas (position absolute inset 0, z-index 1).
- `#badge` (правый верх, поверх сцены):
  «Базовый модуль: **0.625** юнита = **62.5 мм** · кирпич **250×125×65** · ряд **65 мм**»
  (числа в `<b>`).
- `#sidebar` (левая панель, 306 px):
  - `<h1>` «Дровяная печь из кирпичей»;
  - `.sub` «3D-конструктор · кирпич 250×125×65 мм · 1 юнит = 100 мм · новый кирпич встаёт рядом с существующими»;
  - секция «Кирпичи»: `#btn-add.btn.primary` «Создать кирпич»,
    `#btn-add-half.btn` «Создать половинный кирпич»,
    `#btn-delete.btn.danger` «Удалить выделенный» (`disabled` без выделения);
  - секция «Проект (.stove / YAML)»: `#btn-save.btn.success` «Сохранить проект»,
    `#btn-load.btn` «Загрузить проект», скрытый `#file-input`
    (`accept=".stove,.yaml,.yml"`, `display:none`);
  - секция «Состояние»: `#count.stat` «Кирпичей на сцене: N»,
    `#info.info` — либо «Ничего не выделено.<br>Кликните по кирпичу левой кнопкой.»,
    либо `<b>Ярлык типа</b><br>Позиция: X 0.00 · Y 0.33 · Z 0.00<br>Поворот: 90° / 0° / 0°`
    (координаты через `fmt = toFixed(2)`, углы через `deg()`, разделитель «·»);
  - секция «Памятка по управлению» (`ul.help`, элементы `kbd`):
    ЛКМ выделить/тянуть; ПКМ — камера, колесо — масштаб; стрелки — камера;
    **C — создать кирпич** (дубль кнопки); Shift+мышь — подъём/спуск,
    колесо во время драга — шаг на ряд (65 мм);
    X / Y или R / Z — повороты 90°; PageUp/PageDown — ряд; Delete/Backspace —
    удалить; Esc — снять выделение;
  - `.note`: текст про спавн нового кирпича рядом с существующими (не перекрывая),
    снап на сетку 62.5 мм (края на линии), магнит
    (встык, выравнивание граней, постановка сверху), высота ряда строго 65 мм,
    клик по пустому месту снимает выделение.

### updateUI()

- `elCount.textContent = 'Кирпичей на сцене: ' + bricks.length;`
- `btnDelete.disabled = !selected;`
- `elInfo` — см. выше; позиция читается из `selected.mesh.position`,
  поворот из `selected.mesh.rotation` (компоненты rad → `deg()`).

### Кнопки (bindUI)

- Создать кирпич → `addStandardBrick()` (= `selectBrick(createBrick({ type:'standard' }))`
  — новый кирпич сразу выделен; дублируется клавишей **C**);
- Создать половинный → аналогично `selectBrick(createBrick({ type:'half' }))`;
- Удалить → `removeBrick(selected)`;
- Сохранить → `saveProject()`;
- Загрузить → `fileInput.click()`;
- `fileInput change` → `FileReader.readAsText(file, 'utf-8')` →
  `loadProjectText(String(reader.result))`, затем `event.target.value = ''`
  (повторный выбор того же файла возможен); ошибки — `alert()`.

---

## 10. YAML-формат (`.stove`)

Сериализация — `jsyaml.dump(doc, { noRefs: true, indent: 2, lineWidth: -1 })`:

```yaml
format: stove-project
version: 1
created: '2026-09-23T…Z'          # new Date().toISOString()
note: 'Длина: 1 unit = 100 mm. Углы: радианы, кратны PI/2.'
brick_count: 2
bricks:
  - type: standard                 # или half
    position: {x: 0, y: 0.325, z: 0}   # round3 (3 знака)
    rotation: {x: 0, y: 0, z: 0}       # радианы, round3
```

Скачивание: `Blob` → `URL.createObjectURL` → `<a download="pechka.stove">.click()`
→ `revokeObjectURL` через 1 с.

Загрузка `loadProjectText(text)`:

1. `jsyaml.load` в try/catch (alert при ошибке).
2. Валидация: объект с `Array.isArray(data.bricks)`, иначе alert и выход
   (сцена НЕ трогается).
3. `clearBricks()` — полная очистка.
4. Для каждой записи: не-объект → skipped; `type` — только известный, иначе
   `standard`; позиция — три finite-числа, иначе skipped; поворот —
   `Number(r.*) || 0`, компоненты проходят `normalizeAngle` внутри `createBrick`.
   Позиция ставится **точно, без снапа**.
5. `selectBrick(null)` (после загрузки ничего не выделено), `updateUI()`.
6. Если были skipped — alert со счётчиками.

---

## 11. CSS (css/app/style.css)

Тёмная тема, кратко по ключевым значениям:

- `html,body`: margin 0, 100%×100%, `overflow:hidden`, `user-select:none`,
  шрифт «Segoe UI», Roboto, …; фон `#14171c`, текст `#e8eaed`.
- `#viewport`: absolute inset 0, z-index 1; canvas display block.
- `#sidebar`: absolute слева 0, ширина **306px**, z-index 10,
  фон `rgba(20,24,31,0.97)`, padding 16/16/24, `overflow-y:auto`,
  `border-right 1px #323a46`, тень `4px 0 18px rgba(0,0,0,.35)`.
- `#sidebar h1`: 18px, цвет `#ffb454` (оранжевый акцент).
- `.sub`: 12px `#98a2ad`.
- `h2` секции: 11px, uppercase, letter-spacing 1.2px, `#7f8a97`,
  border-bottom `#2b323d`.
- `.btn`: block на всю ширину, padding 10/12, radius 8, фон `#242b36`,
  border `#3b4453`, 14px, transition background .15s; `:disabled` opacity .4.
  - `.primary` фон `#a84531` (тёмно-красный, как кирпич), hover `#bd5340`;
  - `.success` `#2e6b45` / hover `#377d52`;
  - `.danger` `#5a2a2a` / hover `#6b3232`; `:disabled` — нейтральный `#2a2f38`.
- `.info`: 13px, фон `#1a1f27`, border `#2b323d`, radius 8, min-height 54px,
  `font-variant-numeric: tabular-nums`; `b` — `#ffb454`.
- `.help`: list-style none, 12.5px; `kbd` — фон `#0f1319`, border `#3b4453`,
  radius 4, padding 0 5px, 11px.
- `.note`: 11.5px `#7f8a97`.
- `#badge`: absolute top 12 right 14, z-index 5, фон `rgba(20,24,31,.85)`,
  border `#323a46`, radius 8, 12px; `b` — `#ffb454`; `pointer-events:none`.
- Media ≤720px: sidebar во всю ширину сверху, max-height 45%.

---

## 12. Порядок инициализации

В конце IIFE: `init();` — и больше ничего. `init` берёт DOM-хэндлы, строит сцену,
вешает обработчики (`bindUI`, `bindPointer`, `bindKeyboard`, `resize`),
`updateUI()`, запускает `setAnimationLoop`. Состояние: `bricks[]`,
`selected`, `drag`, `pointerNDC` — замыкание, глобального состояния нет
(кроме `THREE`/`jsyaml`/`THREE.OrbitControls` из libs).

---

## 13. Известенные подводные камни (важно при доработке/тестах)

1. **`matrixWorld` до первого render.** Three.js обновляет `matrixWorld` только при
   рендере (или явным `updateMatrixWorld`). Синтетический raycast/клики до первого
   кадра работают по identity-матрицам (все кирпичи «в начале координат»).
   В обычном usage это не видно (setAnimationLoop рисует постоянно), но в
   headless-тестах **перед каждым `pointerdown`/raycast нужно вызывать
   `scene.updateMatrixWorld(true)`**.
2. **`getAABB` сам вызывает `updateMatrixWorld(true)`** для своего mesh — снап
   от этого защищён, pickBrick — нет.
3. Пиксельные проверки через `gl.readPixels` требуют
   `WebGLRenderer({ preserveDrawingBuffer: true })` — патчить **только в тестовой
   копии**, в боевой сборке не нужен (лишняя цена).
4. Headless Firefox: CDN-URL виснут (доказательство офлайна) — тесты гоняются по
   `file://`; `firefox --screenshot` снимает после синхронного выполнения скриптов,
   поэтому тест-оверлей должен финализироваться **синхронно**
   (ручной `renderer.render` + один `readPixels` на весь кадр вместо тысяч
   пиксельных вызовов — иначе упирается в таймаут на software GL).
5. `toFixed(2)` для значений в 0.005: `0.325→"0.33"`, `0.975→"0.97"`,
   `0.625→"0.63"` — учитывать при точных проверках (допуск ≥ 0.005).
6. ЛКМ занята приложением (`mouseButtons.LEFT = null`) — не «чинить» на орбиту.
7. `pkill -f firefox` убивает собственную shell-команду (совпадение по cmdline) —
   использовать `pkill -f 'firefox --headless'` или `pgrep` с точным шаблоном.

---

## 14. Как проверять, что проект в порядке

1. `node --check js/app/app.js` — синтаксис.
2. `grep -c 'src="http\|href="http' index.html` → должно быть **0** (офлайн).
3. Структура каталогов — раздел 2, порядок подключения скриптов — раздел 2.
4. Ручная smoke-проверка в браузере (file://):
   - создать кирпич → пустая сцена: появляется в центре (0, 0.325, 0), выделен
     оранжевым; при занятом центре — рядом, вне существующих, кратно 0.625;
     то же по клавише **C**;
   - PageUp/Down — прыгает на 0.65; drag + отпускание — позиция X/Z кратна 0.625,
     низ — 0.65-сетки;
   - X, Y, Z — Euler как в разделе 7; после каждого поворота кирпич не проваливается
     и не висит в воздухе (края на сетке);
   - второй кирпич рядом → при отпускании примагничивается встык/сверху
     (x: 0.2→0, 2.7→2.5; y сверху → 0.975 при низе соседа 0.65);
   - сохранить → открывалка файла `pechka.stove`; загрузить — сцена восстанавливается
     точь-в-точь, выделение снято;
   - рёбра чёрные, швы видны, небо ~#8fb0d3, земля ~#c9c4b8.
5. Автотесты гоняются headless-фотографией оверлея: **58 проверок** (spawn в центре
   при пустой сцене, края на сетке после каждой операции, drag, повороты, магнит,
   YAML, спавн-вне-существующих + клавиша C, пиксели: небо/земля/красные пиксели/
   тёмные рёбра) — при доработках тест-оверлей воспроизводится по разделу 13.4.
   Ожидание «half spawns at center» валидно, только если первый кирпич уже увлечён
   drag'ом из центра (иначе half встанет рядом — это норма нового спавна).

---

## 15. Чек-лист воссоздания с нуля

1. Создать дерево раздела 2, скачать три libs (r128-совместимые:
   `three.min.js` r128, `OrbitControls.js` из examples/jsm-UMD-версии,
   `js-yaml.min.js`).
2. Написать `index.html` по разделу 8 (язык ru, viewport, badge, sidebar с
   кнопками/info/памяткой/note, 4 script-тега в конце body).
3. Написать `style.css` по разделу 11.
4. Написать `app.js` по разделам 3–10 в указанном порядке функций
   (константы → утилиты → init/animate/resize → NDC/pick/AABB/snap/magnet →
   spawn/create/dispose/remove/clear → selection → rotate/lift →
   pointer/keyboard/UI → save/load → updateUI → `init()`).
5. Прогнать раздел 14.
