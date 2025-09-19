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
const WORLD_UP = new THREE.Vector3(0, 1, 0);

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

const tileGraph = new Map();

buildTileGraph(interactiveTiles);

const pentagonTiles = interactiveTiles.filter((tile) => tile.userData.sides === 5);
const endPointTile =
  pentagonTiles.length > 0
    ? pentagonTiles[Math.floor(Math.random() * pentagonTiles.length)]
    : null;
const spawnPentagonTiles = pentagonTiles.filter((tile) => tile !== endPointTile);
const referenceHexTile = interactiveTiles.find((tile) => tile.userData.sides === 6);
const baseHexRadius = referenceHexTile?.userData.tileRadius ?? tileThickness * 0.75;
const ENEMY_RADIUS = baseHexRadius * 0.8;
const ENEMY_SURFACE_OFFSET = Math.max(tileThickness * 0.05, ENEMY_RADIUS * 0.15);
const ENEMY_TRAVEL_RADIUS = globeRadius + tileThickness + ENEMY_SURFACE_OFFSET;
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

const towerGroup = new THREE.Group();
globeGroup.add(towerGroup);

const towerColor = new THREE.Color(0x8e44ad);
const towerBorderColor = new THREE.Color(0xdcc8ff);
const towerConfig = Object.freeze({
  heightFactor: 1.7,
  radiusFactor: 0.6,
});

const ROUTE_HIGHLIGHT_COLORS = Object.freeze({
  spawn: new THREE.Color(0x2eff71),
  target: new THREE.Color(0xff4d4d),
  path: new THREE.Color(0x9b59ff),
});

const waveConfig = Object.freeze({
  totalWaves: 10,
  enemiesPerWave: 10,
  spawnInterval: 0.8,
  spawnVariance: 0.3,
  initialDelay: 10,
  breakDuration: 10,
});

const waveState = {
  currentWaveIndex: -1,
  enemiesSpawned: 0,
  pendingWaveDelay: waveConfig.initialDelay,
  waveActive: false,
  wavesComplete: false,
  endTile: endPointTile,
  routesBySpawn: new Map(),
  highlightedTiles: [],
};

const enemies = [];
let spawnCountdown = waveConfig.spawnInterval;
const tmpDirection = new THREE.Vector3();
const waveCounterElement = document.getElementById("wave-counter");
if (!waveCounterElement) {
  throw new Error("Wave counter element missing from the page.");
}
updateWaveCounter();

const menuToggleButton = document.getElementById("menu-toggle");
const gameMenu = document.getElementById("game-menu");
const gameMenuAction = document.getElementById("game-menu-action");
let gameHasStarted = false;

if (gameMenu) {
  document.body.classList.add("menu-open");
  gameMenu.classList.add("is-visible");
}

if (menuToggleButton) {
  menuToggleButton.disabled = true;
  menuToggleButton.setAttribute("aria-expanded", "true");
}

let activeHexTile = null;

const buildMenu = document.getElementById("build-menu");
const buildMenuStatus = document.getElementById("build-menu-status");
const buildButton = document.getElementById("build-basic-tower");
if (!buildMenu || !buildMenuStatus || !buildButton) {
  throw new Error("Build menu elements missing from the page.");
}

buildButton.addEventListener("click", () => {
  attemptBuildOnActiveTile();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "1" || event.repeat) {
    return;
  }
  const activeElement = document.activeElement;
  if (
    activeElement &&
    (activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable)
  ) {
    return;
  }
  attemptBuildOnActiveTile();
});

if (gameMenuAction) {
  gameMenuAction.addEventListener("click", () => {
    startNewGame();
  });
}

if (menuToggleButton) {
  menuToggleButton.addEventListener("click", () => {
    openGameMenu();
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && gameMenu && gameMenu.classList.contains("is-visible")) {
    closeGameMenu();
  }
});

updateBuildMenu();

function getNextSpawnTimer() {
  const offset = (Math.random() - 0.5) * waveConfig.spawnVariance;
  return Math.max(0.2, waveConfig.spawnInterval + offset);
}

function startNextWave() {
  waveState.currentWaveIndex += 1;
  waveState.pendingWaveDelay = 0;
  if (waveState.currentWaveIndex >= waveConfig.totalWaves) {
    waveState.wavesComplete = true;
    waveState.waveActive = false;
    clearWaveRouteHighlight();
    updateWaveCounter();
    return;
  }

  if (!prepareNextRoute()) {
    waveState.wavesComplete = true;
    waveState.waveActive = false;
    updateWaveCounter();
    return;
  }

  waveState.enemiesSpawned = 0;
  waveState.waveActive = true;
  spawnCountdown = Math.max(0.2, waveConfig.spawnInterval * 0.5);
  updateWaveCounter();
}



function queueNextWave(delay = waveConfig.breakDuration) {
  waveState.pendingWaveDelay = Math.max(0, delay);
  waveState.waveActive = false;
  if (!prepareNextRoute()) {
    waveState.routesBySpawn = new Map();
    waveState.wavesComplete = true;
    waveState.pendingWaveDelay = 0;
  }
  updateWaveCounter();
}

function updateWaveCounter() {
  if (waveState.wavesComplete) {
    waveCounterElement.textContent = `Wave ${waveConfig.totalWaves} / ${waveConfig.totalWaves} � Complete`;
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
    waveCounterElement.textContent = `Wave ${waveNumber} / ${waveConfig.totalWaves} � ${statusLabel}`;
    return;
  }

  if (waveState.pendingWaveDelay > 0) {
    if (waveState.enemiesSpawned >= waveConfig.enemiesPerWave) {
      waveCounterElement.textContent = `Wave ${waveNumber} / ${waveConfig.totalWaves} � Cleared`;
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

function updateBuildMenu() {
  if (!buildMenu || !buildMenuStatus || !buildButton) {
    return;
  }

  if (!activeHexTile) {
    buildMenu.classList.remove("is-visible");
    buildMenu.setAttribute("aria-hidden", "true");
    buildButton.disabled = true;
    buildMenuStatus.textContent = "Select a hex to build.";
    return;
  }

  buildMenu.classList.add("is-visible");
  buildMenu.setAttribute("aria-hidden", "false");

  if (activeHexTile.userData.hasTower) {
    buildMenuStatus.textContent = "Tower already built on this hex.";
    buildButton.disabled = true;
  } else {
    buildMenuStatus.textContent = "Build a tower on the selected hex.";
    buildButton.disabled = false;
  }
}

function attemptBuildOnActiveTile() {
  if (!activeHexTile) {
    updateBuildMenu();
    return false;
  }
  if (activeHexTile.userData.hasTower) {
    updateBuildMenu();
    return false;
  }
  const built = buildTowerOnTile(activeHexTile);
  updateBuildMenu();
  return built;
}

function buildTowerOnTile(tile) {
  if (!tile || tile.userData.hasTower) {
    return false;
  }

  const towerHeight = tileThickness * towerConfig.heightFactor;
  const towerRadius =
    (tile.userData.tileRadius ?? baseHexRadius) * towerConfig.radiusFactor;

  const towerGeometry = new THREE.CylinderGeometry(
    towerRadius,
    towerRadius * 0.85,
    towerHeight,
    16
  );
  const towerMaterial = new THREE.MeshStandardMaterial({
    color: towerColor.clone(),
    emissive: towerColor.clone().multiplyScalar(0.35),
    roughness: 0.25,
    metalness: 0.65,
  });

  const towerMesh = new THREE.Mesh(towerGeometry, towerMaterial);
  towerMesh.castShadow = false;
  towerMesh.receiveShadow = false;

  const normal = tile.userData.normal.clone().normalize();
  const center = tile.userData.center.clone();
  const elevation = tileThickness * 0.5 + towerHeight * 0.5;

  towerMesh.position.copy(center).add(normal.clone().multiplyScalar(elevation));

  const alignQuaternion = new THREE.Quaternion().setFromUnitVectors(
    WORLD_UP,
    normal
  );
  towerMesh.quaternion.copy(alignQuaternion);

  towerGroup.add(towerMesh);

  tile.userData.hasTower = true;
  tile.userData.tower = towerMesh;
  tile.material.color.copy(towerColor);
  tile.material.needsUpdate = true;
  tile.userData.border.material.color.copy(towerBorderColor);
  tile.userData.border.material.needsUpdate = true;
  tile.userData.baseFill.copy(tile.material.color);
  tile.userData.baseBorder.copy(tile.userData.border.material.color);

  recalculateActivePath();

  return true;
}

function clearWaveRouteHighlight() {
  clearPathHighlight();
  spawnPentagonTiles.forEach((tile) => {
    if (!tile) {
      return;
    }
    tile.material.color.copy(tile.userData.baseFill);
    tile.material.needsUpdate = true;
    tile.userData.border.material.color.copy(tile.userData.baseBorder);
    tile.userData.border.material.needsUpdate = true;
  });
  const endTile = waveState.endTile ?? endPointTile;
  if (endTile) {
    endTile.material.color.copy(endTile.userData.baseFill);
    endTile.material.needsUpdate = true;
    endTile.userData.border.material.color.copy(endTile.userData.baseBorder);
    endTile.userData.border.material.needsUpdate = true;
  }
}

function clearPathHighlight() {
  if (!Array.isArray(waveState.highlightedTiles)) {
    waveState.highlightedTiles = [];
  }
  waveState.highlightedTiles.forEach((tile) => {
    if (!tile) {
      return;
    }
    tile.material.color.copy(tile.userData.baseFill);
    tile.material.needsUpdate = true;
    tile.userData.border.material.color.copy(tile.userData.baseBorder);
    tile.userData.border.material.needsUpdate = true;
  });
  waveState.highlightedTiles = [];
}

function highlightPathTiles(pathTiles, excludedTiles = []) {
  clearPathHighlight();
  if (!Array.isArray(pathTiles) || pathTiles.length === 0) {
    return;
  }
  const excludedSet = new Set((excludedTiles || []).filter(Boolean));
  const tilesToHighlight = pathTiles.filter((tile) => tile && !excludedSet.has(tile));
  tilesToHighlight.forEach((tile) => {
    tile.material.color.copy(ROUTE_HIGHLIGHT_COLORS.path);
    tile.material.needsUpdate = true;
    tile.userData.border.material.color.copy(ROUTE_HIGHLIGHT_COLORS.path);
    tile.userData.border.material.needsUpdate = true;
  });
  waveState.highlightedTiles = tilesToHighlight;
}

function highlightActiveRoutes() {
  if (!waveState.routesBySpawn || waveState.routesBySpawn.size === 0) {
    return;
  }

  const pathSet = new Set();
  const excludedTiles = [];

  waveState.routesBySpawn.forEach((pathTiles, spawnTile) => {
    if (spawnTile) {
      spawnTile.material.color.copy(ROUTE_HIGHLIGHT_COLORS.spawn);
      spawnTile.material.needsUpdate = true;
      spawnTile.userData.border.material.color.copy(ROUTE_HIGHLIGHT_COLORS.spawn);
      spawnTile.userData.border.material.needsUpdate = true;
      excludedTiles.push(spawnTile);
    }
    if (Array.isArray(pathTiles)) {
      pathTiles.forEach((tile) => pathSet.add(tile));
    }
  });

  const endTile = waveState.endTile ?? endPointTile;
  if (endTile) {
    endTile.material.color.copy(ROUTE_HIGHLIGHT_COLORS.target);
    endTile.material.needsUpdate = true;
    endTile.userData.border.material.color.copy(ROUTE_HIGHLIGHT_COLORS.target);
    endTile.userData.border.material.needsUpdate = true;
    excludedTiles.push(endTile);
  }

  const pathTiles = Array.from(pathSet);
  highlightPathTiles(pathTiles, excludedTiles);
}

function synchronizeEnemiesToRoutes() {
  if (!waveState.routesBySpawn || waveState.routesBySpawn.size === 0) {
    return;
  }
  const availableRoutes = Array.from(waveState.routesBySpawn.entries());
  if (availableRoutes.length === 0) {
    return;
  }
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    if (!enemy) {
      continue;
    }
    let spawnTile = enemy.spawnTile;
    let pathTiles = spawnTile ? waveState.routesBySpawn.get(spawnTile) : null;
    if (!Array.isArray(pathTiles) || pathTiles.length < 2) {
      const fallback = availableRoutes[Math.floor(Math.random() * availableRoutes.length)];
      if (!fallback || !Array.isArray(fallback[1]) || fallback[1].length < 2) {
        enemyGroup.remove(enemy.mesh);
        enemies.splice(i, 1);
        continue;
      }
      spawnTile = fallback[0];
      pathTiles = fallback[1];
    }
    assignEnemyPath(enemy, pathTiles, spawnTile);
  }
}


function clearEnemies() {
  while (enemies.length > 0) {
    const enemy = enemies.pop();
    if (enemy && enemy.mesh) {
      enemyGroup.remove(enemy.mesh);
    }
  }
}

function clearTowers() {
  for (let i = towerGroup.children.length - 1; i >= 0; i -= 1) {
    towerGroup.remove(towerGroup.children[i]);
  }
  interactiveTiles.forEach((tile) => {
    if (!tile.userData) {
      return;
    }
    tile.userData.hasTower = false;
    tile.userData.tower = null;
    tile.material.color.copy(tile.userData.baseFill);
    tile.material.needsUpdate = true;
    tile.userData.border.material.color.copy(tile.userData.baseBorder);
    tile.userData.border.material.needsUpdate = true;
  });
}

function centerCameraOnEndTile() {
  const targetTile = waveState.endTile ?? endPointTile;
  if (!targetTile) {
    return;
  }
  const focusPoint = targetTile.userData.center.clone();
  const direction = targetTile.userData.normal.clone().normalize();
  const viewOffset = globeRadius + tileThickness * 3.2;
  const lateral = new THREE.Vector3().crossVectors(direction, WORLD_UP);
  if (lateral.lengthSq() === 0) {
    lateral.set(1, 0, 0);
  }
  lateral.normalize().multiplyScalar(globeRadius * 0.25);
  camera.position.copy(focusPoint.clone().add(direction.multiplyScalar(viewOffset)).add(lateral));
  controls.target.copy(focusPoint);
  camera.lookAt(focusPoint);
  controls.update();
}

function openGameMenu() {
  if (!gameMenu) {
    return;
  }
  if (gameMenu.classList.contains("is-visible")) {
    return;
  }
  gameMenu.classList.add("is-visible");
  document.body.classList.add("menu-open");
  if (menuToggleButton) {
    menuToggleButton.disabled = true;
    menuToggleButton.setAttribute("aria-expanded", "true");
  }
  if (gameMenuAction) {
    const actionLabel = gameHasStarted ? "New Game" : "Start Game";
    gameMenuAction.textContent = actionLabel;
    gameMenuAction.setAttribute("aria-label", actionLabel);
    queueMicrotask(() => gameMenuAction.focus({ preventScroll: true }));
  }
}

function closeGameMenu({ focusToggle = true } = {}) {
  if (!gameMenu) {
    return;
  }
  if (!gameMenu.classList.contains("is-visible")) {
    return;
  }
  gameMenu.classList.remove("is-visible");
  document.body.classList.remove("menu-open");
  if (menuToggleButton) {
    menuToggleButton.disabled = false;
    menuToggleButton.setAttribute("aria-expanded", "false");
    if (focusToggle) {
      queueMicrotask(() => menuToggleButton.focus({ preventScroll: true }));
    }
  }
}

function startNewGame() {
  clearTowers();
  clearEnemies();
  clearWaveRouteHighlight();
  resetHover();
  activeHexTile = null;
  updateBuildMenu();

  waveState.currentWaveIndex = -1;
  waveState.enemiesSpawned = 0;
  waveState.pendingWaveDelay = waveConfig.initialDelay;
  waveState.waveActive = false;
  waveState.wavesComplete = false;
  waveState.routesBySpawn = new Map();
  waveState.highlightedTiles = [];
  waveState.endTile = endPointTile;
  spawnCountdown = waveConfig.spawnInterval;

  const prepared = prepareNextRoute();
  if (!prepared) {
    highlightActiveRoutes();
  }
  centerCameraOnEndTile();
  updateWaveCounter();

  gameHasStarted = true;
  if (gameMenuAction) {
    gameMenuAction.textContent = "New Game";
    gameMenuAction.setAttribute("aria-label", "New Game");
  }
  closeGameMenu({ focusToggle: false });
  if (menuToggleButton) {
    menuToggleButton.disabled = false;
    menuToggleButton.focus({ preventScroll: true });
  }
}




function prepareNextRoute() {
  clearWaveRouteHighlight();
  if (!endPointTile) {
    waveState.routesBySpawn = new Map();
    waveState.highlightedTiles = [];
    return false;
  }

  const routes = new Map();
  const targetTile = waveState.endTile ?? endPointTile;

  spawnPentagonTiles.forEach((spawnTile) => {
    if (!spawnTile || !targetTile) {
      return;
    }
    const pathTiles = findPathBetweenTiles(spawnTile, targetTile);
    if (!Array.isArray(pathTiles) || pathTiles.length < 2) {
      return;
    }
    routes.set(spawnTile, pathTiles);
  });

  waveState.routesBySpawn = routes;
  if (routes.size === 0) {
    waveState.routesBySpawn = new Map();
    waveState.highlightedTiles = [];
    const endTile = waveState.endTile ?? endPointTile;
    if (endTile) {
      endTile.material.color.copy(ROUTE_HIGHLIGHT_COLORS.target);
      endTile.material.needsUpdate = true;
      endTile.userData.border.material.color.copy(ROUTE_HIGHLIGHT_COLORS.target);
      endTile.userData.border.material.needsUpdate = true;
    }
    return false;
  }

  highlightActiveRoutes();
  synchronizeEnemiesToRoutes();
  return true;
}

function buildTileGraph(tiles) {
  tileGraph.clear();
  if (!tiles || tiles.length === 0) {
    return;
  }

  const normals = tiles.map((tile) => tile.userData.normal.clone().normalize());
  const adjacency = new Map();

  const angleSamples = [];
  for (let i = 0; i < normals.length; i += 1) {
    let minAngle = Infinity;
    for (let j = 0; j < normals.length; j += 1) {
      if (i === j) {
        continue;
      }
      const angle = normals[i].angleTo(normals[j]);
      if (angle < minAngle) {
        minAngle = angle;
      }
    }
    angleSamples.push(minAngle);
  }

  const sortedAngles = [...angleSamples].sort((a, b) => a - b);
  const baseAngle = sortedAngles[Math.floor(sortedAngles.length * 0.5)] * 1.25;

  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    const candidates = [];
    for (let j = 0; j < tiles.length; j += 1) {
      if (i === j) {
        continue;
      }
      const angle = normals[i].angleTo(normals[j]);
      candidates.push({ tile: tiles[j], angle });
    }
    candidates.sort((a, b) => a.angle - b.angle);
    const desiredNeighbors = tile.userData.sides ?? 6;
    const neighbors = [];
    for (let k = 0; k < candidates.length && neighbors.length < desiredNeighbors; k += 1) {
      const candidate = candidates[k];
      if (candidate.angle <= baseAngle || neighbors.length === 0) {
        neighbors.push(candidate.tile);
      }
    }
    if (!adjacency.has(tile)) {
      adjacency.set(tile, new Set());
    }
    const neighborSet = adjacency.get(tile);
    neighbors.forEach((neighbor) => {
      neighborSet.add(neighbor);
      if (!adjacency.has(neighbor)) {
        adjacency.set(neighbor, new Set());
      }
      adjacency.get(neighbor).add(tile);
    });
  }

  tiles.forEach((tile) => {
    const neighbors = Array.from(adjacency.get(tile) ?? []);
    tile.userData.neighbors = neighbors;
    tileGraph.set(tile, neighbors);
  });
}

function findPathBetweenTiles(startTile, targetTile) {
  if (!startTile || !targetTile) {
    return null;
  }
  if (startTile === targetTile) {
    return [startTile];
  }
  const visited = new Set([startTile]);
  const queue = [startTile];
  const parent = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = tileGraph.get(current) ?? current.userData.neighbors ?? [];
    for (let i = 0; i < neighbors.length; i += 1) {
      const neighbor = neighbors[i];
      if (!neighbor || visited.has(neighbor)) {
        continue;
      }
      if (neighbor.userData.hasTower && neighbor !== targetTile) {
        continue;
      }
      visited.add(neighbor);
      parent.set(neighbor, current);
      if (neighbor === targetTile) {
        const path = [neighbor];
        let backtrack = current;
        while (backtrack) {
          path.push(backtrack);
          backtrack = parent.get(backtrack);
        }
        path.reverse();
        return path;
      }
      queue.push(neighbor);
    }
  }

  return null;
}

function recalculateActivePath() {
  prepareNextRoute();
}




function calculateSegmentDuration(pathVectors, segmentIndex) {
  const startVector = pathVectors[segmentIndex];
  const endVector = pathVectors[segmentIndex + 1];
  if (!startVector || !endVector) {
    return 0.2;
  }
  const arc = startVector.angleTo(endVector);
  if (!Number.isFinite(arc) || arc <= 0) {
    return 0.2;
  }
  return Math.max(arc / ENEMY_ANGULAR_SPEED, 0.2);
}

function computePathVectors(pathTiles) {
  if (!Array.isArray(pathTiles)) {
    return [];
  }
  return pathTiles.map((tile) => tile.userData.normal.clone());
}

function assignEnemyPath(enemy, pathTiles, spawnTileOverride) {
  if (!Array.isArray(pathTiles) || pathTiles.length < 2) {
    return;
  }
  const newVectors = computePathVectors(pathTiles);
  const segmentsNew = newVectors.length - 1;
  if (segmentsNew <= 0) {
    return;
  }

  const previousVectors = enemy.pathVectors ?? [];
  const segmentsOld = Math.max(previousVectors.length - 1, 1);
  let previousProgress = 0;
  if (segmentsOld > 0) {
    previousProgress = (enemy.segmentIndex ?? 0) + Math.max(Math.min(enemy.segmentProgress ?? 0, 1), 0);
    previousProgress = Math.min(Math.max(previousProgress / segmentsOld, 0), 1);
  }

  const totalSegmentsNew = segmentsNew;
  const newPosition = previousProgress * totalSegmentsNew;
  const newIndex = Math.min(Math.floor(newPosition), totalSegmentsNew - 1);
  const newProgress = Math.min(Math.max(newPosition - newIndex, 0), 0.999);

  enemy.pathVectors = newVectors;
  enemy.segmentIndex = Math.max(0, newIndex);
  enemy.segmentProgress = newProgress;
  enemy.segmentDuration = calculateSegmentDuration(enemy.pathVectors, enemy.segmentIndex);
  if (!Number.isFinite(enemy.segmentDuration) || enemy.segmentDuration <= 0) {
    enemy.segmentDuration = 0.2;
  }

  const startVector = enemy.pathVectors[enemy.segmentIndex];
  const endVector = enemy.pathVectors[enemy.segmentIndex + 1] ?? startVector;
  const progress = Math.min(Math.max(enemy.segmentProgress, 0), 1);
  tmpDirection.set(0, 0, 0);
  if (startVector && endVector && typeof tmpDirection.slerpVectors === "function") {
    tmpDirection.slerpVectors(startVector, endVector, progress);
  } else if (startVector && endVector && typeof startVector.slerp === "function") {
    tmpDirection.copy(startVector).slerp(endVector, progress);
  } else if (startVector && endVector) {
    tmpDirection.lerpVectors(startVector, endVector, progress);
  } else if (startVector) {
    tmpDirection.copy(startVector);
  }

  if (tmpDirection.lengthSq() === 0 && startVector) {
    tmpDirection.copy(startVector);
  }

  tmpDirection
    .normalize()
    .multiplyScalar(enemy.travelRadius ?? ENEMY_TRAVEL_RADIUS);

  enemy.mesh.position.copy(tmpDirection);
  enemy.spawnTile = spawnTileOverride ?? pathTiles[0] ?? enemy.spawnTile ?? null;
}

function spawnEnemy(spawnTileOverride, targetTileOverride) {
  if (!waveState.routesBySpawn || waveState.routesBySpawn.size === 0) {
    if (!prepareNextRoute()) {
      return false;
    }
  }

  const availableRoutes = Array.from(waveState.routesBySpawn.entries());
  if (availableRoutes.length === 0) {
    return false;
  }

  const spawnChoices = spawnTileOverride
    ? [spawnTileOverride]
    : availableRoutes.map(([spawn]) => spawn);

  while (spawnChoices.length > 0) {
    const choiceIndex = Math.floor(Math.random() * spawnChoices.length);
    const spawnTile = spawnChoices.splice(choiceIndex, 1)[0];
    if (!spawnTile) {
      continue;
    }

    const targetTile = targetTileOverride ?? waveState.endTile ?? endPointTile;
    if (!targetTile) {
      return false;
    }

    let pathTiles = waveState.routesBySpawn.get(spawnTile);
    if (!Array.isArray(pathTiles) || pathTiles.length < 2) {
      pathTiles = findPathBetweenTiles(spawnTile, targetTile);
      if (!Array.isArray(pathTiles) || pathTiles.length < 2) {
        waveState.routesBySpawn.delete(spawnTile);
        continue;
      }
      waveState.routesBySpawn.set(spawnTile, pathTiles);
      highlightActiveRoutes();
    }

    const enemyMesh = new THREE.Mesh(enemyGeometry, enemyMaterial);
    enemyMesh.castShadow = false;
    enemyMesh.receiveShadow = false;
    enemyGroup.add(enemyMesh);

    const pathVectors = computePathVectors(pathTiles);
    if (!Array.isArray(pathVectors) || pathVectors.length < 2) {
      enemyGroup.remove(enemyMesh);
      waveState.routesBySpawn.delete(spawnTile);
      continue;
    }
    const travelRadius = ENEMY_TRAVEL_RADIUS;
    enemyMesh.position.copy(pathVectors[0]).multiplyScalar(travelRadius);

    const segmentDuration = calculateSegmentDuration(pathVectors, 0);

    enemies.push({
      mesh: enemyMesh,
      pathVectors,
      segmentIndex: 0,
      segmentProgress: 0,
      segmentDuration: Number.isFinite(segmentDuration) && segmentDuration > 0
        ? segmentDuration
        : 0.2,
      travelRadius,
      waveIndex: waveState.waveActive ? waveState.currentWaveIndex : null,
      spawnTile,
    });

    return true;
  }

  return false;
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
        const spawned = spawnEnemy();
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
    if (!enemy || !enemy.pathVectors || enemy.pathVectors.length < 2) {
      if (enemy) {
        enemyGroup.remove(enemy.mesh);
      }
      enemies.splice(i, 1);
      continue;
    }

    let remainingDelta = delta;
    let enemyRemoved = false;

    while (remainingDelta > 0 && !enemyRemoved) {
      if (enemy.segmentIndex >= enemy.pathVectors.length - 1) {
        enemyGroup.remove(enemy.mesh);
        enemies.splice(i, 1);
        enemyRemoved = true;
        break;
      }

      if (!Number.isFinite(enemy.segmentDuration) || enemy.segmentDuration <= 0) {
        enemy.segmentDuration = calculateSegmentDuration(enemy.pathVectors, enemy.segmentIndex);
        if (!Number.isFinite(enemy.segmentDuration) || enemy.segmentDuration <= 0) {
          enemy.segmentDuration = 0.2;
        }
      }

      const increment = remainingDelta / enemy.segmentDuration;
      enemy.segmentProgress += increment;

      if (enemy.segmentProgress < 1) {
        remainingDelta = 0;
        break;
      }

      remainingDelta = (enemy.segmentProgress - 1) * enemy.segmentDuration;
      enemy.segmentIndex += 1;

      if (enemy.segmentIndex >= enemy.pathVectors.length - 1) {
        enemyGroup.remove(enemy.mesh);
        enemies.splice(i, 1);
        enemyRemoved = true;
        break;
      }

      enemy.segmentProgress = 0;
      enemy.segmentDuration = calculateSegmentDuration(enemy.pathVectors, enemy.segmentIndex);
    }

    if (enemyRemoved) {
      continue;
    }

    const startVector = enemy.pathVectors[enemy.segmentIndex];
    const endVector = enemy.pathVectors[enemy.segmentIndex + 1];
    const progress = Math.min(Math.max(enemy.segmentProgress, 0), 1);
    tmpDirection.set(0, 0, 0);
    if (startVector && endVector && typeof startVector.slerp === "function") {
      tmpDirection.copy(startVector).slerp(endVector, progress);
    } else if (startVector && endVector && typeof tmpDirection.slerpVectors === "function") {
      tmpDirection.slerpVectors(startVector, endVector, progress);
    } else if (startVector && endVector) {
      tmpDirection.lerpVectors(startVector, endVector, progress);
    } else if (startVector) {
      tmpDirection.copy(startVector);
    }

    if (tmpDirection.lengthSq() === 0 && startVector) {
      tmpDirection.copy(startVector);
    }

    tmpDirection
      .normalize()
      .multiplyScalar(enemy.travelRadius ?? ENEMY_TRAVEL_RADIUS);

    enemy.mesh.position.copy(tmpDirection);
  }

  const waveFinished =
    waveState.waveActive &&
    waveState.enemiesSpawned >= waveConfig.enemiesPerWave &&
    enemies.length === 0;

  if (waveFinished) {
    if (waveState.currentWaveIndex >= waveConfig.totalWaves - 1) {
      clearWaveRouteHighlight();
      waveState.wavesComplete = true;
      waveState.waveActive = false;
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
    updateBuildMenu();
    return;
  }
  if (activeHexTile === mesh) {
    mesh.material.color.copy(mesh.userData.baseFill);
    mesh.userData.active = false;
    activeHexTile = null;
    updateBuildMenu();
    return;
  }
  if (activeHexTile) {
    activeHexTile.material.color.copy(activeHexTile.userData.baseFill);
    activeHexTile.userData.active = false;
  }
  activeHexTile = mesh;
  mesh.material.color.copy(activeHexColor);
  mesh.userData.active = true;
  updateBuildMenu();
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
  } else if (activeHexTile) {
    activeHexTile.material.color.copy(activeHexTile.userData.baseFill);
    activeHexTile.userData.active = false;
    activeHexTile = null;
    updateBuildMenu();
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
      hasTower: false,
      tower: null,
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








