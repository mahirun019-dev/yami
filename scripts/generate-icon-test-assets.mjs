import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve("public/icon-test");
const outputSizes = [180, 192, 512];

function parseColor(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function parseSvgPath(data, transform = [0, 0]) {
  const tokens = [...data.matchAll(/[A-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)].map((match) => match[0]);
  const loops = [];
  let loop = [];
  let current = [0, 0];
  let command = "";
  let index = 0;
  const add = (point) => loop.push([point[0] + transform[0], point[1] + transform[1]]);

  while (index < tokens.length) {
    if (/^[A-Z]$/i.test(tokens[index])) command = tokens[index++];
    if (command === "M") {
      if (loop.length) loops.push(loop);
      loop = [];
      current = [Number(tokens[index++]), Number(tokens[index++])];
      add(current);
      command = "L";
      continue;
    }
    if (command === "L") {
      current = [Number(tokens[index++]), Number(tokens[index++])];
      add(current);
      continue;
    }
    if (command === "C") {
      const p0 = current;
      const p1 = [Number(tokens[index++]), Number(tokens[index++])];
      const p2 = [Number(tokens[index++]), Number(tokens[index++])];
      const p3 = [Number(tokens[index++]), Number(tokens[index++])];
      for (let step = 1; step <= 24; step += 1) {
        const t = step / 24;
        const u = 1 - t;
        add([
          u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
          u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
        ]);
      }
      current = p3;
      continue;
    }
    if (command === "Z") {
      if (loop.length) loops.push(loop);
      loop = [];
      command = "";
      continue;
    }
    throw new Error(`Unsupported SVG path command: ${command}`);
  }
  if (loop.length) loops.push(loop);
  return loops;
}

function readSvg(svgPath) {
  const svg = fs.readFileSync(svgPath, "utf8");
  const background = parseColor(svg.match(/<rect\b[^>]*\bfill="(#[0-9a-f]{6})"/i)?.[1] ?? "");
  const paths = [...svg.matchAll(/<path\b([^>]*)\/>/g)].map(([, attributes]) => {
    const fill = attributes.match(/\bfill="(#[0-9a-f]{6})"/i)?.[1];
    const data = attributes.match(/\bd="([^"]+)"/)?.[1];
    if (!fill || !data) throw new Error(`Invalid icon path in ${svgPath}`);
    return {
      color: parseColor(fill),
      loops: parseSvgPath(data),
    };
  });
  if (!paths.length) throw new Error(`No icon glyph found in ${svgPath}`);
  return { background, paths };
}

function fillPath(pixels, size, loops, color) {
  const scale = size / 180;
  for (let y = 0; y < size; y += 1) {
    const scanY = (y + 0.5) / scale;
    const crossings = [];
    for (const loop of loops) {
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
        const [x1, y1] = loop[j];
        const [x2, y2] = loop[i];
        if ((y1 > scanY) === (y2 > scanY)) continue;
        crossings.push(x1 + ((scanY - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const left = Math.max(0, Math.ceil(crossings[pair] * scale - 0.5));
      const right = Math.min(size, Math.ceil(crossings[pair + 1] * scale - 0.5));
      for (let x = left; x < right; x += 1) {
        const offset = (y * size + x) * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    }
  }
}

function renderIcon(svgPath, size) {
  const { background, paths } = readSvg(svgPath);
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const offset = i * 4;
    pixels[offset] = background[0];
    pixels[offset + 1] = background[1];
    pixels[offset + 2] = background[2];
    pixels[offset + 3] = 255;
  }
  for (const pathData of paths) {
    fillPath(pixels, size, pathData.loops, pathData.color);
  }
  return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, width, height) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * width * 4;
    const targetOffset = y * (width * 4 + 1);
    scanlines[targetOffset] = 0;
    rgba.copy(scanlines, targetOffset + 1, sourceOffset, sourceOffset + width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = process.argv.slice(2);
const ids = targets.length ? targets : ["d1", "d2", "d3"];

for (const id of ids) {
  const directory = path.join(root, id);
  for (const size of outputSizes) {
    const image = renderIcon(path.join(directory, "icon-source.svg"), size);
    const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
    fs.writeFileSync(path.join(directory, name), encodePng(image, size, size));
  }
  fs.copyFileSync(path.join(directory, "icon-512.png"), path.join(directory, "icon-maskable-512.png"));
}
