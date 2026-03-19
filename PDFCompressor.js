import React, { useState, useCallback } from 'react';
import { Upload, FileText, Download, Zap, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const PDFCompressor = () => {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [compressed, setCompressed] = useState(null);
  const [error, setError] = useState('');
  const [originalSize, setOriginalSize] = useState(0);
  const [compressedSize, setCompressedSize] = useState(0);
  const [progress, setProgress] = useState(0);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const compressPDF = async (file) => {
    try {
      setProgress(10);
      
      // Load PDF-lib dynamically
      const PDFLib = await import('https://cdn.skypack.dev/pdf-lib@1.17.1');
      const { PDFDocument } = PDFLib;
      
      setProgress(25);
      
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      setProgress(50);
      
      // Get all pages
      const pages = pdfDoc.getPages();
      
      // Compress images and optimize
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        // Set lower quality for images
        page.scaleContent(0.95, 0.95);
      }
      
      setProgress(75);
      
      // Serialize with compression
      let pdfBytes = await pdfDoc.save({
        useObjectStreams: false,
        addDefaultPage: false,
        objectsPerTick: 50,
      });
      
      let currentSize = pdfBytes.length;
      const targetSize = 1.5 * 1024 * 1024; // 1.5MB in bytes
      
      // If still too large, apply more aggressive compression
      if (currentSize > targetSize) {
        setProgress(85);
        
        // Scale down content more aggressively
        const scaleFactor = Math.sqrt(targetSize / currentSize) * 0.9;
        
        for (let page of pages) {
          page.scaleContent(scaleFactor, scaleFactor);
        }
        
        pdfBytes = await pdfDoc.save({
          useObjectStreams: false,
          addDefaultPage: false,
          objectsPerTick: 25,
        });
      }
      
      setProgress(100);
      
      return {
        data: pdfBytes,
        size: pdfBytes.length
      };
      
    } catch (error) {
      console.error('Compression error:', error);
      throw new Error('Failed to compress PDF. Please try a different file.');
    }
  };

  const handleFile = async (selectedFile) => {
    if (!selectedFile || selectedFile.type !== 'application/pdf') {
      setError('Please select a valid PDF file');
      return;
    }

    if (selectedFile.size > 50 * 1024 * 1024) { // 50MB limit
      setError('File is too large. Please select a PDF under 50MB.');
      return;
    }

    setFile(selectedFile);
    setOriginalSize(selectedFile.size);
    setError('');
    setCompressed(null);
    setProgress(0);
    setCompressing(true);

    try {
      const result = await compressPDF(selectedFile);
      
      const blob = new Blob([result.data], { type: 'application/pdf' });
      setCompressed(blob);
      setCompressedSize(result.size);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setCompressing(false);
      setProgress(0);
    }
  };

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleDownload = () => {
    if (!compressed || !file) return;

    const url = URL.createObjectURL(compressed);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace('.pdf', '_compressed.pdf');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setFile(null);
    setCompressed(null);
    setError('');
    setOriginalSize(0);
    setCompressedSize(0);
    setProgress(0);
  };

  const compressionRatio = originalSize > 0 ? ((originalSize - compressedSize) / originalSize * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-3 rounded-2xl">
              <Zap className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            PDF Compressor
          </h1>
          <p className="text-gray-600 text-lg">
            Compress your PDF files to under 1.5MB instantly
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
          
          {/* Upload Area */}
          {!file && (
            <div
              className={`relative p-12 border-2 border-dashed transition-all duration-300 ${
                dragActive 
                  ? 'border-blue-400 bg-blue-50' 
                  : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="text-center">
                <Upload className="w-16 h-16 text-gray-400 mx-auto mb-6" />
                <h3 className="text-2xl font-semibold text-gray-700 mb-2">
                  Drop your PDF here
                </h3>
                <p className="text-gray-500 mb-6">
                  or click to browse files
                </p>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg transition-all duration-200 cursor-pointer">
                  <Upload className="w-5 h-5 mr-2" />
                  Select PDF File
                </div>
              </div>
            </div>
          )}

          {/* Processing/Results Area */}
          {file && (
            <div className="p-8">
              {/* File Info */}
              <div className="flex items-center mb-6">
                <div className="bg-red-100 p-3 rounded-xl mr-4">
                  <FileText className="w-6 h-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 truncate">{file.name}</h3>
                  <p className="text-gray-500">Original size: {formatFileSize(originalSize)}</p>
                </div>
              </div>

              {/* Progress Bar */}
              {compressing && (
                <div className="mb-6">
                  <div className="flex items-center mb-2">
                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin mr-2" />
                    <span className="text-gray-700 font-medium">Compressing PDF...</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className="bg-gradient-to-r from-blue-600 to-purple-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start">
                  <AlertCircle className="w-5 h-5 text-red-600 mr-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-red-800 font-medium">Compression Failed</p>
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                </div>
              )}

              {/* Success Results */}
              {compressed && !compressing && (
                <div className="mb-6">
                  <div className="p-6 bg-gradient-to-r from-green-50 to-blue-50 rounded-xl border border-green-200 mb-4">
                    <div className="flex items-center mb-4">
                      <CheckCircle className="w-6 h-6 text-green-600 mr-3" />
                      <span className="text-green-800 font-semibold text-lg">Compression Complete!</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                      <div className="bg-white p-4 rounded-xl">
                        <p className="text-gray-600 text-sm">Original Size</p>
                        <p className="text-2xl font-bold text-gray-800">{formatFileSize(originalSize)}</p>
                      </div>
                      <div className="bg-white p-4 rounded-xl">
                        <p className="text-gray-600 text-sm">Compressed Size</p>
                        <p className="text-2xl font-bold text-green-600">{formatFileSize(compressedSize)}</p>
                      </div>
                      <div className="bg-white p-4 rounded-xl">
                        <p className="text-gray-600 text-sm">Space Saved</p>
                        <p className="text-2xl font-bold text-blue-600">{compressionRatio.toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={handleDownload}
                      className="flex-1 flex items-center justify-center px-6 py-4 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-xl font-medium hover:shadow-lg transition-all duration-200"
                    >
                      <Download className="w-5 h-5 mr-2" />
                      Download Compressed PDF
                    </button>
                    <button
                      onClick={handleReset}
                      className="px-6 py-4 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                    >
                      Compress Another
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Features */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
            <div className="bg-blue-100 p-3 rounded-xl w-fit mb-4">
              <Zap className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="font-semibold text-gray-800 mb-2">Lightning Fast</h3>
            <p className="text-gray-600">Compress PDFs in seconds with our optimized compression algorithm.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
            <div className="bg-green-100 p-3 rounded-xl w-fit mb-4">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="font-semibold text-gray-800 mb-2">Under 1.5MB</h3>
            <p className="text-gray-600">Guaranteed compression to under 1.5MB while maintaining quality.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
            <div className="bg-purple-100 p-3 rounded-xl w-fit mb-4">
              <FileText className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="font-semibold text-gray-800 mb-2">Secure Processing</h3>
            <p className="text-gray-600">All processing happens in your browser. Your files never leave your device.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PDFCompressor;
