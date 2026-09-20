import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve("public/icon-test");
const background = "#2477d9";
const baseGlyph = 'M47 60 C45 44 59 32 78 32 C96 32 109 43 114 58 C123 53 134 55 141 62 C136 68 132 72 127 77 C139 83 146 96 148 110 C150 124 144 136 135 143 C133 129 127 118 119 110 C120 126 112 140 102 150 C96 139 94 128 93 117 C85 130 73 138 58 142 C63 130 66 121 62 112 C54 122 43 128 30 130 C37 118 41 108 43 99 C38 103 33 105 30 104 C36 92 41 83 48 76 C41 78 35 78 31 76 C35 68 41 63 47 60 Z M87 75 C100 70 114 78 117 92 C120 107 113 122 101 129 C92 134 82 127 80 116 C77 100 78 81 87 75 Z';

const detailPaths = {
  f1: [
    'M85 73 C97 69 109 74 115 82 C118 86 119 91 120 96 L126 102 L120 107 C119 113 116 118 111 122 C108 130 101 133 94 130 C85 127 80 119 78 109 C76 97 77 81 85 73 Z',
  ],
  f2: [
    'M85 73 C97 69 109 74 115 82 C118 86 119 91 120 96 L126 102 L120 107 C119 113 116 118 111 122 C108 130 101 133 94 130 C85 127 80 119 78 109 C76 97 77 81 85 73 Z',
    'M58 58 C69 61 79 67 86 76 C89 71 94 66 101 63 C89 58 73 56 58 58 Z',
  ],
  f3: [
    'M85 73 C97 69 109 74 115 82 C118 86 119 91 120 96 L126 102 L120 107 C119 113 116 118 111 122 C108 130 101 133 94 130 C85 127 80 119 78 109 C76 97 77 81 85 73 Z',
    'M58 58 C69 61 79 67 86 76 C89 71 94 66 101 63 C89 58 73 56 58 58 Z',
    'M50 103 C48 111 43 119 36 125 C42 123 49 120 54 116 C52 112 51 108 52 103 Z',
    'M119 113 C127 120 132 131 134 141 C138 137 140 132 138 125 C133 119 127 115 119 113 Z',
  ],
  f4: [
    'M85 73 C97 69 109 74 115 82 C118 86 119 91 120 96 L126 102 L120 107 C119 113 116 118 111 122 C108 130 101 133 94 130 C85 127 80 119 78 109 C76 97 77 81 85 73 Z',
    'M58 58 C69 61 79 67 86 76 C89 71 94 66 101 63 C89 58 73 56 58 58 Z',
    'M50 103 C48 111 43 119 36 125 C42 123 49 120 54 116 C52 112 51 108 52 103 Z',
    'M119 113 C127 120 132 131 134 141 C138 137 140 132 138 125 C133 119 127 115 119 113 Z',
    'M96 45 C100 43 105 44 110 48 L108 53 C104 49 100 48 96 50 Z',
  ],
};

function renderSvg(id) {
  const cuts = detailPaths[id].map((data) => `<path fill="${background}" d="${data}" />`).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="${background}" />
  <path fill="#ffffff" fill-rule="evenodd" d="${baseGlyph}" />
  ${cuts}
</svg>
`;
}

function renderHtml(id) {
  const label = id.toUpperCase();
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f7f7f8" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Yami Icon Test ${label}" />
    <meta name="application-name" content="Yami Icon Test ${label}" />
    <link rel="apple-touch-icon" href="/yami/icon-test/${id}/apple-touch-icon.png" />
    <link rel="icon" href="/yami/favicon.ico" type="image/x-icon" sizes="16x16 32x32" />
    <link rel="manifest" href="/yami/icon-test/${id}/manifest.webmanifest" />
    <title>Yami Icon Test ${label}</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: #f7f7f8; color: #202124; }
      main { width: min(100% - 40px, 420px); text-align: center; }
      img { display: block; width: 180px; height: 180px; margin: 0 auto 24px; }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0; line-height: 1.6; color: #5c626a; }
      @media (prefers-color-scheme: dark) { body { background: #000; color: #f2f2f2; } p { color: #a3a9b1; } }
    </style>
  </head>
  <body>
    <main>
      <img src="apple-touch-icon.png" alt="Yami avatar icon ${label}" />
      <h1>Yami アイコン実験 ${label}</h1>
      <p>Safari の共有メニューから「ホーム画面に追加」してください。</p>
    </main>
  </body>
</html>
`;
}

function renderManifest(id) {
  const label = id.toUpperCase();
  const startUrl = `/yami/icon-test/${id}/`;
  return `${JSON.stringify({
    name: `Yami Icon Test ${label}`,
    short_name: `Yami ${label}`,
    id: startUrl,
    lang: "zh-CN",
    description: "A focused workspace for Japanese job hunting.",
    theme_color: "#f7f7f8",
    background_color: "#f7f7f8",
    display: "standalone",
    orientation: "portrait-primary",
    start_url: startUrl,
    scope: "/yami/icon-test/",
    icons: [
      { src: `${startUrl}icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${startUrl}icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${startUrl}icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2)}\n`;
}

for (const id of ["f1", "f2", "f3", "f4"]) {
  const directory = path.join(root, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "icon-source.svg"), renderSvg(id));
  fs.writeFileSync(path.join(directory, "index.html"), renderHtml(id));
  fs.writeFileSync(path.join(directory, "manifest.webmanifest"), renderManifest(id));
}

const result = spawnSync(process.execPath, ["scripts/generate-icon-test-assets.mjs", "f1", "f2", "f3", "f4"], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
