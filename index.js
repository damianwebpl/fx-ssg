#!/usr/bin/env bun

const path = require('path');
const fs = require('fs');
const { minify } = require('html-minifier-terser');
const { processImages } = require('./lib/image-optimizer');

// --- CONFIGURATION (Dynamic based on where user runs command) ---
const CWD = process.cwd();

// We expect the user's project to follow your structure
const PAGES_DIR = path.join(CWD, 'src', 'pages');
const FRAGMENTS_DIR = path.join(CWD, 'src', 'fragments');
const ASSETS_SRC = path.join(CWD, 'src', 'assets');
const LAYOUT_DIR = path.join(CWD, 'src', 'layouts');
const OUT_DIR = path.join(CWD, 'public');
const EDGE_DIR = path.join(CWD, 'edgescript');

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

    if (!fs.existsSync(PAGES_DIR)) {
        console.error(`❌ Error: Could not find src/pages in ${CWD}`);
        process.exit(1);
    }

    // 1. Setup Directories
    if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    if (!fs.existsSync(EDGE_DIR)) fs.mkdirSync(EDGE_DIR, { recursive: true });

    // 2. Copy Assets
    if (fs.existsSync(ASSETS_SRC)) {
        fs.cpSync(ASSETS_SRC, path.join(OUT_DIR, 'assets'), { recursive: true });
        console.log(`📂 Assets copied.`);
    }

    const edgeStore = {};

    // 3. Processing Static Pages
    console.log(`\n📄 Processing Pages...`);
    const pageFiles = fs.readdirSync(PAGES_DIR);
    for (const file of pageFiles) {
        if (!file.endsWith('.fx')) continue;

        const rawFile = await Bun.file(path.join(PAGES_DIR, file)).text();
        const slug = file.replace('.fx', '');
        const edgeKey = (slug === 'home' || slug === 'index') ? '/' : `/${slug}`;

        let headerRaw = '';
        let contentHtml = '';

        if (rawFile.includes('------')) {
            // === PAGE ===
            const parts = rawFile.split('------');
            headerRaw = parts[0];
            contentHtml = parts[1].trim();
        } else {
            console.warn(`⚠️  Warning: Page ${file} is missing '------' separator. Using entire file as content (no layout).`);
            contentHtml = rawFile.trim();
        }
            
        // 3.1. Optimize Images (Pass 1 - Partial)
        contentHtml = await processImages(contentHtml, CWD); // Pass CWD down!

        // 3.2. Add to Edge Store (Minified)
        edgeStore[edgeKey] = await minify(contentHtml, MINIFY_OPTS);

        // 3.3. Generate Full HTML (Shell)
        const metadata = parseMetadata(headerRaw);
        metadata.body = contentHtml;
        
        const layoutName = metadata.layout || 'base';
        const layoutPath = path.resolve(LAYOUT_DIR, `${layoutName}.js`);
        
        if (!fs.existsSync(layoutPath)) {
                console.error(`❌ Layout missing: ${layoutName} (expected at ${layoutPath})`);
                continue;
        }

        delete require.cache[require.resolve(layoutPath)];
        const layoutFn = require(layoutPath);
        let fullHtml = layoutFn(metadata);

        // 3.4. Optimize Layout Images (Pass 2)
        fullHtml = await processImages(fullHtml, CWD);

        // 3.5. Write to Disk
        fullHtml = await minify(fullHtml, MINIFY_OPTS);
        
        const outPath = slug === 'home' || slug === 'index' 
            ? path.join(OUT_DIR, 'index.html') 
            : path.join(OUT_DIR, slug + '.html');
            
        await Bun.write(outPath, fullHtml);
        console.log(`✅ Page: ${edgeKey}`);
        
    }

    // 4. Process Fragments
    if (fs.existsSync(FRAGMENTS_DIR)) {
        console.log(`\n🧩 Processing Fragments...`);
        const fragmentFiles = fs.readdirSync(FRAGMENTS_DIR);

        for (const file of fragmentFiles) {
            if (!file.endsWith('.fx')) continue;

            let contentHtml = await Bun.file(path.join(FRAGMENTS_DIR, file)).text();
            contentHtml = contentHtml.trim();

            const slug = file.replace('.fx', '');
            
            // Prefixing logic is optional. 
            // If you want fragments to be accessed via "/my-modal", use `/${slug}`.
            // If you want to namespace them, use `/fragment/${slug}`.
            // Using root path allows flexible naming (e.g., /login-form).
            const edgeKey = `/${slug}`; 

            // Check for collision
            if (edgeStore[edgeKey]) {
                console.warn(`   ⚠️  Collision: Fragment '/${slug}' overwrites Page '/${slug}' in Edge Store!`);
            }

            // 4.1. Optimize Images
            contentHtml = await processImages(contentHtml, CWD);

            // 4.2. Add to Edge Store
            edgeStore[edgeKey] = await minify(contentHtml, MINIFY_OPTS);
            
            console.log(`🧩 Fragment: ${edgeKey}`);
        }
    }

    // --- WORKER GENERATION ---
    const edgeScriptCode = `
      const fragments = ${JSON.stringify(edgeStore)};
      addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
      async function handleRequest(request) {
        const url = new URL(request.url);
        if (fragments[url.pathname]) {
          return new Response(fragments[url.pathname], {
             headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" }
          });
        }
        return fetch(request);
      }
    `;

    await Bun.write(path.join(EDGE_DIR, 'worker.js'), edgeScriptCode);
    console.log(`\n📦 Build Complete! Edge Worker generated.`);
}

build();
