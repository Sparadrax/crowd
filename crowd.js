/**
 * Selectable crowd simulation. Units use obstacle-aware routes, formation slots, and local separation to move around the scene.
 */
import * as THREE from 'three';
import { OrbitControls } from '../../Lib/Three/OrbitControls.js';

const container = document.getElementById('crowd-view');
const panel = document.querySelector('.crowd-info');
panel.innerHTML = `<h1>Crowd</h1>
    <form id="crowd-generator"><label for="unit-count">Units</label><div class="crowd-row"><input id="unit-count" class="form-control form-control-sm" type="number" min="1" max="300" value="80" required><button class="btn btn-primary btn-sm" type="submit">Generate</button></div></form>
    <label for="unit-speed">Movement speed <output id="speed-value">5</output></label><input id="unit-speed" type="range" min="1" max="12" value="5">
    <div class="crowd-row"><button id="select-all" class="btn btn-outline-light btn-sm" type="button">Select all</button><button id="stop-units" class="btn btn-outline-light btn-sm" type="button">Stop</button></div>
    <p id="crowd-status" role="status" aria-live="polite"></p>
    <small>Left-click a unit to select. Drag empty ground to box-select. Shift adds to selection.<br>Drag a selected unit to reposition the group. Right-click ground to move around obstacles.<br>Middle-drag to orbit · Scroll to zoom.</small>`;
const palette = getComputedStyle(document.documentElement);
/**
 * Read a shared CSS palette value and convert it to a Three.js color.
 *
 * @param name - CSS custom-property name or display label used by this operation.
 * @returns Three.js color parsed from the shared CSS palette.
 */
const themeColor = (name) => new THREE.Color(palette.getPropertyValue(name).trim());
const scene = new THREE.Scene();
scene.background = themeColor('--site-bg');
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(30, 48, 42);
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
catch (error) {
    const message = document.getElementById('scene-error');
    message.hidden = false;
    message.textContent = 'Unable to start the scene. Please enable WebGL in your browser.';
    throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const canvas = renderer.domElement;
canvas.setAttribute('aria-label', 'Interactive crowd: left-click or drag to select, right-click to move');
container.appendChild(canvas);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
controls.minDistance = 10;
controls.maxDistance = 160;
controls.maxPolarAngle = Math.PI * 0.46;
scene.add(new THREE.HemisphereLight(0xffffff, 0x263348, 2));
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(10, 30, 20);
scene.add(light);
scene.add(new THREE.GridHelper(80, 40, themeColor('--site-muted'), themeColor('--site-border')));
// Rectangular obstacles are expanded by agent clearance for route planning.
const obstacles = [
    { x: -18, z: 0, width: 5, depth: 18, height: 3 },
    { x: 18, z: 0, width: 5, depth: 18, height: 3 },
    { x: 0, z: -21, width: 17, depth: 4, height: 2.5 },
    { x: 0, z: 21, width: 17, depth: 4, height: 2.5 },
    { x: -26, z: 23, width: 7, depth: 7, height: 4 },
    { x: 26, z: -23, width: 7, depth: 7, height: 4 },
];
const clearance = 0.65;
const blocks = obstacles.map((o) => ({ minX: o.x - o.width / 2 - clearance, maxX: o.x + o.width / 2 + clearance, minZ: o.z - o.depth / 2 - clearance, maxZ: o.z + o.depth / 2 + clearance }));
/**
 * Test whether a ground position lies inside an obstacle expanded by agent clearance.
 *
 * @param point - Ground-plane point used for collision checks or movement orders.
 * @returns True if the point lies within an obstacle expanded by the unit clearance.
 */
function isBlocked(point) {
    return blocks.some((b) => point.x >= b.minX && point.x <= b.maxX && point.z >= b.minZ && point.z <= b.maxZ);
}
/**
 * Use slab intersection tests to reject straight paths that cross an expanded obstacle.
 *
 * @param a - First ground-plane point with x/z coordinates.
 * @param b - Second ground-plane point with x/z coordinates.
 * @returns True if the segment avoids every expanded obstacle.
 */
function segmentClear(a, b) {
    for (const block of blocks) {
        let enter = 0, exit = 1;
        for (const [axis, min, max] of [['x', block.minX, block.maxX], ['z', block.minZ, block.maxZ]]) {
            const delta = b[axis] - a[axis];
            if (Math.abs(delta) < 1e-9) {
                if (a[axis] < min || a[axis] > max) { enter = 2; break; }
            } else {
                const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
                enter = Math.max(enter, Math.min(t1, t2));
                exit = Math.min(exit, Math.max(t1, t2));
            }
        }
        if (enter <= exit) return false;
    }
    return true;
}
/**
 * Push an invalid position to the nearest available side of an obstacle.
 *
 * @param point - Ground-plane point used for collision checks or movement orders.
 * @returns Copy of the point adjusted outward when it starts inside an obstacle.
 */
function freePoint(point) {
    const result = point.clone();
    for (let attempt = 0; attempt < blocks.length; attempt++) {
        const block = blocks.find((b) => result.x >= b.minX && result.x <= b.maxX && result.z >= b.minZ && result.z <= b.maxZ);
        if (!block) break;
        const exits = [
            { distance: result.x - block.minX, axis: 'x', value: block.minX - 0.06 },
            { distance: block.maxX - result.x, axis: 'x', value: block.maxX + 0.06 },
            { distance: result.z - block.minZ, axis: 'z', value: block.minZ - 0.06 },
            { distance: block.maxZ - result.z, axis: 'z', value: block.maxZ + 0.06 },
        ].sort((a,b) => a.distance - b.distance);
        result[exits[0].axis] = exits[0].value;
    }
    return result;
}
const corners = blocks.flatMap((b) => [
    new THREE.Vector3(b.minX - 0.3, 0, b.minZ - 0.3), new THREE.Vector3(b.maxX + 0.3, 0, b.minZ - 0.3),
    new THREE.Vector3(b.minX - 0.3, 0, b.maxZ + 0.3), new THREE.Vector3(b.maxX + 0.3, 0, b.maxZ + 0.3),
]).filter((p) => !isBlocked(p));
/**
 * Search a visibility graph of obstacle corners for a clear route to the destination.
 *
 * @param start - Starting point or node identifier for path search.
 * @param destination - Requested destination point on the ground plane.
 * @returns Ground-plane waypoint vectors around obstacles, or an empty array if no route is found.
 */
function findPath(start, destination) {
    const goal = freePoint(destination);
    if (segmentClear(start, goal)) return [goal];
    const nodes = [start, goal, ...corners];
    const distances = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
    distances[0] = 0;
    for (let step = 0; step < nodes.length; step++) {
        let current = -1;
        for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || distances[i] < distances[current])) current = i;
        if (current < 0 || distances[current] === Infinity) return [];
        if (current === 1) {
            const path = [];
            for (let i = 1; i !== 0; i = previous[i]) path.unshift(nodes[i].clone());
            return path;
        }
        visited.add(current);
        for (let i = 1; i < nodes.length; i++) {
            if (visited.has(i) || !segmentClear(nodes[current], nodes[i])) continue;
            const distance = distances[current] + Math.hypot(nodes[current].x - nodes[i].x, nodes[current].z - nodes[i].z);
            if (distance < distances[i]) { distances[i] = distance; previous[i] = current; }
        }
    }
    return [];
}
const obstacleMaterial = new THREE.MeshStandardMaterial({ color: themeColor('--site-raised'), roughness: 0.8 });
const edgeMaterial = new THREE.LineBasicMaterial({ color: themeColor('--site-accent'), transparent: true, opacity: 0.65 });
for (const obstacle of obstacles) {
    const shape = new THREE.BoxGeometry(obstacle.width, obstacle.height, obstacle.depth);
    const mesh = new THREE.Mesh(shape, obstacleMaterial);
    mesh.position.set(obstacle.x, obstacle.height / 2, obstacle.z);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shape), edgeMaterial);
    mesh.add(edges);
    scene.add(mesh);
}
const geometry = new THREE.CapsuleGeometry(0.38, 0.8, 4, 8);
const material = new THREE.MeshStandardMaterial({ color: themeColor('--site-muted'), roughness: 0.6 });
const selectedMaterial = new THREE.MeshStandardMaterial({ color: themeColor('--site-accent'), roughness: 0.45 });
const ringGeometry = new THREE.RingGeometry(0.55, 0.65, 24);
const ringMaterial = new THREE.MeshBasicMaterial({ color: themeColor('--site-accent'), side: THREE.DoubleSide });
const destination = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32), ringMaterial);
destination.rotation.x = -Math.PI / 2;
destination.visible = false;
scene.add(destination);
const units = [];
const selected = new Set();
let speed = 5;
let gesture = null;
let markerTime = 0;
const box = document.createElement('div');
box.className = 'selection-box';
box.hidden = true;
container.appendChild(box);
/**
 * Reflect selected agents in material colors, selection rings, and the status text.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function updateSelection() {
    for (const unit of units) {
        unit.mesh.material = selected.has(unit) ? selectedMaterial : material;
        unit.ring.visible = selected.has(unit);
    }
    document.getElementById('crowd-status').textContent = `${units.length} units · ${selected.size} selected`;
}
/**
 * Replace the crowd, reset selection, and arrange new units on the ground.
 *
 * @param count - Number of agents or formation slots to create.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function generate(count) {
    cancelGesture();
    for (const unit of units) { scene.remove(unit.mesh, unit.ring); }
    units.length = 0;
    selected.clear();
    const columns = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((i % columns - (columns - 1) / 2) * 1.6, 0.78, (Math.floor(i / columns) - (Math.ceil(count / columns) - 1) / 2) * 1.6);
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(mesh.position.x, 0.025, mesh.position.z);
        mesh.position.copy(freePoint(mesh.position));
        const unit = { mesh, ring, target: null, path: [] };
        mesh.userData.unit = unit;
        units.push(unit);
        scene.add(mesh, ring);
    }
    destination.visible = false;
    updateSelection();
}
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
/**
 * Convert pointer coordinates into a camera ray for picking units and ground positions.
 *
 * @param event - Browser input event containing pointer or keyboard coordinates and state.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function cast(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
}
/**
 * Intersect the pointer ray with the ground and clamp the result to the play area.
 *
 * @param event - Browser input event containing pointer or keyboard coordinates and state.
 * @returns Clamped ground-plane position under the pointer, or null if the ray misses.
 */
function groundPoint(event) {
    cast(event);
    const point = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
    if (!point) return null;
    point.x = THREE.MathUtils.clamp(point.x, -38, 38);
    point.z = THREE.MathUtils.clamp(point.z, -38, 38);
    return point;
}
/**
 * Create evenly spaced destination slots, keeping the complete formation inside the scene.
 *
 * @param count - Number of agents or formation slots to create.
 * @param point - Ground-plane point used for collision checks or movement orders.
 * @returns Array of destination vectors arranged into a bounded formation.
 */
function formation(count, point) {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const halfWidth = (columns - 1) * 1.3 / 2;
    const halfDepth = (rows - 1) * 1.3 / 2;
    const centerX = THREE.MathUtils.clamp(point.x, -38 + halfWidth, 38 - halfWidth);
    const centerZ = THREE.MathUtils.clamp(point.z, -38 + halfDepth, 38 - halfDepth);
    return Array.from({ length: count }, (_, i) => new THREE.Vector3(
        centerX + (i % columns - (columns - 1) / 2) * 1.3,
        0,
        centerZ + (Math.floor(i / columns) - (rows - 1) / 2) * 1.3
    ));
}
/**
 * Assign selected agents to nearby formation slots and request a route for each one.
 *
 * @param point - Ground-plane point used for collision checks or movement orders.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function orderMove(point) {
    if (!selected.size) return;
    const available = [...selected];
    // Assign the nearest remaining unit to each slot to reduce crossing paths.
    for (const target of formation(available.length, point)) {
        let nearest = 0;
        for (let i = 1; i < available.length; i++) {
            if (available[i].mesh.position.distanceToSquared(target) < available[nearest].mesh.position.distanceToSquared(target)) nearest = i;
        }
        const unit = available.splice(nearest, 1)[0];
        unit.path = findPath(unit.mesh.position, target);
        unit.target = unit.path.shift() ?? null;
    }
    destination.position.set(point.x, 0.04, point.z);
    destination.visible = true;
    markerTime = 1.2;
}
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 2) {
        event.preventDefault();
        const point = groundPoint(event);
        if (point) orderMove(point);
        return;
    }
    if (event.button !== 0 || gesture) return;
    cast(event);
    const hit = raycaster.intersectObjects(units.map((unit) => unit.mesh))[0];
    const unit = hit?.object.userData.unit;
    const point = groundPoint(event);
    if (!point) return;
    const initialSelection = new Set(selected);
    if (unit) {
        if (!event.shiftKey && !selected.has(unit)) selected.clear();
        selected.add(unit);
        updateSelection();
    }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, unit, point, shift: event.shiftKey, initialSelection, moved: false,
        positions: new Map([...selected].map((item) => [item, item.mesh.position.clone()])) };
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true;
    if (!gesture.moved) return;
    if (gesture.unit) {
        const point = groundPoint(event);
        if (!point) return;
        const delta = point.sub(gesture.point);
        // Clamp the whole drag together to preserve the group's spacing.
        let minX = -Infinity, maxX = Infinity, minZ = -Infinity, maxZ = Infinity;
        for (const origin of gesture.positions.values()) {
            minX = Math.max(minX, -38 - origin.x); maxX = Math.min(maxX, 38 - origin.x);
            minZ = Math.max(minZ, -38 - origin.z); maxZ = Math.min(maxZ, 38 - origin.z);
        }
        delta.x = THREE.MathUtils.clamp(delta.x, minX, maxX);
        delta.z = THREE.MathUtils.clamp(delta.z, minZ, maxZ);
        const proposals = [...gesture.positions].map(([unit, origin]) => ({ unit, position: new THREE.Vector3(origin.x + delta.x, 0.78, origin.z + delta.z) }));
        if (proposals.some(({unit, position}) => isBlocked(position) || !segmentClear(unit.mesh.position, position))) return;
        for (const {unit, position} of proposals) {
            unit.target = null;
            unit.path = [];
            unit.mesh.position.copy(position);
        }
    } else {
        const rect = container.getBoundingClientRect();
        box.hidden = false;
        Object.assign(box.style, { left: `${Math.min(event.clientX, gesture.x) - rect.left}px`, top: `${Math.min(event.clientY, gesture.y) - rect.top}px`, width: `${Math.abs(event.clientX - gesture.x)}px`, height: `${Math.abs(event.clientY - gesture.y)}px` });
    }
});
/**
 * Clear drag state, release pointer capture, and re-enable camera interaction.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function cancelGesture() {
    const id = gesture?.id;
    gesture = null;
    box.hidden = true;
    controls.enabled = true;
    if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
canvas.addEventListener('pointerup', (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.unit) {
        if (!gesture.shift) selected.clear();
        if (gesture.moved) {
            const rect = canvas.getBoundingClientRect();
            camera.updateMatrixWorld();
            for (const unit of units) {
                const projected = unit.mesh.position.clone().project(camera);
                const x = rect.left + (projected.x + 1) / 2 * rect.width;
                const y = rect.top + (1 - projected.y) / 2 * rect.height;
                if (projected.z >= -1 && projected.z <= 1 && x >= Math.min(gesture.x, event.clientX) && x <= Math.max(gesture.x, event.clientX) && y >= Math.min(gesture.y, event.clientY) && y <= Math.max(gesture.y, event.clientY)) selected.add(unit);
            }
        }
    } else if (!gesture.moved) {
        if (gesture.shift && gesture.initialSelection.has(gesture.unit)) selected.delete(gesture.unit);
        else if (!gesture.shift) { selected.clear(); selected.add(gesture.unit); }
    }
    cancelGesture();
    updateSelection();
});
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', cancelGesture);
window.addEventListener('blur', cancelGesture);
document.getElementById('crowd-generator').addEventListener('submit', (event) => {
    event.preventDefault();
    const count = Number(document.getElementById('unit-count').value);
    if (Number.isInteger(count) && count >= 1 && count <= 300) generate(count);
});
document.getElementById('unit-speed').addEventListener('input', (event) => {
    speed = Number(event.target.value);
    document.getElementById('speed-value').value = speed;
});
document.getElementById('select-all').addEventListener('click', () => { units.forEach((unit) => selected.add(unit)); updateSelection(); });
document.getElementById('stop-units').addEventListener('click', () => { selected.forEach((unit) => { unit.target = null; unit.path = []; }); });
const direction = new THREE.Vector3();
/**
 * Follow route waypoints, recover stalled agents, and resolve local overlaps.
 *
 * @param dt - Elapsed simulation time in seconds.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function update(dt) {
    for (const unit of units) {
        if (gesture?.unit && selected.has(unit)) continue;
        // Repair invalid starting positions before requesting a route.
        if (isBlocked(unit.mesh.position)) unit.mesh.position.copy(freePoint(unit.mesh.position));
        if (!unit.target) continue;
        const goal = unit.path.length ? unit.path[unit.path.length - 1] : unit.target;
        // Separation may have pushed an agent off its original route. Replan
        // the whole obstructed leg instead of repeatedly walking into the wall.
        if (!segmentClear(unit.mesh.position, unit.target)) {
            unit.path = findPath(unit.mesh.position, goal);
            unit.target = unit.path.shift() ?? null;
            if (!unit.target) continue;
        }
        direction.subVectors(unit.target, unit.mesh.position);
        direction.y = 0;
        const distance = direction.length();
        if (unit.progressTarget !== unit.target) {
            unit.progressTarget = unit.target;
            unit.bestDistance = distance;
            unit.stalledTime = 0;
        }
        unit.recoveryTime = Math.max(0, (unit.recoveryTime ?? 0) - dt);
        if (distance < unit.bestDistance - 0.05) {
            unit.bestDistance = distance;
            unit.stalledTime = 0;
        } else unit.stalledTime += dt;
        if (unit.stalledTime > 0.8) {
            // Temporarily prioritize route following over soft crowd spacing.
            // This breaks queues that balance against one another at corners.
            unit.recoveryTime = 1;
            unit.stalledTime = 0;
        }
        const travel = speed * dt;
        if (distance <= travel + 1e-8) {
            // Reach the actual corner before turning; proximity alone can cut
            // across an obstacle and cause an endless replan at the same corner.
            unit.mesh.position.set(unit.target.x, 0.78, unit.target.z);
            unit.target = unit.path.shift() ?? null;
        } else {
            unit.mesh.position.addScaledVector(direction, travel / distance);
        }
    }
    // Resolve local overlaps symmetrically, keeping units visibly separated.
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j];
        if (gesture?.unit && (selected.has(a) || selected.has(b))) continue;
        direction.subVectors(a.mesh.position, b.mesh.position);
        direction.y = 0;
        const distance = direction.length();
        if (distance >= 0.9) continue;
        if (distance < 0.0001) direction.set(1, 0, 0);
        else direction.divideScalar(distance);
        const push = (0.9 - distance) * Math.min(dt * 8, 0.5);
        const nextA = a.mesh.position.clone().addScaledVector(direction, push);
        const nextB = b.mesh.position.clone().addScaledVector(direction, -push);
        if (!(a.recoveryTime > 0) && segmentClear(a.mesh.position, nextA) && (!a.target || segmentClear(nextA, a.target))) a.mesh.position.copy(nextA);
        if (!(b.recoveryTime > 0) && segmentClear(b.mesh.position, nextB) && (!b.target || segmentClear(nextB, b.target))) b.mesh.position.copy(nextB);
    }
    for (const unit of units) {
        unit.mesh.position.x = THREE.MathUtils.clamp(unit.mesh.position.x, -38, 38);
        unit.mesh.position.z = THREE.MathUtils.clamp(unit.mesh.position.z, -38, 38);
        unit.ring.position.set(unit.mesh.position.x, 0.025, unit.mesh.position.z);
    }
    markerTime -= dt;
    if (markerTime <= 0) destination.visible = false;
}
/**
 * Synchronize renderer dimensions and camera projection with the available container size.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function resize() {
    const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}
// Recalculate view dimensions when the surrounding layout changes.
new ResizeObserver(resize).observe(container);
resize();
generate(80);
let lastTime;
// Keep visual frames separate from the simulation's own update timing.
renderer.setAnimationLoop((time) => {
    const dt = lastTime === undefined ? 0 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    update(dt);
    controls.update();
    renderer.render(scene, camera);
});
