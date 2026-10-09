import { PALETTE } from './palette';

/** The palette fields a theme recolours; building colours stay the same in every theme. */
type ThemeColors = Pick<typeof PALETTE,
  'background' | 'land' | 'landEdge' | 'sand' | 'water' | 'waterDeep' | 'mountainBase' | 'mountain' | 'mountainTiers' |
  'outside' | 'road' | 'bridge' | 'bridgeRail' | 'pad' | 'parking' | 'curb' | 'parkingLine' | 'island' | 'pillar' | 'trunk' | 'leaves'>;

export interface Theme {
  name: string;
  colors: ThemeColors;
  /** Flat fill light and the low sun that draws the hard shadows. */
  light: { fill: number; sun: number; sunColor: string };
}

const DAY_LIGHT = { fill: 1.75, sun: 1.5, sunColor: '#ffffff' };
const ROAD = { road: '#3d3c50', bridge: '#3d3c50', bridgeRail: '#2c2b3a', parking: '#3d3c50', curb: '#3d3c50', parkingLine: '#5d5b75' };

/** Day themes; each city picks one from its seed. */
export const DAY_THEMES: Theme[] = [
  {
    name: 'Sunny', light: DAY_LIGHT, colors: {
      ...ROAD, background: '#f5b44c', land: '#ffd06a', landEdge: '#f0a640', sand: '#fff1d6', water: '#8fd3d6', waterDeep: '#74c4c9',
      mountainBase: '#f59a3c', mountain: '#f08a33', mountainTiers: ['#f39238', '#f7a446', '#fab656'], outside: '#f5b44c',
      pad: '#fbd27a', island: '#fff1d6', pillar: '#e2953a', trunk: '#a8552d', leaves: ['#e8574a', '#d9443c', '#f07560'],
    },
  },
  {
    name: 'Snowy', light: DAY_LIGHT, colors: {
      ...ROAD, background: '#e6e1d8', land: '#f6f3ec', landEdge: '#e2ddd2', sand: '#ffffff', water: '#b9e1ee', waterDeep: '#a3d6e8',
      mountainBase: '#e8445a', mountain: '#e0364d', mountainTiers: ['#e23d53', '#ea5468', '#f06e80'], outside: '#e6e1d8',
      pad: '#ece7dd', island: '#ffffff', pillar: '#d9d3c7', trunk: '#8a6d5a', leaves: ['#e8445a', '#cf3349', '#f07a8a'],
    },
  },
  {
    name: 'Meadow', light: DAY_LIGHT, colors: {
      ...ROAD, background: '#9fd3a8', land: '#bde6c2', landEdge: '#a3d6aa', sand: '#effae9', water: '#7cc6e6', waterDeep: '#68b9dd',
      mountainBase: '#6cbf88', mountain: '#5bb37a', mountainTiers: ['#62b880', '#76c48f', '#8ad0a0'], outside: '#9fd3a8',
      pad: '#d4f0d6', island: '#effae9', pillar: '#a3d6aa', trunk: '#7a5a3c', leaves: ['#3f9a5c', '#4fae6c', '#2f8a4e'],
    },
  },
  {
    name: 'Blossom', light: DAY_LIGHT, colors: {
      ...ROAD, background: '#f4b3a6', land: '#fbcdbf', landEdge: '#f2b6a8', sand: '#fff0ea', water: '#95d6dc', waterDeep: '#7fcbd2',
      mountainBase: '#e98271', mountain: '#e27262', mountainTiers: ['#e57868', '#ec8f80', '#f2a597'], outside: '#f4b3a6',
      pad: '#fde0d6', island: '#fff0ea', pillar: '#eaa595', trunk: '#8f5745', leaves: ['#f07d98', '#e35f7e', '#f79ab0'],
    },
  },
];

/** Night: deep navy land, light roads, dim cool light. */
export const NIGHT_THEME: Theme = {
  name: 'Night', light: { fill: 1.25, sun: 1.0, sunColor: '#eef1ff' }, colors: {
    background: '#23253a', land: '#2d3149', landEdge: '#272a44', sand: '#434766', water: '#3a6db5', waterDeep: '#3463aa',
    mountainBase: '#3a3e62', mountain: '#353959', mountainTiers: ['#383c5f', '#41466c', '#4b5079'], outside: '#23253a',
    road: '#8e93aa', bridge: '#8e93aa', bridgeRail: '#7d8199', parking: '#8e93aa', curb: '#8e93aa', parkingLine: '#c7cada',
    pad: '#3d4163', island: '#434766', pillar: '#5a5f85', trunk: '#3b3550', leaves: ['#5866a0', '#4a578f', '#6875b0'],
  },
};

export type DayNight = 'day' | 'night';
const MODE_KEY = 'pocket-roads.daynight';

export function savedMode(): DayNight {
  try { return localStorage.getItem(MODE_KEY) === 'night' ? 'night' : 'day'; } catch { return 'day'; }
}

export function saveMode(m: DayNight): void {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
}

/** The theme for a city: its seed picks the day look; night is shared. Writes it into PALETTE. */
export function applyTheme(seed: number, mode: DayNight): Theme {
  const theme = mode === 'night' ? NIGHT_THEME : DAY_THEMES[Math.abs(seed) % DAY_THEMES.length];
  Object.assign(PALETTE, theme.colors);
  return theme;
}
