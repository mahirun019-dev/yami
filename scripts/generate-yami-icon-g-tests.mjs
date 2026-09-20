import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve("public/icon-test");
const f4Svg = fs.readFileSync(path.join(root, "f4", "icon-source.svg"), "utf8");

const palettes = {
  g1: {
    light: { background: "#F4F0E7", glyph: "#C8AA6A" },
    dark: { background: "#111318", glyph: "#E6D49F" },
  },
  g2: {
    light: { background: "#F1EEE7", glyph: "#B98A32" },
    dark: { background: "#0C1220", glyph: "#DDBB68" },
  },
  g3: {
    light: { background: "#F7F7F4", glyph: "#C2942B" },
    dark: { background: "#070A12", glyph: "#F0D98F" },
  },
};

function iconSvg({ background, glyph }) {
  return f4Svg
    .replaceAll("#2477d9", background)
    .replaceAll("#ffffff", glyph);
}

function renderHtml(id) {
  const label = id.toUpperCase();
  const startUrl = `/yami/icon-test/${id}/`;
  const lightIcon = `${startUrl}light/apple-touch-icon.png`;
  const darkIcon = `${startUrl}dark/apple-touch-icon.png`;
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f7f7f8" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#111318" media="(prefers-color-scheme: dark)" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Yami Icon Test ${label}" />
    <meta name="application-name" content="Yami Icon Test ${label}" />
    <link rel="apple-touch-icon" sizes="180x180" media="(prefers-color-scheme: light)" href="${lightIcon}" />
    <link rel="apple-touch-icon" sizes="180x180" media="(prefers-color-scheme: dark)" href="${darkIcon}" />
    <link rel="icon" href="/yami/favicon.ico" type="image/x-icon" sizes="16x16 32x32" />
    <link rel="manifest" href="${startUrl}manifest.webmanifest" />
    <title>Yami Icon Test ${label}</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: #f7f7f8; color: #202124; }
      main { width: min(100% - 36px, 430px); text-align: center; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0 0 24px; line-height: 1.55; color: #60656d; }
      .variants { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .variant { min-width: 0; padding: 14px 10px; border-radius: 8px; background: #fff; }
      .variant.dark { background: #17191f; color: #f4f4f4; }
      .preview { width: min(100%, 154px); aspect-ratio: 1; margin: 0 auto 10px; overflow: hidden; border-radius: 22%; }
      .preview img { display: block; width: 100%; height: 100%; }
      .label { margin: 0; font-size: 14px; font-weight: 600; }
      @media (prefers-color-scheme: dark) { body { background: #000; color: #f2f2f2; } p { color: #a3a9b1; } .variant { background: #111318; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Yami アイコン候補 ${label}</h1>
      <p>Safari の共有メニューからホーム画面に追加し、外観を切り替えてご確認ください。</p>
      <section class="variants" aria-label="Light and dark app icon previews">
        <div class="variant light"><div class="preview"><img src="${lightIcon}" alt="${label} Light icon" /></div><p class="label">Light</p></div>
        <div class="variant dark"><div class="preview"><img src="${darkIcon}" alt="${label} Dark icon" /></div><p class="label">Dark</p></div>
      </section>
    </main>
  </body>
</html>
`;
}

function renderManifest(id) {
  const startUrl = `/yami/icon-test/${id}/`;
  const icons = [];
  for (const theme of ["light", "dark"]) {
    for (const [size, purpose] of [[192, "any"], [512, "any"], [512, "maskable"]]) {
      icons.push({
        src: `${startUrl}${theme}/icon${purpose === "maskable" ? "-maskable" : ""}-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose,
      });
    }
  }
  return `${JSON.stringify({
    name: `Yami Icon Test ${id.toUpperCase()}`,
    short_name: `Yami ${id.toUpperCase()}`,
    id: startUrl,
    lang: "zh-CN",
    description: "A Yami app icon appearance test.",
    theme_color: "#f7f7f8",
    background_color: "#f7f7f8",
    display: "standalone",
    orientation: "portrait-primary",
    start_url: startUrl,
    scope: "/yami/icon-test/",
    icons,
  }, null, 2)}\n`;
}

const outputIds = [];
for (const [id, themes] of Object.entries(palettes)) {
  const directory = path.join(root, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), renderHtml(id));
  fs.writeFileSync(path.join(directory, "manifest.webmanifest"), renderManifest(id));
  for (const [theme, colors] of Object.entries(themes)) {
    const assetDirectory = path.join(directory, theme);
    fs.mkdirSync(assetDirectory, { recursive: true });
    fs.writeFileSync(path.join(assetDirectory, "icon-source.svg"), iconSvg(colors));
    outputIds.push(`${id}/${theme}`);
  }
}

const result = spawnSync(process.execPath, ["scripts/generate-icon-test-assets.mjs", "--supersample=4", ...outputIds], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
