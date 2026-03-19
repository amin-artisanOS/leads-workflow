#!/bin/bash

# Check if Ghostscript is installed
if ! command -v gs &> /dev/null; then
    echo "Error: Ghostscript is not installed. Please install it first:"
    echo "  - macOS: brew install ghostscript"
    echo "  - Linux: sudo apt-get install ghostscript"
    echo "  - Windows: Download from https://ghostscript.com/releases/gsdnld.html"
    exit 1
fi

# Create output directory if it doesn't exist
mkdir -p "COMPRESSED PDFs"

# Process each PDF in the "PDF TO COMPRESS" directory
for file in "PDF TO COMPRESS"/*.pdf; do
    if [ -f "$file" ]; then
        filename=$(basename -- "$file")
        echo "\nProcessing: $filename"
        
        # Get original file size
        original_size=$(stat -f%z "$file")
        echo "Original size: $(($original_size / 1024)) KB"
        
        # Compress the PDF using Ghostscript
        gs -sDEVICE=pdfwrite -dNOPAUSE -dQUIET -dBATCH \
           -dPDFSETTINGS=/screen -dCompatibilityLevel=1.4 \
           -dColorImageResolution=72 -dGrayImageResolution=72 \
           -dMonoImageResolution=72 -dColorImageDownsampleType=/Bicubic \
           -dGrayImageDownsampleType=/Bicubic -dMonoImageDownsampleType=/Bicubic \
           -dColorConversionStrategy=/sRGB -dProcessColorModel=/DeviceRGB \
           -sOutputFile="COMPRESSED PDFs/compressed_$filename" "$file"
        
        # Get compressed file size
        compressed_size=$(stat -f%z "COMPRESSED PDFs/compressed_$filename" 2>/dev/null || echo 0)
        
        if [ $compressed_size -gt 0 ]; then
            echo "Compressed size: $(($compressed_size / 1024)) KB"
            savings=$((100 - (compressed_size * 100 / original_size)))
            echo "Space saved: $savings%"
            
            # If still too large, try more aggressive settings
            if [ $compressed_size -gt 1500000 ]; then
                echo "File still too large, applying extreme compression..."
                gs -sDEVICE=pdfwrite -dNOPAUSE -dQUIET -dBATCH \
                   -dPDFSETTINGS=/ebook -dCompatibilityLevel=1.4 \
                   -dColorImageResolution=36 -dGrayImageResolution=36 \
                   -dMonoImageResolution=36 -dColorImageDownsampleType=/Average \
                   -dGrayImageDownsampleType=/Average -dMonoImageDownsampleType=/Average \
                   -dColorConversionStrategy=/sRGB -dProcessColorModel=/DeviceRGB \
                   -dConvertCMYKImagesToRGB=true -dDownsampleColorImages=true \
                   -dAutoFilterColorImages=false -dAutoFilterGrayImages=false \
                   -dColorImageFilter=/DCTEncode -dGrayImageFilter=/DCTEncode \
                   -sOutputFile="COMPRESSED PDFs/compressed_$filename.tmp" "COMPRESSED PDFs/compressed_$filename"
                
                # Replace with the more compressed version if it's smaller
                new_size=$(stat -f%z "COMPRESSED PDFs/compressed_$filename.tmp" 2>/dev/null || echo 0)
                if [ $new_size -gt 0 ] && [ $new_size -lt $compressed_size ]; then
                    mv "COMPRESSED PDFs/compressed_$filename.tmp" "COMPRESSED PDFs/compressed_$filename"
                    compressed_size=$new_size
                    echo "Extreme compression size: $(($compressed_size / 1024)) KB"
                    savings=$((100 - (compressed_size * 100 / original_size)))
                    echo "Space saved after extreme compression: $savings%"
                else
                    rm -f "COMPRESSED PDFs/compressed_$filename.tmp"
                fi
            fi
        else
            echo "Error compressing $filename"
        fi
    fi
done

echo "\nAll done! Compressed PDFs are in the 'COMPRESSED PDFs' directory."
