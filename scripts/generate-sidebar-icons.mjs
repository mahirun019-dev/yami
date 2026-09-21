import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "public/sidebar-icons");

const icons = {
  home: {
    silhouette: "M12 2.7 2.7 10.2v9.2c0 1 .8 1.8 1.8 1.8h15c1 0 1.8-.8 1.8-1.8v-9.2L12 2.7Z",
    cutouts: "M9.4 21v-5.1c0-1.4 1.1-2.5 2.6-2.5s2.6 1.1 2.6 2.5V21Z",
    details: "",
    accents: "",
    cutoutStroke: 1.7,
  },
  company: {
    silhouette: "M4 21V5.4c0-.9.7-1.6 1.6-1.6h12.8c.9 0 1.6.7 1.6 1.6V21H4Z",
    cutouts: "M7.1 7.2h2.2v1.9H7.1zM14.7 7.2h2.2v1.9h-2.2zM7.1 11.1h2.2V13H7.1zM14.7 11.1h2.2V13h-2.2zM7.1 15h2.2v1.9H7.1zM14.7 15h2.2v1.9h-2.2zM9.4 21v-2.5c0-1.2 1-2.2 2.2-2.2h.8c1.2 0 2.2 1 2.2 2.2V21Z",
    details: "",
    accents: "",
    cutoutStroke: 1.25,
  },
  notification: {
    silhouette: "M5 16.9h14l-1.5-1.9a4 4 0 0 1-.8-2.4V9.1a4.7 4.7 0 0 0-9.4 0v3.5a4 4 0 0 1-.8 2.4L5 16.9Z",
    cutouts: "",
    details: "M10.8 15.5a1.2 1.2 0 0 0 2.4 0",
    accents: "",
    detailStroke: 1.35,
  },
  calendar: {
    silhouette: "M5.3 5.4h13.4c1.3 0 2.3 1 2.3 2.3v10.8c0 1.4-1 2.4-2.3 2.4H5.3C4 20.9 3 19.9 3 18.5V7.7c0-1.3 1-2.3 2.3-2.3Z",
    cutouts: "M6.3 12h2v1.9h-2zM11 12h2v1.9h-2zM15.7 12h2v1.9h-2zM6.3 16h2v1.9h-2zM11 16h2v1.9h-2zM15.7 16h2v1.9h-2z",
    details: "M3.2 9.6h17.6",
    accents: "M7.5 2.8v4.6M16.5 2.8v4.6",
    detailStroke: 1.3,
    cutoutStroke: 1.1,
    accentStroke: 1.8,
  },
  es: {
    silhouette: "M7 3.1h7.2l5 5v11.5c0 1.2-.9 2.1-2.1 2.1H7c-1.2 0-2.1-.9-2.1-2.1V5.2C4.9 4 5.8 3.1 7 3.1Z",
    cutouts: "M6.8 10.3h1.1v1.5H6.8zM6.8 13.8h1.1v1.5H6.8zM6.8 17.3h1.1v1.5H6.8z",
    details: "M14.2 3.4v3.1c0 .9.7 1.6 1.6 1.6h3M10 11.1h5.6M10 14.6h5.6M10 18.1h4.3",
    accents: "",
    detailStroke: 1.35,
    cutoutStroke: 1.1,
  },
};

const esc = (value) => value.replaceAll('"', "&quot;");

function svgFor(name, geometry, state) {
  const clipId = `${name}-outline-clip`;
  const maskId = `${name}-filled-mask`;
  const outline = state === "outline";
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">`];

  if (outline) {
    parts.push(`<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path d="${esc(geometry.silhouette)}"/></clipPath></defs>`);
    parts.push(`<g clip-path="url(#${clipId})"><path data-geometry="silhouette" d="${esc(geometry.silhouette)}" fill="none" stroke="#000" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></g>`);
    if (geometry.cutouts) parts.push(`<path data-geometry="cutouts" d="${esc(geometry.cutouts)}" fill="none" stroke="#000" stroke-width="${geometry.cutoutStroke ?? 1.35}" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (geometry.details) parts.push(`<path data-geometry="details" d="${esc(geometry.details)}" fill="none" stroke="#000" stroke-width="${geometry.detailStroke ?? 1.5}" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (geometry.accents) parts.push(`<path data-geometry="accents" d="${esc(geometry.accents)}" fill="none" stroke="#000" stroke-width="${geometry.accentStroke ?? 1.8}" stroke-linecap="round" stroke-linejoin="round"/>`);
  } else {
    parts.push(`<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><path d="${esc(geometry.silhouette)}" fill="#fff"/>`);
    if (geometry.cutouts) parts.push(`<path d="${esc(geometry.cutouts)}" fill="#000" stroke="#000" stroke-width="${geometry.cutoutStroke ?? 1.35}" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (geometry.details) parts.push(`<path d="${esc(geometry.details)}" fill="none" stroke="#000" stroke-width="${geometry.detailStroke ?? 1.5}" stroke-linecap="round" stroke-linejoin="round"/>`);
    parts.push(`</mask></defs><path data-geometry="silhouette" d="${esc(geometry.silhouette)}" fill="#000" mask="url(#${maskId})"/>`);
    if (geometry.accents) parts.push(`<path data-geometry="accents" d="${esc(geometry.accents)}" fill="none" stroke="#000" stroke-width="${geometry.accentStroke ?? 1.8}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  parts.push(`</svg>`, "");
  return parts.join("\n");
}

let mismatch = false;
for (const [name, geometry] of Object.entries(icons)) {
  for (const state of ["outline", "filled"]) {
    const file = path.join(outputDir, `${name}-${state}.svg`);
    const expected = svgFor(name, geometry, state);
    if (process.argv.includes("--check")) {
      const actual = await readFile(file, "utf8").catch(() => "");
      if (actual !== expected) {
        console.error(`Out of sync: public/sidebar-icons/${name}-${state}.svg`);
        mismatch = true;
      }
    } else {
      await writeFile(file, expected);
    }
  }
}

if (mismatch) process.exitCode = 1;
else console.log(process.argv.includes("--check") ? "Sidebar icon pairs match their shared geometry source." : "Generated 10 sidebar SVGs from 5 shared geometry definitions.");
