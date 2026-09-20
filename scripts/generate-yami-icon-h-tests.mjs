import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve("public/icon-test");
const f4Svg = fs.readFileSync(path.join(root, "f4", "icon-source.svg"), "utf8");

const palettes = {
  h1: {
    light: { background: "#F5F1E8", glyph: "#C7A960" },
    dark: { background: "#11131B", glyph: "#E8D9AE" },
  },
  h2: {
    light: { background: "#F2EFE6", glyph: "#C08F34" },
    dark: { background: "#0B1220", glyph: "#E5C979" },
  },
  h3: {
    light: { background: "#F8F7F2", glyph: "#C99D41" },
    dark: { background: "#080B12", glyph: "#F1DFA3" },
  },
};

function replacePaths(svg, overrides) {
  let index = 0;
  return svg.replace(/<path\b[^>]*\/>/g, (tag) => {
    const data = overrides[index++];
    return data ? tag.replace(/\bd="[^"]+"/, `d="${data}"`) : tag;
  });
}

function recolor(svg, { background, glyph }) {
  return svg.replaceAll("#2477d9", background).replaceAll("#ffffff", glyph);
}

const h1Svg = replacePaths(f4Svg, [
  "M47 60 C45 44 59 32 78 32 C96 32 109 42 115 58 C124 53 135 55 141 62 C137 68 132 73 127 77 C139 84 146 97 148 110 C150 124 144 136 135 143 C132 130 127 119 119 111 C120 126 112 140 102 150 C96 139 94 128 93 117 C85 130 73 138 58 142 C63 130 66 121 62 112 C54 122 43 128 30 130 C37 118 41 108 43 99 C38 103 33 105 30 104 C36 92 41 83 48 76 C41 78 35 78 31 76 C35 68 41 63 47 60 Z M87 75 C99 71 111 77 117 87 C121 98 118 112 109 122 C102 131 92 132 85 125 C78 118 76 101 79 88 C80 82 83 77 87 75 Z",
  "M84 75 C96 71 108 74 114 82 C118 87 120 93 120 98 C121 100 124 102 126 103 C127 105 123 107 120 108 C119 114 115 119 109 123 C106 130 99 132 93 129 C84 126 80 118 78 108 C76 95 78 82 84 75 Z",
  "M58 58 C70 60 80 66 87 75 C90 70 96 65 103 62 C90 57 74 56 58 58 Z",
  null,
  "M119 112 C127 119 133 130 135 141 C139 137 140 132 138 125 C133 119 127 115 119 112 Z",
  null,
]);

const h2Svg = replacePaths(h1Svg, [
  null,
  "M84 75 C95 71 107 74 113 82 C118 88 120 94 120 99 C121 101 124 103 125 104 C126 106 123 108 120 109 C118 115 114 120 108 123 C105 130 99 132 93 129 C84 126 80 118 78 108 C76 95 78 82 84 75 Z",
  null,
  "M50 102 C48 111 43 119 36 125 C43 123 50 120 55 116 C53 112 52 107 53 102 Z",
  "M118 111 C127 117 134 128 136 140 C140 136 141 130 139 124 C133 117 126 113 118 111 Z",
  "M94 44 C99 40 107 42 112 47 L109 55 C104 50 100 49 94 52 Z",
]);

const h3Svg = replacePaths(h2Svg, [
  "M47 60 C45 44 59 32 78 32 C96 32 109 42 115 58 C124 53 135 55 141 62 C137 68 132 73 127 77 C139 84 146 97 148 110 C150 124 144 136 135 143 C133 130 127 118 119 110 C120 126 112 140 101 150 C95 140 93 129 92 118 C84 130 72 138 57 142 C62 130 65 121 61 112 C53 122 42 128 29 130 C36 118 41 108 43 99 C38 103 33 105 30 104 C36 92 41 83 48 76 C41 78 35 78 31 76 C35 68 41 63 47 60 Z M87 75 C99 71 111 77 117 87 C121 98 118 112 109 122 C102 131 92 132 85 125 C78 118 76 101 79 88 C80 82 83 77 87 75 Z",
  null,
  null,
  null,
  "M118 111 C128 118 135 130 137 142 C141 137 142 131 139 123 C133 117 126 113 118 111 Z",
  null,
]);

function renderHtml(id) {
  const label = id.toUpperCase();
  const startUrl = `/yami/icon-test/${id}/`;
  const lightIcon = `${startUrl}light/apple-touch-icon.png`;
  const darkIcon = `${startUrl}dark/apple-touch-icon.png`;
  const refinements = {
    h1: "Gの簡略構造を保ち、頭頂の丸み・前髪の流れ・横顔の余白を控えめに整えました。",
    h2: "H1から、ひとつの髪飾りと後ろ髪の分け目を少し見やすくしました。",
    h3: "H2から、長い髪の先端をわずかに流れる形へ整えました。",
  };
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
    <title>Yami アイコン候補 ${label}</title>
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
      <p>${refinements[id]} Safari の共有メニューからホーム画面に追加してご確認ください。</p>
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

const svgById = { h1: h1Svg, h2: h2Svg, h3: h3Svg };
const outputIds = [];
for (const [id, themes] of Object.entries(palettes)) {
  const directory = path.join(root, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), renderHtml(id));
  fs.writeFileSync(path.join(directory, "manifest.webmanifest"), renderManifest(id));
  fs.writeFileSync(path.join(directory, "icon-source.svg"), svgById[id]);
  for (const [theme, colors] of Object.entries(themes)) {
    const assetDirectory = path.join(directory, theme);
    fs.mkdirSync(assetDirectory, { recursive: true });
    fs.writeFileSync(path.join(assetDirectory, "icon-source.svg"), recolor(svgById[id], colors));
    outputIds.push(`${id}/${theme}`);
  }
}

const result = spawnSync(process.execPath, ["scripts/generate-icon-test-assets.mjs", "--supersample=4", ...outputIds], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
