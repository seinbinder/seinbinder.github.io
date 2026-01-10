// Draw makes grids, tiles, handles trails
export class Draw {
    // canvas, # of grids (make lines if > 1)
    constructor(canvas, view) {
        this.canvas = canvas;
        this.scaleX = canvas.width / 2;
        this.scaleY = canvas.height / 2;
        this.ctx = (this.canvas.getContext('2d'));
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (view !== "zero" && view !== "world") { 
            throw new Error("gridPlayback: view must be 'zero' or 'world'");
        }
        this.view = view;
    }    

    _setStatusStyle() {
        this.textPadPx = 6;
        this.ctx.font = "10pt monospace";
        this.ctx.fillStyle = "#cccccc";
        this.ctx.textAlign = "left";
    }

    // World view needs initial observation to unrotate and translate. zero doesn't use it.
    initialObs(obs) {
        // setup for world view
        this.angleTotal = 0; // accumulated rotation angle
        this.initObs = 0;
        this.skipCount = 0;

        this.initWp1_pix = this.toPix(obs.wp1x, obs.wp1y); // (-1, 1) --> pixels .x .y
    }

    // draw tile, either view, always Trail, no action
    drawTile(obs, stepAngle, tileRect) {
        this.ctx.save();
        
        // optionally can clip each tile, but not a bad effect to let them slop over
        if(false) {
            this.ctx.beginPath();
            this.ctx.rect(tileRect.x, tileRect.y, tileRect.w, tileRect.h);
            this.ctx.clip();
        }
        this.ctx.translate(tileRect.x, tileRect.y);
        this.ctx.scale(tileRect.w / this.canvas.width, tileRect.h / this.canvas.height);

        this.draw(obs, {steer: 0, throttle: 0}, stepAngle, "noSkip");
        this.ctx.restore()
    }

    // draw is a wrapper that handles trail, forward to Core or World (which calls Core)
    draw(obs, action, stepAngle, trail = false) {
        this.angleTotal += stepAngle; // accumulate the angle each step
        
        if(trail) {
            // trail created by lack of clearRect
            // tough to see player when trail steps overlap, so skip some draws
            //   but not for Tiles (which sets a truthy value of "noSkip")
            this.skipCount += 1;
            if ( this.skipCount%10 != 0 && trail != "noSkip") { return }
        } else {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        if ( this.view == "zero") { this._drawCore(obs, action) }
        if ( this.view == "world") { this._drawWorld(obs, action) }
    }
    
    _drawWorld(obs, action, stepAngle) {  
        // save, translate, calls draw(), restore
        const ctxO = this.ctx;
        const scaleX = this.scaleX;
        const scaleY = this.scaleY;
        const initWp1_pix = this.initWp1_pix;

        // prepare to translate/rotate canvas0. all math in pixels
        const wp1_pix = this.toPix(obs.wp1x, obs.wp1y);
        const cos_angle = Math.cos(this.angleTotal)
        const sin_angle = Math.sin(this.angleTotal);
        // where wp1 would land after rotating the canvas about center
        const deltaX = wp1_pix.x - scaleX;
        const deltaY = wp1_pix.y - scaleY;
        const wp1RotatedX = scaleX + deltaX * cos_angle - deltaY * sin_angle
        const wp1RotatedY = scaleY + deltaX * sin_angle + deltaY * cos_angle;
        // translation to move wp1 back to initial position
        const tx = initWp1_pix.x - wp1RotatedX;
        const ty = initWp1_pix.y - wp1RotatedY;

        ctxO.save();    // save & restore so the transformations don't accumulate
        ctxO.translate(tx, ty);
        ctxO.translate(scaleX, scaleY);
        ctxO.rotate(this.angleTotal); 
        ctxO.translate(-scaleX, -scaleY);
        this._drawCore(obs, action); 
        ctxO.restore();
    }

    // draw doesn't know what canvas, tile, or orientation it's drawing on
    _drawCore(obs, action) {
        // wp1. Note: as wp1 rotates around player its sprite should rotate.
        //  for simplification, wp1 is drawn as a circle (If a rectangle, the lack of sprite rotation is apparent) 
        this.ctx.fillStyle = "red";
        this.ctx.beginPath();
        this.ctx.arc(obs.wp1x * this.scaleX + this.scaleX, -obs.wp1y * this.scaleY + this.scaleY, 2, 0, 2 * Math.PI);
        this.ctx.fill();

        // draw player at 0,0, in blue
        let playerW = 2; let playerH = 5;
        this.ctx.fillStyle = "blue";
        this.ctx.beginPath();
        this.ctx.fillRect(this.scaleX - playerW/2, this.scaleY - playerH/2, playerW, playerH);
        // action indication: flame proportional to throttle, steering direction.
        if (action) {
            if (action.throttle > 0) {
                this.ctx.fillStyle = "lightblue";
                this.ctx.beginPath();
                this.ctx.moveTo(this.scaleX - 3, this.scaleY + 5);
                this.ctx.lineTo(this.scaleX + 3, this.scaleY + 5);
                this.ctx.lineTo(this.scaleX, this.scaleY + 5 + action.throttle * 10);
                this.ctx.closePath();
                this.ctx.fill();
            }

            if (action.steering < 0) {
                this.ctx.fillStyle = "lightgreen";
                this.ctx.beginPath();
                this.ctx.arc(this.scaleX + 10, this.scaleY, 1, 0, 2 * Math.PI);
                this.ctx.fill();
            } else if (action.steering > 0) {
                this.ctx.fillStyle = "lightgreen";
                this.ctx.beginPath();
                this.ctx.arc(this.scaleX - 10, this.scaleY, 1, 0, 2 * Math.PI);
                this.ctx.fill();
            }
        }
    
    }

    drawTileText(text, tileRect){
        this._setStatusStyle();
        this.ctx.save();
        this.ctx.textAlign = "left";
        this.ctx.textBaseline = "bottom";
        this.ctx.fillText(text, tileRect.x + this.textPadPx, tileRect.y + tileRect.h - this.textPadPx);
        this.ctx.restore();
    }

    // stats drawn on the canvas. 
    drawTopText(text) {
        this.ctx.clearRect(0,0,this.canvas.width,20);
        this._setStatusStyle();
        this.ctx.textBaseline = "top"; // top of this canvas
        this.ctx.fillText(text, this.textPadPx, this.textPadPx)
    }

    drawGridBorders(gridN){
        this.ctx.save();
        this.ctx.strokeStyle = "#606060";
        this.ctx.lineWidth = 1;
        const cellW = this.canvas.width / gridN;
        const cellH = this.canvas.height / gridN;
        for (let r = 0; r < gridN; r++) {
            for (let c = 0; c < gridN; c++) {
                this.ctx.strokeRect(c * cellW, r * cellH, cellW, cellH);
            }
        }
        this.ctx.restore();
    }

    // helper converts from (-1,1) to pixels
    toPix(x, y) {
        const xp = this.scaleX + x * this.scaleX;
        const yp = this.scaleY - y * this.scaleY;
        return {x: xp, y: yp};
     };
 }