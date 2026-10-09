import * as THREE from 'three';
import { CameraControls } from './input/cameraControls';
import { RoadTool } from './input/roadTool';
import { BuildingRenderer } from './render/buildings';
import { CarRenderer } from './render/cars';
import { GameRenderer } from './render/renderer';
import { RoadRenderer } from './render/roads';
import { Game } from './sim/game';
import { generateMap } from './sim/mapgen';
import { Toolbar } from './ui/toolbar';

/** Fixed simulation step; rendering interpolates nothing yet, cars just move in small steps. */
const SIM_DT = 1 / 60;

const app = document.getElementById('app')!;
const renderer = new GameRenderer(app);
const roadRenderer = new RoadRenderer(renderer.scene);
const buildingRenderer = new BuildingRenderer(renderer.scene);
const carRenderer = new CarRenderer(renderer.scene);
const toolbar = new Toolbar(document.body);

const hud = document.createElement('div');
hud.className = 'hud';
document.body.appendChild(hud);
const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent =
  'drag road · right-drag erase · scroll zoom · middle/space-drag pan · P pause · 1/2/3 speed · R new map · G grow · T/B/N +roads/bridge/tunnel';
document.body.appendChild(hint);

const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e6);
let game: Game;
let speed = 1;
let paused = false;
let drawnRoads = -1;
let drawnBuildings = -1;

function newGame(newSeed: number) {
  seed = newSeed;
  game = new Game(generateMap(seed));
  drawnRoads = drawnBuildings = -1;
  buildingRenderer.clear();
  renderer.setMap(game.map);
  renderer.resize();
  renderer.setBounds(game.bounds, true);
  history.replaceState(null, '', `?seed=${seed}`);
}

function updateHud() {
  const mins = Math.floor(game.time / 60), secs = Math.floor(game.time % 60).toString().padStart(2, '0');
  const state = paused ? 'paused' : `${speed}x`;
  hud.innerHTML = `<span class="title">${game.score}</span>
    <span class="meta">${mins}:${secs} · ${state} · seed ${seed} · stage ${game.stage + 1}/${game.map.stages.length}</span>`;
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
  if (e.key === 'g' && game.grow()) renderer.setBounds(game.bounds);
  if (e.key === 'f') renderer.setBounds(game.bounds);
  if (e.key === 'p') paused = !paused;
  if (['1', '2', '3'].includes(e.key)) {
    speed = Number(e.key);
    paused = false;
  }
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
  carRenderer.update(game);
  updateHud();
  renderer.update(dt);
  renderer.render();
});
