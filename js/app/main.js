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
  var undoStack = [];
  var redoStack = [];
  var STORAGE_KEY = 'stove_current_project';
  var MAX_HISTORY = 20;

  var elCount, elInfo, btnAdd, btnAddHalf, btnDelete, btnSave, btnLoad, btnPdf;
  var btnUndo, btnRedo, btnClear, fileInput, viewport;

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
    btnPdf = document.getElementById('btn-pdf');
    btnUndo = document.getElementById('btn-undo');
    btnRedo = document.getElementById('btn-redo');
    btnClear = document.getElementById('btn-clear');
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
    restoreFromLocalStorage();
    historyInit();
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
    recordSceneChange();
  }

  function addHalfBrick() {
    selectBrick(createBrick({ type: 'half' }));
    recordSceneChange();
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
    recordSceneChange();
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

  function clearAll() {
    clearBricks();
    historyPush();
    storageRemove(STORAGE_KEY);
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
    recordSceneChange();
  }

  function liftBrick(brick, direction) {
    if (!brick) return;
    brick.mesh.position.y += direction * brick.def.h;
    snapBrick(brick, 'y');
    updateUI();
    recordSceneChange();
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
      var moved = drag.moved;
      magnetSnap(drag.brick);
      controls.enabled = true;
      renderer.domElement.style.cursor = 'default';
      drag = null;
      if (moved) recordSceneChange();
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
      recordSceneChange();
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
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        var ck = event.key.toLowerCase();
        if (ck === 'z') { event.preventDefault(); undo(); return; }
        if (ck === 'y') { event.preventDefault(); redo(); return; }
      }
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
    btnAddHalf.addEventListener('click', addHalfBrick);
    btnDelete.addEventListener('click', function () {
      if (selected) removeBrick(selected);
    });
    btnUndo.addEventListener('click', undo);
    btnRedo.addEventListener('click', redo);
    btnClear.addEventListener('click', clearAll);
    btnSave.addEventListener('click', saveProject);
    btnLoad.addEventListener('click', function () {
      fileInput.click();
    });
    btnPdf.addEventListener('click', downloadOrdersPDF);
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

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }

  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }

  function buildProjectDoc() {
    return {
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
  }

  function projectToYaml() {
    var result = { ok: false, yaml: null, error: null };
    try {
      result.yaml = jsyaml.dump(buildProjectDoc(), { noRefs: true, indent: 2, lineWidth: -1 });
      result.ok = true;
    } catch (e) {
      result.error = e.message;
    }
    return result;
  }

  function currentYaml() {
    return projectToYaml().yaml;
  }

  function saveProject() {
    var r = projectToYaml();
    if (!r.ok) {
      alert('Не удалось сформировать YAML: ' + r.error);
      return;
    }
    var blob = new Blob([r.yaml], { type: 'application/x-yaml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pechka.stove';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function saveToLocalStorage() {
    var yaml = currentYaml();
    if (yaml !== null) storageSet(STORAGE_KEY, yaml);
  }

  function recordSceneChange() {
    var yaml = currentYaml();
    if (yaml === null) return;
    undoStack.push(yaml);
    redoStack.length = 0;
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    saveToLocalStorage();
    updateUI();
  }

  function historyPush() {
    var yaml = currentYaml();
    if (yaml === null) return;
    undoStack.push(yaml);
    redoStack.length = 0;
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    updateUI();
  }

  function undo() {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    restoreFromYamlString(undoStack[undoStack.length - 1]);
    updateUI();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(redoStack.pop());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    restoreFromYamlString(undoStack[undoStack.length - 1]);
    updateUI();
  }

  function applyProjectData(data) {
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
    return { loaded: loaded, skipped: skipped };
  }

  function restoreFromYamlString(text) {
    var data;
    try {
      data = jsyaml.load(text);
    } catch (e) {
      return false;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.bricks)) return false;
    applyProjectData(data);
    return true;
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
    var result = applyProjectData(data);
    recordSceneChange();
    if (result.skipped > 0) {
      alert('Загружено кирпичей: ' + result.loaded + '. Пропущено записей: ' + result.skipped + '.');
    }
  }

  function restoreFromLocalStorage() {
    var saved = storageGet(STORAGE_KEY);
    if (saved === null || saved === '') return;
    restoreFromYamlString(saved);
  }

  function historyInit() {
    var yaml = currentYaml();
    if (yaml !== null) undoStack.push(yaml);
    updateUI();
  }

  var PDF_EPSILON = 0.05;
  var BRICK_STD_SIZES = [2.5, 1.25, 0.65];

  function pdfScale(v) { return Math.round(v * 100) / 100; }

  function nearestStdSize(v) {
    var best = BRICK_STD_SIZES[0];
    var bestDiff = Math.abs(v - best);
    for (var s = 1; s < BRICK_STD_SIZES.length; s++) {
      var d = Math.abs(v - BRICK_STD_SIZES[s]);
      if (d < bestDiff) { bestDiff = d; best = BRICK_STD_SIZES[s]; }
    }
    return best;
  }

  function rowHeightLevel(centerY, halfH) {
    var bottomY = round2(centerY - halfH);
    var level = Math.round(bottomY / ROW);
    var diff = Math.abs(bottomY - level * ROW);
    if (diff <= PDF_EPSILON) return level;
    return Math.round(bottomY / ROW);
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  function drawRowPage(doc, level, items, baseMinX, baseMaxX, baseMinZ, baseMaxZ) {
    var margin = 15;
    var headerH = 26;
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();

    var spanX = baseMaxX - baseMinX;
    var spanZ = baseMaxZ - baseMinZ;
    if (spanX === 0) spanX = 1;
    if (spanZ === 0) spanZ = 1;

    var availW = pageW - margin * 2;
    var availH = pageH - margin * 2 - headerH;
    var scale = Math.min(availW / spanX, availH / spanZ);
    var offX = margin + (availW - spanX * scale) / 2;
    var offZ = margin + headerH + (availH - spanZ * scale) / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('Ряд № ' + (level + 1), margin, margin + 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text('Масштаб: 1 юнит = ' + pdfScale(scale) + ' мм · кирпич 250×125×65 мм (вид сверху)', margin, margin + 19);
    doc.setTextColor(0, 0, 0);

    doc.setDrawColor(176, 176, 176);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([2, 2], 0);
    doc.rect(offX, offZ, spanX * scale, spanZ * scale, 'S');
    doc.setLineDashPattern([], 0);

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.setFillColor(224, 224, 224);

    var box = new THREE.Box3();
    var size = new THREE.Vector3();
    var center = new THREE.Vector3();
    for (var j = 0; j < items.length; j++) {
      var m = items[j].mesh;
      m.updateMatrixWorld(true);
      box.setFromObject(m);
      box.getSize(size);
      box.getCenter(center);
      var w = nearestStdSize(size.x) * scale;
      var h = nearestStdSize(size.z) * scale;
      var cx = snapTo(clean(center.x), GRID);
      var cz = snapTo(clean(center.z), GRID);
      var x = offX + (cx - baseMinX) * scale - w / 2;
      var y = offZ + (cz - baseMinZ) * scale - h / 2;
      doc.rect(x, y, w, h, 'FD');
    }
  }

  function downloadOrdersPDF() {
    if (bricks.length === 0) {
      alert('На сцене нет кирпичей — порядовку строить не из чего.');
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('Не загружена библиотека jsPDF (js/libs/jspdf.umd.min.js).');
      return;
    }

    var baseMinX = Infinity, baseMaxX = -Infinity, baseMinZ = Infinity, baseMaxZ = -Infinity;
    var rows = {};
    var box = new THREE.Box3();
    var size = new THREE.Vector3();
    var center = new THREE.Vector3();

    for (var i = 0; i < bricks.length; i++) {
      var brick = bricks[i];
      brick.mesh.updateMatrixWorld(true);
      box.setFromObject(brick.mesh);
      if (box.min.x < baseMinX) baseMinX = box.min.x;
      if (box.max.x > baseMaxX) baseMaxX = box.max.x;
      if (box.min.z < baseMinZ) baseMinZ = box.min.z;
      if (box.max.z > baseMaxZ) baseMaxZ = box.max.z;
      box.getSize(size);
      box.getCenter(center);
      var level = rowHeightLevel(center.y, size.y / 2);
      if (!rows[level]) rows[level] = [];
      rows[level].push(brick);
    }

    baseMinX = clean(baseMinX);
    baseMaxX = clean(baseMaxX);
    baseMinZ = clean(baseMinZ);
    baseMaxZ = clean(baseMaxZ);

    var levels = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });

    var doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    for (var r = 0; r < levels.length; r++) {
      if (r > 0) doc.addPage();
      drawRowPage(doc, levels[r], rows[levels[r]], baseMinX, baseMaxX, baseMinZ, baseMaxZ);
    }

    doc.save('poryadovka.pdf');
  }

  function updateUI() {
    elCount.textContent = 'Кирпичей на сцене: ' + bricks.length;
    btnDelete.disabled = !selected;
    btnUndo.disabled = undoStack.length <= 1;
    btnRedo.disabled = redoStack.length === 0;

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
