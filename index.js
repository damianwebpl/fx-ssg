#!/usr/bin/env bun

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { minify } from "html-minifier-terser";
import { processImages } from "./lib/image-optimizer.js";

const CWD = process.cwd();

const SRC = path.join(CWD, "src");
const PAGES = path.join(SRC, "pages");
const FRAGMENTS = path.join(SRC, "fragments");
const LAYOUTS = path.join(SRC, "layouts");
const ASSETS = path.join(SRC, "assets");

const OUT = path.join(CWD, "public");
const EDGE = path.join(CWD, "edgescript");

const MINIFY = {
  collapseWhitespace: true,
  removeComments: true,
  minifyJS: true,
  minifyCSS: true
};

/* ---------------- helpers ---------------- */

const hash = s =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);

const read = p => fs.readFileSync(p, "utf8");

/* -------------- build start -------------- */

console.log("🚀 FX-SSG build");

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(EDGE, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(EDGE, { recursive: true });

if (fs.existsSync(ASSETS))
  fs.cpSync(ASSETS, path.join(OUT, "assets"), { recursive: true });

/* -------------- fragments ---------------- */

const fragmentStore = {};
const fragmentFiles = fs.existsSync(FRAGMENTS)
  ? fs.readdirSync(FRAGMENTS).filter(f => f.endsWith(".fx"))
  : [];

let fragmentPayload = "";

for (const f of fragmentFiles) {
  let html = read(path.join(FRAGMENTS, f)).trim();
  html = await processImages(html, CWD);
  html = await minify(html, MINIFY);
  fragmentPayload += html;
}

const FX_VERSION = hash(fragmentPayload || "fx");

for (const f of fragmentFiles) {
  const name = f.replace(".fx", "");
  let html = read(path.join(FRAGMENTS, f)).trim();
  html = await processImages(html, CWD);
  html = await minify(html, MINIFY);

  fragmentStore[`/__fx/v${FX_VERSION}/${name}`] = html;
  console.log(`🧩 fragment /${name} → v${FX_VERSION}`);
}

/* ---------------- pages ------------------ */

const pageFiles = fs.readdirSync(PAGES).filter(f => f.endsWith(".fx"));

for (const f of pageFiles) {
  const raw = read(path.join(PAGES, f));
  const [head, body] = raw.includes("------")
    ? raw.split("------")
    : ["", raw];

  const meta = {};
  head.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, (_, k, v) => {
    meta[k] = v.trim();
  });

  let html = body.trim();
  html = await processImages(html, CWD);

  const layout = meta.layout || "base";
  const layoutFn = (await import(path.join(LAYOUTS, layout + ".js"))).default;

  let page = layoutFn({
    ...meta,
    body: html,
    fxVersion: FX_VERSION
  });

  page = await processImages(page, CWD);
  page = await minify(page, MINIFY);

  const name = f.replace(".fx", "");
  const out =
    name === "index" || name === "home"
      ? "index.html"
      : `${name}.html`;

  fs.writeFileSync(path.join(OUT, out), page);
  console.log(`📄 page /${name}`);
}

/* ------------- edge script --------------- */

const edgeScript = `const P=${JSON.stringify(fragmentStore)},H={"Content-Type":"text/html;charset=utf-8","Cache-Control":"public,max-age=31536000,immutable"};addEventListener("fetch",e=>{r=e.request,u=r.url,i=u.indexOf("/__fx/",8);if(i>-1){h=P[u.slice(i)];if(h!==void 0)return e.respondWith(new Response(h,{headers:H}))}e.respondWith(fetch(r))})`;

fs.writeFileSync(path.join(EDGE, "worker.js"), edgeScript);
console.log("✅ Created: Edge Script");

console.log(`\n✅ Build complete — FX v${FX_VERSION}`);
