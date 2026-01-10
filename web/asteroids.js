// asteroids.js is the web UI for live HumanAgent and Replay games
// Zero-centered system player's view and World View
// multiple playbacks side-by-side, quick-sanity grid, and grid side-by-side

import { Draw } from './draw.js';

// two available canvases, Left and Right
const canvasL = (document.getElementById('gameCanvasL'));
const canvasR =  (document.getElementById('gameCanvasR'));
resizeCanvas()

// stats div outside of canvas (see index.html)
const statsDiv = document.getElementById("stats");
statsDiv.style.color = "#cccccc";
statsDiv.style.fontFamily = "monospace";

// shorthand
const Z = "zero"; // draw flag
const W = "world"; // draw flag
const L = canvasL;
const R = canvasR;

// user controls (ignored when using `humanAgent`)
const controls = {
    paused: false,
    stepOnce: false,
    stepHold: false,
    trails: false,
    replay: false,
    done: false,
};

let sKeyDown = false;   // for 's' key hold detection
let sHoldTimer = null;

// rollout(obs, agent) plays a game till target reached. agentID is text string shown in status bar
async function rollout(obs, agent, agentID, pbList = null, canvas, view) {

    const initialObs = { ...obs }; // save initial obs for 'r' replay. ... is a copy to ensure we don't accidently muck the original 
    let steps = 0;
    const maxSteps = 3000;
    const draw = new Draw(canvas, view);

    function resetRunState() {
        obs = { ...initialObs };
        draw.initialObs(obs)    // save initial obs for world view, reset angleTotal
        draw.draw(obs, 0, 0, true);   // draw initial obs, no action, angle 0
        steps = 0;
        clearStepKeyState();
        controls.replay = false;
        controls.done = false;
        const statText = formatStats(agentID, steps, { throttle: NaN, steering: NaN }, obs, controls.done); // initial conditions
        draw.drawTopText(statText);
    }

    // start state
    resetRunState();

    while (true) {

        // process UI controls
        if (controls.replay) { resetRunState();  }
        if (controls.done) { await new Promise(requestAnimationFrame); continue;}
        if (controls.paused && !(controls.stepOnce || controls.stepHold)) { await new Promise(requestAnimationFrame); continue;}

        // stepOnce either runs WASM step, or gets next obs and stats from playBack list
        let { nextObs, action, angleDelta, done } = stepOnce(obs, agent, pbList, steps);
        obs = nextObs;
        let doneNow = done;

        draw.draw(obs, action, angleDelta, controls.trails);

        if (controls.stepOnce) {
            controls.stepOnce = false;
            controls.paused = true;
        }

        steps += 1;
        if (!doneNow && steps >= maxSteps) {
            doneNow = true;
            done = "MAXSTEPS";
            console.log("GAME TERMINATED at Max steps reached ${maxSteps} ${done}");
        }
        controls.done = doneNow;

        draw.drawTopText(formatStats(agentID, steps, action, obs, done));
        if (controls.done) console.log("Game Done");

        await new Promise(requestAnimationFrame)
    }
}

// draws N tiles based on entries in .mpb
async function gridPlayback(mpbFilename, canvas, view) {
    const maxSteps = 3000;
    let gridTotalSteps = 0;
    let steps = 0;

    const url = new URL(mpbFilename, import.meta.url);
    const resp = await fetch(url, {cache: 'no-store'});
    if(!resp.ok) {
        console.log("Failed to load .mpb", mpbFilename);
        return;
    }
    // read the .mpb file and parse into pbFilenames[] list
    const text = await resp.text(); // reads the whole file
    const pbFilenames = String(text).split("\n").filter(line => line.trim().length > 0);
    // append '.' before each filename to make relative to current dir (this .js file is in web/)
    for (let i = 0; i < pbFilenames.length; i++) {
        pbFilenames[i] = "." + pbFilenames[i];
    }
    console.log(`grid playback mode: ${pbFilenames.length} files`);

    // Setup grid to match number of playback files
    const gridN = Math.ceil(Math.sqrt(pbFilenames.length));
    const tileW = canvas.width / gridN;
    const tileH = canvas.height / gridN;
    const draw = new Draw(canvas, view);
    draw.drawGridBorders(gridN);

    // for each tile
    for (let i = 0; i < pbFilenames.length; i++) {
        // location of this tile
        // Todo: let Draw object figure this out from index and gridN
        const tileRect = {
            x: (i % gridN) * tileW,
            y: Math.floor(i / gridN) * tileH,
            w: tileW,
            h: tileH,
        };

        // open and load next playback file
        const pbList = await loadPlaybackList(pbFilenames[i]);
        if ( !(pbList && pbList.length > 0)) {
            console.log("Failed to load .pb", pbFilenames[i]);
            return;
        }

        // rollout on this tile
        let obs = { ...pbList[i].obs }; // copy 1st obs to obs
        console.log(`Grid run ${i + 1} of ${pbFilenames.length} start`, obs);

        draw.initialObs(obs)    // World view needs initial observation
        draw.drawTile(obs, 0, tileRect);   // draw initial obs (angle=0)

        steps = 0;
        let done = false;
        while (!done) {
            steps += 1;
            let nextObs = pbList[steps].obs;
            let angleDelta = pbList[steps].angleDelta;
            draw.drawTile(nextObs, angleDelta, tileRect);
            done = pbList[steps].done || steps >= maxSteps;    
        }
        console.log(`Grid run ${i + 1}/${pbFilenames.length} done in ${steps} steps`);
        draw.drawTileText(String(steps), tileRect);
        gridTotalSteps += steps;
    }
    const mpbFilenameShort = mpbFilename.split('/').pop();
    draw.drawTopText(`${mpbFilenameShort} total steps ${gridTotalSteps} avg ${(gridTotalSteps/gridN).toFixed(0)}`);
}

function formatStats(agentID, steps, action, obs, done) {
    let text = `${agentID} Steps: ${String(steps).padStart(4, '\xA0')} \xA0steer: ${pad(action.steering,2)} \xA0\xA0throttle: ${action.throttle.toFixed(2)}`;
    // add obs values
    text += `\xA0\xA0wp1: (${pad(obs.wp1x,4)}, ${pad(obs.wp1y,4)}) \xA0vel: (${pad(obs.velx,4)}, ${pad(obs.vely,4)}) \xA0\xA0Done: ${done}`;
    return text;
}

// stepOnce is a step helper that handles WASM
// Allocate offsets manually (no malloc here)
const OBS_PTR = 0;              // 16 bytes (4 floats)
const ACTION_PTR = OBS_PTR + 16; // 8 bytes (2 floats)
const ANGLE_PTR = ACTION_PTR + 8; // 4 bytes (1 float)

function stepOnce(obs, agent, pbList = null, idx = null) {
    let action, angleDelta, done, nextObs;

    // if there's a playback list, pull obs and stats from it instead of playing actual game
    if (pbList) {
        nextObs = pbList[idx].obs;
        action = pbList[idx].action;
        angleDelta = pbList[idx].angleDelta;
        done = pbList[idx].done;
    } else {
        // convert js objects to c++ structs in wasm memory
        
        // give obs to agent and get action
        writeObservation(OBS_PTR, obs);
        action = agent(obs);

        // give action to step() which updates obs
        writeAction(ACTION_PTR, action);
        done = step(OBS_PTR, ACTION_PTR, ANGLE_PTR);
        
        // get player rotation from step, rather than computing from obs
        //  (it's kosher because we don't use this to draw actual zero-centered game)
        angleDelta = readRotation(ANGLE_PTR);
        
        // get updated obs from step
        nextObs = readObservation(OBS_PTR); 
    }
    return { nextObs, action, angleDelta, done };
}

// ---- WASM setup ----
// setup 8 pages (512KB = 8 x 64KB pages. see ...memory=524288 options in Makefile) 
const memory = new WebAssembly.Memory({ initial: 8, maximum: 8 }); 
const textDecoder = new TextDecoder("utf-8"); // for console_log_str, which is for console_log() 

// Build the import object the wasm expects
const imports = { 
    env: {   memory, sin: Math.sin, cos: Math.cos, atan2: Math.atan2, random: Math.random,
        console_log: (val) => console.log("Value from C:", val),
        console_log_str: (ptr, len) => {
            const bytes = new Uint8Array(memory.buffer, ptr, len);
            console.log(textDecoder.decode(bytes));
        }
    }
};

// Load & instantiate the module (no imports needed).
// const bytes = fs.readFileSync('./step.wasm');
// await fetch for bytes from ../step.wasm
// (our makefile compiled step.cpp into step.wasm web assembly)
const resp = await fetch("../step.wasm");  // download the compiled bytes
const bytes = await resp.arrayBuffer(); // get as array buffer
const mod = new WebAssembly.Module(bytes); 
const instance = new WebAssembly.Instance(mod, imports);
const { step, agent0, /*other funcs */ } = instance.exports;

// Helper: write a JS object into wasm memory at a pointer
function writeObservation(ptr, obj) {
  const f32 = new Float32Array(memory.buffer, ptr, 4);
  f32[0] = obj.wp1x;
  f32[1] = obj.wp1y;
  f32[2] = obj.velx;
  f32[3] = obj.vely;
}
function writeAction(ptr, obj) {
  const f32 = new Float32Array(memory.buffer, ptr, 2);
  f32[0] = obj.throttle;
  f32[1] = obj.steering;
}
function readObservation(ptr) {
  const f32 = new Float32Array(memory.buffer, ptr, 4);
  return {
    wp1x: f32[0],
    wp1y: f32[1],
    velx: f32[2],
    vely: f32[3],
  };
}
function readRotation(ptr) {
    const f32 = new Float32Array(memory.buffer, ptr, 1);
    return f32[0];
}

function humanAgent(obs) {
    // simple keyboard agent
    let throttle = 0;
    let steering = 0;
    if (keyMap.get("ArrowUp")) {
        throttle = 1;
    } else if (keyMap.get("ArrowDown")) {
        throttle = -1;
    }
    if (keyMap.get("ArrowLeft")) {
        steering = -1;
    } else if (keyMap.get("ArrowRight")) {
        steering = 1;
    }
    return { throttle, steering };
}

function agent0Wrapper(obs) {
    // wrapper to call wasm agent0
    const obsPtr = 0;              // 16 bytes (4 floats)
    const actionPtr = obsPtr + 16; // 8 bytes (2 floats)
    writeObservation(obsPtr, obs);
    agent0(obsPtr, actionPtr);
    return readAction(actionPtr);
}
function readAction(ptr) {
    const f32 = new Float32Array(memory.buffer, ptr, 2);
    return {
      throttle: f32[0],
      steering: f32[1],
    };
}

// ---- UI stuff (step, repeat, trails, etc)----
function clearStepKeyState() {
    sKeyDown = false;
    controls.stepOnce = false;
    controls.stepHold = false;
    if (sHoldTimer !== null) {
        clearTimeout(sHoldTimer);
        sHoldTimer = null;
    }
}
document.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();

    // Trails toggle is always available (even for `humanAgent`).
    if (key === "t") {
        if (e.repeat) return;
        controls.trails = !controls.trails;
        return;
    }

    if (key !== "r" && key !== "p" && key !== "s") return;

    // avoid repeated toggle spam
    if (e.repeat) return;

    if (key === "r") {
        clearStepKeyState();
        controls.replay = true;
        return;
    }

    // per spec: after game is done, p/s do nothing
    if (controls.done) return;

    if (key === "p") {
        controls.paused = !controls.paused;
        clearStepKeyState();
    } else if (key === "s") {
        if (!controls.paused) {
            controls.paused = true;
            clearStepKeyState();
        } else {
            // Tap => one step. Hold (>200ms) => continuous stepping until release.
            sKeyDown = true;
            controls.stepOnce = true;
            controls.stepHold = false;
            if (sHoldTimer !== null) clearTimeout(sHoldTimer);
            sHoldTimer = setTimeout(() => {
                sHoldTimer = null;
                if (sKeyDown) controls.stepHold = true;
            }, 200);
        }
    }
});
// everything is one-shot, but 's' can be held for continuous stepping so we need keyup detection
document.addEventListener("keyup", (e) => {
    const key = (e.key || "").toLowerCase();
    if (key === "s") {
        sKeyDown = false;
        controls.stepHold = false;
        if (sHoldTimer !== null) {
            clearTimeout(sHoldTimer);
            sHoldTimer = null;
        }
    }
});


// ---- Canvas setup ----
window.addEventListener('resize', () => { resizeCanvas(); });
const keyMap = new Map();
document.addEventListener("keydown", (e) => {
    if (!e.key.startsWith("Arrow")) return; // only care about arrows
    e.preventDefault(); // prevent scrolling
    keyMap.set(e.key, true);
});
document.addEventListener("keyup", (e) => {
    keyMap.set(e.key, false);
});
// clear keys on window blur (alt-tab away)
window.addEventListener("blur", (e) => {
    keyMap.clear();
    clearStepKeyState();
});
function resizeCanvas() {
    console.log("window.innerWidth:", window.innerWidth, "window.innerHeight:", window.innerHeight);
    let size = Math.min(window.innerWidth /2 - 30, window.innerHeight) ;
    canvasL.width = size;
    canvasL.height =  size;
    canvasR.width = size;
    canvasR.height =  size;

    console.log(`Canvas resized to ${canvasL.width}x${canvasL.height}`);
}

async function loadPlaybackList(filename) {
    // fetch
    const url = new URL(filename, import.meta.url);
    const resp = await fetch(url, {cache: 'no-store'});
    if(!resp.ok) return null;
    const text = await resp.text(); // reads the whole file

    // parse into array of records
    const records = [];
    const lines = String(text).split("\n"); // split into lines
    for(let i = 0; i < lines.length; i++) {
        let fields = lines[i].split(','); 
        if (fields.length != 8) {
            console.log("Playback line", i, "incorrect length", fields.length)
            continue; // skip it
        }
        const wp1x = Number(fields[0]);
        const wp1y = Number(fields[1]);
        const velx = Number(fields[2]);
        const vely = Number(fields[3]);
        const throttle = Number(fields[4]);
        const steering = Number(fields[5]);
        const angleDelta = Number(fields[6]);
        const done = Number(fields[7]);
        records.push({
            obs: { wp1x, wp1y, velx, vely },
            action: { throttle, steering },
            angleDelta,
            done: Boolean(done),
        })
    }

    return records;
}

async function playback(filename, canvas, view) {
    // single replay from .pb file. 
    // rollout() manages UI controls pause, step, replay, trails
    const pbList = await loadPlaybackList(filename);
    if (pbList) {
            console.log(`Playback mode: ${pbList.length} records`);
            const pbName = filename.split('/').pop();
            await rollout(pbList[0].obs, null, pbName, pbList, canvas, view);
    } else console.log("Failed to load .pb", filename);
}

// *********************************
// ---- MAIN LOOP ----

// NOTE: CHOOSE MODE HERE
let mode = 3;

if (mode === 1) { // 1) human, random initial obs
    // await rollout(randomObs(), humanAgent, null, L, W);
    await rollout({wp1x: .8, wp1y: -0.2, velx: 0, vely: 0}, humanAgent, "human",  null, L, W);
} 
else if (mode === 2) { // 2) single replay // Note: must set .pb filename
    // UI: p pause, s step, r replay, t trails
    // Note: two playbacks UI ok for trails, pause; conflict on stats, replay, step
    // playback("../no_git_here/pb_agent0toT1_Jan_10%_07.pb", L, W);
    playback("../no_git_here/TEST.pb", L, W);
    playback("../no_git_here/TEST.pb", R, Z);

} 
else if (mode === 3) { // 3) multi-replay grid mode on either canvas // Note: must set .mpb filename
    // gridPlayback("../no_git_here/TEST.mpb", canvasR, W);
    gridPlayback("../no_git_here/agent0_Jan.mpb", L, Z);
    gridPlayback("../no_git_here/agent0_Jan.mpb", R, W);
    // gridPlayback("../no_git_here/agent0toT1_Jan.mpb", R, W);
}
else if (mode === 4) { // 4) agent0 random game (unsupported, use .pb replay instead)
    // UI: p pause, s step, r replay, t trails
    await rollout(randomObs(), agent0Wrapper, "agent0 live", null, L, Z);
}


// *********************************
// ---- HELPERS ----

// create random observation 
//  obs isn't formally defined. randomObs() creates a dictionary with four values, and that gets passed around as return values and args
function randomObs() {
    return {
        // wp are in -1..1, vel in -1..1
        wp1x: Math.random() * 2 - 1,
        wp1y: Math.random() * 2 - 1,
        velx: Math.random() * 2 - 1,
        vely: Math.random() * 2 - 1,
    }
}

// pads and adds space for negative sign. \xA0 is non-breaking space
function pad(n, digits = 5) {
    return (Number(n) >= 0 ? "\xA0" : "") + Number(n).toFixed(digits);
}