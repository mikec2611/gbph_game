import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { COLOR_CONFIG, GLOBE_CONFIG } from "./constants.js";

export function initScene(containerId = "globe-container") {
  const container = document.getElementById(containerId);
  if (!container) {
    throw new Error(`Globe container element missing: ${containerId}`);
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(COLOR_CONFIG.background, 1);

  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLOR_CONFIG.background, GLOBE_CONFIG.fogNear, GLOBE_CONFIG.fogFar);

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

  const globeGroup = new THREE.Group();
  scene.add(globeGroup);

  scene.add(new THREE.AmbientLight(0x7b8bf3, 0.55));

  const keyLight = new THREE.DirectionalLight(0xd7e7ff, 1.15);
  keyLight.position.set(6, 10, 4);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x123b7a, 0.5);
  rimLight.position.set(-6, -4, -3);
  scene.add(rimLight);

  const clock = new THREE.Clock();

  return { container, renderer, scene, camera, controls, globeGroup, clock };
}
