// Adds the PWA tags to the exported web app's index.html (Expo's single-page export uses its own HTML
// template and ignores +html.tsx): manifest, icons, theme colour, dark-mode background, service worker.
//   node scripts/postbuild-web.mjs [distDir]      (run from apps/app by `pnpm export:web`)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve(process.argv[2] ?? "dist");
const file = join(dist, "index.html");
if (!existsSync(file)) throw new Error(`No index.html in ${dist}. Run the web export first.`);

let html = readFileSync(file, "utf8");
if (html.includes('rel="manifest"')) {
  console.log("index.html already has PWA tags");
  process.exit(0);
}

const head = `
    <meta name="description" content="Capture what you learn. Recall it when you need it." />
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#4F46E5" />
    <link rel="icon" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Learning Log" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <style>
      html, body { background: #F6F6FA; overscroll-behavior-y: none; }
      /* iPhone Safari: 100% is the tall viewport (toolbar hidden), so the bottom of the page, including the tab bar, hides behind the toolbar. dvh is the part you can see. */
      @supports (height: 100dvh) { html, body, #root { height: 100dvh; } }
      @media (prefers-color-scheme: dark) { html, body { background: #0D0E14; } }
    </style>
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
      }
    </script>
  </head>`;

html = html
  .replace("</head>", head)
  .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />')
  .replace(/<link rel="icon"[^>]*favicon\.ico[^>]*>/, "");
writeFileSync(file, html);
console.log("added PWA tags to", file);
