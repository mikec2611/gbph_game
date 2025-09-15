import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const container = document.getElementById("globe-container");
if (!container) {
  throw new Error("Globe container element missing from the page.");
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setClearColor(0x02040b, 1);
container.appendChild(renderer.domElement);

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

const globeRadius = 5;
const tileThickness = globeRadius * 0.22;
const frequency = 1; // Goldberg G(3,0) -> 12 pentagons + 80 hexagons = 92 tiles

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

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredTile = null;
const highlightColor = new THREE.Color(0xffec6b);
const emissiveBoost = 0.55;

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function resetHover() {
  if (!hoveredTile) {
    return;
  }
  hoveredTile.material.color.copy(hoveredTile.userData.baseColor);
  hoveredTile.material.emissiveIntensity = hoveredTile.userData.baseEmissive;
  hoveredTile = null;
}

function applyHover(mesh) {
  if (hoveredTile === mesh) {
    return;
  }
  resetHover();
  hoveredTile = mesh;
  mesh.material.color.copy(highlightColor);
  mesh.material.emissiveIntensity = emissiveBoost;
}

function handlePointerMove(event) {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects(interactiveTiles, false);
  if (intersections.length > 0) {
    applyHover(intersections[0].object);
  } else {
    resetHover();
  }
}

renderer.domElement.addEventListener("pointermove", handlePointerMove);
renderer.domElement.addEventListener("pointerleave", resetHover);

const clock = new THREE.Clock();

function resizeRenderer() {
  const { clientWidth, clientHeight } = container;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}

window.addEventListener("resize", resizeRenderer);

function animate() {
  const delta = clock.getDelta();
  globeGroup.rotation.y += delta * 0.12;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

resizeRenderer();
animate();

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
  const scratchColor = new THREE.Color();
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

    const material = new THREE.MeshStandardMaterial({
      roughness: 0.45,
      metalness: 0.22,
      emissive: new THREE.Color(0x050a16),
      emissiveIntensity: 0.25,
      flatShading: true,
    });

    const latNormalized = THREE.MathUtils.clamp((normal.y + 1) * 0.5, 0, 1);
    const hue = THREE.MathUtils.lerp(0.58, 0.08, latNormalized);
    const lightness = THREE.MathUtils.lerp(0.35, 0.58, latNormalized);
    scratchColor.setHSL(hue, 0.72, lightness);
    material.color.copy(scratchColor);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData = {
      baseColor: scratchColor.clone(),
      baseEmissive: material.emissiveIntensity,
      sides: ringPoints.length,
    };

    if (ringPoints.length === 5) {
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
