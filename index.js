#!/usr/bin/env bun

const path = require('path');
const fs = require('fs');
const { minify } = require('html-minifier-terser');

// Import internal lib (relative to THIS script, not the user's project)
const { processImages } = require('./lib/image-optimizer');

// --- CONFIGURATION (Dynamic based on where user runs command) ---
const CWD = process.cwd();

// We expect the user's project to follow your structure
const SRC_DIR = path.join(CWD, 'src', 'pages');
const ASSETS_SRC = path.join(CWD, 'src', 'assets');
const LAYOUT_DIR = path.join(CWD, 'src', 'layouts');
const OUT_DIR = path.join(CWD, 'public');
const EDGE_OUT_DIR = path.join(CWD, 'edgescript');

const MINIFY_OPTS = {
    collapseWhitespace: true,
    removeComments: true,
    minifyJS: true,
    minifyCSS: true,
    removeEmptyAttributes: true
};

// --- HELPER ---
function parseMetadata(rawHeader) {
    const metadata = {};
    const regex = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = regex.exec(rawHeader)) !== null) {
        metadata[match[1]] = match[2].trim();
    }
    return metadata;
}

// --- MAIN BUILD ---
async function build() {
    console.log(`🚀 FX-SSG: Building from ${CWD}...`);

    if (!fs.existsSync(SRC_DIR)) {
        console.error(`❌ Error: Could not find src/pages in ${CWD}`);
        process.exit(1);
    }

    // 1. Setup Directories
    if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    if (!fs.existsSync(EDGE_OUT_DIR)) fs.mkdirSync(EDGE_OUT_DIR, { recursive: true });

    // 2. Copy Assets
    if (fs.existsSync(ASSETS_SRC)) {
        fs.cpSync(ASSETS_SRC, path.join(OUT_DIR, 'assets'), { recursive: true });
        console.log(`📂 Assets copied.`);
    }

    const files = fs.readdirSync(SRC_DIR);
    const edgeStore = {};

    for (const file of files) {
        if (!file.endsWith('.fx')) continue;

        const rawFile = await Bun.file(path.join(SRC_DIR, file)).text();
        const slug = file.replace('.fx', '');
        const edgeKey = (slug === 'home' || slug === 'index') ? '/' : `/${slug}`;

        let contentHtml = '';

        if (rawFile.includes('------')) {
            // === PAGE ===
            const parts = rawFile.split('------');
            const headerRaw = parts[0];
            contentHtml = parts[1].trim();
            
            // 1. Optimize Images (Pass 1)
            contentHtml = await processImages(contentHtml, CWD); // Pass CWD down!

            // 2. Minify for Edge
            edgeStore[edgeKey] = await minify(contentHtml, MINIFY_OPTS);

            // 3. Layout Injection
            const metadata = parseMetadata(headerRaw);
            metadata.content = contentHtml;
            
            const layoutName = metadata.layout || 'base';
            const layoutPath = path.resolve(LAYOUT_DIR, `${layoutName}.js`);
            
            if (!fs.existsSync(layoutPath)) {
                 console.error(`❌ Layout missing: ${layoutName} (expected at ${layoutPath})`);
                 continue;
            }

            delete require.cache[require.resolve(layoutPath)];
            const layoutFn = require(layoutPath);
            let fullHtml = layoutFn(metadata);

            // 4. Optimize Layout Images (Pass 2)
            fullHtml = await processImages(fullHtml, CWD);

            // 5. Write to Disk
            fullHtml = await minify(fullHtml, MINIFY_OPTS);
            
            const outPath = slug === 'home' || slug === 'index' 
                ? path.join(OUT_DIR, 'index.html') 
                : path.join(OUT_DIR, slug + '.html');
                
            await Bun.write(outPath, fullHtml);
            console.log(`✅ Page: ${edgeKey}`);

        } else {
            // === FRAGMENT ===
            contentHtml = rawFile.trim();
            contentHtml = await processImages(contentHtml, CWD);
            edgeStore[edgeKey] = await minify(contentHtml, MINIFY_OPTS);
            console.log(`🧩 Fragment: ${edgeKey}`);
        }
    }

    // --- WORKER GENERATION ---
    const edgeScriptCode = `
      const partials = ${JSON.stringify(edgeStore)};
      addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
      async function handleRequest(request) {
        const url = new URL(request.url);
        if (partials[url.pathname]) {
          return new Response(partials[url.pathname], {
             headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" }
          });
        }
        return fetch(request);
      }
    `;

    await Bun.write(path.join(EDGE_OUT_DIR, 'worker.js'), edgeScriptCode);
    console.log(`📦 Build Complete!`);
}

build();
