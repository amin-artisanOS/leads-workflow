import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFImage } from 'pdf-lib';
import sharp from 'sharp';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================================================================
// NEW & MODIFIED CONFIGURATION - Tweak these values
// ===================================================================
const INPUT_DIR = path.join(__dirname, 'PDF TO COMPRESS');
const OUTPUT_DIR = path.join(__dirname, 'COMPRESSED PDFs');
const TARGET_SIZE = 1.5 * 1024 * 1024; // 1.5MB in bytes

// NEW: Image Resizing (Downsampling) Configuration
const ENABLE_RESIZING = true; // Set to 'false' to disable resizing
const RESIZE_WIDTH = 1200;    // Resize images to this width in pixels (A4 at ~150 DPI)

// NEW: Grayscale Configuration
const ENABLE_GRAYSCALE = false; // Set to 'true' for maximum compression (black & white)

// MODIFIED: More aggressive quality settings
const INITIAL_JPEG_QUALITY = 80;
const MIN_JPEG_QUALITY = 15; // Lowered minimum quality
// ===================================================================


async function ensureOutputDir() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function formatFileSize(bytes) {
  if (bytes < 0 || !Number.isFinite(bytes)) return 'N/A';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function compressPDF(filePath, outputPath) {
  console.log(`\nProcessing: ${path.basename(filePath)}`);

  try {
    const inputBytes = await fs.readFile(filePath);
    const originalSize = inputBytes.length;
    console.log(`Original size: ${formatFileSize(originalSize)}`);

    if (originalSize <= TARGET_SIZE) {
      console.log('File is already smaller than target size. Copying directly.');
      await fs.writeFile(outputPath, inputBytes);
      return { originalSize, compressedSize: originalSize, compressionRatio: 0, success: true };
    }

    let currentQuality = INITIAL_JPEG_QUALITY;
    let attempts = 0;
    const maxAttempts = 5;
    let compressedBytes;

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts}: Trying JPEG quality ${currentQuality}...`);

      const pdfDoc = await PDFDocument.load(inputBytes);
      const imageObjects = [];
      const processedRefs = new Set();
      const pages = pdfDoc.getPages();

      for (const page of pages) {
        if (!page.getResources) continue;
        const resources = page.getResources();
        const xObjectNames = resources.getXObjectNames();
        for (const name of xObjectNames) {
          const xObject = resources.getXObject(name);
          if (xObject instanceof PDFImage) {
            if (!processedRefs.has(xObject.ref.toString())) {
               imageObjects.push(xObject);
               processedRefs.add(xObject.ref.toString());
            }
          }
        }
      }

      if (imageObjects.length > 0) {
        console.log(`  - Found ${imageObjects.length} unique image(s) to process.`);
        for (const image of imageObjects) {
          try {
            const { bytes } = await image.embed();
            
            // ===================================================================
            // MODIFIED: Aggressive sharp processing pipeline
            // ===================================================================
            let sharpInstance = sharp(bytes);

            // 1. Resize if enabled
            if (ENABLE_RESIZING) {
                sharpInstance = sharpInstance.resize({ width: RESIZE_WIDTH });
            }

            // 2. Convert to grayscale if enabled
            if (ENABLE_GRAYSCALE) {
                sharpInstance = sharpInstance.grayscale();
            }

            // 3. Apply JPEG compression
            const compressedImageBuffer = await sharpInstance
                .jpeg({ quality: currentQuality, mozjpeg: true })
                .toBuffer();
            // ===================================================================
            
            const newImage = await pdfDoc.embedJpg(compressedImageBuffer);
            image.replace(newImage.ref);

          } catch (e) {
            console.warn(`  - Warning: Could not process an image: ${e.message}. Skipping it.`);
          }
        }
      } else {
        console.log("  - No images found to compress in this PDF.");
        compressedBytes = await pdfDoc.save();
        break;
      }

      compressedBytes = await pdfDoc.save({ useObjectStreams: true });
      
      if (compressedBytes.length <= TARGET_SIZE) {
        console.log('  - Target size reached!');
        break;
      }
      
      if (attempts < maxAttempts) {
         currentQuality = Math.max(MIN_JPEG_QUALITY, currentQuality - 15);
      } else {
         console.log('  - Max attempts reached. Saving with best result.');
      }
    }

    await fs.writeFile(outputPath, compressedBytes);
    const compressedSize = compressedBytes.length;
    const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
    
    console.log(`Compressed size: ${formatFileSize(compressedSize)}`);
    console.log(`Space saved: ${compressionRatio}%`);
    
    return { originalSize, compressedSize, compressionRatio, success: true };
    
  } catch (error) {
    console.error(`Error compressing ${path.basename(filePath)}:`, error);
    return { success: false, error: error.message };
  }
}

// Main function to process all PDFs (Unchanged)
async function processAllPDFs() {
    try {
        await ensureOutputDir();
        const files = await fs.readdir(INPUT_DIR);
        const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

        if (pdfFiles.length === 0) {
            console.log('No PDF files found in the input directory.');
            return;
        }

        console.log(`Found ${pdfFiles.length} PDF file(s) to process.`);
        const results = [];

        for (const file of pdfFiles) {
            const inputPath = path.join(INPUT_DIR, file);
            const outputPath = path.join(OUTPUT_DIR, `${path.parse(file).name}_compressed.pdf`);
            const result = await compressPDF(inputPath, outputPath);
            results.push({ file, ...result });
        }

        console.log('\n=== Compression Summary ===');
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        console.log(`Total files processed: ${results.length}`);
        console.log(`Successfully compressed: ${successful.length}`);
        console.log(`Failed: ${failed.length}`);

        if (successful.length > 0) {
            const totalOriginal = successful.reduce((sum, r) => sum + (r.originalSize || 0), 0);
            const totalCompressed = successful.reduce((sum, r) => sum + (r.compressedSize || 0), 0);
            const totalSaved = totalOriginal - totalCompressed;
            const totalRatio = totalOriginal > 0 ? (totalSaved / totalOriginal * 100).toFixed(1) : 0;

            console.log('\nTotal original size:', formatFileSize(totalOriginal));
            console.log('Total compressed size:', formatFileSize(totalCompressed));
            console.log(`Total space saved: ${formatFileSize(totalSaved)} (${totalRatio}%)`);
        }

        if (failed.length > 0) {
            console.log('\nFailed files:');
            failed.forEach(f => console.log(`- ${f.file}: ${f.error}`));
        }
        
        console.log(`\nCompressed files saved to: ${OUTPUT_DIR}`);

    } catch (error) {
        console.error('An unexpected error occurred:', error);
    }
}

processAllPDFs();