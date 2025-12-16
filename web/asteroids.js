// zero-centered coordinate system (where the game is actually played)
const canvasZ = (document.getElementById('gameCanvasZ'));
const ctxZ = (canvasZ.getContext('2d'));
window.addEventListener('resize', () => { resizeCanvas(); });

// translated & rotated view (observer, aka 'outsider' perspective)
const canvasO =  (document.getElementById('gameCanvasO'));
const ctxO =  (canvasO.getContext('2d'));


// TODO: scale, not resize.

// function takes obs, draws to a given canvas. takes and draws action, too
function draw(obs, action, canvas, ctx) {

    // scale input wp from -1..1 to canvas size
    const scaleX = canvas.width / 2;
    const scaleY = canvas.height / 2;

    // Render scene to offscreen buffer
    // ctx.clearRect(0, 0, canvas.width, canvas.height);

    // wp1 circle
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(obs.wp1x * scaleX + scaleX, -obs.wp1y * scaleY + scaleY, 5, 0, 2 * Math.PI);
    ctx.fill();

    // draw player at 0,0, in blue
    ctx.fillStyle = "blue";
    ctx.beginPath();
    ctx.arc(scaleX, scaleY, 5, 0, 2 * Math.PI);
    ctx.fill();

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
// create random observation 
//  obs isn't formally defined. randomObs() creates a dictionary with four values, and that gets passed around as return values and args
function randomObs() {
    return {
        // NOTE: TESTMODE FIXED OBSERVATION
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
// rollout(obs, agent) plays a game till target reached
async function rollout(obs, agent) {

    // before rolling out the game, prepare outsider's view constants
    const scaleX = canvasO.width / 2;
    const scaleY = canvasO.height / 2;
    const toPix = (x, y) => ({ x: scaleX + x * scaleX, y: scaleY - y * scaleY });
    const initWp1_px = toPix(obs.wp1x, obs.wp1y);

    let count = 0;
    while (true) {
        // TODO: inconsistency? agent() has its own writeObservation, which is redundant.
        //       and step() has no writeAction, requiring one here.
        //      could make a step_wrapper(), similar to agent0Wrapper() that does wasm memory insertions
        //        can't be directly in step() because step() is used by Native code.
        //      need solution for other agents, too; 
        //  1) genericize agent0Wrapper() into agentWrapper(), and include wasm there.
        //  2) make stepWrapper() that calls writeAction()
        // Allocate offsets manually (no malloc here)
        const obsPtr = 0;              // 16 bytes (4 floats)
        const actionPtr = obsPtr + 16; // 8 bytes (2 floats)
        const anglePtr = actionPtr + 8; // 4 bytes (1 float)

        // convert js objects to c++ structs in wasm memory
        writeObservation(obsPtr, obs);
        let action = agent(obs); // get action from agent

        writeAction(actionPtr, action);
        const done = step(obsPtr, actionPtr, anglePtr);
        // NOTE: get player rotation from step, rather than computing from obs
        //  it's kosher because we don't use this to draw actual zero-centered game
        let angle_delta = readRotation(anglePtr);

        // Read back
        obs = readObservation(obsPtr); // get updated obs from step

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

        count += 1;
        if (done) {
            console.log("Game Done")
            // reload the page
            // location.reload();
            break;
            // TODO: replay a game on demand. after 'done' listen for keys. save original obs, re-run rollout.
        };

        await new Promise(requestAnimationFrame)
    }
}

// setup 8 pages (512KB = 8 x 64KB pages)
// see ...memory=524288 options in Makefile. 
const memory = new WebAssembly.Memory({ initial: 8, maximum: 8 }); 

// Build the import object the wasm expects.
const imports = { env: { memory, sin: Math.sin, cos: Math.cos, atan2: Math.atan2 } };

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

// **** setup canvas stuff ****

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

resizeCanvas()
await rollout(randomObs(), agent0Wrapper);