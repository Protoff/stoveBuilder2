(function () {
  'use strict';

  var GRID = 0.625;
  var ROW = 0.65;
  var MAGNET = 0.3;
  var HALF_PI = Math.PI / 2;

  var BRICK_TYPES = {
    standard: { id: 'standard', label: 'Стандартный 250×125×65', w: 2.5, h: 0.65, d: 1.25 },
    half:     { id: 'half',     label: 'Половинный 125×125×65', w: 1.25, h: 0.65, d: 1.25 }
  };

  var BRICK_COLOR = 0xa84531;
  var SELECTED_COLOR = 0xe0762c;
  var EDGE_COLOR = 0x000000;
  var EMISSIVE_SELECTED = 0x441c00;

  var scene, camera, renderer, controls, raycaster;
  var bricks = [];
  var selected = null;
  var drag = null;
  var pointerNDC = new THREE.Vector2();

  var elCount, elInfo, btnAdd, btnAddHalf, btnDelete, btnSave, btnLoad, fileInput, viewport;

  function clean(v) { return Math.round(v * 1e6) / 1e6; }
  function snapTo(v, step) { return Math.round(v / step) * step; }
  function normalizeAngle(a) { return Math.round(a / HALF_PI) * HALF_PI; }
  function fmt(v) { return v.toFixed(2); }
  function deg(a) {
    var d = a * 180 / Math.PI;
    d = ((d % 360) + 360) % 360;
    return Math.round(d);
  }

  function init() {
    viewport = document.getElementById('viewport');
    elCount = document.getElementById('count');
    elInfo = document.getElementById('info');
    btnAdd = document.getElementById('btn-add');
    btnAddHalf = document.getElementById('btn-add-half');
    btnDelete = document.getElementById('btn-delete');
    btnSave = document.getElementById('btn-save');
    btnLoad = document.getElementById('btn-load');
    fileInput = document.getElementById('file-input');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fb0d3);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(14, 9, 16);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    viewport.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    var sun = new THREE.DirectionalLight(0xfff2dd, 0.85);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 100;
    scene.add(sun);

    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ color: 0xc9c4b8 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    var gridAccent = new THREE.GridHelper(60, 24, 0xc2c8d0, 0xd0d5dc);
    gridAccent.position.y = 0.01;
    scene.add(gridAccent);

    var gridMain = new THREE.GridHelper(60, 96, 0x3f4a58, 0x556072);
    gridMain.position.y = 0.02;
    scene.add(gridMain);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 3;
    controls.maxDistance = 120;

    raycaster = new THREE.Raycaster();

    bindUI();
    bindPointer();
    bindKeyboard();
    window.addEventListener('resize', onResize);

    updateUI();
    renderer.setAnimationLoop(animate);
  }

  function animate() {
    controls.update();
    renderer.render(scene, camera);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function setNDC(clientX, clientY) {
    pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  }

  function pickBrick() {
    raycaster.setFromCamera(pointerNDC, camera);
    var meshes = bricks.map(function (b) { return b.mesh; });
    var hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    return { brick: hits[0].object.userData.brick, point: hits[0].point.clone() };
  }

  function getAABB(brick) {
    var def = brick.def;
    var min = new THREE.Vector3(Infinity, Infinity, Infinity);
    var max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    var v = new THREE.Vector3();
    var sx, sy, sz;
    brick.mesh.updateMatrixWorld(true);
    for (sx = -1; sx <= 1; sx += 2) {
      for (sy = -1; sy <= 1; sy += 2) {
        for (sz = -1; sz <= 1; sz += 2) {
          v.set(sx * def.w / 2, sy * def.h / 2, sz * def.d / 2);
          v.applyMatrix4(brick.mesh.matrixWorld);
          min.min(v);
          max.max(v);
        }
      }
    }
    return { min: min, max: max };
  }

  function snapBrick(brick, axes) {
    axes = axes || 'xyz';
    var box = getAABB(brick);
    var pos = brick.mesh.position;
    var hx = (box.max.x - box.min.x) / 2;
    var hy = (box.max.y - box.min.y) / 2;
    var hz = (box.max.z - box.min.z) / 2;

    if (axes.indexOf('x') !== -1) pos.x = clean(snapTo(box.min.x, GRID) + hx);
    if (axes.indexOf('z') !== -1) pos.z = clean(snapTo(box.min.z, GRID) + hz);
    if (axes.indexOf('y') !== -1) {
      var minY = snapTo(box.min.y, ROW);
      if (minY < 0) minY = 0;
      pos.y = clean(minY + hy);
    }
  }

  function magnetAxisDelta(brick, box, axis) {
    var otherAxis = axis === 'x' ? 'z' : 'x';
    var best = null;
    var bestAbs = Infinity;
    for (var i = 0; i < bricks.length; i++) {
      var other = bricks[i];
      if (other === brick) continue;
      var ob = getAABB(other);
      if (!(ob.max[otherAxis] >= box.min[otherAxis] &&
            box.max[otherAxis] >= ob.min[otherAxis] &&
            ob.max.y >= box.min.y && box.max.y >= ob.min.y)) continue;
      var deltas = [
        ob.max[axis] - box.min[axis],
        ob.min[axis] - box.max[axis],
        ob.min[axis] - box.min[axis],
        ob.max[axis] - box.max[axis]
      ];
      for (var d = 0; d < deltas.length; d++) {
        var ad = Math.abs(deltas[d]);
        if (ad <= MAGNET && ad < bestAbs) {
          bestAbs = ad;
          best = deltas[d];
        }
      }
    }
    return best;
  }

  function magnetSnap(brick) {
    snapBrick(brick, 'xyz');

    var box = getAABB(brick);
    var support = null;
    var supportAbs = Infinity;
    for (var i = 0; i < bricks.length; i++) {
      var other = bricks[i];
      if (other === brick) continue;
      var ob = getAABB(other);
      if (!(ob.max.x > box.min.x && box.max.x > ob.min.x &&
            ob.max.z > box.min.z && box.max.z > ob.min.z)) continue;
      var delta = ob.max.y - box.min.y;
      if (Math.abs(delta) <= MAGNET && Math.abs(delta) < supportAbs) {
        supportAbs = Math.abs(delta);
        support = delta;
      }
    }
    if (support !== null) {
      brick.mesh.position.y = clean(brick.mesh.position.y + support);
      box = getAABB(brick);
    }

    var dx = magnetAxisDelta(brick, box, 'x');
    if (dx !== null) {
      brick.mesh.position.x = clean(brick.mesh.position.x + dx);
      box = getAABB(brick);
    }
    var dz = magnetAxisDelta(brick, box, 'z');
    if (dz !== null) {
      brick.mesh.position.z = clean(brick.mesh.position.z + dz);
    }

    snapBrick(brick, 'xz');
    updateUI();
  }

  function spawnPosition(def) {
    var y = def.h / 2;
    var boxes = [];
    for (var b = 0; b < bricks.length; b++) boxes.push(getAABB(bricks[b]));
    var hw = def.w / 2, hh = def.h / 2, hd = def.d / 2;

    function free(x, z) {
      var mnx = x - hw, mny = y - hh, mnz = z - hd;
      var mxx = x + hw, mxy = y + hh, mxz = z + hd;
      for (var i = 0; i < boxes.length; i++) {
        var ob = boxes[i];
        if (mnx < ob.max.x && mxx > ob.min.x &&
            mny < ob.max.y && mxy > ob.min.y &&
            mnz < ob.max.z && mxz > ob.min.z) return false;
      }
      return true;
    }

    for (var r = 0; r < 64; r++) {
      for (var i = -r; i <= r; i++) {
        for (var j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          var x = i * GRID;
          var z = j * GRID;
          if (free(x, z)) return [x, y, z];
        }
      }
    }
    return [0, y, 0];
  }

  function addStandardBrick() {
    selectBrick(createBrick({ type: 'standard' }));
  }

  function createBrick(opts) {
    opts = opts || {};
    var type = BRICK_TYPES[opts.type] ? opts.type : 'standard';
    var def = BRICK_TYPES[type];

    var geometry = new THREE.BoxGeometry(def.w, def.h, def.d);
    var material = new THREE.MeshLambertMaterial({ color: BRICK_COLOR });
    var mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    var edgeGeometry = new THREE.EdgesGeometry(geometry);
    var edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
    var edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    mesh.add(edges);

    var brick = { mesh: mesh, edges: edges, def: def, type: type };
    mesh.userData.brick = brick;

    if (opts.position && opts.position.length === 3 &&
        opts.position.every(function (n) { return Number.isFinite(Number(n)); })) {
      mesh.position.set(Number(opts.position[0]), Number(opts.position[1]), Number(opts.position[2]));
    } else {
      var sp = spawnPosition(def);
      mesh.position.set(sp[0], sp[1], sp[2]);
    }

    if (opts.rotation && opts.rotation.length === 3) {
      mesh.rotation.set(
        Number(opts.rotation[0]) || 0,
        Number(opts.rotation[1]) || 0,
        Number(opts.rotation[2]) || 0
      );
      mesh.rotation.x = normalizeAngle(mesh.rotation.x);
      mesh.rotation.y = normalizeAngle(mesh.rotation.y);
      mesh.rotation.z = normalizeAngle(mesh.rotation.z);
      mesh.quaternion.setFromEuler(mesh.rotation);
    }

    scene.add(mesh);
    bricks.push(brick);
    applySelectionVisual(brick);
    updateUI();
    return brick;
  }

  function disposeBrick(brick) {
    brick.mesh.remove(brick.edges);
    brick.edges.geometry.dispose();
    brick.edges.material.dispose();
    brick.mesh.geometry.dispose();
    brick.mesh.material.dispose();
    scene.remove(brick.mesh);
  }

  function removeBrick(brick) {
    if (!brick) return;
    if (drag && drag.brick === brick) {
      drag = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = 'default';
    }
    var idx = bricks.indexOf(brick);
    if (idx !== -1) bricks.splice(idx, 1);
    if (selected === brick) selected = null;
    disposeBrick(brick);
    updateUI();
  }

  function clearBricks() {
    if (drag) {
      drag = null;
      controls.enabled = true;
    }
    selected = null;
    while (bricks.length) disposeBrick(bricks.pop());
    updateUI();
  }

  function applySelectionVisual(brick) {
    var isSel = brick === selected;
    brick.mesh.material.color.setHex(isSel ? SELECTED_COLOR : BRICK_COLOR);
    brick.mesh.material.emissive.setHex(isSel ? EMISSIVE_SELECTED : 0x000000);
    brick.edges.material.color.setHex(EDGE_COLOR);
  }

  function selectBrick(brick) {
    if (selected === brick) {
      if (selected) applySelectionVisual(selected);
      updateUI();
      return;
    }
    var prev = selected;
    selected = brick;
    if (prev) applySelectionVisual(prev);
    if (selected) applySelectionVisual(selected);
    updateUI();
  }

  function rotateBrick(brick, axis) {
    if (!brick) return;
    var vec;
    if (axis === 'x') vec = new THREE.Vector3(1, 0, 0);
    else if (axis === 'y') vec = new THREE.Vector3(0, 1, 0);
    else vec = new THREE.Vector3(0, 0, 1);

    var q = new THREE.Quaternion().setFromAxisAngle(vec, HALF_PI);
    brick.mesh.quaternion.premultiply(q);
    brick.mesh.rotation.setFromQuaternion(brick.mesh.quaternion);
    brick.mesh.rotation.x = normalizeAngle(brick.mesh.rotation.x);
    brick.mesh.rotation.y = normalizeAngle(brick.mesh.rotation.y);
    brick.mesh.rotation.z = normalizeAngle(brick.mesh.rotation.z);
    brick.mesh.quaternion.setFromEuler(brick.mesh.rotation);
    snapBrick(brick, 'xyz');
    updateUI();
  }

  function liftBrick(brick, direction) {
    if (!brick) return;
    brick.mesh.position.y += direction * brick.def.h;
    snapBrick(brick, 'y');
    updateUI();
  }

  function bindPointer() {
    renderer.domElement.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      setNDC(event.clientX, event.clientY);
      var hit = pickBrick();

      if (!hit) {
        selectBrick(null);
        return;
      }

      var brick = hit.brick;
      selectBrick(brick);

      var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -brick.mesh.position.y);
      var startPoint = new THREE.Vector3();
      var ok = raycaster.ray.intersectPlane(plane, startPoint);
      if (!ok) startPoint.set(brick.mesh.position.x, brick.mesh.position.y, brick.mesh.position.z);

      drag = {
        brick: brick,
        plane: plane,
        startPoint: startPoint.clone(),
        startPos: brick.mesh.position.clone(),
        startY: brick.mesh.position.y,
        startNDCy: pointerNDC.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
        shift: event.shiftKey,
        moved: false
      };
      controls.enabled = false;
      renderer.domElement.style.cursor = 'grabbing';
    });

    window.addEventListener('pointermove', function (event) {
      setNDC(event.clientX, event.clientY);

      if (drag) {
        var brick = drag.brick;
        if (bricks.indexOf(brick) === -1) {
          drag = null;
          controls.enabled = true;
          renderer.domElement.style.cursor = 'default';
          return;
        }

        if (!drag.moved &&
            Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) > 3) {
          drag.moved = true;
        }

        if (event.shiftKey !== drag.shift) {
          drag.shift = event.shiftKey;
          drag.startNDCy = pointerNDC.y;
          drag.startY = brick.mesh.position.y;
          drag.plane.constant = -brick.mesh.position.y;
          raycaster.setFromCamera(pointerNDC, camera);
          var rebased = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(drag.plane, rebased)) {
            drag.startPoint.copy(rebased);
            drag.startPos.copy(brick.mesh.position);
          }
        }

        if (drag.shift) {
          brick.mesh.position.y = drag.startY + (pointerNDC.y - drag.startNDCy) * 8;
          snapBrick(brick, 'y');
        } else {
          raycaster.setFromCamera(pointerNDC, camera);
          var p = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(drag.plane, p)) {
            brick.mesh.position.x = drag.startPos.x + (p.x - drag.startPoint.x);
            brick.mesh.position.z = drag.startPos.z + (p.z - drag.startPoint.z);
            snapBrick(brick, 'xz');
          }
        }

        brick.mesh.position.y = clean(brick.mesh.position.y);
        updateUI();
        return;
      }

      var hit = pickBrick();
      renderer.domElement.style.cursor = hit ? 'move' : 'default';
    });

    window.addEventListener('pointerup', function (event) {
      if (!drag) return;
      if (event.button !== 0) return;
      magnetSnap(drag.brick);
      controls.enabled = true;
      renderer.domElement.style.cursor = 'default';
      drag = null;
      updateUI();
    });

    renderer.domElement.addEventListener('wheel', function (event) {
      if (!drag) return;
      event.preventDefault();
      var brick = drag.brick;
      var dir = event.deltaY > 0 ? -1 : 1;
      brick.mesh.position.y += dir * brick.def.h;
      snapBrick(brick, 'y');
      drag.startY = brick.mesh.position.y;
      drag.startNDCy = pointerNDC.y;
      updateUI();
    }, { passive: false });
  }

  function orbitCamera(deltaTheta, deltaPhi) {
    var offset = camera.position.clone().sub(controls.target);
    var spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaTheta;
    spherical.phi -= deltaPhi;
    spherical.phi = Math.max(0.15, Math.min(Math.PI * 0.495, spherical.phi));
    spherical.makeSafe();
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
  }

  function bindKeyboard() {
    window.addEventListener('keydown', function (event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      var k = event.key;

      if (k === 'ArrowLeft') { event.preventDefault(); orbitCamera(0.12, 0); return; }
      if (k === 'ArrowRight') { event.preventDefault(); orbitCamera(-0.12, 0); return; }
      if (k === 'ArrowUp') { event.preventDefault(); orbitCamera(0, -0.08); return; }
      if (k === 'ArrowDown') { event.preventDefault(); orbitCamera(0, 0.08); return; }

      if (k === 'Escape') { selectBrick(null); return; }

      var lower = k.toLowerCase();
      if (lower === 'c') {
        event.preventDefault();
        addStandardBrick();
        return;
      }

      if (k === 'PageUp' && selected) {
        event.preventDefault();
        if (!drag) liftBrick(selected, 1);
        return;
      }
      if (k === 'PageDown' && selected) {
        event.preventDefault();
        if (!drag) liftBrick(selected, -1);
        return;
      }

      if (drag) return;

      if ((k === 'Delete' || k === 'Backspace') && selected) {
        event.preventDefault();
        removeBrick(selected);
        return;
      }

      if (!selected) return;

      if (lower === 'x') rotateBrick(selected, 'x');
      else if (lower === 'y' || lower === 'r') rotateBrick(selected, 'y');
      else if (lower === 'z') rotateBrick(selected, 'z');
    });
  }

  function bindUI() {
    btnAdd.addEventListener('click', addStandardBrick);
    btnAddHalf.addEventListener('click', function () {
      selectBrick(createBrick({ type: 'half' }));
    });
    btnDelete.addEventListener('click', function () {
      if (selected) removeBrick(selected);
    });
    btnSave.addEventListener('click', saveProject);
    btnLoad.addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { loadProjectText(String(reader.result)); };
      reader.onerror = function () { alert('Не удалось прочитать файл.'); };
      reader.readAsText(file, 'utf-8');
      event.target.value = '';
    });
  }

  function round3(v) { return Math.round(v * 1000) / 1000; }

  function saveProject() {
    var doc = {
      format: 'stove-project',
      version: 1,
      created: new Date().toISOString(),
      note: 'Длина: 1 unit = 100 mm. Углы: радианы, кратны PI/2.',
      brick_count: bricks.length,
      bricks: bricks.map(function (b) {
        return {
          type: b.type,
          position: {
            x: round3(b.mesh.position.x),
            y: round3(b.mesh.position.y),
            z: round3(b.mesh.position.z)
          },
          rotation: {
            x: round3(b.mesh.rotation.x),
            y: round3(b.mesh.rotation.y),
            z: round3(b.mesh.rotation.z)
          }
        };
      })
    };

    var yaml;
    try {
      yaml = jsyaml.dump(doc, { noRefs: true, indent: 2, lineWidth: -1 });
    } catch (e) {
      alert('Не удалось сформировать YAML: ' + e.message);
      return;
    }

    var blob = new Blob([yaml], { type: 'application/x-yaml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pechka.stove';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function loadProjectText(text) {
    var data;
    try {
      data = jsyaml.load(text);
    } catch (e) {
      alert('Ошибка разбора YAML: ' + e.message);
      return;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.bricks)) {
      alert('Файл не похож на проект печи: нет списка bricks.');
      return;
    }

    clearBricks();

    var loaded = 0;
    var skipped = 0;

    for (var i = 0; i < data.bricks.length; i++) {
      var item = data.bricks[i];
      if (!item || typeof item !== 'object') { skipped++; continue; }

      var type = BRICK_TYPES[item.type] ? item.type : 'standard';
      var p = item.position || {};
      var r = item.rotation || {};
      var px = Number(p.x), py = Number(p.y), pz = Number(p.z);
      if (![px, py, pz].every(Number.isFinite)) { skipped++; continue; }

      createBrick({
        type: type,
        position: [px, py, pz],
        rotation: [Number(r.x) || 0, Number(r.y) || 0, Number(r.z) || 0]
      });
      loaded++;
    }

    selectBrick(null);
    updateUI();

    if (skipped > 0) {
      alert('Загружено кирпичей: ' + loaded + '. Пропущено записей: ' + skipped + '.');
    }
  }

  function updateUI() {
    elCount.textContent = 'Кирпичей на сцене: ' + bricks.length;
    btnDelete.disabled = !selected;

    if (!selected) {
      elInfo.innerHTML = 'Ничего не выделено.<br>Кликните по кирпичу левой кнопкой.';
      return;
    }

    var p = selected.mesh.position;
    var r = selected.mesh.rotation;
    elInfo.innerHTML =
      '<b>' + selected.def.label + '</b><br>' +
      'Позиция: X ' + fmt(p.x) + ' · Y ' + fmt(p.y) + ' · Z ' + fmt(p.z) + '<br>' +
      'Поворот: ' + deg(r.x) + '° / ' + deg(r.y) + '° / ' + deg(r.z) + '°';
  }

  init();
})();
