export function buildTileGraph(tiles) {
  const tileGraph = new Map();
  if (!tiles || tiles.length === 0) {
    return tileGraph;
  }

  const normals = tiles.map((tile) => tile.userData.normal.clone().normalize());
  const adjacency = new Map();
  const angleSamples = [];

  for (let i = 0; i < normals.length; i += 1) {
    let minAngle = Infinity;
    for (let j = 0; j < normals.length; j += 1) {
      if (i === j) {
        continue;
      }
      const angle = normals[i].angleTo(normals[j]);
      if (angle < minAngle) {
        minAngle = angle;
      }
    }
    angleSamples.push(minAngle);
  }

  const sortedAngles = [...angleSamples].sort((a, b) => a - b);
  const baseAngle = sortedAngles[Math.floor(sortedAngles.length * 0.5)] * 1.25;

  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    const candidates = [];

    for (let j = 0; j < tiles.length; j += 1) {
      if (i === j) {
        continue;
      }
      const angle = normals[i].angleTo(normals[j]);
      candidates.push({ tile: tiles[j], angle });
    }

    candidates.sort((a, b) => a.angle - b.angle);
    const desiredNeighbors = tile.userData.sides ?? 6;
    const neighbors = [];

    for (let k = 0; k < candidates.length && neighbors.length < desiredNeighbors; k += 1) {
      const candidate = candidates[k];
      if (candidate.angle <= baseAngle || neighbors.length === 0) {
        neighbors.push(candidate.tile);
      }
    }

    if (!adjacency.has(tile)) {
      adjacency.set(tile, new Set());
    }

    const neighborSet = adjacency.get(tile);
    neighbors.forEach((neighbor) => {
      neighborSet.add(neighbor);
      if (!adjacency.has(neighbor)) {
        adjacency.set(neighbor, new Set());
      }
      adjacency.get(neighbor).add(tile);
    });
  }

  tiles.forEach((tile) => {
    const neighbors = Array.from(adjacency.get(tile) ?? []);
    tile.userData.neighbors = neighbors;
    tileGraph.set(tile, neighbors);
  });

  return tileGraph;
}

export function findPathBetweenTiles(tileGraph, startTile, targetTile) {
  if (!startTile || !targetTile) {
    return null;
  }
  if (startTile === targetTile) {
    return [startTile];
  }

  const visited = new Set([startTile]);
  const queue = [startTile];
  const parent = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = tileGraph.get(current) ?? current.userData.neighbors ?? [];
    for (let i = 0; i < neighbors.length; i += 1) {
      const neighbor = neighbors[i];
      if (!neighbor || visited.has(neighbor)) {
        continue;
      }
      if (neighbor.userData.hasTower && neighbor !== targetTile) {
        continue;
      }
      visited.add(neighbor);
      parent.set(neighbor, current);
      if (neighbor === targetTile) {
        const path = [neighbor];
        let backtrack = current;
        while (backtrack) {
          path.push(backtrack);
          backtrack = parent.get(backtrack);
        }
        path.reverse();
        return path;
      }
      queue.push(neighbor);
    }
  }

  return null;
}
