import * as THREE from "three";
import { initScene } from "./modules/scene.js";
import { createHalo, createGoldbergSphere } from "./modules/geometry.js";
import { buildTileGraph } from "./modules/pathfinding.js";
import { initUI } from "./modules/ui.js";
import { createTowerManager } from "./modules/towers.js";
import { createWaveController } from "./modules/waves.js";
import { createInteractionController } from "./modules/interactions.js";
import { GLOBE_CONFIG, WORLD_UP, PLAYER_CONFIG } from "./modules/constants.js";

const { container, renderer, scene, camera, controls, globeGroup, clock } = initScene();

const globeRadius = GLOBE_CONFIG.radius;
const tileThickness = globeRadius * GLOBE_CONFIG.tileThicknessFactor;
const frequency = GLOBE_CONFIG.frequency;

globeGroup.add(createHalo(globeRadius));

const { group: tileGroup, counts, tiles: interactiveTiles } = createGoldbergSphere(
  globeRadius,
  tileThickness,
  frequency
);
globeGroup.add(tileGroup);
console.info("Tile distribution", counts);

const pentagonTiles = interactiveTiles.filter((tile) => tile.userData.sides === 5);
const endPointTile =
  pentagonTiles.length > 0
    ? pentagonTiles[Math.floor(Math.random() * pentagonTiles.length)]
    : null;
const spawnPentagonTiles = pentagonTiles.filter((tile) => tile !== endPointTile);
const referenceHexTile = interactiveTiles.find((tile) => tile.userData.sides === 6);
const baseHexRadius = referenceHexTile?.userData.tileRadius ?? tileThickness * 0.75;

const enemyGroup = new THREE.Group();
globeGroup.add(enemyGroup);

const towerGroup = new THREE.Group();
globeGroup.add(towerGroup);
const towerEffectGroup = new THREE.Group();
globeGroup.add(towerEffectGroup);

const tileGraph = buildTileGraph(interactiveTiles);

const ui = initUI({
  onPlayAgain: startNewGame,
});

const INITIAL_LIVES = Number.isFinite(PLAYER_CONFIG.initialLives) ? Math.max(Math.floor(PLAYER_CONFIG.initialLives), 0) : 0;
let lives = INITIAL_LIVES;
let isGameOver = false;
ui.updateLifeCounter(lives);

const waveController = createWaveController({
  globeRadius,
  tileThickness,
  baseHexRadius,
  enemyGroup,
  spawnPentagonTiles,
  endPointTile,
  tileGraph,
  updateWaveCounter: ui.updateWaveCounter,
  onEnemyReachedEnd: handleEnemyReachedEnd,
});

const towerManager = createTowerManager({
  towerGroup,
  effectGroup: towerEffectGroup,
  tileThickness,
  baseHexRadius,
  tileGraph,
  onPathRecalculated: waveController.recalculateActivePath,
  updateBuildMenu: ui.updateBuildMenu,
});

const interactionController = createInteractionController({
  renderer,
  camera,
  interactiveTiles,
  towerManager,
});

centerCameraOnEndTile();

if (ui.buildButton) {
  ui.buildButton.addEventListener("click", () => {
    towerManager.attemptBuildOnActiveTile();
  });
}

if (ui.gameMenuAction) {
  ui.gameMenuAction.addEventListener("click", () => {
    startNewGame();
  });
}

if (ui.menuToggleButton) {
  ui.menuToggleButton.addEventListener("click", () => {
    openGameMenu();
  });
}

ui.updateBuildMenu(null);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ui.gameMenu && ui.gameMenu.classList.contains("is-visible")) {
    closeGameMenu();
  }
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
  towerManager.attemptBuildOnActiveTile();
});

function openGameMenu() {
  ui.openGameMenu();
}

function closeGameMenu(options) {
  ui.closeGameMenu(options);
}

function startNewGame() {
  isGameOver = false;
  ui.hideGameOver();
  resetLives();
  towerManager.clearTowers(interactiveTiles);
  waveController.startNewGame();
  interactionController.resetHover();
  towerManager.resetActiveTile();
  centerCameraOnEndTile();
  ui.setGameStarted(true);
  closeGameMenu({ focusToggle: false });
  ui.setMenuToggleEnabled(true);
  if (ui.menuToggleButton) {
    ui.menuToggleButton.focus({ preventScroll: true });
  }
}

function resetLives() {
  lives = INITIAL_LIVES;
  ui.updateLifeCounter(lives);
}

function handleEnemyReachedEnd() {
  if (isGameOver) {
    return;
  }
  lives = Math.max(lives - 1, 0);
  ui.updateLifeCounter(lives);
  if (lives <= 0) {
    triggerGameOver();
  }
}

function triggerGameOver() {
  if (isGameOver) {
    return;
  }
  isGameOver = true;
  interactionController.resetHover();
  towerManager.resetActiveTile();
  towerManager.clearShots();
  waveController.clearAllEnemies();
  waveController.clearWaveRouteHighlight();
  const currentWaveNumber = Math.max(waveController.waveState.currentWaveIndex + 1, 1);
  ui.showGameOver({
    waveNumber: currentWaveNumber,
    wavesComplete: waveController.waveState.wavesComplete,
  });
  ui.setMenuToggleEnabled(false);
}
function centerCameraOnEndTile() {
  const targetTile = waveController.waveState.endTile ?? endPointTile;
  if (!targetTile) {
    return;
  }
  const tileCenter = targetTile.userData.center.clone();
  const viewDirection = tileCenter.clone().normalize();

  const fovRadians = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const minDistanceForFit = globeRadius / Math.tan(fovRadians);
  const extraOffset = tileThickness * 1.5;
  const cameraDistance = Math.max(minDistanceForFit + extraOffset, globeRadius + tileThickness * 2.5);

  camera.position.copy(viewDirection.clone().multiplyScalar(cameraDistance));
  controls.target.set(0, 0, 0);
  camera.lookAt(new THREE.Vector3(0, 0, 0));
  controls.update();
}

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
  if (!isGameOver) {
    waveController.update(delta);
    towerManager.update(delta, waveController.getActiveEnemies());
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

resizeRenderer();
animate();






