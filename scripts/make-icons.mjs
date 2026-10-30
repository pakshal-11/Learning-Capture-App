// Generates the app icons (an "L" mark on indigo) as PNGs without any image library.
//   node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const root = join(import.meta.dirname, "..", "apps", "app");
const INDIGO = [0x4f, 0x46, 0xe5, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x / size, y / size), y * (size * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// An "L": vertical stem and a foot, inside `safe` (fraction of the canvas kept clear around it).
const inL = (u, v, safe) => {
  const a = safe, b = 1 - safe, t = (b - a) * 0.26;
  const stem = u >= a + (b - a) * 0.1 && u <= a + (b - a) * 0.1 + t && v >= a && v <= b;
  const foot = u >= a + (b - a) * 0.1 && u <= b - (b - a) * 0.05 && v >= b - t && v <= b;
  return stem || foot;
};

const make = (name, size, kind, safe = 0.24) => {
  const pixel = (u, v) => {
    if (kind === "solid") return INDIGO;
    if (kind === "mark") return inL(u, v, safe) ? WHITE : CLEAR;
    return inL(u, v, safe) ? WHITE : INDIGO;
  };
  const file = join(root, name);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, png(size, pixel));
  console.log("wrote", name);
};

make("public/icon-192.png", 192, "icon");
make("public/icon-512.png", 512, "icon");
make("public/icon-maskable-512.png", 512, "icon", 0.3);
make("public/apple-touch-icon.png", 180, "icon");
make("public/favicon.png", 48, "icon", 0.2);
make("assets/icon.png", 1024, "icon");
make("assets/favicon.png", 48, "icon", 0.2);
make("assets/android-icon-background.png", 1024, "solid");
make("assets/android-icon-foreground.png", 1024, "mark", 0.3);
make("assets/android-icon-monochrome.png", 1024, "mark", 0.3);
make("assets/splash-icon.png", 1024, "mark", 0.3);
