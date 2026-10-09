import * as THREE from 'three';

export const PALETTE = {
  background: '#e6e0d1',
  land: '#f2ede0',
  landEdge: '#d9d1bd',
  sand: '#e7dbbd',
  water: '#7db6dc',
  waterDeep: '#6aa7d2',
  mountainBase: '#ddd2b8',
  mountain: '#cdbf9c',
  /** Terrace tints from the foot of a mountain to its top. */
  mountainTiers: ['#cdbf9d', '#d9cdae', '#e4dac0'],
  outside: '#e2dccd',
  gridLine: '#000000',
  road: '#5d6169',
  bridge: '#8a8f97',
  bridgeRail: '#44474d',
  tunnel: '#3b3a38',
  pad: '#e3ddcf',
  parking: '#80848c',
  curb: '#d8d2c4',
  parkingLine: '#fbfaf6',
  pin: '#ffffff',
  pinRim: '#3d3a35',
  island: '#9ccf86',
  motorway: '#878c95',
  pillar: '#c9c2b2',
  warning: '#e5483a',
  trunk: '#9a7b5c',
  leaves: ['#8fc27c', '#7db46e', '#a4cf88'],
  glass: '#2f3540',
  /** One per game color id. */
  colors: ['#e8584a', '#3f8fd8', '#f2b230', '#3db58a', '#9a6ad6', '#f07f3c'],
};

/** A colour shifted in lightness and saturation (HSL offsets). */
export function shade(color: string, light: number, sat = 0): THREE.Color {
  return new THREE.Color(color).offsetHSL(0, sat, light);
}
