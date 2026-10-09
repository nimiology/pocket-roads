import * as THREE from 'three';
import { CameraControls } from './input/cameraControls';
import { RoadTool } from './input/roadTool';
import { BuildingRenderer } from './render/buildings';
import { CarRenderer } from './render/cars';
import { GameRenderer } from './render/renderer';
import { RoadRenderer } from './render/roads';
import { CONFIG, Game } from './sim/game';
import { generateMap } from './sim/mapgen';
import { GameOverScreen } from './ui/gameOver';
import { Hud } from './ui/hud';
import { UpgradePicker } from './ui/upgradePicker';
import { Toolbar } from './ui/toolbar';
import { Tutorial } from './ui/tutorial';

/** Fixed simulation step; rendering interpolates nothing yet, cars just move in small steps. */
const SIM_DT = 1 / 60;

const app = document.getElementById('app')!;
const renderer = new GameRenderer(app);
const roadRenderer = new RoadRenderer(renderer.scene);
const buildingRenderer = new BuildingRenderer(renderer.scene);
let entrancesKey = '';
const carRenderer = new CarRenderer(renderer.scene);
const toolbar = new Toolbar(document.body);
const gameOver = new GameOverScreen(document.body, () => newGame(seed), () => newGame(Math.floor(Math.random() * 1e6)));

const hud = new Hud(document.body, (s) => setSpeed(s));
const tutorial = new Tutorial(document.body);
const picker = new UpgradePicker(document.body, (i) => game.chooseUpgrade(i));
const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent =
  'drag road · drag out of a house to turn it · right-drag erase · right-click a tool to remove it · scroll zoom · middle/space-drag pan · P pause · 1/2 speed · H tutorial · O sandbox · R new map · G grow · T/B/N/Y/U/M +roads/bridge/tunnel/roundabout/light/motorway · Esc road tool';
document.body.appendChild(hint);

const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e6);
let game: Game;
let speed = 1;
let paused = false;
let drawnRoads = -1;
let drawnBuildings = -1;
let shownOver = false;
let shownStage = 0;
let drawnTrees = '';
/** Tools the player has been told about, so each tip shows once per game. */
let toldTools = new Set<string>();
const TOOL_TIPS: Record<string, string> = {
  roundabouts: 'You got a <b>roundabout</b>! Pick it in the toolbar, then click a junction. Several cars can use it at once.',
  lights: 'You got a <b>traffic light</b>! Pick it in the toolbar, then click a junction. It lets one direction go at a time.',
  motorways: 'You got a <b>motorway</b>! Pick it in the toolbar, then drag between two roads. Cars only join at its ends.',
};

function newGame(newSeed: number) {
  seed = newSeed;
  game = new Game(generateMap(seed));
  drawnRoads = drawnBuildings = -1;
  shownOver = false;
  shownStage = 0;
  drawnTrees = '';
  toldTools = new Set();
  gameOver.hide();
  picker.hide();
  buildingRenderer.clear();
  buildingRenderer.gridW = game.map.grid.w;
  renderer.setMap(game.map);
  renderer.resize();
  renderer.setBounds(game.bounds, true);
  history.replaceState(null, '', `?seed=${seed}`);
}

function setSpeed(s: number) {
  if (s === 0) paused = !paused;
  else {
    speed = s;
    paused = false;
  }
}

function updateHud() {
  hud.update(game.score, game.week + 1, game.weekProgress, paused ? 0 : speed, game.sandbox);
  hint.dataset.meta = `seed ${seed} · stage ${game.stage + 1}/${game.map.stages.length}`;
}

const camera = new CameraControls(
  renderer,
  () => renderer.fitHeight(game.map.stages.at(-1)!) * 1.1,
  () => ({ w: game.map.grid.w, h: game.map.grid.h }),
);
new RoadTool(renderer, roadRenderer, () => game.net, () => camera.isPanning, {
  tool: () => toolbar.selected,
  toolSpent: () => toolbar.select('road'),
  houseAt: (i) => {
    const b = game.buildings.at(i);
    return b?.kind === 'house' ? b : undefined;
  },
  strokeStart: (i) => game.buildings.at(i)?.access ?? i,
  turnHouse: (h, dir) => game.turnHouse(h, dir),
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'r') newGame(Math.floor(Math.random() * 1e6));
  if (e.key === 'g') game.grow();
  if (e.key === 'f') renderer.setBounds(game.bounds);
  if (picker.visible && ['1', '2'].includes(e.key)) {
    picker.pick(Number(e.key) - 1);
    return;
  }
  if (e.key === 'p') setSpeed(0);
  if (e.key === 'h') tutorial.start(true);
  if (e.key === 'Escape') toolbar.select('road');
  if (e.key === 'o') game.sandbox = !game.sandbox;
  if (['1', '2'].includes(e.key)) setSpeed(Number(e.key));
  // Dev shortcuts for testing tools without waiting for upgrades.
  const dev: Record<string, keyof typeof game.net.inventory> = { t: 'roads', b: 'bridges', n: 'tunnels', y: 'roundabouts', u: 'lights', m: 'motorways' };
  if (dev[e.key]) {
    game.net.inventory[dev[e.key]] += e.key === 't' ? 10 : 1;
    game.net.version++;
  }
});

window.addEventListener('resize', () => {
  renderer.resize();
  renderer.setBounds(game.bounds);
});

newGame(seed);
tutorial.start();

if (import.meta.env.DEV) {
  // Debug handle for poking at the game from the browser console.
  Object.assign(window, {
    __game: {
      renderer,
      get game() { return game; },
      get net() { return game.net; },
      get map() { return game.map; },
      tileToScreen(x: number, y: number) {
        const v = new THREE.Vector3(x + 0.5, 0, y + 0.5).project(renderer.camera);
        const rect = renderer.renderer.domElement.getBoundingClientRect();
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
      },
    },
  });
}

let last = performance.now();
let acc = 0;
renderer.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt * speed;
    while (acc >= SIM_DT) {
      game.update(SIM_DT);
      acc -= SIM_DT;
    }
  }
  const treesKey = `${seed}:${game.net.version}:${game.buildings.houses.length}:${game.buildings.dests.length}`;
  if (treesKey !== drawnTrees) {
    drawnTrees = treesKey;
    // Trees give way to anything built on their tile (or a driveway's access tile).
    renderer.syncTrees((i) => !game.net.hasTile(i) && !game.buildings.isOccupied(i) && !game.buildings.isAccess(i));
  }
  if (game.net.version !== drawnRoads) {
    drawnRoads = game.net.version;
    roadRenderer.rebuild(game.net);
    toolbar.update(game.net.available(), game.net.inventory);
    for (const k of Object.keys(TOOL_TIPS)) {
      if (!toldTools.has(k) && game.net.inventory[k as keyof typeof game.net.inventory] > 0) {
        toldTools.add(k);
        tutorial.tip(TOOL_TIPS[k]);
      }
    }
  }
  if (game.buildings.version !== drawnBuildings) {
    drawnBuildings = game.buildings.version;
    buildingRenderer.sync(game.buildings);
  }
  const ek = `${treesKey}:${drawnBuildings}`;
  if (ek !== entrancesKey) {
    entrancesKey = ek;
    buildingRenderer.updateEntrances((i) => game.net.hasTile(i));
  }
  if (game.stage !== shownStage) {
    shownStage = game.stage;
    renderer.setBounds(game.bounds);
  }
  if (game.upgrades && !picker.visible) picker.show(game.week, CONFIG.weeklyRoads, game.upgrades);
  buildingRenderer.updateWarnings(game.buildings.dests, now / 1000);
  if (game.over && !shownOver) {
    shownOver = true;
    // Zoom in on the destination that overflowed, framed above the card that fades in.
    const d = game.over.dest, height = 14;
    Object.assign(renderer.viewTarget, { x: d.x + 1, z: d.y + 1 + height * 0.26, height });
    gameOver.show(game.score, game.over.time);
  }
  tutorial.update(game);
  roadRenderer.updateLights((i) => game.traffic.lightAt(i, game.time));
  carRenderer.update(game);
  updateHud();
  renderer.update(dt);
  renderer.render();
});
