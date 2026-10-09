# Pocket Roads — Plan

A browser road-drawing city game, inspired by the gameplay of Mini Motorways (not affiliated).

## Decisions
| Topic | Choice |
|---|---|
| Stack | Vite + TypeScript + Three.js |
| Look | Near-top-down orthographic camera, low-poly 3D buildings, soft shadows (mockup "C2") |
| Simulation | Lane-based traffic: cars queue, yield at intersections, and can gridlock |
| Map | Full terrain like the original: rivers/lakes (bridges), mountains (tunnels), map grows over time |
| v1 extras | Pause + 1x/2x speed, map growth, sound + music, local high score |
| v1 tools | Bridges, tunnels, roundabouts, traffic lights, motorways |
| Platform | Desktop mouse first; touch later |
| Workflow | Build milestone by milestone, with a screenshot or playable check-in after each |

## Game rules (target behaviour)
- **Grid map** with grass, water and mountain tiles. Each map is generated from a seed.
- **Houses**: 1 tile, colored, 2 cars each, with a fixed driveway direction.
- **Destinations**: a 2×2 building plus a parking lot with one entrance. Each is circle or square type, and that type sets how often it gets pins and how many it can hold (about 7 for squares, 10 for circles).
- **Pins**: demand appears per color over time and is assigned to that color's destinations. An idle car from a connected house of the same color drives there, parks, takes a pin (+1 score), and drives home.
- **Overflow**: a destination over capacity starts a warning timer. Arriving cars slow it down. When it fills, the game is over.
- **Roads**: drag to draw roads in 8 directions (diagonals allowed, crossing diagonals not). Right-drag erases. Each tile costs one road tile from a limited budget, and erased tiles are refunded.
- **Bridges / tunnels**: a road crossing one continuous stretch of water or mountain uses one bridge or tunnel.
- **Weeks**: about every 2.5 minutes at 1x. Each week gives more road tiles plus a pick from 2 upgrade packages. Packages hold road tiles plus one special tool: bridge, tunnel, roundabout, traffic light or motorway.
- **Roundabout**: a one-way 3×3 loop placed on an intersection.
- **Traffic light**: placed on an intersection; alternates which axis gets green.
- **Motorway**: a straight point-to-point link drawn over other roads (not over mountains); cars may enter only at its ends.
- **Removing tools**: a deleted tool returns to inventory once the cars on it have cleared.
- **Map growth**: the playable area widens every few weeks, and the camera zooms out.
- **Spawning** speeds up over time, and new colors are added gradually.

## Architecture
```
src/
  sim/        pure TS, no Three.js: fixed-timestep, deterministic, seeded RNG
    grid.ts       terrain + occupancy
    mapgen.ts     rivers, lakes, mountains
    roads.ts      road graph (tiles = nodes, 8-dir edges), bridge/tunnel accounting
    path.ts       A* over directed lane graph, cached and invalidated on edits
    traffic.ts    car agents: lane following, gap keeping, intersection reservation
    demand.ts     building spawning, pin generation, dispatch, overflow timers
    game.ts       clock, weeks, upgrades, score, game over
  render/     Three.js scene that reads sim state (instanced meshes for cars/houses)
  input/      mouse → tile picking, road draw/erase, camera pan/zoom
  ui/         HTML overlay: HUD, upgrade picker, pause/speed, game over, menu
  audio/      procedural WebAudio music + horn/UI sounds (no asset files)
```
The simulation is kept separate from rendering, so it can be tested headless and the look can change later.

## Milestones
1. **Scaffold + map**: Vite/TS/Three setup, generated terrain, top-down camera with pan/zoom.
2. **Roads**: drawing and erasing roads with diagonals, tile budget, automatic bridges/tunnels, road meshes with rounded joins.
3. **Buildings + cars**: houses and destinations spawn, pathfinding, cars drive house → destination → home (no collisions yet).
4. **Traffic sim**: right-hand lanes, car following, intersection yielding, real jams.
5. **Demand + game over**: pins, dispatch priority, overflow timers with warning ring, score, game-over screen.
6. **Game loop**: weekly clock, upgrade picker, map growth, pause/1x/2x, HUD.
7. **Special tools**: roundabouts, traffic lights, motorways (placing, removing, inventory, traffic behaviour).
8. **Audio + polish**: procedural ambient music, horns on jams, local high score, main menu, animations.

### After v1
Multiple maps/cities, touch controls, daily challenges, trains.
