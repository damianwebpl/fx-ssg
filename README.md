# FX Build System

The FX Build System is a custom, lightweight Static Site Generator (SSG) built on **Bun** and **Node.js** primitives. It is designed to work in tandem with the [FX Library](https://www.google.com/search?q=https://codeberg.org/DamianT/fx) to provide **Isomorphic Rendering**:

1. **Full HTML Pages** for SEO, direct navigation, and fallbacks.
2. **Edge Partials** for instant, app-like navigation via BunnyCDN Edge Scripts.

## 1. Project Structure

The build script expects a specific folder hierarchy. It separates raw source files from the compiled public output.

```text
/
├── build.js                 # Main build script
├── image-optimizer.js       # Helper for resizing/WebP conversion
├── src/
│   ├── assets/              # Raw images, CSS, JS (e.g., hero.jpg)
│   ├── layouts/             # JS Template Literals for full page wrappers
│   │   └── base.js
│   └── pages/               # Content files (.fx)
│       ├── index.fx         # Home page
│       ├── about.fx         # Standard page
│       └── modal.fx         # Partial/Fragment (no layout)
├── public/                  # [GENERATED] Static HTML files for Storage
│   ├── assets/              # Optimized assets + copies of originals
│   └── index.html
└── edgescript/              # [GENERATED] Worker file
    └── worker.js            # Ready-to-deploy BunnyCDN script

```

---

## 2. The `.fx` Syntax

The system uses a custom file format (`.fx`) that combines XML-like metadata with standard HTML content. The build script parses these files differently depending on whether they contain a separator.

### A. Full Page (SEO + Edge)

Used for standard routes (Home, About, Contact). These generate **both** a static `.html` file and an entry in the Edge Script.

**Structure:** `Metadata` + `------` + `HTML Content`

```html
<layout>base</layout>
<title>About Us - MySite</title>
<description>Learn more about our company</description>
<ldjson>
  { "@context": "https://schema.org", "@type": "Organization", ... }
</ldjson>
------
<h1>About Us</h1>
<p>We are a small team...</p>
<img src="/assets/team.jpg" data-opt alt="Our Team">

```

### B. Fragment (Edge Only)

Used for modals, dropdowns, or dynamic bits that never need to be a full landing page. These generate **only** an entry in the Edge Script.

**Structure:** `HTML Content` (No separator, no metadata)

```html
<div class="modal">
  <h2>Login</h2>
  <form>...</form>
</div>

```

---

## 3. How `build.js` Works

The build pipeline is automated and runs in a single pass.

### The Pipeline Steps

1. **Clean & Prepare:**
* Deletes old `./public` and `./edgescript` folders.
* Recreates the directory structure.


2. **Asset Management:**
* Copies `./src/assets` to `./public/assets`.
* This ensures original files are available as fallbacks or for direct linking.


3. **Processing Loop (for each `.fx` file):**
* **Parsing:** Reads the file and determines if it is a **Page** or a **Fragment** based on the presence of `------`.
* **Image Optimization:** Scans for `<img ... data-opt>`. Uses `sharp` to generate resized WebP versions and rewrites the tag with `srcset`.
* **Minification:** Compresses the HTML partial using `html-minifier-terser`.
* **Edge Store:** Adds the minified partial to the `edgeStore` object (Key: URL path, Value: HTML).
* **HTML Generation (Pages Only):**
* Injects the partial into the specified Layout file (e.g., `layouts/base.js`).
* Runs a second pass of Image Optimization on the full layout (for headers/footers).
* Writes the final `index.html` or `slug.html` to `./public`.




4. **Worker Compilation:**
* Injects the `edgeStore` JSON into the `worker.js` template.
* Writes the final Edge Script to `./edgescript/worker.js`.



---

## 4. Features & Logic

### Smart Image Resizing

Add the `data-opt` attribute to any image tag to trigger processing at build time.

* **Input:** `<img src="/assets/hero.jpg" data-opt>`
* **Process:** Generates `hero-480.webp`, `hero-800.webp`, `hero-1200.webp`.
* **Output:** `<img src="/assets/hero.jpg" srcset="/assets/hero-480.webp 480w, ...">`

### The Layout System

Layouts are simple JavaScript functions that return template literals. They receive the metadata object from the `.fx` file.

**`src/layouts/base.js`**

```javascript
module.exports = (data) => `
<!DOCTYPE html>
<html>
<head>
    <title>${data.title}</title> <meta name="description" content="${data.description}">
    ${data.ldjson ? `<script type="application/ld+json">${data.ldjson}</script>` : ''}
</head>
<body>
    <nav>...</nav>
    <main id="app">
        ${data.content} </main>
</body>
</html>
`;

```

### The Edge Logic (BunnyCDN)

The generated `worker.js` contains a routing table of all your partials.

* **Incoming Request:** `GET /about`
* **Logic:**
1. Checks if `/about` exists in the `partials` map.
2. **If Yes:** Returns the HTML partial immediately (Fast, no origin fetch).
3. **If No:** Returns `fetch(request)`. This allows requests for CSS, JS, images, or non-existent pages to fall through to the BunnyCDN Storage (where your Static HTML files live).



## 5. Usage

**Requirements:** [Bun](https://bun.sh)

```bash
# Install dependencies
bun add sharp html-minifier-terser

# Run the build
bun run build.js

```
