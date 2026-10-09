import * as THREE from 'three';
import { CameraControls } from './input/cameraControls';
import { RoadTool } from './input/roadTool';
import { GameRenderer } from './render/renderer';
import { RoadRenderer } from './render/roads';
import { inBounds } from './sim/grid';
import { MapData, generateMap } from './sim/mapgen';
import { RoadNetwork } from './sim/roads';
import { Toolbar } from './ui/toolbar';

const STARTING_INVENTORY = { roads: 30, bridges: 1, tunnels: 1 };

const app = document.getElementById('app')!;
const renderer = new GameRenderer(app);
const roadRenderer = new RoadRenderer(renderer.scene);
const toolbar = new Toolbar(document.body);

const hud = document.createElement('div');
hud.className = 'hud';
document.body.appendChild(hud);
const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent =
  'drag draw road · right-drag erase · scroll zoom · middle/space-drag pan · R new map · G grow · T/B/N +roads/bridge/tunnel';
document.body.appendChild(hint);

const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e6);
let map: MapData;
let stage = 0;
let net: RoadNetwork;
let drawnVersion = -1;

function loadMap(newSeed: number) {
  seed = newSeed;
  map = generateMap(seed);
  stage = 0;
  net = new RoadNetwork(map.grid, { ...STARTING_INVENTORY }, (x, y) => inBounds(map.stages[stage], x, y));
  drawnVersion = -1;
  renderer.setMap(map);
  renderer.resize();
  renderer.setBounds(map.stages[0], true);
  history.replaceState(null, '', `?seed=${seed}`);
  updateHud();
}

function updateHud() {
  hud.innerHTML = `<span class="title">Mini Motorways</span>
    <span class="meta">seed ${seed} · stage ${stage + 1}/${map.stages.length}</span>`;
}

const camera = new CameraControls(
  renderer,
  () => renderer.fitHeight(map.stages.at(-1)!) * 1.1,
  () => ({ w: map.grid.w, h: map.grid.h }),
);
new RoadTool(renderer, roadRenderer, () => net, () => camera.isPanning);

window.addEventListener('keydown', (e) => {
  if (e.key === 'r') loadMap(Math.floor(Math.random() * 1e6));
  if (e.key === 'g' && stage < map.stages.length - 1) {
    stage++;
    renderer.setBounds(map.stages[stage]);
    updateHud();
  }
  if (e.key === 'f') renderer.setBounds(map.stages[stage]);
  // Dev shortcuts until weekly upgrades exist.
  if (e.key === 't') net.inventory.roads += 10;
  if (e.key === 'b') net.inventory.bridges += 1;
  if (e.key === 'n') net.inventory.tunnels += 1;
  if ('tbn'.includes(e.key)) net.version++;
});

window.addEventListener('resize', () => {
  renderer.resize();
  renderer.setBounds(map.stages[stage]);
});

loadMap(seed);

if (import.meta.env.DEV) {
  // Debug handle for poking at the game from the browser console.
  Object.assign(window, {
    __game: {
      renderer,
      get net() { return net; },
      get map() { return map; },
      tileToScreen(x: number, y: number) {
        const v = new THREE.Vector3(x + 0.5, 0, y + 0.5).project(renderer.camera);
        const rect = renderer.renderer.domElement.getBoundingClientRect();
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
      },
    },
  });
}

let last = performance.now();
renderer.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (net.version !== drawnVersion) {
    drawnVersion = net.version;
    roadRenderer.rebuild(net);
    toolbar.update(net.available());
  }
  renderer.update(dt);
  renderer.render();
});
