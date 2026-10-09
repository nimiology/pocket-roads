import * as THREE from 'three';

export const PALETTE = {
  background: '#f5b44c',
  land: '#ffd06a',
  landEdge: '#f0a640',
  sand: '#fff1d6',
  water: '#8fd3d6',
  waterDeep: '#74c4c9',
  mountainBase: '#f59a3c',
  mountain: '#f08a33',
  /** Terrace tints from the foot of a mountain to its top. */
  mountainTiers: ['#f39238', '#f7a446', '#fab656'],
  outside: '#f5b44c',
  gridLine: '#000000',
  road: '#3d3c50',
  bridge: '#3d3c50',
  bridgeRail: '#2c2f3a',
  tunnel: '#3b3a38',
  pad: '#fbd27a',
  parking: '#3d3c50',
  curb: '#3d3c50',
  parkingLine: '#5d5b75',
  pin: '#ffffff',
  pinRim: '#3d3a35',
  island: '#fff1d6',
  motorway: '#878c95',
  pillar: '#e2953a',
  warning: '#e5483a',
  trunk: '#a8552d',
  leaves: ['#e8574a', '#d9443c', '#f07560'],
  glass: '#2f3540',
  /** One per game color id. */
  colors: ['#ef5a4c', '#5ec4e8', '#ffffff', '#8b84d9', '#3fbf8f', '#f580a8'],
};

/** A colour shifted in lightness and saturation (HSL offsets). */
export function shade(color: string, light: number, sat = 0): THREE.Color {
  return new THREE.Color(color).offsetHSL(0, sat, light);
}
