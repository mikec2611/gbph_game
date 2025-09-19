import * as THREE from "three";

export const COLOR_CONFIG = Object.freeze({
  hexFill: 0x2c3e50,
  hexBorder: 0x95a5a6,
  pentagonFill: 0xf1c40f,
  pentagonBorder: 0x7d6608,
  hoverBorder: 0x1abc9c,
  activeHexFill: 0x27ae60,
  background: 0x02040b,
});

export const ROUTE_HIGHLIGHT_COLORS = Object.freeze({
  spawn: new THREE.Color(0x2eff71),
  target: new THREE.Color(0xff4d4d),
  path: new THREE.Color(0x9b59ff),
});

export const TOWER_CONFIG = Object.freeze({
  heightFactor: 1.7,
  radiusFactor: 0.6,
  color: new THREE.Color(0x8e44ad),
  borderColor: new THREE.Color(0xdcc8ff),
  projectileColor: new THREE.Color(0xdcc8ff),
  rangeHexes: 3,
  damagePerShot: 1,
  fireInterval: 1,
});

export const GLOBE_CONFIG = Object.freeze({
  radius: 5,
  tileThicknessFactor: 0.22,
  frequency: 10,
  fogNear: 18,
  fogFar: 38,
});

export const ENEMY_CONFIG = Object.freeze({
  travelAngularSpeed: Math.PI / 12,
  baseRadiusFactor: 0.8,
  surfaceOffsetFactor: 0.15,
  minimumSurfaceOffset: 0.05,
  geometrySegments: 16,
  color: new THREE.Color(0xe74c3c),
});

export const WAVE_CONFIG = Object.freeze({
  initialDelay: 10,
  breakDuration: 10,
  baseSpawnInterval: 0.8,
  baseSpawnVariance: 0.3,
  minimumSpawnInterval: 0.2,
  waves: [
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
  ],
});

export const WORLD_UP = new THREE.Vector3(0, 1, 0);
