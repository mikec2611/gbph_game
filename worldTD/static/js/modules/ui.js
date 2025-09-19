import { WAVE_CONFIG } from "./constants.js";

function getTotalWaves() {
  return Array.isArray(WAVE_CONFIG.waves) ? WAVE_CONFIG.waves.length : 0;
}

function getWaveEnemyCount(index) {
  const waves = WAVE_CONFIG.waves || [];
  if (!Array.isArray(waves) || waves.length === 0) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(index, waves.length - 1));
  const wave = waves[clamped] || {};
  return wave.enemies ?? 0;
}

export function initUI({
  onStartGame,
  onMenuToggle,
  onBuildRequest,
} = {}) {
  const waveCounterElement = document.getElementById("wave-counter");
  if (!waveCounterElement) {
    throw new Error("Wave counter element missing from the page.");
  }

  const waveTimerElement = document.getElementById("wave-timer");
  if (!waveTimerElement) {
    throw new Error("Wave timer element missing from the page.");
  }

  const menuToggleButton = document.getElementById("menu-toggle");
  const gameMenu = document.getElementById("game-menu");
  const gameMenuAction = document.getElementById("game-menu-action");
  const buildMenu = document.getElementById("build-menu");
  const buildMenuStatus = document.getElementById("build-menu-status");
  const buildButton = document.getElementById("build-basic-tower");

  if (!buildMenu || !buildMenuStatus || !buildButton) {
    throw new Error("Build menu elements missing from the page.");
  }

  if (typeof onBuildRequest === "function") {
    buildButton.addEventListener("click", onBuildRequest);
  }

  if (gameMenu) {
    document.body.classList.add("menu-open");
    gameMenu.classList.add("is-visible");
  }

  if (menuToggleButton) {
    menuToggleButton.disabled = true;
    menuToggleButton.setAttribute("aria-expanded", "true");
    if (typeof onMenuToggle === "function") {
      menuToggleButton.addEventListener("click", onMenuToggle);
    }
  }

  if (gameMenuAction && typeof onStartGame === "function") {
    gameMenuAction.addEventListener("click", onStartGame);
  }

  updateWaveCounter({
    waveState: {
      wavesComplete: false,
      currentWaveIndex: -1,
      waveActive: false,
      enemiesSpawned: 0,
      enemiesRemaining: getWaveEnemyCount(0),
      pendingWaveDelay: WAVE_CONFIG.initialDelay ?? 10,
    },
    timeUntilNextWave: WAVE_CONFIG.initialDelay ?? 10,
  });

  let gameHasStarted = false;

  function setGameStarted(started) {
    gameHasStarted = started;
    if (gameMenuAction) {
      const actionLabel = gameHasStarted ? "New Game" : "Start Game";
      gameMenuAction.textContent = actionLabel;
      gameMenuAction.setAttribute("aria-label", actionLabel);
    }
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

  function setMenuToggleEnabled(enabled) {
    if (!menuToggleButton) {
      return;
    }
    menuToggleButton.disabled = !enabled;
  }

  function updateWaveCounter({ waveState, timeUntilNextWave }) {
    const totalWaves = getTotalWaves();
    const currentIndex = Math.max(waveState.currentWaveIndex, 0);
    const enemiesForWave = getWaveEnemyCount(currentIndex);

    if (waveState.wavesComplete) {
      waveCounterElement.textContent = `Wave ${totalWaves} / ${totalWaves} - Complete`;
      waveTimerElement.textContent = "Time Until Next Wave: Complete";
      return;
    }

    if (waveState.currentWaveIndex < 0) {
      waveCounterElement.textContent = `Preparing Wave 1 / ${totalWaves}`;
    } else {
      const waveNumber = waveState.currentWaveIndex + 1;
      if (waveState.waveActive) {
        const remaining = Math.max(enemiesForWave - waveState.enemiesSpawned, 0);
        const statusLabel = remaining > 0 ? `${remaining} inbound` : "Engaged";
        waveCounterElement.textContent = `Wave ${waveNumber} / ${totalWaves} - ${statusLabel}`;
      } else if (waveState.pendingWaveDelay > 0) {
        if (waveState.enemiesSpawned >= enemiesForWave) {
          waveCounterElement.textContent = `Wave ${waveNumber} / ${totalWaves} - Cleared`;
        } else {
          const nextWaveNumber = Math.min(waveState.currentWaveIndex + 2, totalWaves);
          waveCounterElement.textContent = `Preparing Wave ${nextWaveNumber} / ${totalWaves}`;
        }
      } else {
        waveCounterElement.textContent = `Wave ${waveNumber} / ${totalWaves}`;
      }
    }

    let timerLabel = "Time Until Next Wave: --";
    if (waveState.wavesComplete) {
      timerLabel = "Time Until Next Wave: Complete";
    } else if (waveState.waveActive) {
      timerLabel = "Time Until Next Wave: Wave In Progress";
    } else if (Number.isFinite(timeUntilNextWave) && timeUntilNextWave > 0) {
      timerLabel = `Time Until Next Wave: ${timeUntilNextWave.toFixed(1)}s`;
    } else {
      timerLabel = "Time Until Next Wave: Ready";
    }
    waveTimerElement.textContent = timerLabel;
  }

  function updateBuildMenu(activeHexTile) {
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

  return {
    waveCounterElement,
    waveTimerElement,
    menuToggleButton,
    gameMenu,
    gameMenuAction,
    buildMenu,
    buildButton,
    updateWaveCounter,
    updateBuildMenu,
    openGameMenu,
    closeGameMenu,
    setMenuToggleEnabled,
    setGameStarted,
  };
}
