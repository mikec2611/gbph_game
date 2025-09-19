import * as THREE from "three";
import { COLOR_CONFIG } from "./constants.js";

export function createInteractionController({
  renderer,
  camera,
  interactiveTiles,
  towerManager,
}) {
  if (!renderer || !camera) {
    throw new Error("Renderer and camera are required for interaction setup.");
  }
  if (!towerManager) {
    throw new Error("Tower manager is required for interaction setup.");
  }

  const hoverBorderColor = new THREE.Color(COLOR_CONFIG.hoverBorder);
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

  function selectTileUnderPointer(event) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(interactiveTiles, false);
    if (intersections.length > 0) {
      towerManager.setActiveTile(intersections[0].object);
    } else {
      towerManager.resetActiveTile();
    }
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

  return {
    resetHover,
  };
}
