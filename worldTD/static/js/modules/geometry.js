import * as THREE from "three";
import { COLOR_CONFIG } from "./constants.js";

export function createHalo(radius) {
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

export function createGoldbergSphere(radius, thickness, frequency) {
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
  const tiles = [];

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
    tiles.push(mesh);
  }

  return { group: tileGroup, counts, tiles };
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
    const key = `${Math.round(point.x * 1e6)}|${Math.round(point.y * 1e6)}|${Math.round(point.z * 1e6)}`;
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
