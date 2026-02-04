const QRCode = require("qrcode");

// size: "500x500"
function parseSize(sizeStr) {
  const fallback = 500;
  if (typeof sizeStr !== "string") return fallback;

  const m = sizeStr.toLowerCase().match(/^(\d{2,4})x(\d{2,4})$/);
  if (!m) return fallback;

  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return fallback;

  const side = Math.min(w, h);
  // clamp biar aman di serverless
  return Math.max(128, Math.min(2048, side));
}

// color: hex tanpa '#', contoh "000000" / "ea580c"
function parseColorNoHash(colorStr) {
  if (typeof colorStr !== "string") return "#000000";
  if (/^[0-9a-fA-F]{6}$/.test(colorStr)) return `#${colorStr}`;
  if (/^[0-9a-fA-F]{3}$/.test(colorStr)) return `#${colorStr}`;
  return "#000000";
}

// style: 1/2/3
function parseStyle(styleStr) {
  const s = parseInt(styleStr, 10);
  if (s === 1 || s === 2 || s === 3) return s;
  return 1;
}

module.exports = async (req, res) => {
  try {
    // Support CORS (opsional, tapi enak kalau dipakai dari frontend)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const { size, style, color, data, margin, ecl } = req.query;

    // data wajib
    const text = (data ?? "").toString();
    if (!text) {
      res.statusCode = 400;
      return res.end("Missing parameter: data");
    }

    const width = parseSize(size);
    const userColor = parseColorNoHash(color);
    const qrStyle = parseStyle(style);

    // margin optional: 0-10 (default 2)
    const m = Number.isFinite(parseInt(margin, 10))
      ? Math.max(0, Math.min(10, parseInt(margin, 10)))
      : 2;

    // error correction optional: L/M/Q/H (default M)
    const E = (ecl || "M").toString().toUpperCase();
    const allowedECL = new Set(["L", "M", "Q", "H"]);
    const errorCorrectionLevel = allowedECL.has(E) ? E : "M";

    /**
     * STYLE:
     * 1 = normal (dark=userColor, bg putih)
     * 2 = invert (dark putih, bg userColor)
     * 3 = transparent bg (dark userColor, bg transparan)
     */
    let dark = userColor;
    let light = "#ffffff";

    if (qrStyle === 2) {
      dark = "#ffffff";
      light = userColor;
    } else if (qrStyle === 3) {
      light = "#00000000"; // transparan (RGBA)
    }

    const pngBuffer = await QRCode.toBuffer(text, {
      type: "png",
      width,
      margin: m,
      errorCorrectionLevel,
      color: { dark, light }
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");
    res.statusCode = 200;
    return res.end(pngBuffer);
  } catch (err) {
    res.statusCode = 500;
    return res.end(`QR generation error: ${err?.message || "unknown"}`);
  }
};
