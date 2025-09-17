import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLOR_CONFIG = Object.freeze({
  hexFill: 0x2c3e50,        // Slate blue-gray
  hexBorder: 0x95a5a6,      // Steel gray
  pentagonFill: 0xf1c40f,   // Muted golden yellow
  pentagonBorder: 0x7d6608, // Bronze/dark ochre
  hoverBorder: 0x1abc9c,    // Bright teal glow
  activeHexFill: 0x27ae60,  // Vibrant emerald
});

const hoverBorderColor = new THREE.Color(COLOR_CONFIG.hoverBorder);
const activeHexColor = new THREE.Color(COLOR_CONFIG.activeHexFill);

const container = document.getElementById("globe-container");
if (!container) {
  throw new Error("Globe container element missing from the page.");
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setClearColor(0x02040b, 1);
container.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = "none";
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100%";

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x02040b, 18, 38);

const camera = new THREE.PerspectiveCamera(
  50,
  container.clientWidth / container.clientHeight,
  0.1,
  100
);
camera.position.set(0, 3.5, 12);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 7;
controls.maxDistance = 22;
controls.enablePan = false;
controls.target.set(0, 0, 0);
controls.update();

const clock = new THREE.Clock();

const globeRadius = 5;
const tileThickness = globeRadius * 0.22;
const frequency = 10; // Goldberg G(3,0) -> 12 pentagons + 80 hexagons = 92 tiles

const globeGroup = new THREE.Group();
scene.add(globeGroup);

globeGroup.add(createHalo(globeRadius));

const { group: tileGroup, counts } = createGoldbergSphere(
  globeRadius,
  tileThickness,
  frequency
);
globeGroup.add(tileGroup);
console.info("Tile distribution", counts);

scene.add(new THREE.AmbientLight(0x7b8bf3, 0.55));

const keyLight = new THREE.DirectionalLight(0xd7e7ff, 1.15);
keyLight.position.set(6, 10, 4);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x123b7a, 0.5);
rimLight.position.set(-6, -4, -3);
scene.add(rimLight);

const interactiveTiles = [];
tileGroup.traverse((child) => {
  if (child.isMesh) {
    interactiveTiles.push(child);
  }
});

const pentagonTiles = interactiveTiles.filter((tile) => tile.userData.sides === 5);
const referenceHexTile = interactiveTiles.find((tile) => tile.userData.sides === 6);
const baseHexRadius = referenceHexTile?.userData.tileRadius ?? tileThickness * 0.75;
const ENEMY_RADIUS = baseHexRadius * 0.8;
const ENEMY_TRAVEL_RADIUS = globeRadius + tileThickness + ENEMY_RADIUS * 0.9;
const ENEMY_ANGULAR_SPEED = Math.PI / 12;

const enemyGroup = new THREE.Group();
globeGroup.add(enemyGroup);

const enemyColor = new THREE.Color(0xe74c3c);
const enemyGeometry = new THREE.SphereGeometry(ENEMY_RADIUS, 16, 16);
const enemyMaterial = new THREE.MeshStandardMaterial({
  color: enemyColor.clone(),
  emissive: enemyColor.clone().multiplyScalar(0.4),
  roughness: 0.35,
  metalness: 0.2,
});

const waveConfig = Object.freeze({
  totalWaves: 10,
  enemiesPerWave: 10,
  spawnInterval: 0.8,
  spawnVariance: 0.3,
  initialDelay: 1.5,
  breakDuration: 2.4,
});

const waveState = {
  currentWaveIndex: -1,
  enemiesSpawned: 0,
  pendingWaveDelay: waveConfig.initialDelay,
  waveActive: false,
  wavesComplete: false,
  activeRoute: null,
};

const enemies = [];
let spawnCountdown = waveConfig.spawnInterval;
const tmpDirection = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpAxis = new THREE.Vector3();

const waveCounterElement = document.getElementById("wave-counter");
if (!waveCounterElement) {
  throw new Error("Wave counter element missing from the page.");
}
updateWaveCounter();

function getNextSpawnTimer() {
  const offset = (Math.random() - 0.5) * waveConfig.spawnVariance;
  return Math.max(0.2, waveConfig.spawnInterval + offset);
}

function selectWaveRoute() {
  if (pentagonTiles.length < 2) {
    return null;
  }
  const spawnIndex = Math.floor(Math.random() * pentagonTiles.length);
  let targetIndex = spawnIndex;
  let attempts = 0;
  while (targetIndex === spawnIndex && attempts < pentagonTiles.length * 2) {
    targetIndex = Math.floor(Math.random() * pentagonTiles.length);
    attempts += 1;
  }
  if (targetIndex === spawnIndex) {
    targetIndex = (spawnIndex + 1) % pentagonTiles.length;
  }
  return {
    spawnTile: pentagonTiles[spawnIndex],
    targetTile: pentagonTiles[targetIndex],
  };
}

function startNextWave() {
  waveState.currentWaveIndex += 1;
  waveState.pendingWaveDelay = 0;
  if (waveState.currentWaveIndex >= waveConfig.totalWaves) {
    waveState.wavesComplete = true;
    waveState.waveActive = false;
    waveState.activeRoute = null;
    updateWaveCounter();
    return;
  }

  const route = selectWaveRoute();
  if (!route) {
    waveState.wavesComplete = true;
    waveState.waveActive = false;
    waveState.activeRoute = null;
    updateWaveCounter();
    return;
  }

  waveState.activeRoute = route;
  waveState.enemiesSpawned = 0;
  waveState.waveActive = true;
  spawnCountdown = Math.max(0.2, waveConfig.spawnInterval * 0.5);
  updateWaveCounter();
}

function queueNextWave(delay = waveConfig.breakDuration) {
  waveState.pendingWaveDelay = Math.max(0, delay);
  waveState.waveActive = false;
  waveState.activeRoute = null;
  updateWaveCounter();
}

function updateWaveCounter() {
  if (waveState.wavesComplete) {
    waveCounterElement.textContent = `Wave ${waveConfig.totalWaves} / ${waveConfig.totalWaves} — Complete`;
    return;
  }

  if (waveState.currentWaveIndex < 0) {
    waveCounterElement.textContent = `Preparing Wave 1 / ${waveConfig.totalWaves}`;
    return;
  }

  const waveNumber = waveState.currentWaveIndex + 1;
  if (waveState.waveActive) {
    const spawnsRemaining = Math.max(
      waveConfig.enemiesPerWave - waveState.enemiesSpawned,
      0
    );
    const statusLabel = spawnsRemaining > 0 ? `${spawnsRemaining} inbound` : "Engaged";
    waveCounterElement.textContent = `Wave ${waveNumber} / ${waveConfig.totalWaves} — ${statusLabel}`;
    return;
  }

  if (waveState.pendingWaveDelay > 0) {
    if (waveState.enemiesSpawned >= waveConfig.enemiesPerWave) {
      waveCounterElement.textContent = `Wave ${waveNumber} / ${waveConfig.totalWaves} — Cleared`;
    } else {
      const nextWaveNumber = Math.min(
        waveState.currentWaveIndex + 2,
        waveConfig.totalWaves
      );
      waveCounterElement.textContent = `Preparing Wave ${nextWaveNumber} / ${waveConfig.totalWaves}`;
    }
    return;
  }

  waveCounterElement.textContent = `Wave ${waveNumber} / ${waveConfig.totalWaves}`;
}

function spawnEnemy(spawnTileOverride, targetTileOverride) {
  if (pentagonTiles.length < 2) {
    return false;
  }

  const spawnTile =
    spawnTileOverride ??
    pentagonTiles[Math.floor(Math.random() * pentagonTiles.length)];

  let targetTile = targetTileOverride ?? spawnTile;
  let attempts = 0;
  while (targetTile === spawnTile && attempts < pentagonTiles.length * 2) {
    targetTile = pentagonTiles[Math.floor(Math.random() * pentagonTiles.length)];
    attempts += 1;
  }
  if (targetTile === spawnTile) {
    return false;
  }

  const enemyMesh = new THREE.Mesh(enemyGeometry, enemyMaterial);
  enemyMesh.castShadow = false;
  enemyMesh.receiveShadow = false;
  enemyGroup.add(enemyMesh);

  const startDirection = spawnTile.userData.normal.clone();
  const endDirection = targetTile.userData.normal.clone();
  const arc = startDirection.angleTo(endDirection);

  if (!Number.isFinite(arc) || arc <= 0) {
    enemyGroup.remove(enemyMesh);
    return false;
  }

  tmpAxis.copy(startDirection).cross(endDirection);
  if (tmpAxis.lengthSq() < 1e-6) {
    const referenceAxis =
      Math.abs(startDirection.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
    tmpAxis.copy(startDirection).cross(referenceAxis);
  }
  if (tmpAxis.lengthSq() < 1e-6) {
    tmpAxis.set(0, 0, 1);
  }
  tmpAxis.normalize();

  const travelDuration = Math.max(arc / ENEMY_ANGULAR_SPEED, 0.5);
  enemyMesh.position.copy(startDirection).multiplyScalar(ENEMY_TRAVEL_RADIUS);

  enemies.push({
    mesh: enemyMesh,
    startDirection,
    targetDirection: endDirection,
    rotationAxis: tmpAxis.clone(),
    arc,
    progress: 0,
    travelDuration,
    travelRadius: ENEMY_TRAVEL_RADIUS,
    waveIndex: waveState.waveActive ? waveState.currentWaveIndex : null,
  });

  return true;
}

function updateEnemies(delta) {
  if (!waveState.wavesComplete) {
    if (!waveState.waveActive) {
      if (waveState.pendingWaveDelay > 0) {
        waveState.pendingWaveDelay -= delta;
        if (waveState.pendingWaveDelay <= 0) {
          startNextWave();
        }
      }
    } else if (waveState.enemiesSpawned < waveConfig.enemiesPerWave) {
      spawnCountdown -= delta;
      if (spawnCountdown <= 0) {
        const spawned = spawnEnemy(
          waveState.activeRoute?.spawnTile,
          waveState.activeRoute?.targetTile
        );
        if (spawned) {
          waveState.enemiesSpawned += 1;
        }
        spawnCountdown = getNextSpawnTimer();
        updateWaveCounter();
      }
    }
  }

  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    enemy.progress += delta / enemy.travelDuration;

    if (enemy.progress >= 1) {
      enemyGroup.remove(enemy.mesh);
      enemies.splice(i, 1);
      continue;
    }

    const rotationAngle = enemy.arc * Math.min(enemy.progress, 1);
    const travelRadius = enemy.travelRadius ?? ENEMY_TRAVEL_RADIUS;
    tmpQuaternion.setFromAxisAngle(enemy.rotationAxis, rotationAngle);
    tmpDirection
      .copy(enemy.startDirection)
      .applyQuaternion(tmpQuaternion)
      .multiplyScalar(travelRadius);

    enemy.mesh.position.copy(tmpDirection);
  }

  const waveFinished =
    waveState.waveActive &&
    waveState.enemiesSpawned >= waveConfig.enemiesPerWave &&
    enemies.length === 0;

  if (waveFinished) {
    if (waveState.currentWaveIndex >= waveConfig.totalWaves - 1) {
      waveState.wavesComplete = true;
      waveState.waveActive = false;
      waveState.activeRoute = null;
      waveState.pendingWaveDelay = 0;
      updateWaveCounter();
    } else {
      queueNextWave();
    }
  }
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredTile = null;
let activeHexTile = null;
let touchPointerDown = null;

function isTouchLike(event) {
  return event.pointerType === "touch" || event.pointerType === "pen";
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function resetHover() {
  if (!hoveredTile) {
    return;
  }
  hoveredTile.userData.border.material.color.copy(hoveredTile.userData.baseBorder);
  hoveredTile.userData.border.material.needsUpdate = true;
  hoveredTile = null;
}

function applyHover(mesh) {
  if (hoveredTile === mesh) {
    return;
  }
  resetHover();
  hoveredTile = mesh;
  mesh.userData.border.material.color.copy(hoverBorderColor);
  mesh.userData.border.material.needsUpdate = true;
}

function setActiveTile(mesh) {
  if (mesh.userData.sides !== 6) {
    return;
  }
  if (activeHexTile === mesh) {
    mesh.material.color.copy(mesh.userData.baseFill);
    mesh.userData.active = false;
    activeHexTile = null;
    return;
  }
  if (activeHexTile) {
    activeHexTile.material.color.copy(activeHexTile.userData.baseFill);
    activeHexTile.userData.active = false;
  }
  activeHexTile = mesh;
  mesh.material.color.copy(activeHexColor);
  mesh.userData.active = true;
}

function handlePointerMove(event) {
  if (isTouchLike(event) && !event.isPrimary) {
    return;
  }
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects(interactiveTiles, false);
  if (intersections.length > 0) {
    applyHover(intersections[0].object);
  } else {
    resetHover();
  }
}

function handlePointerLeave() {
  resetHover();
}

function handlePointerClick(event) {
  selectTileUnderPointer(event);
}

renderer.domElement.addEventListener("pointermove", handlePointerMove);
renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
renderer.domElement.addEventListener("click", handlePointerClick);
renderer.domElement.addEventListener("pointerdown", handlePointerDown, {
  passive: true,
});
renderer.domElement.addEventListener("pointerup", handlePointerUp, {
  passive: false,
});
renderer.domElement.addEventListener("pointercancel", () => {
  touchPointerDown = null;
});

function resizeRenderer() {
  const { clientWidth, clientHeight } = container;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}

window.addEventListener("resize", resizeRenderer);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resizeRenderer);
  window.visualViewport.addEventListener("scroll", resizeRenderer);
}

function animate() {
  const delta = clock.getDelta();
  controls.update();
  updateEnemies(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

resizeRenderer();
animate();

function selectTileUnderPointer(event) {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects(interactiveTiles, false);
  if (intersections.length > 0) {
    setActiveTile(intersections[0].object);
  }
}

function handlePointerDown(event) {
  if (!isTouchLike(event) || !event.isPrimary) {
    touchPointerDown = null;
    return;
  }
  touchPointerDown = {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    id: event.pointerId,
  };
}

function handlePointerUp(event) {
  if (!touchPointerDown || touchPointerDown.id !== event.pointerId) {
    touchPointerDown = null;
    return;
  }
  const dx = event.clientX - touchPointerDown.x;
  const dy = event.clientY - touchPointerDown.y;
  const elapsed = performance.now() - touchPointerDown.time;
  touchPointerDown = null;
  const movementThreshold = 15;
  const durationThreshold = 450;
  if (dx * dx + dy * dy > movementThreshold * movementThreshold) {
    return;
  }
  if (elapsed > durationThreshold) {
    return;
  }
  event.preventDefault();
  selectTileUnderPointer(event);
}

function createGoldbergSphere(radius, thickness, frequency) {
  const { positions, faces } = buildGeodesicSphere(frequency);
  const scaledPositions = positions.map((p) => p.clone().multiplyScalar(radius));

  const vertexFaces = Array.from({ length: positions.length }, () => new Set());
  faces.forEach((face, faceIndex) => {
    vertexFaces[face[0]].add(faceIndex);
    vertexFaces[face[1]].add(faceIndex);
    vertexFaces[face[2]].add(faceIndex);
  });

  const faceCentroids = faces.map((face) => {
    const centroid = new THREE.Vector3();
    centroid
      .add(positions[face[0]])
      .add(positions[face[1]])
      .add(positions[face[2]]);
    centroid.multiplyScalar(1 / 3);
    centroid.normalize();
    return centroid;
  });

  const tileGroup = new THREE.Group();
  const counts = { pentagon: 0, hexagon: 0 };

  for (let vIndex = 0; vIndex < positions.length; vIndex += 1) {
    const normal = positions[vIndex].clone().normalize();
    const centerPoint = scaledPositions[vIndex];

    let tangent1 = new THREE.Vector3(0, 1, 0);
    if (Math.abs(tangent1.dot(normal)) > 0.9) {
      tangent1 = new THREE.Vector3(1, 0, 0);
    }
    tangent1.cross(normal).normalize();
    const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1);

    const neighborFaces = Array.from(vertexFaces[vIndex]);
    const ringPoints = neighborFaces
      .map((faceIndex) => {
        const centroid = faceCentroids[faceIndex].clone().multiplyScalar(radius);
        const offset = centroid.sub(centerPoint);
        return new THREE.Vector2(offset.dot(tangent1), offset.dot(tangent2));
      })
      .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));

    if (ringPoints.length < 5) {
      continue;
    }

    let area = 0;
    for (let i = 0; i < ringPoints.length; i += 1) {
      const p1 = ringPoints[i];
      const p2 = ringPoints[(i + 1) % ringPoints.length];
      area += p1.x * p2.y - p2.x * p1.y;
    }
    if (area < 0) {
      ringPoints.reverse();
    }

    const inflation = 1.012;
    ringPoints.forEach((pt) => pt.multiplyScalar(inflation));
    const ringRadius = ringPoints.reduce(
      (max, pt) => Math.max(max, Math.hypot(pt.x, pt.y)),
      0
    );

    const shape = new THREE.Shape();
    ringPoints.forEach((pt, idx) => {
      if (idx === 0) {
        shape.moveTo(pt.x, pt.y);
      } else {
        shape.lineTo(pt.x, pt.y);
      }
    });
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
    });

    const basis = new THREE.Matrix4().makeBasis(tangent1, tangent2, normal);
    geometry.applyMatrix4(basis);
    geometry.translate(centerPoint.x, centerPoint.y, centerPoint.z);

    const isPentagon = ringPoints.length === 5;
    const fillColor = new THREE.Color(
      isPentagon ? COLOR_CONFIG.pentagonFill : COLOR_CONFIG.hexFill
    );
    const borderColor = new THREE.Color(
      isPentagon ? COLOR_CONFIG.pentagonBorder : COLOR_CONFIG.hexBorder
    );

    const material = new THREE.MeshStandardMaterial({
      color: fillColor.clone(),
      roughness: 0.45,
      metalness: 0.22,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.05,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: borderColor.clone() })
    );
    mesh.add(border);

    mesh.userData = {
      baseFill: fillColor.clone(),
      baseBorder: borderColor.clone(),
      border,
      sides: ringPoints.length,
      active: false,
      normal: normal.clone(),
      center: centerPoint.clone(),
      tileRadius: ringRadius,
    };

    if (isPentagon) {
      counts.pentagon += 1;
    } else {
      counts.hexagon += 1;
    }

    tileGroup.add(mesh);
  }

  return { group: tileGroup, counts };
}

function buildGeodesicSphere(frequency) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const baseVertices = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ].map((coords) => new THREE.Vector3(coords[0], coords[1], coords[2]).normalize());

  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  const vertexMap = new Map();
  const positions = [];
  const triangles = [];

  function getVertexIndex(point) {
    const key = `${Math.round(point.x * 1e6)}|${Math.round(point.y * 1e6)}|${Math.round(
      point.z * 1e6
    )}`;
    if (vertexMap.has(key)) {
      return vertexMap.get(key);
    }
    const index = positions.length;
    positions.push(point.clone());
    vertexMap.set(key, index);
    return index;
  }

  faces.forEach(([ia, ib, ic]) => {
    const a = baseVertices[ia];
    const b = baseVertices[ib];
    const c = baseVertices[ic];

    const grid = [];
    for (let i = 0; i <= frequency; i += 1) {
      grid[i] = [];
      for (let j = 0; j <= frequency - i; j += 1) {
        const k = frequency - i - j;
        const point = new THREE.Vector3();
        point.addScaledVector(a, i);
        point.addScaledVector(b, j);
        point.addScaledVector(c, k);
        point.divideScalar(frequency);
        point.normalize();
        grid[i][j] = getVertexIndex(point);
      }
    }

    for (let i = 0; i < frequency; i += 1) {
      for (let j = 0; j < frequency - i; j += 1) {
        const v0 = grid[i][j];
        const v1 = grid[i + 1][j];
        const v2 = grid[i][j + 1];
        triangles.push([v0, v1, v2]);

        if (i + j < frequency - 1) {
          const v3 = grid[i + 1][j + 1];
          triangles.push([v1, v3, v2]);
        }
      }
    }
  });

  return { positions, faces: triangles };
}

function createHalo(radius) {
  const geometry = new THREE.RingGeometry(radius * 1.05, radius * 1.22, 64);
  const material = new THREE.MeshBasicMaterial({
    color: 0x214fdd,
    opacity: 0.16,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(geometry, material);
  halo.rotation.x = THREE.MathUtils.degToRad(78);
  halo.renderOrder = -1;
  return halo;
}
