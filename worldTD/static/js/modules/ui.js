import { WAVE_CONFIG, PLAYER_CONFIG } from "./constants.js";

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
  onPlayAgain,
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
  const gameOverOverlay = document.getElementById("game-over");
  const gameOverAction = document.getElementById("game-over-action");
  const gameOverMessage = document.getElementById("game-over-message");
  const lifeCounterElement = document.getElementById("life-counter");
  if (!lifeCounterElement) {
    throw new Error("Life counter element missing from the page.");
  }

  if (!buildMenu || !buildMenuStatus || !buildButton) {
    throw new Error("Build menu elements missing from the page.");
  }

  if (!gameOverOverlay || !gameOverAction || !gameOverMessage) {
    throw new Error("Game over elements missing from the page.");
  }

  if (typeof onBuildRequest === "function") {
    buildButton.addEventListener("click", onBuildRequest);
  }

  if (typeof onPlayAgain === "function") {
    gameOverAction.addEventListener("click", onPlayAgain);
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

  updateLifeCounter(PLAYER_CONFIG.initialLives ?? 0);

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
    const totalWaves = Math.max(getTotalWaves(), 1);
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

  function updateBuildMenu(activeHexTile, { statusMessage, forceDisabled = false } = {}) {
    buildButton.classList.remove("tower-card--ready");

    if (!activeHexTile) {
      buildMenu.classList.remove("is-visible");
      buildMenu.setAttribute("aria-hidden", "true");
      buildButton.disabled = true;
      buildMenuStatus.textContent = statusMessage ?? "Select a hex to build.";
      return;
    }

    buildMenu.classList.add("is-visible");
    buildMenu.setAttribute("aria-hidden", "false");

    if (activeHexTile.userData.hasTower) {
      buildMenuStatus.textContent = statusMessage ?? "Tower already built on this hex.";
      buildButton.disabled = true;
      buildButton.classList.remove("tower-card--ready");
      return;
    }

    if (forceDisabled) {
      buildButton.disabled = true;
      buildButton.classList.remove("tower-card--ready");
    } else {
      buildButton.disabled = false;
      buildButton.classList.add("tower-card--ready");
    }

    buildMenuStatus.textContent = statusMessage ?? "Deploy the Sentinel Tower on this hex.";
  }

  function updateLifeCounter(lives) {
    const safeLives = Number.isFinite(lives) ? Math.max(Math.floor(lives), 0) : 0;
    lifeCounterElement.textContent = `Player Lives: ${safeLives}`;
  }

  function showGameOver({ waveNumber, wavesComplete } = {}) {
    if (wavesComplete) {
      gameOverMessage.textContent = "You survived every wave!";
    } else if (Number.isFinite(waveNumber) && waveNumber > 0) {
      const safeWave = Math.max(Math.floor(waveNumber), 1);
      gameOverMessage.textContent = `You made it to Wave ${safeWave}.`;
    } else {
      gameOverMessage.textContent = "You made it to the final wave.";
    }

    gameOverOverlay.classList.add("is-visible");
    gameOverOverlay.setAttribute("aria-hidden", "false");
    queueMicrotask(() => gameOverAction.focus({ preventScroll: true }));
  }

  function hideGameOver() {
    if (!gameOverOverlay.classList.contains("is-visible")) {
      return;
    }
    gameOverOverlay.classList.remove("is-visible");
    gameOverOverlay.setAttribute("aria-hidden", "true");
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
    updateLifeCounter,
    showGameOver,
    hideGameOver,
    openGameMenu,
    closeGameMenu,
    setMenuToggleEnabled,
    setGameStarted,
  };
}



















