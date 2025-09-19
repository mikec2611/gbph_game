import * as THREE from "three";
import { COLOR_CONFIG, TOWER_CONFIG, WORLD_UP } from "./constants.js";

const SHOT_LIFETIME = 0.25;

export function createTowerManager({
  towerGroup,
  effectGroup,
  tileThickness,
  baseHexRadius,
  tileGraph,
  onPathRecalculated,
  updateBuildMenu,
}) {
  if (!towerGroup) {
    throw new Error("Tower group missing from tower manager initialization.");
  }
  if (!tileGraph) {
    throw new Error("Tile graph missing from tower manager initialization.");
  }
  if (!effectGroup) {
    throw new Error("Effect group missing from tower manager initialization.");
  }

  const activeHexColor = new THREE.Color(COLOR_CONFIG.activeHexFill);
  const towerColor = TOWER_CONFIG.color.clone();
  const towerBorderColor = TOWER_CONFIG.borderColor.clone();
  const projectileColor = TOWER_CONFIG.projectileColor.clone();

  const managedTowers = [];
  const activeShots = [];

  let activeHexTile = null;

  function resetActiveTile() {
    if (!activeHexTile) {
      return;
    }
    activeHexTile.material.color.copy(activeHexTile.userData.baseFill);
    activeHexTile.userData.active = false;
    activeHexTile = null;
    if (typeof updateBuildMenu === "function") {
      updateBuildMenu(null);
    }
  }

  function setActiveTile(tile) {
    if (!tile || tile.userData.sides !== 6) {
      resetActiveTile();
      return;
    }

    if (activeHexTile === tile) {
      tile.material.color.copy(tile.userData.baseFill);
      tile.userData.active = false;
      activeHexTile = null;
    } else {
      if (activeHexTile) {
        activeHexTile.material.color.copy(activeHexTile.userData.baseFill);
        activeHexTile.userData.active = false;
      }
      activeHexTile = tile;
      tile.material.color.copy(activeHexColor);
      tile.userData.active = true;
    }

    if (typeof updateBuildMenu === "function") {
      updateBuildMenu(activeHexTile);
    }
  }

  function attemptBuildOnActiveTile() {
    if (!activeHexTile) {
      if (typeof updateBuildMenu === "function") {
        updateBuildMenu(null);
      }
      return false;
    }
    if (activeHexTile.userData.hasTower) {
      if (typeof updateBuildMenu === "function") {
        updateBuildMenu(activeHexTile);
      }
      return false;
    }
    const built = buildTowerOnTile(activeHexTile);
    if (typeof updateBuildMenu === "function") {
      updateBuildMenu(activeHexTile);
    }
    return built;
  }

  function buildTowerOnTile(tile) {
    if (!tile || tile.userData.hasTower) {
      return false;
    }

    const towerHeight = tileThickness * TOWER_CONFIG.heightFactor;
    const tileRadius = tile.userData.tileRadius ?? baseHexRadius;
    const towerRadius = tileRadius * TOWER_CONFIG.radiusFactor;

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

    const rangeTiles = computeRangeTiles(tile, TOWER_CONFIG.rangeHexes);

    managedTowers.push({
      tile,
      mesh: towerMesh,
      cooldown: 0,
      rangeTiles,
    });

    if (typeof onPathRecalculated === "function") {
      onPathRecalculated();
    }

    return true;
  }

  function computeRangeTiles(startTile, maxSteps) {
    const visited = new Set([startTile]);
    let frontier = [startTile];

    for (let step = 0; step < maxSteps; step += 1) {
      const nextFrontier = [];
      frontier.forEach((tile) => {
        const neighbors = tileGraph.get(tile) ?? tile.userData.neighbors ?? [];
        neighbors.forEach((neighbor) => {
          if (!neighbor || visited.has(neighbor)) {
            return;
          }
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        });
      });
      frontier = nextFrontier;
      if (frontier.length === 0) {
        break;
      }
    }

    return visited;
  }

  function update(delta, enemies = []) {
    managedTowers.forEach((tower) => {
      tower.cooldown = Math.max(tower.cooldown - delta, 0);
      if (tower.cooldown > 0) {
        return;
      }
      const target = acquireTarget(tower, enemies);
      if (target) {
        fireShot(tower, target);
        tower.cooldown = TOWER_CONFIG.fireInterval;
        if (typeof target.totalDamage === "number") {
          target.totalDamage += TOWER_CONFIG.damagePerShot;
        } else {
          target.totalDamage = TOWER_CONFIG.damagePerShot;
        }
        if (typeof target.health === "number") {
          target.health = Math.max(target.health - TOWER_CONFIG.damagePerShot, 0);
        }
      }
    });

    updateShots(delta);
  }

  function acquireTarget(tower, enemies) {
    let selected = null;
    let bestDistance = Infinity;

    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = enemies[i];
      if (typeof enemy.health === "number" && enemy.health <= 0) {
        continue;
      }
      const tileIndex = Math.min(
        Math.max(enemy.segmentIndex ?? 0, 0),
        (enemy.pathTiles?.length ?? 1) - 1
      );
      const enemyTile = enemy.pathTiles ? enemy.pathTiles[tileIndex] : null;
      if (!enemyTile || !tower.rangeTiles.has(enemyTile)) {
        continue;
      }
      const distance = tower.mesh.position.distanceToSquared(enemy.mesh.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        selected = enemy;
      }
    }

    return selected;
  }

  function fireShot(tower, enemy) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      tower.mesh.position.clone(),
      enemy.mesh.position.clone(),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: projectileColor,
      transparent: true,
      opacity: 1,
      linewidth: 2,
    });
    const line = new THREE.Line(geometry, material);
    effectGroup.add(line);

    activeShots.push({
      mesh: line,
      lifetime: SHOT_LIFETIME,
      elapsed: 0,
      material,
    });
  }

  function updateShots(delta) {
    for (let i = activeShots.length - 1; i >= 0; i -= 1) {
      const shot = activeShots[i];
      shot.elapsed += delta;
      const remaining = Math.max(shot.lifetime - shot.elapsed, 0);
      const opacity = remaining / shot.lifetime;
      shot.material.opacity = opacity;
      if (shot.elapsed >= shot.lifetime) {
        effectGroup.remove(shot.mesh);
        shot.mesh.geometry.dispose();
        shot.material.dispose();
        activeShots.splice(i, 1);
      }
    }
  }

  function clearShots() {
    while (activeShots.length > 0) {
      const shot = activeShots.pop();
      effectGroup.remove(shot.mesh);
      shot.mesh.geometry.dispose();
      shot.material.dispose();
    }
  }

  function clearTowers(interactiveTiles) {
    for (let i = towerGroup.children.length - 1; i >= 0; i -= 1) {
      towerGroup.remove(towerGroup.children[i]);
    }
    managedTowers.length = 0;
    clearShots();

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
    if (typeof updateBuildMenu === "function") {
      updateBuildMenu(activeHexTile);
    }
  }

  return {
    setActiveTile,
    resetActiveTile,
    attemptBuildOnActiveTile,
    buildTowerOnTile,
    clearTowers,
    update,
    clearShots,
    getActiveTile: () => activeHexTile,
  };
}