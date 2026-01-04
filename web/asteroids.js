// asteroids.js is the web UI and game loop
// Game is played in a zero-centered system (canvasZ),
// also rendered in an observer's translated & rotated view (canvasO).

// zero-centered coordinate system (where the game is actually played)
const canvasZ = (document.getElementById('gameCanvasZ'));
const ctxZ = (canvasZ.getContext('2d'));

// translated & rotated view (observer, aka 'outsider' perspective)
const canvasO =  (document.getElementById('gameCanvasO'));
const ctxO =  (canvasO.getContext('2d'));

// stats div outside of canvas (see index.html)
const statsDiv = document.getElementById("stats");
statsDiv.style.color = "#cccccc";
statsDiv.style.fontFamily = "monospace";

// user controls (ignored when using `humanAgent`)
const controls = {
    paused: false,
    stepOnce: false,
    stepHold: false,
    trails: false,
    radials: false,
    replay: false,
    done: false,
};
let activeAgent = null;
let sKeyDown = false;   // for 's' key hold detection
let sHoldTimer = null;

// function takes obs, draws to a given canvas. takes and draws action, too
function draw(obs, action, canvas, ctx) {

    // scale input wp from -1..1 to canvas size
    const scaleX = canvas.width / 2;
    const scaleY = canvas.height / 2;

    if (!controls.trails) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (controls.radials) {
        // draw radials from center every 45°
        ctx.strokeStyle = "#404040";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let angle = 0; angle < 360; angle += 45) {
            const angle_rad = angle * Math.PI / 180;
            const x = scaleX + Math.cos(angle_rad) * scaleX *.99;
            const y = scaleY - Math.sin(angle_rad) * scaleY *.99;
            ctx.moveTo(scaleX, scaleY);
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // wp1 circle
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(obs.wp1x * scaleX + scaleX, -obs.wp1y * scaleY + scaleY, 2, 0, 2 * Math.PI);
    ctx.fill();
    // ctx.fillRect(obs.wp1x * scaleX + scaleX - 2, -obs.wp1y * scaleY + scaleY -10, 4, 20);

    // draw player at 0,0, in blue
    ctx.fillStyle = "blue";
    ctx.beginPath();
    // ctx.arc(scaleX, scaleY, 5, 0, 2 * Math.PI);
    // ctx.fill();
    ctx.fillRect(scaleX - 2, scaleY -10, 4, 20);

    // action indication: flame proportional to throttle, steering direction.
    if (action) {
        if (action.throttle > 0) {
            ctx.fillStyle = "lightblue";
            ctx.beginPath();
            ctx.moveTo(scaleX - 3, scaleY + 5);
            ctx.lineTo(scaleX + 3, scaleY + 5);
            ctx.lineTo(scaleX, scaleY + 5 + action.throttle * 10);
            ctx.closePath();
            ctx.fill();
        }

        if (action.steering < 0) {
            ctx.fillStyle = "lightgreen";
            ctx.beginPath();
            ctx.arc(scaleX + 10, scaleY, 1, 0, 2 * Math.PI);
            ctx.fill();
        } else if (action.steering > 0) {
            ctx.fillStyle = "lightgreen";
            ctx.beginPath();
            ctx.arc(scaleX - 10, scaleY, 1, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}
function drawStats(steps, action, obs, done) {
    let text = `Steps: ${String(steps).padStart(4, '\xA0')} \xA0steer: ${pad(action.steering,2)} \xA0\xA0throttle: ${action.throttle.toFixed(2)}`;
    // add obs values
    text += `\xA0\xA0wp1: (${pad(obs.wp1x,4)}, ${pad(obs.wp1y,4)}) \xA0vel: (${pad(obs.velx,4)}, ${pad(obs.vely,4)}) \xA0\xA0Done: ${done}`;
    statsDiv.textContent = text;
}
// rollout(obs, agent) plays a game till target reached
async function rollout(obs, agent, pbList = null) {

    activeAgent = agent;
    const initialObs = { ...obs }; // save initial obs for 'r' replay. ... is a copy to ensure we don't accidently muck the original 
    let steps = 0;
    const maxSteps = 3000;

    function resetRunState() {
        obs = { ...initialObs };
        steps = 0;
        // (don't unpause on reset. allow to step from start)
        clearStepState();
        controls.replay = false;
        controls.done = false;
        drawStats(steps, { throttle: NaN, steering: NaN }, obs, controls.done); // initial conditions
    }

    // start state
    resetRunState();

    // before rolling out the game, prepare outsider's view constants
    const scaleX = canvasO.width / 2;
    const scaleY = canvasO.height / 2;
    const toPix = (x, y) => ({ x: scaleX + x * scaleX, y: scaleY - y * scaleY });
    const initWp1_px = toPix(obs.wp1x, obs.wp1y);

    while (true) {

        // process UI controls
        if (controls.replay) { resetRunState();        }
        if (controls.done) { await new Promise(requestAnimationFrame); continue;}
        if (controls.paused && !(controls.stepOnce || controls.stepHold)) { await new Promise(requestAnimationFrame); continue;}

        // stepOnce either runs WASM step, or gets next obs and stats from playBack list
        let { nextObs, action, angleDelta, done } = stepOnce(obs, agent, pbList, steps);
        obs = nextObs;
        let doneNow = done;
        const angle_delta = angleDelta;

        draw(obs, action, canvasZ, ctxZ);

        // prepare to translate/rotate canvas0. all math in pixels
        const wp1_px = toPix(obs.wp1x, obs.wp1y);
        const cos_angle = Math.cos(angle_delta)
        const sin_angle = Math.sin(angle_delta);
        // where wp1 would land after rotating the canvas about center
        const delta_x = wp1_px.x - scaleX;
        const delta_y = wp1_px.y - scaleY;
        const wp1RotatedX = scaleX + delta_x * cos_angle - delta_y * sin_angle
        const wp1RotatedY = scaleY + delta_x * sin_angle + delta_y * cos_angle;
        // translation to move wp1 back to initial position
        const tx = initWp1_px.x - wp1RotatedX;
        const ty = initWp1_px.y - wp1RotatedY;

        ctxO.save();    // save & restore so the transformations don't accumulate
        ctxO.translate(tx, ty);
        ctxO.translate(scaleX, scaleY);
        ctxO.rotate(angle_delta); 
        ctxO.translate(-scaleX, -scaleY);

        draw(obs, action, canvasO, ctxO); 
        ctxO.restore();

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
        drawStats(steps, action, obs, done);
        if (controls.done) console.log("Game Done");

        await new Promise(requestAnimationFrame)
    }
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
function clearStepState() {
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

    if (key === "l") {
        if (e.repeat) return;
        controls.radials = !controls.radials;
        return;
    }

    // if (activeAgent === humanAgent) return;

    if (key !== "r" && key !== "p" && key !== "s") return;

    // avoid repeated toggle spam
    if (e.repeat) return;

    if (key === "r") {
        clearStepState();
        controls.replay = true;
        return;
    }

    // per spec: after game is done, p/s do nothing
    if (controls.done) return;

    if (key === "p") {
        controls.paused = !controls.paused;
        clearStepState();
    } else if (key === "s") {
        if (!controls.paused) {
            controls.paused = true;
            clearStepState();
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
    clearStepState();
});
function resizeCanvas() {
    console.log("window.innerWidth:", window.innerWidth, "window.innerHeight:", window.innerHeight);
    let size = Math.min(window.innerWidth /2 - 30, window.innerHeight) ;
    canvasZ.width = size;
    canvasZ.height =  size;
    canvasO.width = size;
    canvasO.height =  size;

    console.log(`Canvas resized to ${canvasZ.width}x${canvasZ.height}`);
}

// ---- Grid Mode ---- Grid mode uses it's own rollout loop and draw

// only wp1 is drawn
function drawGridTile(obs, ctx, tileRect) {
    const { x, y, w, h } = tileRect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const scaleX = w / 2;
    const scaleY = h / 2;
    const px = x + scaleX + obs.wp1x * scaleX;
    const py = y + scaleY - obs.wp1y * scaleY;

    ctx.fillStyle = "rgba(255, 0, 0, 0.35)"; // note: alpha for visibility
    ctx.fillRect(px - 1, py - 1, 2, 2);
    ctx.restore();
}
function drawGridBorders(ctx, w, h, n) {
    ctx.save();
    ctx.strokeStyle = "#404040";
    ctx.lineWidth = 1;
    const cellW = w / n;
    const cellH = h / n;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            ctx.strokeRect(c * cellW, r * cellH, cellW, cellH);
        }
    }
    ctx.restore();
}

// draws all, updates frame once
async function gridPlayback(mpbFilename, canvas, ctx) {
    const maxSteps = 3000;

    const textPadPx = 6;
    ctx.font = "10pt monospace";
    ctx.fillStyle = "#cccccc";
    ctx.textAlign = "left";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
    drawGridBorders(ctx, canvas.width, canvas.height, gridN);

    // for each tile
    for (let i = 0; i < pbFilenames.length; i++) {
        // location of this tile
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
        drawGridTile(obs, ctx, tileRect); // draw initial obs
        steps = 0;
        let done = false;
        while (!done) {
            // step, draw
            steps += 1;
            let nextObs = pbList[steps].obs;
            drawGridTile(nextObs, ctx, tileRect);
            done = pbList[steps].done || steps >= maxSteps;         
        }

        console.log(`Grid run ${i + 1}/${pbFilenames.length} done in ${steps} steps`);
        gridTotalSteps += steps;

        // draw steps count in this tile
        ctx.save();
        ctx.font = "10pt monospace";
        ctx.fillStyle = "#cccccc";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(steps), tileRect.x + textPadPx, tileRect.y + tileRect.h - textPadPx);
        ctx.restore();
    }

    ctx.textBaseline = "top";
    // strip directory from mpbFilename for display
    const mpbFilenameShort = mpbFilename.split('/').pop();
    ctx.fillText(`${mpbFilenameShort} total steps ${gridTotalSteps}`, textPadPx, textPadPx);

}

function deg2rad(deg) {
    return deg * Math.PI / 180;
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

async function playback(filename) {
    // single replay from .pb file. 
    // rollout() manages UI controls pause, step, replay, trails, radials
    const pbList = await loadPlaybackList(filename);
    if (pbList) {
            console.log(`Playback mode: ${pbList.length} records`);
            await rollout(pbList[0].obs, null, pbList); // 1st obs provides initial obs for Observer's view
    } else console.log("Failed to load .pb", filename);
}

// *********************************
// ---- MAIN LOOP ----

resizeCanvas()

let mode = 3; /* choose a game mode */ 
// 1) random obs with human
// 2) single replay // Note: must set .pb filename (../dir/file)
//     UI: p pause, s step, r replay, t trails, l radials
// 3) multi-replay grid mode // Note: must set .mpb filename (../dir/file)
// 4) agent0 random game (depricated, use .pb replay instead)

if (mode === 1) {
    await rollout(randomObs(), humanAgent);
} 
else if (mode === 2) {
    playback("../no_git_here/pb_agent0_08.pb");
} 
else if (mode === 3) { 
    gridPlayback("../no_git_here/agent0.mpb", canvasZ, ctxZ);
    gridPlayback("../no_git_here/agent0toT1.mpb", canvasO, ctxO);
}
else if (mode === 4) {
    await rollout(randomObs(), agent0Wrapper);
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

// create random action
function randomAction() {
    return {
        // throttle, steering in -1..1
        throttle: Math.random() * 2 - 1,
        steering: Math.random() * 2 - 1,
    }
}

// pads and adds space for negative sign. \xA0 is non-breaking space
function pad(n, digits = 5) {
    return (Number(n) >= 0 ? "\xA0" : "") + Number(n).toFixed(digits);
}

