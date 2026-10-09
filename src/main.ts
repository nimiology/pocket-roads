import { CameraControls } from './input/cameraControls';
import { GameRenderer } from './render/renderer';
import { MapData, generateMap } from './sim/mapgen';

const app = document.getElementById('app')!;
const renderer = new GameRenderer(app);

const hud = document.createElement('div');
hud.className = 'hud';
document.body.appendChild(hud);
const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent = 'R new map · G grow · F fit · scroll zoom · middle-drag / space-drag pan';
document.body.appendChild(hint);

const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e6);
let map: MapData;
let stage = 0;

function loadMap(newSeed: number) {
  seed = newSeed;
  map = generateMap(seed);
  stage = 0;
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

new CameraControls(
  renderer,
  () => renderer.fitHeight(map.stages.at(-1)!) * 1.1,
  () => ({ w: map.grid.w, h: map.grid.h }),
);

window.addEventListener('keydown', (e) => {
  if (e.key === 'r') loadMap(Math.floor(Math.random() * 1e6));
  if (e.key === 'g' && stage < map.stages.length - 1) {
    stage++;
    renderer.setBounds(map.stages[stage]);
    updateHud();
  }
  if (e.key === 'f') renderer.setBounds(map.stages[stage]);
});

window.addEventListener('resize', () => {
  renderer.resize();
  renderer.setBounds(map.stages[stage]);
});

loadMap(seed);

let last = performance.now();
renderer.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  renderer.update(dt);
  renderer.render();
});
