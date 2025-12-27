const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Configuration
const DEFAULT_SIZES = [480, 800, 1200];
const QUALITY = 80;

function normalizePath(p) {
    return p.split(path.sep).join('/');
}

async function processImages(html, cwd) {
    // UPDATED REGEX:
    // 1. Captures attributes before src
    // 2. Captures src URL
    // 3. Captures attributes between src and data-opt
    // 4. Captures OPTIONAL value of data-opt (e.g. "200, 500x500")
    // 5. Captures attributes after data-opt
    const imgRegex = /<img\s+([^>]*?)src=["']([^"']+)["']([^>]*?)data-opt(?:=["']([^"']*)["'])?([^>]*?)>/g;
    
    const matches = [...html.matchAll(imgRegex)];
    if (matches.length === 0) return html;

    const processingPromises = matches.map(async (match) => {
        const [originalTag, beforeSrc, srcPath, between, optValue, after] = match;

        // 1. Resolve Paths
        const cleanPath = srcPath.startsWith('/') ? srcPath.slice(1) : srcPath; 
        const localFilePath = path.join(cwd, 'src', cleanPath);
        
        if (!fs.existsSync(localFilePath)) {
            console.warn(`⚠️  Image not found: ${localFilePath}`);
            return { originalTag, newTag: originalTag };
        }

        // 2. Parse Sizes
        let sizesToProcess = [];
        
        if (optValue) {
            // Parse "200, 400x400"
            sizesToProcess = optValue.split(',').map(s => {
                const parts = s.trim().split('x');
                return {
                    width: parseInt(parts[0]),
                    // If 'x' exists, we have a height => Crop needed
                    height: parts[1] ? parseInt(parts[1]) : null 
                };
            });
        } else {
            // Default behavior
            sizesToProcess = DEFAULT_SIZES.map(w => ({ width: w, height: null }));
        }

        // 3. File Naming
        const fileExt = path.extname(localFilePath);
        let fileName = path.basename(localFilePath, fileExt);
        fileName = fileName.replace('.raw', '');
        const dirName = normalizePath(path.dirname(srcPath));
        const fsDirName = normalizePath(path.dirname(cleanPath));

        // 4. Process Images (Parallel)
        const sizePromises = sizesToProcess.map(async (size) => {
            // Naming convention: name-480.webp OR name-480x480.webp
            const suffix = size.height ? `${size.width}x${size.height}` : size.width;
            const outFileName = `${fileName}-${suffix}.webp`;
            
            const outPath = path.join(process.cwd(), 'public', fsDirName, outFileName);
            
            await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

            if (!fs.existsSync(outPath)) {
                const pipeline = sharp(localFilePath);
                
                if (size.height) {
                    // CROP Strategy (Cover)
                    pipeline.resize({
                        width: size.width,
                        height: size.height,
                        fit: 'cover', // Crops explicitly
                        position: 'centre' // Centers the crop
                    });
                } else {
                    // RESIZE Strategy (Aspect Ratio Preserved)
                    pipeline.resize({ width: size.width });
                }

                await pipeline
                    .webp({ quality: QUALITY })
                    .toFile(outPath);
            }

            const urlPath = `${dirName}/${outFileName}`;
            return `${urlPath} ${size.width}w`;
        });

        const srcSetParts = await Promise.all(sizePromises);
        
        // 5. Construct New Tag
        const srcSetString = srcSetParts.join(', ');
        
        // Reconstruct: remove data-opt, add srcset
        const newTag = `<img ${beforeSrc} src="${srcPath}" srcset="${srcSetString}" ${between} ${after}>`
            .replace(/\s+/g, ' ');

        console.log(`⚡ Optimized: ${fileName} -> [${sizesToProcess.map(s => s.width).join(', ')}]`);
        
        return { originalTag, newTag };
    });

    const results = await Promise.all(processingPromises);

    let newHtml = html;
    for (const { originalTag, newTag } of results) {
        newHtml = newHtml.replace(originalTag, newTag);
    }

    return newHtml;
}

module.exports = { processImages };
