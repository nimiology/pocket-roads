import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Rounded-rectangle outline centred on the origin. */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * A slab extruded upward from a 2D outline: base at y=0, top at y=height, with a soft bevel.
 * The outline's x maps to world X and its y to world Z.
 */
export function slab(shape: THREE.Shape, height: number, bevel = 0.025): THREE.BufferGeometry {
  const bv = Math.min(bevel, height / 2.5);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, height - 2 * bv), bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv * 0.8,
    bevelSegments: 3, curveSegments: 14,
  });
  // Extrusion runs along +Z; stand it up so it runs along +Y, then sit it on the ground.
  geo.rotateX(-Math.PI / 2).translate(0, bv, 0);
  return geo;
}

/** Rounded slab of the given footprint (x by z). */
export function roundedSlab(w: number, d: number, height: number, r: number, bevel?: number): THREE.BufferGeometry {
  return slab(roundedRect(w - 0.04, d - 0.04, r), height, bevel);
}

export function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 3, r);
}

/** Gable roof: ridge along X, eaves overhanging the walls. Base at y=0. */
export function gableRoof(w: number, d: number, h: number): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  const v = [
    // two slopes
    -hw, 0, -hd, hw, 0, -hd, hw, h, 0, -hw, 0, -hd, hw, h, 0, -hw, h, 0,
    -hw, 0, hd, -hw, h, 0, hw, h, 0, -hw, 0, hd, hw, h, 0, hw, 0, hd,
    // gable ends
    -hw, 0, -hd, -hw, h, 0, -hw, 0, hd,
    hw, 0, -hd, hw, 0, hd, hw, h, 0,
    // underside
    -hw, 0, -hd, -hw, 0, hd, hw, 0, hd, -hw, 0, -hd, hw, 0, hd, hw, 0, -hd,
  ];
  // The triangles above are listed clockwise from outside; flip each so its front faces out.
  for (let t = 0; t < v.length; t += 9) {
    for (let k = 0; k < 3; k++) [v[t + 3 + k], v[t + 6 + k]] = [v[t + 6 + k], v[t + 3 + k]];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  // Material slots: 0 = sunny slope, 1 = shaded slope and the rest, so the ridge reads from above.
  geo.addGroup(0, 6, 0);
  geo.addGroup(6, 18, 1);
  return geo;
}
