const express = require("express");
const { createCanvas } = require("canvas");
const qrgen = require("qrcode-generator");

const app = express();

function parseSize(sizeStr) {
  // "500x500" -> 500
  const fallback = 500;
  if (typeof sizeStr !== "string") return fallback;
  const m = sizeStr.toLowerCase().match(/^(\d{2,4})x(\d{2,4})$/);
  if (!m) return fallback;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return fallback;
  return Math.max(128, Math.min(2048, Math.min(w, h)));
}

function parseColorNoHash(colorStr) {
  // "000000" / "ea580c" / "0ff"
  if (typeof colorStr !== "string") return "#000000";
  if (/^[0-9a-fA-F]{6}$/.test(colorStr)) return `#${colorStr}`;
  if (/^[0-9a-fA-F]{3}$/.test(colorStr)) return `#${colorStr}`;
  return "#000000";
}

function parseStyle(styleStr) {
  const s = parseInt(styleStr, 10);
  return s === 1 || s === 2 || s === 3 ? s : 1;
}

// helper: rounded rect path
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// identify “finder” (eye) 7x7 at 3 corners
function isInFinder(x, y, n) {
  const inTL = x <= 6 && y <= 6;
  const inTR = x >= n - 7 && y <= 6;
  const inBL = x <= 6 && y >= n - 7;
  return inTL || inTR || inBL;
}

// draw finder with rounded style
function drawFinder(ctx, px, py, cell, color, style) {
  // finder is 7x7:
  // outer (7), inner white (5), center (3)
  const x = px;
  const y = py;

  ctx.fillStyle = color;

  // outer
  if (style === 3) {
    roundRect(ctx, x, y, 7 * cell, 7 * cell, 2.2 * cell);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, 7 * cell, 7 * cell);
  }

  // inner white
  ctx.fillStyle = "#ffffff";
  if (style === 3) {
    roundRect(ctx, x + cell, y + cell, 5 * cell, 5 * cell, 1.6 * cell);
    ctx.fill();
  } else {
    ctx.fillRect(x + cell, y + cell, 5 * cell, 5 * cell);
  }

  // center
  ctx.fillStyle = color;
  if (style === 3) {
    roundRect(ctx, x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, 1.2 * cell);
    ctx.fill();
  } else {
    ctx.fillRect(x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell);
  }
}

app.get("/api/qr-code/v1", async (req, res) => {
  try {
    // input: size=500x500 style=1/2/3 color=000000 data=...
    const { size, style, color, data, margin, ecl, bg } = req.query;

    const text = (data ?? "").toString();
    if (!text) return res.status(400).send("Missing parameter: data");

    const W = parseSize(size);
    const S = parseStyle(style);
    const dark = parseColorNoHash(color);

    // optional background: default white, allow "transparent"
    const background =
      (bg || "").toString().toLowerCase() === "transparent" ? "transparent" : "#ffffff";

    const m = Number.isFinite(parseInt(margin, 10))
      ? Math.max(0, Math.min(12, parseInt(margin, 10)))
      : 2;

    const E = (ecl || "M").toString().toUpperCase();
    const allowedECL = new Set(["L", "M", "Q", "H"]);
    const ecLevel = allowedECL.has(E) ? E : "M";

    // build QR matrix
    // qrcode-generator typeNumber: 0 = auto
    const qr = qrgen(0, ecLevel);
    qr.addData(text);
    qr.make();

    const n = qr.getModuleCount();

    // canvas setup
    const canvas = createCanvas(W, W);
    const ctx = canvas.getContext("2d");

    // background
    if (background !== "transparent") {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, W, W);
    } else {
      // clear to transparent
      ctx.clearRect(0, 0, W, W);
    }

    // compute cell size with margin (quiet zone)
    // total cells incl quiet zone = n + 2*m
    const total = n + 2 * m;
    const cell = W / total;

    // draw modules
    // style 1: square
    // style 2: dots (circles)
    // style 3: rounded squares + rounded eyes
    ctx.fillStyle = dark;

    // Draw finders (eyes) first (style 3 nicer)
    const offset = m * cell;

    // finder top-left
    drawFinder(ctx, offset + 0 * cell, offset + 0 * cell, cell, dark, S);
    // finder top-right
    drawFinder(ctx, offset + (n - 7) * cell, offset + 0 * cell, cell, dark, S);
    // finder bottom-left
    drawFinder(ctx, offset + 0 * cell, offset + (n - 7) * cell, cell, dark, S);

    // Then draw the rest modules (skip finder area)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!qr.isDark(y, x)) continue;

        // skip finder blocks (7x7 area)
        if (isInFinder(x, y, n)) continue;

        const px = offset + x * cell;
        const py = offset + y * cell;

        if (S === 2) {
          // dot
          const r = cell * 0.42;
          ctx.beginPath();
          ctx.arc(px + cell / 2, py + cell / 2, r, 0, Math.PI * 2);
          ctx.fill();
        } else if (S === 3) {
          // rounded square
          roundRect(ctx, px + cell * 0.08, py + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.28);
          ctx.fill();
        } else {
          // square
          ctx.fillRect(px, py, cell, cell);
        }
      }
    }

    // output png
    const buf = canvas.toBuffer("image/png");

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(500).send(`QR canvas error: ${err?.message || "unknown"}`);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("QR canvas API running on", port));
