import * as THREE from "three";
import {
  ROUTE_HIGHLIGHT_COLORS,
  ENEMY_CONFIG,
  WAVE_CONFIG,
} from "./constants.js";
import { findPathBetweenTiles } from "./pathfinding.js";

const DEFAULT_WAVES = [
  { enemies: 8, health: 10, speed: 1.0 },
  { enemies: 9, health: 12, speed: 1.05 },
  { enemies: 10, health: 14, speed: 1.1 },
  { enemies: 11, health: 17, speed: 1.12 },
  { enemies: 12, health: 20, speed: 1.14 },
  { enemies: 13, health: 24, speed: 1.16 },
  { enemies: 14, health: 29, speed: 1.18 },
  { enemies: 15, health: 35, speed: 1.2 },
  { enemies: 16, health: 42, speed: 1.22 },
  { enemies: 18, health: 50, speed: 1.25 },
];

export function createWaveController({
  globeRadius,
  tileThickness,
  baseHexRadius,
  enemyGroup,
  spawnPentagonTiles,
  endPointTile,
  tileGraph,
  updateWaveCounter,
}) {
  if (!enemyGroup) {
    throw new Error("Enemy group missing from wave controller initialization.");
  }
  if (!Array.isArray(spawnPentagonTiles)) {
    throw new Error("Spawn tile list missing for wave controller initialization.");
  }
  if (!tileGraph) {
    throw new Error("Tile graph missing for wave controller initialization.");
  }

  const defaults = {
    initialDelay: WAVE_CONFIG.initialDelay ?? 10,
    breakDuration: WAVE_CONFIG.breakDuration ?? 10,
    baseSpawnInterval: WAVE_CONFIG.baseSpawnInterval ?? 0.8,
    baseSpawnVariance: WAVE_CONFIG.baseSpawnVariance ?? 0.3,
    minimumSpawnInterval: WAVE_CONFIG.minimumSpawnInterval ?? 0.2,
  };

  const waveDefinitions = Array.isArray(WAVE_CONFIG.waves) && WAVE_CONFIG.waves.length > 0
    ? WAVE_CONFIG.waves
    : DEFAULT_WAVES;

  const enemyRadius = baseHexRadius * ENEMY_CONFIG.baseRadiusFactor;
  const enemySurfaceOffset = Math.max(
    tileThickness * ENEMY_CONFIG.minimumSurfaceOffset,
    enemyRadius * ENEMY_CONFIG.surfaceOffsetFactor,
  );
  const enemyTravelRadius = globeRadius + tileThickness + enemySurfaceOffset;

  const enemyGeometry = new THREE.SphereGeometry(
    enemyRadius,
    ENEMY_CONFIG.geometrySegments,
    ENEMY_CONFIG.geometrySegments,
  );
  const enemyColor = ENEMY_CONFIG.color.clone();
  const enemyMaterial = new THREE.MeshStandardMaterial({
    color: enemyColor.clone(),
    emissive: enemyColor.clone().multiplyScalar(0.4),
    roughness: 0.35,
    metalness: 0.2,
  });

  const waveState = {
    currentWaveIndex: -1,
    enemiesSpawned: 0,
    enemiesRemaining: getWaveConfigAt(0).enemies,
    pendingWaveDelay: defaults.initialDelay,
    waveActive: false,
    wavesComplete: false,
    endTile: endPointTile,
    routesBySpawn: new Map(),
    highlightedTiles: [],
  };

  const enemies = [];
  let spawnCountdown = getAdjustedSpawnInterval(getWaveConfigAt(0));
  const tmpDirection = new THREE.Vector3();

  function getTotalWaves() {
    return waveDefinitions.length;
  }

  function getMinimumInterval() {
    return defaults.minimumSpawnInterval;
  }

  function getWaveConfigAt(index) {
    if (waveDefinitions.length === 0) {
      return DEFAULT_WAVES[0];
    }
    const clamped = Math.max(0, Math.min(index, waveDefinitions.length - 1));
    const wave = waveDefinitions[clamped] || DEFAULT_WAVES[Math.min(clamped, DEFAULT_WAVES.length - 1)];
    return {
      enemies: wave.enemies ?? DEFAULT_WAVES[clamped]?.enemies ?? 8,
      health: wave.health ?? DEFAULT_WAVES[clamped]?.health ?? 10,
      speed: wave.speed ?? DEFAULT_WAVES[clamped]?.speed ?? 1,
      spawnInterval: wave.spawnInterval ?? defaults.baseSpawnInterval,
      spawnVariance: wave.spawnVariance ?? defaults.baseSpawnVariance,
      breakDuration: wave.breakDuration ?? defaults.breakDuration,
      initialDelay: wave.initialDelay ?? defaults.initialDelay,
    };
  }

  function getCurrentWaveConfig() {
    return getWaveConfigAt(Math.max(waveState.currentWaveIndex, 0));
  }

  function getNextWaveConfig() {
    return getWaveConfigAt(Math.max(waveState.currentWaveIndex + 1, 0));
  }

  function getAdjustedSpawnInterval(wave) {
    const safeWave = wave ?? getCurrentWaveConfig();
    const baseInterval = Math.max(safeWave.spawnInterval ?? defaults.baseSpawnInterval, getMinimumInterval());
    const speed = Math.max(safeWave.speed ?? 1, 0.1);
    return Math.max(getMinimumInterval(), baseInterval / speed);
  }

  function getBreakDuration() {
    return getCurrentWaveConfig().breakDuration;
  }

  function getTimeUntilNextWave() {
    if (waveState.wavesComplete) {
      return null;
    }
    if (waveState.waveActive) {
      return 0;
    }
    return Math.max(waveState.pendingWaveDelay, 0);
  }

  function notifyWaveCounter() {
    if (typeof updateWaveCounter === "function") {
      updateWaveCounter({
        waveState,
        timeUntilNextWave: getTimeUntilNextWave(),
      });
    }
  }

  function getNextSpawnTimer() {
    const wave = getCurrentWaveConfig();
    const baseInterval = getAdjustedSpawnInterval(wave);
    const variance = wave.spawnVariance ?? defaults.baseSpawnVariance;
    const offset = (Math.random() - 0.5) * variance;
    return Math.max(getMinimumInterval(), baseInterval + offset);
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

    highlightPathTiles(Array.from(pathSet), excludedTiles);
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
      const pathTiles = findPathBetweenTiles(tileGraph, spawnTile, targetTile);
      if (!Array.isArray(pathTiles) || pathTiles.length < 2) {
        return;
      }
      routes.set(spawnTile, pathTiles);
    });

    waveState.routesBySpawn = routes;
    if (routes.size === 0) {
      waveState.routesBySpawn = new Map();
      waveState.highlightedTiles = [];
      waveState.enemiesRemaining = 0;
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

  function recalculateActivePath() {
    prepareNextRoute();
  }

  function calculateSegmentDuration(pathVectors, segmentIndex) {
    const startVector = pathVectors[segmentIndex];
    const endVector = pathVectors[segmentIndex + 1];
    if (!startVector || !endVector) {
      return getMinimumInterval();
    }
    const arc = startVector.angleTo(endVector);
    if (!Number.isFinite(arc) || arc <= 0) {
      return getMinimumInterval();
    }
    return Math.max(arc / ENEMY_CONFIG.travelAngularSpeed, getMinimumInterval());
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
    enemy.pathTiles = pathTiles;
    enemy.segmentIndex = Math.max(0, newIndex);
    enemy.segmentProgress = newProgress;
    enemy.segmentDuration = calculateSegmentDuration(enemy.pathVectors, enemy.segmentIndex);
    if (!Number.isFinite(enemy.segmentDuration) || enemy.segmentDuration <= 0) {
      enemy.segmentDuration = getMinimumInterval();
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

    tmpDirection.normalize().multiplyScalar(enemy.travelRadius ?? enemyTravelRadius);

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

    const spawnChoices = spawnTileOverride ? [spawnTileOverride] : availableRoutes.map(([spawn]) => spawn);

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
        pathTiles = findPathBetweenTiles(tileGraph, spawnTile, targetTile);
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
      enemyMesh.position.copy(pathVectors[0]).multiplyScalar(enemyTravelRadius);

      const wave = getCurrentWaveConfig();
      const segmentDuration = calculateSegmentDuration(pathVectors, 0) / Math.max(wave.speed ?? 1, 0.1);

      enemies.push({
        mesh: enemyMesh,
        pathTiles,
        pathVectors,
        segmentIndex: 0,
        segmentProgress: 0,
        segmentDuration: Number.isFinite(segmentDuration) && segmentDuration > 0 ? segmentDuration : getMinimumInterval(),
        travelRadius: enemyTravelRadius,
        waveIndex: waveState.waveActive ? waveState.currentWaveIndex : null,
        spawnTile,
        totalDamage: 0,
        maxHealth: wave.health,
        health: wave.health,
        speedMultiplier: Math.max(wave.speed ?? 1, 0.1),
      });

      return true;
    }

    return false;
  }

  function startNextWave() {
    waveState.currentWaveIndex += 1;

    if (waveState.currentWaveIndex >= getTotalWaves()) {
      waveState.currentWaveIndex = getTotalWaves() - 1;
      waveState.wavesComplete = true;
      waveState.waveActive = false;
      waveState.pendingWaveDelay = 0;
      waveState.enemiesSpawned = 0;
      waveState.enemiesRemaining = 0;
      clearWaveRouteHighlight();
      notifyWaveCounter();
      return;
    }

    const wave = getCurrentWaveConfig();
    waveState.pendingWaveDelay = 0;
    waveState.enemiesSpawned = 0;
    waveState.enemiesRemaining = wave.enemies ?? 0;

    if (!prepareNextRoute()) {
      waveState.wavesComplete = true;
      waveState.waveActive = false;
      waveState.enemiesRemaining = 0;
      notifyWaveCounter();
      return;
    }

    spawnCountdown = Math.max(getMinimumInterval(), getAdjustedSpawnInterval(wave) * 0.5);
    waveState.waveActive = true;
    notifyWaveCounter();
  }

  function queueNextWave(delay = getBreakDuration()) {
    const nextWave = getNextWaveConfig();
    waveState.pendingWaveDelay = Math.max(0, delay);
    waveState.waveActive = false;
    waveState.enemiesSpawned = 0;
    waveState.enemiesRemaining = nextWave.enemies ?? 0;
    spawnCountdown = getAdjustedSpawnInterval(nextWave);

    if (!prepareNextRoute()) {
      waveState.routesBySpawn = new Map();
      waveState.wavesComplete = true;
      waveState.pendingWaveDelay = 0;
      waveState.enemiesRemaining = 0;
    }
    notifyWaveCounter();
  }

  function update(delta) {
    const activeWave = getCurrentWaveConfig();
    const upcomingWave = getNextWaveConfig();
    const countdownSpeed = Math.max((waveState.waveActive ? activeWave.speed : upcomingWave.speed) ?? 1, 0.1);

    if (!waveState.wavesComplete) {
      if (!waveState.waveActive) {
        if (waveState.pendingWaveDelay > 0) {
          waveState.pendingWaveDelay -= delta * countdownSpeed;
          if (waveState.pendingWaveDelay <= 0) {
            startNextWave();
          }
        }
      } else if (waveState.enemiesSpawned < (activeWave.enemies ?? 0)) {
        spawnCountdown -= delta * Math.max(activeWave.speed ?? 1, 0.1);
        if (spawnCountdown <= 0) {
          const spawned = spawnEnemy();
          if (spawned) {
            waveState.enemiesSpawned += 1;
            if (typeof waveState.enemiesRemaining === "number") {
              waveState.enemiesRemaining = Math.max(waveState.enemiesRemaining - 1, 0);
            }
          }
          spawnCountdown = getNextSpawnTimer();
          notifyWaveCounter();
        }
      }
    }

    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (!enemy) {
        enemies.splice(i, 1);
        continue;
      }

      if (typeof enemy.health === "number" && enemy.health <= 0) {
        if (enemy.mesh) {
          enemyGroup.remove(enemy.mesh);
        }
        enemies.splice(i, 1);
        continue;
      }

      if (!enemy.pathVectors || enemy.pathVectors.length < 2) {
        if (enemy.mesh) {
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
            enemy.segmentDuration = getMinimumInterval();
          }
        }

        const enemySpeed = Math.max(enemy.speedMultiplier ?? 1, 0.1);
        const increment = (remainingDelta * enemySpeed) / enemy.segmentDuration;
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

      tmpDirection.normalize().multiplyScalar(enemy.travelRadius ?? enemyTravelRadius);

      enemy.mesh.position.copy(tmpDirection);
    }

    const waveComplete =
      waveState.waveActive &&
      waveState.enemiesSpawned >= (activeWave.enemies ?? 0) &&
      enemies.length === 0;

    if (waveComplete) {
      if (waveState.currentWaveIndex >= getTotalWaves() - 1) {
        clearWaveRouteHighlight();
        waveState.wavesComplete = true;
        waveState.waveActive = false;
        waveState.pendingWaveDelay = 0;
        waveState.enemiesRemaining = 0;
        notifyWaveCounter();
      } else {
        queueNextWave();
      }
    }

    notifyWaveCounter();
  }

  function getActiveEnemies() {
    return enemies;
  }

  function clearAllEnemies() {
    clearEnemies();
  }

  function startNewGame() {
    clearEnemies();
    clearWaveRouteHighlight();
    waveState.currentWaveIndex = -1;
    waveState.enemiesSpawned = 0;
    waveState.enemiesRemaining = getWaveConfigAt(0).enemies;
    waveState.pendingWaveDelay = defaults.initialDelay;
    waveState.waveActive = false;
    waveState.wavesComplete = false;
    waveState.routesBySpawn = new Map();
    waveState.highlightedTiles = [];
    waveState.endTile = endPointTile;
    spawnCountdown = getAdjustedSpawnInterval(getWaveConfigAt(0));

    const prepared = prepareNextRoute();
    if (!prepared) {
      highlightActiveRoutes();
    }
    notifyWaveCounter();
  }

  return {
    waveState,
    startNewGame,
    startNextWave,
    queueNextWave,
    update,
    getActiveEnemies,
    clearWaveRouteHighlight,
    synchronizeEnemiesToRoutes,
    prepareNextRoute,
    recalculateActivePath,
    clearAllEnemies,
    highlightActiveRoutes,
  };
}
