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
const carRenderer = new CarRenderer(renderer.scene);
const toolbar = new Toolbar(document.body);
const gameOver = new GameOverScreen(document.body, () => newGame(seed), () => newGame(Math.floor(Math.random() * 1e6)));

const hud = new Hud(document.body, (s) => setSpeed(s));
const tutorial = new Tutorial(document.body);
const picker = new UpgradePicker(document.body, (i) => game.chooseUpgrade(i));
const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent =
  'drag road · right-drag erase · scroll zoom · middle/space-drag pan · P pause · 1/2 speed · H tutorial · O sandbox · R new map · G grow · T/B/N +roads/bridge/tunnel';
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

function newGame(newSeed: number) {
  seed = newSeed;
  game = new Game(generateMap(seed));
  drawnRoads = drawnBuildings = -1;
  shownOver = false;
  shownStage = 0;
  gameOver.hide();
  picker.hide();
  buildingRenderer.clear();
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
new RoadTool(renderer, roadRenderer, () => game.net, () => camera.isPanning, (i) => {
  const b = game.buildings.at(i);
  return b ? b.access : i;
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
  if (e.key === 'o') game.sandbox = !game.sandbox;
  if (['1', '2'].includes(e.key)) setSpeed(Number(e.key));
  // Dev shortcuts until weekly upgrades exist.
  if (e.key === 't') game.net.inventory.roads += 10;
  if (e.key === 'b') game.net.inventory.bridges += 1;
  if (e.key === 'n') game.net.inventory.tunnels += 1;
  if ('tbn'.includes(e.key)) game.net.version++;
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
  if (game.net.version !== drawnRoads) {
    drawnRoads = game.net.version;
    roadRenderer.rebuild(game.net);
    toolbar.update(game.net.available());
  }
  if (game.buildings.version !== drawnBuildings) {
    drawnBuildings = game.buildings.version;
    buildingRenderer.sync(game.buildings);
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
  carRenderer.update(game);
  updateHud();
  renderer.update(dt);
  renderer.render();
});
