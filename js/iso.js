/* =============================================================================
   LIMINAL.CO — iso.js
   Isometric projection + primitives for drawing floor diamonds and wall boxes.
   All functions take screen-space centers; the camera transform lives in game.js.
   ============================================================================= */
(function (global) {
  'use strict';
  const L = global.L || (global.L = {});

  const TILE_W = 64;       // full width of a floor diamond
  const TILE_H = 32;       // full height of a floor diamond (2:1 iso)
  const WALL_H = 42;       // pixel height of a wall block

  const HW = TILE_W / 2;
  const HH = TILE_H / 2;

  // world (tile units, may be fractional) -> screen (before camera offset)
  function worldToScreen(fx, fy) {
    return { x: (fx - fy) * HW, y: (fx + fy) * HH };
  }
  // inverse: screen (pre-camera) -> world tile coords
  function screenToWorld(sx, sy) {
    return { x: (sx / HW + sy / HH) / 2, y: (sy / HH - sx / HW) / 2 };
  }

  // Draw a floor diamond centered at screen (sx, sy).
  function floorPath(g, sx, sy) {
    g.beginPath();
    g.moveTo(sx, sy - HH);
    g.lineTo(sx + HW, sy);
    g.lineTo(sx, sy + HH);
    g.lineTo(sx - HW, sy);
    g.closePath();
  }

  function drawFloor(g, sx, sy, col) {
    floorPath(g, sx, sy);
    g.fillStyle = col;
    g.fill();
  }

  // Draw a wall block whose FLOOR-CELL center is (sx, sy). The top face sits
  // WALL_H pixels above the floor. Renders left & right visible faces + top.
  function drawWall(g, sx, sy, h, topCol, leftCol, rightCol, edgeCol) {
    const ty = sy - h; // top face center
    // Left face (from bottom-left to top): points floor-left, floor-bottom, top-bottom, top-left
    g.beginPath();
    g.moveTo(sx - HW, sy);        // floor left
    g.lineTo(sx, sy + HH);        // floor bottom
    g.lineTo(sx, ty + HH);        // top bottom
    g.lineTo(sx - HW, ty);        // top left
    g.closePath();
    g.fillStyle = leftCol; g.fill();

    // Right face
    g.beginPath();
    g.moveTo(sx + HW, sy);        // floor right
    g.lineTo(sx, sy + HH);        // floor bottom
    g.lineTo(sx, ty + HH);        // top bottom
    g.lineTo(sx + HW, ty);        // top right
    g.closePath();
    g.fillStyle = rightCol; g.fill();

    // Top face
    floorPath(g, sx, ty);
    g.fillStyle = topCol; g.fill();

    if (edgeCol) {
      g.strokeStyle = edgeCol; g.lineWidth = 1;
      // top edges
      g.beginPath();
      g.moveTo(sx, ty - HH); g.lineTo(sx + HW, ty); g.lineTo(sx, ty + HH);
      g.lineTo(sx - HW, ty); g.closePath(); g.stroke();
    }
  }

  L.iso = {
    TILE_W, TILE_H, WALL_H, HW, HH,
    worldToScreen, screenToWorld, floorPath, drawFloor, drawWall
  };

})(typeof window !== 'undefined' ? window : this);
