import React, { useEffect, useRef, useState } from 'react';
import { CropAdjustModal } from './components/CropAdjustModal';
import { SignatureModal } from './components/SignatureModal';
import { ThawmteEmblem, getThawmteEmblemPngDataUrl } from './components/ThawmteEmblem';
import { ToolKey, ToolModals } from './components/ToolModals';
import {
  Point2D,
  detectDocumentCornersAlgorithm,
  renderTextStampToPng,
} from './utils/cvEngine';

type TabId = 'home' | 'convert' | 'esign' | 'reader' | 'scanner' | 'recents';
type ConvertSubTab =
  | 'pdfToWord'
  | 'pdfToExcel'
  | 'imgToPdf'
  | 'pdfToImg'
  | 'pdfToTxt'
  | 'txtToPdf';

interface PlacedStamp {
  id: string;
  type: string;
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecentItem {
  name: string;
  pageCount: number;
  size: string;
  date: string;
}

interface ActiveFileState {
  name: string;
  bytes: Uint8Array;
  size: string;
  pageCount: number;
}

const STORAGE_KEY = 'THAWMTE_PDF_RECENTS_V2';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function App() {
  // Navigation & Global UI State
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [convertTab, setConvertTab] = useState<ConvertSubTab>('pdfToWord');
  const [activeTool, setActiveTool] = useState<ToolKey>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSigModalOpen, setIsSigModalOpen] = useState(false);
  const [textPromptMode, setTextPromptMode] = useState<'initials' | 'name' | null>(null);

  // Toast & Progress
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({ visible: false, message: '', type: 'success' });
  const toastTimerRef = useRef<number | null>(null);

  const [progress, setProgressState] = useState<{
    show: boolean;
    title: string;
    subtitle: string;
    percent: number;
  }>({ show: false, title: '', subtitle: '', percent: 0 });

  // Active PDF Document & Reader State
  const [pdfJsDoc, setPdfJsDoc] = useState<any>(null);
  const [activeFile, setActiveFile] = useState<ActiveFileState | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [readerPage, setReaderPage] = useState(1);
  const [readerPageInputVal, setReaderPageInputVal] = useState('1');
  const [readerScale, setReaderScale] = useState(1.0);
  const readerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const readerViewportRef = useRef<HTMLDivElement | null>(null);

  // E-Sign Studio State
  const [esignPage, setEsignPage] = useState(1);
  const [esignStamps, setEsignStamps] = useState<Record<number, PlacedStamp[]>>({});
  const [selectedStampId, setSelectedStampId] = useState<string | null>(null);
  const esignCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const esignPageWrapperRef = useRef<HTMLDivElement | null>(null);
  const dragStampRef = useRef<{
    stampId: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  // Convert Hub States
  // 1. PDF to Word
  const [convertWordFile, setConvertWordFile] = useState<File | null>(null);
  const [wordLayoutMode, setWordLayoutMode] = useState('smart');
  const [wordTargetFormat, setWordTargetFormat] = useState<'docx' | 'doc'>('docx');
  const [wordBaseName, setWordBaseName] = useState('DOCUMENT');
  const wordLivePreviewRef = useRef<HTMLDivElement | null>(null);

  // 2. PDF to Excel
  const [convertExcelFile, setConvertExcelFile] = useState<File | null>(null);
  const [excelSensitivity, setExcelSensitivity] = useState('adaptive');
  const [excelPageMode, setExcelPageMode] = useState('consolidated');
  const [parsedExcelRows, setParsedExcelRows] = useState<string[][]>([]);
  const [parsedExcelSheets, setParsedExcelSheets] = useState<Record<string, string[][]>>({});
  const [excelBaseName, setExcelBaseName] = useState('SPREADSHEET');
  const excelTableRef = useRef<HTMLTableElement | null>(null);

  // 3. Images to PDF
  const [selectedImages, setSelectedImages] = useState<
    { name: string; dataUrl: string; size: string }[]
  >([]);
  const [imgOrientation, setImgOrientation] = useState('portrait');
  const [imgMargin, setImgMargin] = useState('0');

  // 4. PDF to Images
  const [convertPdfToImgFile, setConvertPdfToImgFile] = useState<File | null>(null);
  const [pdfImgScale, setPdfImgScale] = useState('1.5');
  const [pdfImgFormat, setPdfImgFormat] = useState<'image/jpeg' | 'image/png'>('image/jpeg');
  const [extractedPageImages, setExtractedPageImages] = useState<
    { page: number; dataUrl: string; ext: string }[]
  >([]);

  // 5. PDF to Text
  const [convertPdfToTxtFile, setConvertPdfToTxtFile] = useState<File | null>(null);
  const [extractedTextContent, setExtractedTextContent] = useState('');

  // 6. Text to PDF
  const [txtToPdfTitle, setTxtToPdfTitle] = useState('');
  const [txtToPdfBody, setTxtToPdfBody] = useState('');

  // Scanner & ID Card Scanner State
  const [scannerMode, setScannerMode] = useState<'document' | 'idcard'>('document');
  const [scannerFilter, setScannerFilter] = useState<'color' | 'bw' | 'grayscale'>('color');
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [idCardTarget, setIdCardTarget] = useState<'front' | 'back'>('front');
  const [idCardFront, setIdCardFront] = useState<string | null>(null);
  const [idCardBack, setIdCardBack] = useState<string | null>(null);
  const [idCardLayout, setIdCardLayout] = useState<'stacked' | 'side'>('stacked');
  const [idCardCertify, setIdCardCertify] = useState(true);
  const [autoEdgeDetection, setAutoEdgeDetection] = useState(true);
  const [autoDeskewInstant, setAutoDeskewInstant] = useState(false);

  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const liveDetectedQuadRef = useRef<Point2D[] | null>(null);
  const autoEdgeRef = useRef(true);
  const scannerModeRef = useRef<'document' | 'idcard'>('document');

  // Crop Adjust Modal State
  const [cropModalState, setCropModalState] = useState<{
    isOpen: boolean;
    imageSource: string | null;
    isIdCard: boolean;
    onComplete: ((croppedUrl: string) => void) | null;
  }>({
    isOpen: false,
    imageSource: null,
    isIdCard: false,
    onComplete: null,
  });

  // Recents State
  const [recents, setRecents] = useState<RecentItem[]>([]);

  // Initialize PDF.js worker, Emblem raster, and Recents
  useEffect(() => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    getThawmteEmblemPngDataUrl();
    loadRecentsFromStorage();
  }, []);

  useEffect(() => {
    autoEdgeRef.current = autoEdgeDetection;
  }, [autoEdgeDetection]);

  useEffect(() => {
    scannerModeRef.current = scannerMode;
  }, [scannerMode]);

  const loadRecentsFromStorage = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setRecents(JSON.parse(raw));
    } catch {
      setRecents([]);
    }
  };

  const addRecentItem = (item: { name: string; pageCount?: number; size?: string }) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      let list: RecentItem[] = raw ? JSON.parse(raw) : [];
      list = list.filter((x) => x.name !== item.name);
      list.unshift({
        name: item.name,
        pageCount: item.pageCount || 1,
        size: item.size || '100 KB',
        date:
          new Date().toLocaleDateString() +
          ' ' +
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      if (list.length > 20) list.pop();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      setRecents(list);
    } catch {
      // ignore storage errors
    }
  };

  const clearAllRecents = () => {
    localStorage.removeItem(STORAGE_KEY);
    setRecents([]);
    showToast('Recents cleared', 'info');
  };

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'success'
  ) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ visible: true, message, type });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3000);
  };

  const setProgress = (
    show: boolean,
    title = '',
    subtitle = '',
    percent = 0
  ) => {
    setProgressState({ show, title, subtitle, percent });
  };

  const downloadPdfBytes = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addRecentItem({
      name: filename,
      pageCount: totalPages || 1,
      size: formatFileSize(bytes.byteLength),
    });
    showToast(`Saved ${filename}`, 'success');
  };

  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ================= PDF LOADER & SAMPLE GENERATOR ================= */
  const loadPdfFromArrayBuffer = async (
    arrayBuffer: ArrayBuffer,
    fileName: string,
    fileSize = 0
  ) => {
    const uint8 = new Uint8Array(arrayBuffer);
    const loadingTask = window.pdfjsLib.getDocument({ data: uint8.slice(0) });
    const doc = await loadingTask.promise;

    const sizeStr = formatFileSize(fileSize || uint8.byteLength);
    setPdfJsDoc(doc);
    setTotalPages(doc.numPages);
    setReaderPage(1);
    setReaderPageInputVal('1');
    setEsignPage(1);
    setReaderScale(1.0);
    setEsignStamps({});
    setActiveFile({
      name: fileName,
      bytes: uint8,
      size: sizeStr,
      pageCount: doc.numPages,
    });

    addRecentItem({
      name: fileName,
      pageCount: doc.numPages,
      size: sizeStr,
    });

    return doc;
  };

  const handleGlobalPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setProgress(true, 'Opening PDF', file.name, 40);
      const buffer = await file.arrayBuffer();
      await loadPdfFromArrayBuffer(buffer, file.name, file.size);
      setProgress(false);
      showToast(`Loaded ${file.name}`, 'success');
      setActiveTab('reader');
    } catch (err: any) {
      setProgress(false);
      showToast('Failed to open PDF: ' + err.message, 'error');
    }
  };

  const loadSampleDocument = async () => {
    try {
      setProgress(true, 'Generating Sample', 'Creating Acrobat test doc...', 50);
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Page 1: Official Certificate & E-Sign Test Area
      const page1 = pdfDoc.addPage([595.28, 841.89]);
      page1.drawText('THAWMTE TEC PDF PRO', {
        x: 50,
        y: 760,
        size: 26,
        font,
        color: rgb(0.89, 0.14, 0.16),
      });
      page1.drawText('Certified E-Sign & Conversion Architecture', {
        x: 50,
        y: 730,
        size: 14,
        font: regularFont,
        color: rgb(0.2, 0.2, 0.2),
      });

      page1.drawRectangle({
        x: 50,
        y: 560,
        width: 495,
        height: 130,
        borderColor: rgb(0.89, 0.14, 0.16),
        borderWidth: 1.5,
        color: rgb(0.98, 0.98, 0.99),
      });
      page1.drawText('OFFICIAL SIGNATURE & CONVERT CERTIFICATE', {
        x: 70,
        y: 650,
        size: 14,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      page1.drawText('1. Use the E-Sign Hub to draw, type, or stamp your signature.', {
        x: 70,
        y: 625,
        size: 11,
        font: regularFont,
        color: rgb(0.3, 0.3, 0.3),
      });
      page1.drawText('2. Place initials, date stamps, and checkmarks interactively.', {
        x: 70,
        y: 605,
        size: 11,
        font: regularFont,
        color: rgb(0.3, 0.3, 0.3),
      });
      page1.drawText('3. Use the Convert Hub to transform Word, Excel, images, and text.', {
        x: 70,
        y: 585,
        size: 11,
        font: regularFont,
        color: rgb(0.3, 0.3, 0.3),
      });

      page1.drawText('Signer Authorization Area:', {
        x: 50,
        y: 480,
        size: 12,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      page1.drawLine({
        start: { x: 50, y: 410 },
        end: { x: 300, y: 410 },
        thickness: 1,
        color: rgb(0.7, 0.7, 0.7),
      });
      page1.drawText('Authorized Signature (Place stamp above)', {
        x: 50,
        y: 395,
        size: 9,
        font: regularFont,
        color: rgb(0.5, 0.5, 0.5),
      });

      // Page 2: Feature Verification & Sample Service Statement Table for Excel/Word Testing
      const page2 = pdfDoc.addPage([595.28, 841.89]);
      page2.drawText('Page 2 - CSC Digital Service Statement', {
        x: 50,
        y: 760,
        size: 20,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      page2.drawText(
        'Multi-page signing and tabular conversion tested locally in browser.',
        { x: 50, y: 725, size: 12, font: regularFont, color: rgb(0.4, 0.4, 0.4) }
      );

      // Draw a structured table so PDF to Excel can extract clean columns
      const tableRows = [
        ['Code', 'Citizen Service Description', 'Qty', 'Fee (INR)'],
        ['CSC-101', 'Certified PDF & Document Print', '10', '150.00'],
        ['CSC-102', 'Identity Card 2-in-1 Verification', '2', '60.00'],
        ['CSC-103', 'Digital E-Sign & Official Seal', '1', '100.00'],
        ['CSC-104', 'PDF to Word / Excel Conversion', '4', '120.00'],
      ];
      let yPos = 660;
      tableRows.forEach((row, rIdx) => {
        const rowFont = rIdx === 0 ? font : regularFont;
        page2.drawText(row[0], { x: 50, y: yPos, size: 11, font: rowFont });
        page2.drawText(row[1], { x: 140, y: yPos, size: 11, font: rowFont });
        page2.drawText(row[2], { x: 380, y: yPos, size: 11, font: rowFont });
        page2.drawText(row[3], { x: 450, y: yPos, size: 11, font: rowFont });
        yPos -= 26;
      });

      const bytes = await pdfDoc.save();
      await loadPdfFromArrayBuffer(
        bytes.buffer,
        'THAWMTE_CERTIFIED_SAMPLE.pdf',
        bytes.byteLength
      );
      setProgress(false);
      showToast('Sample PDF loaded!', 'success');
      setActiveTab('esign');
    } catch (err: any) {
      setProgress(false);
      showToast('Sample error: ' + err.message, 'error');
    }
  };

  /* ================= PDF READER RENDERING ================= */
  useEffect(() => {
    if (activeTab === 'reader' && pdfJsDoc) {
      renderReaderPage(readerPage, readerScale);
    }
  }, [activeTab, pdfJsDoc, readerPage, readerScale]);

  const renderReaderPage = async (pageNum: number, scaleVal: number) => {
    if (!pdfJsDoc || !readerCanvasRef.current) return;
    try {
      const page = await pdfJsDoc.getPage(pageNum);
      const canvas = readerCanvasRef.current;
      const context = canvas.getContext('2d')!;
      const viewport = page.getViewport({ scale: scaleVal });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
    } catch {
      // ignore concurrent render cancel
    }
  };

  const fitReaderWidth = async () => {
    if (!readerViewportRef.current || !pdfJsDoc) return;
    const page = await pdfJsDoc.getPage(readerPage);
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const newScale = Math.max(
      0.4,
      Math.min(2.5, (readerViewportRef.current.clientWidth - 40) / unscaledViewport.width)
    );
    setReaderScale(newScale);
  };

  /* ================= E-SIGN STUDIO RENDERING & STAMP ENGINE ================= */
  useEffect(() => {
    if (activeTab === 'esign' && pdfJsDoc) {
      renderEsignCanvas(esignPage);
    }
  }, [activeTab, pdfJsDoc, esignPage]);

  const renderEsignCanvas = async (pageNum: number) => {
    if (!pdfJsDoc || !esignCanvasRef.current) return;
    try {
      const page = await pdfJsDoc.getPage(pageNum);
      const canvas = esignCanvasRef.current;
      const context = canvas.getContext('2d')!;
      // Fit neatly on mobile & desktop screens
      const viewport = page.getViewport({ scale: 1.0 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
    } catch {
      // ignore
    }
  };

  const placeStampOnCurrentPage = (stampSpec: {
    type: string;
    dataUrl: string;
    width: number;
    height: number;
  }) => {
    if (!pdfJsDoc) {
      showToast('Please open or load a PDF document first', 'error');
      return;
    }
    const canvas = esignCanvasRef.current;
    const cW = canvas?.width || 595;
    const cH = canvas?.height || 842;

    const currentList = esignStamps[esignPage] || [];
    const offset = (currentList.length % 5) * 18;
    const newStamp: PlacedStamp = {
      id: `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: stampSpec.type,
      dataUrl: stampSpec.dataUrl,
      width: stampSpec.width,
      height: stampSpec.height,
      x: Math.max(20, Math.round((cW - stampSpec.width) / 2) + offset),
      y: Math.max(20, Math.round(cH * 0.48) + offset),
    };

    setEsignStamps((prev) => ({
      ...prev,
      [esignPage]: [...(prev[esignPage] || []), newStamp],
    }));
    setSelectedStampId(newStamp.id);
  };

  const placeOfficialCscSealStamp = async () => {
    if (!pdfJsDoc) {
      showToast('Please open or load a document first', 'error');
      return;
    }
    const pngUrl = await getThawmteEmblemPngDataUrl();
    placeStampOnCurrentPage({
      type: 'officialSeal',
      dataUrl: pngUrl,
      width: 115,
      height: 115,
    });
    showToast('Official CSC Seal placed! Drag & resize on document.', 'success');
  };

  const handleConfirmTextPrompt = (val: string, mode: 'initials' | 'name') => {
    setTextPromptMode(null);
    const rendered = renderTextStampToPng(val, {
      fontFamily: mode === 'initials' ? "'Caveat', cursive" : "'Plus Jakarta Sans', sans-serif",
      fontSize: mode === 'initials' ? 50 : 34,
      color: '#0A3871',
      fontWeight: '700',
    });
    placeStampOnCurrentPage({
      type: mode,
      ...rendered,
    });
    showToast(`${mode === 'initials' ? 'Initials' : 'Name'} stamp placed!`, 'success');
  };

  const placeDateStamp = () => {
    if (!pdfJsDoc) {
      showToast('Please open or load a document first', 'error');
      return;
    }
    const dateStr = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const rendered = renderTextStampToPng(dateStr, {
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      fontSize: 32,
      color: '#1E293B',
      fontWeight: '700',
    });
    placeStampOnCurrentPage({
      type: 'date',
      ...rendered,
    });
    showToast('Date stamp placed!', 'success');
  };

  const placeMarkStamp = (symbol: '✓' | '✕') => {
    if (!pdfJsDoc) {
      showToast('Please open or load a document first', 'error');
      return;
    }
    const rendered = renderTextStampToPng(symbol, {
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      fontSize: 52,
      color: symbol === '✓' ? '#059669' : '#E5252A',
      fontWeight: '800',
      paddingX: 16,
      paddingY: 12,
    });
    placeStampOnCurrentPage({
      type: 'mark',
      ...rendered,
    });
    showToast(`${symbol === '✓' ? 'Checkmark' : 'Cross mark'} placed!`, 'success');
  };

  const removeStamp = (stampId: string) => {
    setEsignStamps((prev) => ({
      ...prev,
      [esignPage]: (prev[esignPage] || []).filter((s) => s.id !== stampId),
    }));
  };

  const clearEsignStampsOnCurrentPage = () => {
    setEsignStamps((prev) => ({
      ...prev,
      [esignPage]: [],
    }));
    showToast('Cleared stamps on current page', 'info');
  };

  const startStampInteraction = (
    e: React.MouseEvent | React.TouchEvent,
    stamp: PlacedStamp,
    mode: 'move' | 'resize'
  ) => {
    e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setSelectedStampId(stamp.id);
    dragStampRef.current = {
      stampId: stamp.id,
      mode,
      startX: clientX,
      startY: clientY,
      origX: stamp.x,
      origY: stamp.y,
      origW: stamp.width,
      origH: stamp.height,
    };
  };

  const moveStampInteraction = (clientX: number, clientY: number) => {
    const drag = dragStampRef.current;
    if (!drag || !esignCanvasRef.current) return;
    const dx = clientX - drag.startX;
    const dy = clientY - drag.startY;
    const maxW = esignCanvasRef.current.width;
    const maxH = esignCanvasRef.current.height;

    setEsignStamps((prev) => {
      const pageList = prev[esignPage] || [];
      return {
        ...prev,
        [esignPage]: pageList.map((st) => {
          if (st.id !== drag.stampId) return st;
          if (drag.mode === 'move') {
            return {
              ...st,
              x: Math.max(0, Math.min(maxW - st.width, drag.origX + dx)),
              y: Math.max(0, Math.min(maxH - st.height, drag.origY + dy)),
            };
          } else {
            const aspect = drag.origW / (drag.origH || 1);
            const newW = Math.max(32, Math.min(maxW - st.x, drag.origW + dx));
            const newH = Math.max(24, Math.round(newW / aspect));
            return {
              ...st,
              width: newW,
              height: newH,
            };
          }
        }),
      };
    });
  };

  const endStampInteraction = () => {
    dragStampRef.current = null;
  };

  const finishAndBakeEsignPdf = async () => {
    if (!activeFile) {
      showToast('Please open a PDF document first', 'error');
      return;
    }
    const allPagesWithStamps = Object.keys(esignStamps).filter(
      (k) => (esignStamps[Number(k)] || []).length > 0
    );
    if (allPagesWithStamps.length === 0) {
      showToast('Place at least one signature, seal, or stamp first', 'error');
      return;
    }

    try {
      setProgress(true, 'Baking E-Signatures', 'Embedding stamps into PDF...', 40);
      const { PDFDocument } = window.PDFLib;
      const pdfDoc = await PDFDocument.load(activeFile.bytes);
      const pages = pdfDoc.getPages();

      for (const pageKey of allPagesWithStamps) {
        const pageNum = Number(pageKey);
        const stamps = esignStamps[pageNum] || [];
        const pdfPage = pages[pageNum - 1];
        if (!pdfPage) continue;

        const { width: pdfW, height: pdfH } = pdfPage.getSize();
        const jsPage = await pdfJsDoc.getPage(pageNum);
        const vp = jsPage.getViewport({ scale: 1.0 });
        const scaleX = pdfW / vp.width;
        const scaleY = pdfH / vp.height;

        for (const st of stamps) {
          const embeddedImg = st.dataUrl.includes('image/png')
            ? await pdfDoc.embedPng(st.dataUrl)
            : await pdfDoc.embedJpg(st.dataUrl);

          const drawW = st.width * scaleX;
          const drawH = st.height * scaleY;
          const drawX = st.x * scaleX;
          const drawY = pdfH - st.y * scaleY - drawH;

          pdfPage.drawImage(embeddedImg, {
            x: drawX,
            y: drawY,
            width: drawW,
            height: drawH,
          });
        }
      }

      const outBytes = await pdfDoc.save();
      setProgress(false);
      const cleanName = activeFile.name.replace(/\.pdf$/i, '');
      downloadPdfBytes(outBytes, `SIGNED_${cleanName}.pdf`);
      // Also reload the newly signed PDF into active state
      await loadPdfFromArrayBuffer(
        outBytes.buffer,
        `SIGNED_${cleanName}.pdf`,
        outBytes.byteLength
      );
    } catch (err: any) {
      setProgress(false);
      showToast('Failed to bake signature: ' + err.message, 'error');
    }
  };

  /* ================= CONVERT HUB ENGINES ================= */
  // 1. PDF to Word (.docx & .doc)
  const executePdfToWord = async () => {
    let pdfBytes: ArrayBuffer | Uint8Array;
    let fileName = 'DOCUMENT';
    if (convertWordFile) {
      pdfBytes = await convertWordFile.arrayBuffer();
      fileName = convertWordFile.name.replace(/\.pdf$/i, '');
    } else if (activeFile) {
      pdfBytes = activeFile.bytes;
      fileName = activeFile.name.replace(/\.pdf$/i, '');
    } else {
      showToast('Please select or load a PDF document first', 'error');
      return;
    }

    try {
      setProgress(true, 'Converting to Word', 'Analyzing headings & paragraphs...', 25);
      const pdfJs = await window.pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes.slice(0)),
      }).promise;
      let previewHtml = '';

      for (let pageNum = 1; pageNum <= pdfJs.numPages; pageNum++) {
        setProgress(
          true,
          'Converting to Word',
          `Analyzing page ${pageNum} of ${pdfJs.numPages}...`,
          (pageNum / pdfJs.numPages) * 75
        );
        const page = await pdfJs.getPage(pageNum);
        const textContent = await page.getTextContent({ normalizeWhitespace: true });
        const items = textContent.items;
        if (items.length === 0) continue;

        const linesMap = new Map<number, any[]>();
        items.forEach((it: any) => {
          if (!it.str || !it.str.trim()) return;
          const y = Math.round(it.transform[5]);
          let matchedY: number | null = null;
          for (const key of linesMap.keys()) {
            if (Math.abs(key - y) <= 4) {
              matchedY = key;
              break;
            }
          }
          if (matchedY === null) {
            matchedY = y;
            linesMap.set(matchedY, []);
          }
          linesMap.get(matchedY)!.push(it);
        });

        const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);
        const pageParagraphs: { text: string; isHeading: boolean }[] = [];

        sortedY.forEach((y) => {
          const lineItems = linesMap.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
          const lineText = lineItems
            .map((it) => it.str)
            .join(' ')
            .trim();
          const avgHeight =
            lineItems.reduce((acc, it) => acc + (it.height || 10), 0) / lineItems.length;
          const isHeading =
            avgHeight >= 14 ||
            (lineText.length < 50 && (avgHeight > 12 || /^[0-9A-Z\s.\-]{4,}$/.test(lineText)));

          if (lineText) {
            pageParagraphs.push({ text: lineText, isHeading });
          }
        });

        previewHtml += `<div class="mb-4 pb-3 ${
          pageNum < pdfJs.numPages ? 'border-b border-gray-200' : ''
        }">`;
        previewHtml += `<div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Page ${pageNum}</div>`;
        pageParagraphs.forEach((p) => {
          if (p.isHeading && wordLayoutMode === 'smart') {
            previewHtml += `<h3 class="text-sm font-bold text-gray-900 mt-2 mb-1">${escapeHtml(
              p.text
            )}</h3>`;
          } else {
            previewHtml += `<p class="text-xs text-gray-700 mb-1.5 leading-relaxed">${escapeHtml(
              p.text
            )}</p>`;
          }
        });
        previewHtml += `</div>`;
      }

      if (wordLivePreviewRef.current) {
        wordLivePreviewRef.current.innerHTML =
          previewHtml ||
          '<p class="text-gray-400 italic">No extractable text found in this document.</p>';
      }
      setWordBaseName(fileName);
      setProgress(false);
      showToast('Word structure parsed! Review or edit below.', 'success');
    } catch (err: any) {
      setProgress(false);
      showToast('Word conversion failed: ' + err.message, 'error');
    }
  };

  const downloadLiveWordDocument = async (format: 'docx' | 'doc') => {
    const previewEl = wordLivePreviewRef.current;
    const textContent = previewEl?.innerText.trim() || '';
    if (!textContent || textContent.includes('Select a PDF above')) {
      showToast('Please convert a PDF first to generate content', 'error');
      return;
    }

    const fileName = `${wordBaseName || 'DOCUMENT'}.${format}`;
    try {
      if (format === 'docx' && window.docx) {
        setProgress(true, 'Building .docx', 'Generating Microsoft Word document...', 50);
        const docxLib = window.docx;
        const paragraphs = textContent.split('\n').filter((line) => line.trim().length > 0);

        const docChildren = paragraphs.map((para) => {
          const isHeading =
            para.length < 60 && (para.startsWith('Page ') || /^[0-9A-Z\s]{4,}$/.test(para));
          if (isHeading) {
            return new docxLib.Paragraph({
              text: para,
              heading: docxLib.HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 100 },
            });
          }
          return new docxLib.Paragraph({
            children: [new docxLib.TextRun({ text: para, font: 'Calibri', size: 22 })],
            spacing: { after: 120, line: 276 },
          });
        });

        const doc = new docxLib.Document({
          sections: [
            {
              properties: {
                page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
              },
              children: docChildren,
            },
          ],
        });

        const blob = await docxLib.Packer.toBlob(doc);
        triggerBlobDownload(blob, fileName);
        setProgress(false);
        showToast(`Downloaded ${fileName}`, 'success');
      } else {
        const htmlContent = `
          <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
          <head>
            <meta charset="utf-8">
            <title>${escapeHtml(fileName)}</title>
            <style>
              body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #111827; }
              h1, h2, h3 { color: #1E3A8A; margin-top: 14pt; margin-bottom: 6pt; }
              p { margin-bottom: 8pt; }
            </style>
          </head>
          <body>
            ${previewEl?.innerHTML || ''}
          </body>
          </html>
        `;
        const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
        triggerBlobDownload(blob, fileName);
        showToast(`Downloaded ${fileName}`, 'success');
      }
    } catch (err: any) {
      setProgress(false);
      showToast('Word export error: ' + err.message, 'error');
    }
  };

  const copyWordLiveText = () => {
    const text = wordLivePreviewRef.current?.innerText.trim() || '';
    if (!text) return showToast('No text available to copy', 'error');
    navigator.clipboard.writeText(text);
    showToast('Word content copied to clipboard!', 'success');
  };

  // 2. PDF to Excel (.xlsx & .csv)
  const executePdfToExcel = async () => {
    let pdfBytes: ArrayBuffer | Uint8Array;
    let fileName = 'SPREADSHEET';
    if (convertExcelFile) {
      pdfBytes = await convertExcelFile.arrayBuffer();
      fileName = convertExcelFile.name.replace(/\.pdf$/i, '');
    } else if (activeFile) {
      pdfBytes = activeFile.bytes;
      fileName = activeFile.name.replace(/\.pdf$/i, '');
    } else {
      showToast('Please select or load a PDF document first', 'error');
      return;
    }

    try {
      setProgress(true, 'Extracting Tables', 'Aligning tabular coordinates...', 25);
      const pdfJs = await window.pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes.slice(0)),
      }).promise;

      const allSheets: Record<string, string[][]> = {};
      const consolidatedRows: string[][] = [];

      for (let pageNum = 1; pageNum <= pdfJs.numPages; pageNum++) {
        setProgress(
          true,
          'Extracting Tables',
          `Parsing rows on page ${pageNum} of ${pdfJs.numPages}...`,
          (pageNum / pdfJs.numPages) * 75
        );
        const page = await pdfJs.getPage(pageNum);
        const textContent = await page.getTextContent({ normalizeWhitespace: true });
        const items = textContent.items;
        if (items.length === 0) continue;

        const linesMap = new Map<number, { str: string; x: number; width: number }[]>();
        const yTolerance = excelSensitivity === 'compact' ? 3 : 5;

        items.forEach((it: any) => {
          if (!it.str || !it.str.trim()) return;
          const y = Math.round(it.transform[5]);
          let matchedY: number | null = null;
          for (const key of linesMap.keys()) {
            if (Math.abs(key - y) <= yTolerance) {
              matchedY = key;
              break;
            }
          }
          if (matchedY === null) {
            matchedY = y;
            linesMap.set(matchedY, []);
          }
          linesMap.get(matchedY)!.push({
            str: it.str.trim(),
            x: Math.round(it.transform[4]),
            width: Math.round(it.width || it.str.length * 6),
          });
        });

        const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);
        const pageRows: string[][] = [];
        const gapThreshold =
          excelSensitivity === 'compact' ? 12 : excelSensitivity === 'spacing' ? 24 : 16;

        sortedY.forEach((y) => {
          const lineItems = linesMap.get(y)!.sort((a, b) => a.x - b.x);
          const rowCells: string[] = [];
          let currentCellText = '';
          let prevEnd = -1;

          lineItems.forEach((it) => {
            if (prevEnd !== -1 && it.x - prevEnd > gapThreshold) {
              rowCells.push(currentCellText.trim());
              currentCellText = it.str;
            } else {
              currentCellText += (currentCellText ? ' ' : '') + it.str;
            }
            prevEnd = it.x + it.width;
          });
          if (currentCellText) rowCells.push(currentCellText.trim());

          if (rowCells.length > 0) {
            pageRows.push(rowCells);
            consolidatedRows.push(rowCells);
          }
        });

        allSheets[`Page_${pageNum}`] = pageRows;
      }

      setParsedExcelRows(consolidatedRows);
      setParsedExcelSheets(allSheets);
      setExcelBaseName(fileName);
      setProgress(false);
      showToast(`Parsed ${consolidatedRows.length} table rows!`, 'success');
    } catch (err: any) {
      setProgress(false);
      showToast('Table parsing failed: ' + err.message, 'error');
    }
  };

  const getLiveExcelGridData = (): string[][] => {
    const table = excelTableRef.current;
    if (!table) return parsedExcelRows;
    const rows: string[][] = [];
    const trs = table.querySelectorAll('tbody tr');
    trs.forEach((tr) => {
      const tds = tr.querySelectorAll('td[contenteditable="true"]');
      if (tds.length > 0) {
        const rowCells: string[] = [];
        tds.forEach((td) => rowCells.push((td as HTMLElement).innerText.trim()));
        rows.push(rowCells);
      }
    });
    return rows.length > 0 ? rows : parsedExcelRows;
  };

  const downloadLiveExcelWorkbook = (format: 'xlsx' | 'csv') => {
    const currentRows = getLiveExcelGridData();
    if (!currentRows || currentRows.length === 0) {
      showToast('Please extract tabular data first', 'error');
      return;
    }

    const fileName = `${excelBaseName || 'SPREADSHEET'}.${format}`;
    try {
      const XLSX = window.XLSX;
      if (!XLSX) {
        showToast('Spreadsheet engine loading. Please retry...', 'error');
        return;
      }
      const wb = XLSX.utils.book_new();
      if (excelPageMode === 'persheet' && Object.keys(parsedExcelSheets).length > 1) {
        Object.keys(parsedExcelSheets).forEach((sheetName) => {
          const sheetRows = parsedExcelSheets[sheetName];
          const ws = XLSX.utils.aoa_to_sheet(
            sheetRows.length > 0 ? sheetRows : [['No data']]
          );
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });
      } else {
        const ws = XLSX.utils.aoa_to_sheet(currentRows);
        XLSX.utils.book_append_sheet(wb, ws, 'DataSheet');
      }

      if (format === 'csv') {
        XLSX.writeFile(wb, fileName, { bookType: 'csv' });
      } else {
        XLSX.writeFile(wb, fileName, { bookType: 'xlsx' });
      }
      showToast(`Saved ${fileName}`, 'success');
    } catch (err: any) {
      showToast('Excel export failed: ' + err.message, 'error');
    }
  };

  const copyExcelTableTsv = () => {
    const rows = getLiveExcelGridData();
    if (!rows || rows.length === 0) return showToast('No table data to copy', 'error');
    const tsv = rows.map((r) => r.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv);
    showToast('Tabular data copied (Ready to paste into Excel / Sheets)', 'success');
  };

  // 3. Images to PDF
  const handleConvertImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSelectedImages([]);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSelectedImages((prev) => [
          ...prev,
          {
            name: file.name,
            dataUrl: ev.target?.result as string,
            size: formatFileSize(file.size),
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    showToast(`${files.length} images queued for PDF conversion!`, 'info');
  };

  const executeImagesToPdf = async () => {
    if (selectedImages.length === 0) {
      showToast('Please select at least one image', 'error');
      return;
    }
    try {
      setProgress(true, 'Converting Images', 'Creating PDF pages...', 30);
      const { PDFDocument } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      const margin = parseInt(imgMargin, 10) || 0;

      for (let i = 0; i < selectedImages.length; i++) {
        setProgress(
          true,
          'Converting Images',
          `Embedding image ${i + 1} of ${selectedImages.length}...`,
          ((i + 1) / selectedImages.length) * 100
        );
        const imgItem = selectedImages[i];
        const embeddedImg = imgItem.dataUrl.includes('image/png')
          ? await pdfDoc.embedPng(imgItem.dataUrl)
          : await pdfDoc.embedJpg(imgItem.dataUrl);

        let pWidth: number, pHeight: number;
        if (imgOrientation === 'portrait') {
          pWidth = 595.28;
          pHeight = 841.89;
        } else if (imgOrientation === 'landscape') {
          pWidth = 841.89;
          pHeight = 595.28;
        } else {
          pWidth = embeddedImg.width + margin * 2;
          pHeight = embeddedImg.height + margin * 2;
        }

        const page = pdfDoc.addPage([pWidth, pHeight]);
        const availableW = pWidth - margin * 2;
        const availableH = pHeight - margin * 2;
        const scale = Math.min(availableW / embeddedImg.width, availableH / embeddedImg.height);
        const drawW = embeddedImg.width * scale;
        const drawH = embeddedImg.height * scale;

        page.drawImage(embeddedImg, {
          x: margin + (availableW - drawW) / 2,
          y: margin + (availableH - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      }

      const outBytes = await pdfDoc.save();
      setProgress(false);
      downloadPdfBytes(outBytes, `CONVERTED_IMAGES_${Date.now()}.pdf`);
    } catch (err: any) {
      setProgress(false);
      showToast('Image conversion failed: ' + err.message, 'error');
    }
  };

  // 4. PDF to Images
  const executePdfToImages = async () => {
    let pdfBytes: ArrayBuffer | Uint8Array;
    if (convertPdfToImgFile) {
      pdfBytes = await convertPdfToImgFile.arrayBuffer();
    } else if (activeFile) {
      pdfBytes = activeFile.bytes;
    } else {
      showToast('Please select or load a PDF document first', 'error');
      return;
    }

    try {
      setProgress(true, 'Rendering Pages', 'Converting PDF pages to images...', 25);
      const pdfJs = await window.pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes.slice(0)),
      }).promise;
      const scaleVal = parseFloat(pdfImgScale) || 1.5;
      const ext = pdfImgFormat === 'image/png' ? 'png' : 'jpg';
      const outImages: { page: number; dataUrl: string; ext: string }[] = [];

      for (let i = 1; i <= pdfJs.numPages; i++) {
        setProgress(
          true,
          'Rendering Pages',
          `Rendering page ${i} of ${pdfJs.numPages}...`,
          (i / pdfJs.numPages) * 90
        );
        const page = await pdfJs.getPage(i);
        const vp = page.getViewport({ scale: scaleVal });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        outImages.push({
          page: i,
          dataUrl: canvas.toDataURL(pdfImgFormat, 0.92),
          ext,
        });
      }

      setExtractedPageImages(outImages);
      setProgress(false);
      showToast(`Extracted ${outImages.length} high-resolution page images!`, 'success');
    } catch (err: any) {
      setProgress(false);
      showToast('PDF to Images failed: ' + err.message, 'error');
    }
  };

  // 5. PDF to Text (.txt)
  const executePdfToTxt = async () => {
    let pdfBytes: ArrayBuffer | Uint8Array;
    if (convertPdfToTxtFile) {
      pdfBytes = await convertPdfToTxtFile.arrayBuffer();
    } else if (activeFile) {
      pdfBytes = activeFile.bytes;
    } else {
      showToast('Please select or load a PDF document first', 'error');
      return;
    }

    try {
      setProgress(true, 'Extracting Text', 'Reading PDF text streams...', 35);
      const pdfJs = await window.pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes.slice(0)),
      }).promise;
      let fullText = '';

      for (let i = 1; i <= pdfJs.numPages; i++) {
        const page = await pdfJs.getPage(i);
        const tc = await page.getTextContent();
        const pageText = tc.items.map((it: any) => it.str).join(' ');
        fullText += `--- PAGE ${i} ---\n${pageText.trim()}\n\n`;
      }

      setExtractedTextContent(fullText.trim() || 'No extractable text found.');
      setProgress(false);
      showToast('Text extracted!', 'success');
    } catch (err: any) {
      setProgress(false);
      showToast('Text extraction failed: ' + err.message, 'error');
    }
  };

  const downloadExtractedText = () => {
    if (!extractedTextContent.trim()) {
      showToast('Extract text first before saving', 'error');
      return;
    }
    const blob = new Blob([extractedTextContent], { type: 'text/plain;charset=utf-8' });
    triggerBlobDownload(blob, `EXTRACTED_TEXT_${Date.now()}.txt`);
    showToast('Saved .txt file', 'success');
  };

  // 6. Text to PDF
  const executeTxtToPdf = async () => {
    if (!txtToPdfBody.trim()) {
      showToast('Please enter text content to compile into PDF', 'error');
      return;
    }
    try {
      setProgress(true, 'Compiling PDF', 'Formatting text onto A4 pages...', 45);
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const pageW = 595.28;
      const pageH = 841.89;
      let page = pdfDoc.addPage([pageW, pageH]);
      let y = pageH - 60;

      if (txtToPdfTitle.trim()) {
        page.drawText(txtToPdfTitle.trim(), {
          x: 50,
          y,
          size: 18,
          font: boldFont,
          color: rgb(0.05, 0.17, 0.51),
        });
        y -= 30;
      }

      const paragraphs = txtToPdfBody.split('\n');
      for (const para of paragraphs) {
        const words = para.split(' ');
        let line = '';
        for (const word of words) {
          const testLine = line ? `${line} ${word}` : word;
          if (regFont.widthOfTextAtSize(testLine, 11) > pageW - 100) {
            if (y < 60) {
              page = pdfDoc.addPage([pageW, pageH]);
              y = pageH - 60;
            }
            page.drawText(line, {
              x: 50,
              y,
              size: 11,
              font: regFont,
              color: rgb(0.15, 0.15, 0.15),
            });
            y -= 18;
            line = word;
          } else {
            line = testLine;
          }
        }
        if (line) {
          if (y < 60) {
            page = pdfDoc.addPage([pageW, pageH]);
            y = pageH - 60;
          }
          page.drawText(line, {
            x: 50,
            y,
            size: 11,
            font: regFont,
            color: rgb(0.15, 0.15, 0.15),
          });
          y -= 18;
        } else {
          y -= 10;
        }
      }

      const outBytes = await pdfDoc.save();
      setProgress(false);
      downloadPdfBytes(outBytes, `TEXT_DOCUMENT_${Date.now()}.pdf`);
    } catch (err: any) {
      setProgress(false);
      showToast('Text to PDF failed: ' + err.message, 'error');
    }
  };

  /* ================= SCANNER & AUTO EDGE DETECTION ENGINE ================= */
  useEffect(() => {
    let timer: number | null = null;
    let isCancelled = false;

    const startCamera = async () => {
      try {
        if (scannerStreamRef.current) return;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        scannerStreamRef.current = stream;
        if (scannerVideoRef.current) {
          scannerVideoRef.current.srcObject = stream;
        }
      } catch {
        showToast('Camera unavailable in this preview. Use Gallery / Upload.', 'info');
      }
    };

    const runEdgeLoop = () => {
      if (isCancelled) return;
      renderLiveEdgeTracking();
      timer = window.setTimeout(runEdgeLoop, 95);
    };

    if (activeTab === 'scanner') {
      startCamera();
      runEdgeLoop();
    } else {
      if (scannerStreamRef.current) {
        scannerStreamRef.current.getTracks().forEach((t) => t.stop());
        scannerStreamRef.current = null;
      }
    }

    return () => {
      isCancelled = true;
      if (timer) window.clearTimeout(timer);
      if (activeTab !== 'scanner' && scannerStreamRef.current) {
        scannerStreamRef.current.getTracks().forEach((t) => t.stop());
        scannerStreamRef.current = null;
      }
    };
  }, [activeTab]);

  const renderLiveEdgeTracking = () => {
    const video = scannerVideoRef.current;
    const overlay = scannerOverlayRef.current;
    if (!video || !overlay) return;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    if (!autoEdgeRef.current || video.readyState < 2) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      return;
    }

    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (overlay.width !== rect.width || overlay.height !== rect.height) {
      overlay.width = rect.width;
      overlay.height = rect.height;
    }
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const analysisW = 180;
    const analysisH =
      Math.round((video.videoHeight / (video.videoWidth || 1)) * 180) || 135;
    const off = document.createElement('canvas');
    off.width = analysisW;
    off.height = analysisH;
    const offCtx = off.getContext('2d')!;
    offCtx.drawImage(video, 0, 0, analysisW, analysisH);

    const isIdCard = scannerModeRef.current === 'idcard';
    const cornersNorm = detectDocumentCornersAlgorithm(offCtx, analysisW, analysisH, isIdCard);
    liveDetectedQuadRef.current = cornersNorm;

    const W = overlay.width;
    const H = overlay.height;
    const pts = cornersNorm.map((p) => ({ x: p.x * W, y: p.y * H }));

    const themeColor = isIdCard ? '#3B82F6' : '#10B981';
    const glowColor = isIdCard ? 'rgba(59, 130, 246, 0.35)' : 'rgba(16, 185, 129, 0.35)';

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.lineTo(pts[3].x, pts[3].y);
    ctx.closePath();

    ctx.fillStyle = glowColor;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = themeColor;
    ctx.shadowColor = themeColor;
    ctx.shadowBlur = 8;
    ctx.stroke();

    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = themeColor;
      ctx.stroke();
    });
    ctx.restore();
  };

  const openCropAdjustmentModal = (
    imageSource: string,
    isIdCard: boolean,
    onComplete: (croppedUrl: string) => void
  ) => {
    setCropModalState({
      isOpen: true,
      imageSource,
      isIdCard,
      onComplete,
    });
  };

  const applyCapturedIdCardImage = (dataUrl: string, target: 'front' | 'back') => {
    if (target === 'front') {
      setIdCardFront(dataUrl);
      if (!idCardBack) {
        setIdCardTarget('back');
        showToast('Front captured! Now align Back of ID card', 'success');
      } else {
        showToast('Front of ID card updated', 'success');
      }
    } else {
      setIdCardBack(dataUrl);
      showToast('Back of ID card captured! Ready to compile.', 'success');
    }
  };

  const captureScannerFrame = () => {
    const video = scannerVideoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video?.videoWidth || 1280;
    canvas.height = video?.videoHeight || 720;
    const ctx = canvas.getContext('2d')!;

    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } else {
      // Fallback synthetic test document/card when camera hardware isn't attached
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(160, 100, canvas.width - 320, canvas.height - 200);
      ctx.fillStyle = '#0D2B82';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('THAWMTE TEC CSC SCANNER CAPTURE', 220, 220);
      ctx.fillStyle = '#334155';
      ctx.font = '24px sans-serif';
      ctx.fillText(
        scannerMode === 'idcard'
          ? `IDENTITY CARD - ${idCardTarget.toUpperCase()} SIDE`
          : 'OFFICIAL SCANNED DOCUMENT PAGE',
        220,
        280
      );
    }

    const isIdCard = scannerMode === 'idcard';
    const currentTarget = idCardTarget;
    openCropAdjustmentModal(
      canvas.toDataURL('image/jpeg', 0.95),
      isIdCard,
      (croppedDataUrl) => {
        if (isIdCard) {
          applyCapturedIdCardImage(croppedDataUrl, currentTarget);
        } else {
          setScannedPages((prev) => [...prev, croppedDataUrl]);
          showToast('Document page cropped & added!', 'success');
        }
      }
    );
  };

  const handleScannerGalleryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      openCropAdjustmentModal(ev.target?.result as string, false, (croppedUrl) => {
        setScannedPages((prev) => [...prev, croppedUrl]);
        showToast('Photo auto-cropped and added!', 'success');
      });
    };
    reader.readAsDataURL(file);
  };

  const handleIdCardGalleryUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'front' | 'back'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      openCropAdjustmentModal(ev.target?.result as string, true, (croppedUrl) => {
        applyCapturedIdCardImage(croppedUrl, target);
      });
    };
    reader.readAsDataURL(file);
  };

  const exportScannedPdf = async () => {
    if (scannedPages.length === 0) {
      showToast('Please capture at least one page', 'error');
      return;
    }
    try {
      setProgress(true, 'Compiling Scans', 'Building PDF...', 40);
      const { PDFDocument } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      for (let i = 0; i < scannedPages.length; i++) {
        const jpgImage = await pdfDoc.embedJpg(scannedPages[i]);
        const page = pdfDoc.addPage([jpgImage.width, jpgImage.height]);
        page.drawImage(jpgImage, {
          x: 0,
          y: 0,
          width: jpgImage.width,
          height: jpgImage.height,
        });
      }
      const outBytes = await pdfDoc.save();
      setProgress(false);
      downloadPdfBytes(outBytes, `SCAN_${Date.now()}.pdf`);
      setScannedPages([]);
    } catch (err: any) {
      setProgress(false);
      showToast('Scanner export failed: ' + err.message, 'error');
    }
  };

  const exportIdCardPdf = async () => {
    if (!idCardFront && !idCardBack) {
      showToast('Please capture or upload at least the Front side of your ID', 'error');
      return;
    }
    try {
      setProgress(true, 'Compiling ID Card PDF', 'Aligning Front and Back on A4...', 30);
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const page = pdfDoc.addPage([pageWidth, pageHeight]);

      if (idCardCertify) {
        page.drawRectangle({
          x: 36,
          y: pageHeight - 95,
          width: pageWidth - 72,
          height: 60,
          color: rgb(0.05, 0.17, 0.51),
          borderColor: rgb(0.89, 0.14, 0.16),
          borderWidth: 1.5,
        });

        page.drawText('THAWMTE TEC COMMON SERVICES CENTRE', {
          x: 52,
          y: pageHeight - 58,
          size: 15,
          font,
          color: rgb(1, 1, 1),
        });

        page.drawText('GOVERNMENT CITIZEN SERVICES & IDENTITY VERIFICATION DESK', {
          x: 52,
          y: pageHeight - 74,
          size: 8.5,
          font,
          color: rgb(0.96, 0.75, 0.15),
        });

        page.drawText('Hmuia Veng, Tetea Road, Lamka • Contact: 9612887396', {
          x: 52,
          y: pageHeight - 87,
          size: 8,
          font: regularFont,
          color: rgb(0.85, 0.9, 1),
        });

        try {
          const sealPng = await getThawmteEmblemPngDataUrl();
          if (sealPng.startsWith('data:image/png')) {
            const sealImg = await pdfDoc.embedPng(sealPng);
            page.drawImage(sealImg, {
              x: pageWidth - 88,
              y: pageHeight - 90,
              width: 48,
              height: 48,
            });
          }
        } catch {
          // ignore seal error
        }
      }

      const cardWidth = 265;
      const cardHeight = 167;

      let frontImg = null;
      let backImg = null;
      if (idCardFront) {
        frontImg = idCardFront.includes('image/png')
          ? await pdfDoc.embedPng(idCardFront)
          : await pdfDoc.embedJpg(idCardFront);
      }
      if (idCardBack) {
        backImg = idCardBack.includes('image/png')
          ? await pdfDoc.embedPng(idCardBack)
          : await pdfDoc.embedJpg(idCardBack);
      }

      if (idCardLayout === 'side') {
        const startY = pageHeight - 340;
        const leftX1 = 36;
        const leftX2 = pageWidth - cardWidth - 36;

        if (frontImg) {
          page.drawRectangle({
            x: leftX1 - 2,
            y: startY - 2,
            width: cardWidth + 4,
            height: cardHeight + 4,
            borderColor: rgb(0.7, 0.7, 0.7),
            borderWidth: 1,
            color: rgb(0.98, 0.98, 0.99),
          });
          page.drawImage(frontImg, {
            x: leftX1,
            y: startY,
            width: cardWidth,
            height: cardHeight,
          });
          page.drawText('FRONT SIDE', {
            x: leftX1,
            y: startY - 14,
            size: 9,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
        }

        if (backImg) {
          page.drawRectangle({
            x: leftX2 - 2,
            y: startY - 2,
            width: cardWidth + 4,
            height: cardHeight + 4,
            borderColor: rgb(0.7, 0.7, 0.7),
            borderWidth: 1,
            color: rgb(0.98, 0.98, 0.99),
          });
          page.drawImage(backImg, {
            x: leftX2,
            y: startY,
            width: cardWidth,
            height: cardHeight,
          });
          page.drawText('BACK SIDE', {
            x: leftX2,
            y: startY - 14,
            size: 9,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
        }
      } else {
        const centerX = (pageWidth - cardWidth) / 2;
        const frontY = pageHeight - 310;
        const backY = pageHeight - 530;

        if (frontImg) {
          page.drawRectangle({
            x: centerX - 3,
            y: frontY - 3,
            width: cardWidth + 6,
            height: cardHeight + 6,
            borderColor: rgb(0.6, 0.6, 0.65),
            borderWidth: 1.2,
            color: rgb(0.98, 0.98, 0.99),
          });
          page.drawImage(frontImg, {
            x: centerX,
            y: frontY,
            width: cardWidth,
            height: cardHeight,
          });
          page.drawText('IDENTITY CARD - FRONT SIDE', {
            x: centerX,
            y: frontY - 14,
            size: 9,
            font,
            color: rgb(0.15, 0.15, 0.15),
          });
        }

        if (backImg) {
          page.drawRectangle({
            x: centerX - 3,
            y: backY - 3,
            width: cardWidth + 6,
            height: cardHeight + 6,
            borderColor: rgb(0.6, 0.6, 0.65),
            borderWidth: 1.2,
            color: rgb(0.98, 0.98, 0.99),
          });
          page.drawImage(backImg, {
            x: centerX,
            y: backY,
            width: cardWidth,
            height: cardHeight,
          });
          page.drawText('IDENTITY CARD - BACK SIDE', {
            x: centerX,
            y: backY - 14,
            size: 9,
            font,
            color: rgb(0.15, 0.15, 0.15),
          });
        }
      }

      const footerY = 160;
      page.drawLine({
        start: { x: 36, y: footerY + 30 },
        end: { x: pageWidth - 36, y: footerY + 30 },
        thickness: 0.8,
        color: rgb(0.8, 0.8, 0.8),
      });

      const timeStr =
        new Date().toLocaleDateString('en-US', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }) +
        ' ' +
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      page.drawText('OFFICIAL VERIFICATION CERTIFICATE:', {
        x: 36,
        y: footerY + 16,
        size: 8.5,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      page.drawText(
        'This is a verified 2-in-1 true electronic document copy of the original identity card processed by THAWMTE TEC CSC.',
        {
          x: 36,
          y: footerY + 3,
          size: 7.5,
          font: regularFont,
          color: rgb(0.35, 0.35, 0.35),
        }
      );
      page.drawText(`Date & Time Generated: ${timeStr} • CSC Center ID: TT-CSC-LMK`, {
        x: 36,
        y: footerY - 9,
        size: 7.5,
        font: regularFont,
        color: rgb(0.4, 0.4, 0.4),
      });

      page.drawLine({
        start: { x: pageWidth - 190, y: footerY - 30 },
        end: { x: pageWidth - 36, y: footerY - 30 },
        thickness: 1,
        color: rgb(0.6, 0.6, 0.6),
      });
      page.drawText('Authorized Center Seal & Signature', {
        x: pageWidth - 185,
        y: footerY - 42,
        size: 7.5,
        font: regularFont,
        color: rgb(0.45, 0.45, 0.45),
      });

      pdfDoc.setProducer('THAWMTE TEC PDF PRO ID SCANNER');
      pdfDoc.setSubject('2-in-1 Identity Card Verification Copy');

      const outBytes = await pdfDoc.save();
      setProgress(false);
      downloadPdfBytes(outBytes, `ID_CARD_2IN1_${Date.now()}.pdf`);
    } catch (err: any) {
      setProgress(false);
      showToast('Failed to compile ID Card PDF: ' + err.message, 'error');
    }
  };

  // Excel Grid Preview Helper
  const activeExcelGrid =
    excelPageMode === 'persheet'
      ? parsedExcelSheets['Page_1'] || parsedExcelRows
      : parsedExcelRows;
  const maxExcelCols =
    activeExcelGrid.length > 0
      ? Math.min(Math.max(...activeExcelGrid.map((r) => r.length), 1), 12)
      : 3;

  return (
    <div
      className="bg-gray-100 text-gray-900 font-sans h-screen w-screen overflow-hidden flex flex-col justify-between select-none"
      onMouseMove={(e) => moveStampInteraction(e.clientX, e.clientY)}
      onMouseUp={endStampInteraction}
      onTouchMove={(e) => {
        if (e.touches[0]) moveStampInteraction(e.touches[0].clientX, e.touches[0].clientY);
      }}
      onTouchEnd={endStampInteraction}
    >
      {/* ================= TOP HEADER ================= */}
      <header className="bg-acrobat-slate text-white px-4 py-2.5 flex items-center justify-between border-b border-acrobat-border shadow-md z-30 shrink-0">
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setIsAboutOpen(true)}
            className="w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center p-0.5 active:scale-95 transition border-2 border-blue-900 shrink-0 hover:ring-2 hover:ring-acrobat-red"
            title="About THAWMTE TEC Common Services Centre"
          >
            <ThawmteEmblem />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-wide text-white whitespace-nowrap">
                THAWMTE TEC
              </span>
              <span className="text-[11px] text-blue-300 font-semibold whitespace-nowrap">
                · CSC PRO
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate max-w-[160px] sm:max-w-xs">
              {activeFile
                ? `${activeFile.name} (${activeFile.pageCount} p)`
                : 'Lamka · Common Services Centre'}
            </p>
          </div>
        </div>

        {/* Quick Acrobat Actions */}
        <div className="flex items-center space-x-1.5 sm:space-x-2">
          <a
            href="/APK_DOWNLOAD/app-debug.apk"
            download="app-debug.apk"
            className="flex items-center space-x-1 bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow whitespace-nowrap shrink-0"
            title="Download Installable Android Debug APK"
          >
            <svg
              className="w-3.5 h-3.5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span>APK</span>
          </a>

          <button
            onClick={() => setActiveTab('convert')}
            className="flex items-center space-x-1 bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold transition border border-white/15 whitespace-nowrap shrink-0"
          >
            <svg
              className="w-3.5 h-3.5 text-yellow-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
            <span className="font-bold">Convert</span>
          </button>

          <button
            onClick={() => setActiveTab('esign')}
            className="flex items-center space-x-1 bg-acrobat-red hover:bg-acrobat-darkRed text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow whitespace-nowrap shrink-0"
          >
            <svg
              className="w-3.5 h-3.5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
            <span>E-Sign</span>
          </button>

          <button
            onClick={() => {
              if (!pdfJsDoc) {
                showToast('Please open a PDF document first', 'error');
                return;
              }
              setIsSearchOpen(true);
            }}
            className="touch-target p-2 text-gray-300 hover:text-white rounded-full transition flex items-center justify-center"
            title="Search PDF"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>

          <label
            className="touch-target p-2 text-gray-300 hover:text-white cursor-pointer rounded-full transition flex items-center justify-center"
            title="Open PDF"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleGlobalPdfUpload}
            />
          </label>
        </div>
      </header>

      {/* ================= MAIN VIEW CONTAINER ================= */}
      <main className="flex-1 relative overflow-hidden bg-gray-50 flex flex-col">
        {/* ================= TAB 1: ALL TOOLS (HOME) ================= */}
        {activeTab === 'home' && (
          <section className="flex flex-col h-full overflow-y-auto p-4 pb-24">
            <div className="w-full max-w-6xl mx-auto">
              {/* Acrobat Hero Feature Highlights */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div
                  onClick={() => setActiveTab('convert')}
                  className="bg-gradient-to-br from-neutral-900 to-neutral-800 text-white p-4 rounded-2xl shadow border border-neutral-700/60 cursor-pointer hover:border-yellow-500/50 transition flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-9 h-9 rounded-xl bg-yellow-400/20 text-yellow-400 flex items-center justify-center font-black text-base">
                      ⇄
                    </span>
                    <span className="text-[11px] text-yellow-300 font-semibold">
                      Acrobat Hub
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-white">Convert</h3>
                    <p className="text-xs text-gray-300 mt-0.5 leading-tight">
                      Word, Excel, Images ↔ PDF
                    </p>
                  </div>
                </div>

                <div
                  onClick={() => setActiveTab('esign')}
                  className="bg-gradient-to-br from-red-950 via-neutral-900 to-neutral-900 text-white p-4 rounded-2xl shadow border border-acrobat-red/40 cursor-pointer hover:border-acrobat-red transition flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-9 h-9 rounded-xl bg-acrobat-red/20 text-acrobat-red flex items-center justify-center font-black text-base">
                      ✍️
                    </span>
                    <span className="text-[11px] text-red-300 font-semibold">Fill & Sign</span>
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-white">
                      E-Sign & Seal
                    </h3>
                    <p className="text-xs text-gray-300 mt-0.5 leading-tight">
                      Draw, Type & CSC Seal
                    </p>
                  </div>
                </div>
              </div>

              {/* Official THAWMTE TEC CSC Certified Center Banner */}
              <div className="bg-gradient-to-r from-blue-950 via-neutral-900 to-neutral-900 border border-blue-900/50 p-3.5 rounded-2xl shadow-md mb-4 flex items-center justify-between text-white">
                <div className="flex items-center space-x-3">
                  <div
                    onClick={() => setIsAboutOpen(true)}
                    className="w-12 h-12 rounded-full bg-white p-0.5 shadow-md flex items-center justify-center cursor-pointer border-2 border-blue-700 shrink-0 hover:scale-105 transition"
                  >
                    <ThawmteEmblem />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-xs sm:text-sm font-black tracking-wide text-white">
                        THAWMTE TEC
                      </h3>
                      <span className="text-[10px] text-emerald-400 font-bold">
                        · CSC OFFICIAL
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-300 font-medium">
                      Hmuia Veng, Tetea Road, Lamka
                    </p>
                    <p className="text-[11px] text-emerald-400 font-semibold flex items-center space-x-1.5">
                      <span>9612887396</span>
                      <span className="text-gray-500">·</span>
                      <span className="text-gray-300">Authorized Digital Centre</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
                  <a
                    href="/APK_DOWNLOAD/app-debug.apk"
                    download="app-debug.apk"
                    className="touch-target px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[11px] font-bold transition shadow text-center whitespace-nowrap flex items-center justify-center"
                  >
                    Download APK
                  </a>
                  <button
                    onClick={() => setIsAboutOpen(true)}
                    className="touch-target px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-xl text-[11px] font-bold transition shadow text-center whitespace-nowrap"
                  >
                    Shop Info
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('esign');
                      setTimeout(() => placeOfficialCscSealStamp(), 80);
                    }}
                    className="touch-target px-3 py-1.5 bg-white/10 hover:bg-white/20 text-yellow-300 border border-yellow-400/30 rounded-xl text-[11px] font-bold transition text-center whitespace-nowrap"
                  >
                    Stamp Seal
                  </button>
                </div>
              </div>

              {/* Quick Sample Document Banner */}
              <div className="bg-white border border-gray-200 p-3.5 rounded-2xl shadow-sm mb-5 flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-xl bg-red-50 text-acrobat-red flex items-center justify-center font-bold text-xs">
                    PDF
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm font-bold text-gray-800">
                      Test with Sample Document
                    </p>
                    <p className="text-[11px] text-gray-500">
                      Instantly test reading, signing, Word & Excel table conversion
                    </p>
                  </div>
                </div>
                <button
                  onClick={loadSampleDocument}
                  className="touch-target bg-acrobat-red hover:bg-acrobat-darkRed text-white px-3.5 py-2 rounded-xl text-xs font-bold transition shadow whitespace-nowrap"
                >
                  Load Sample
                </button>
              </div>

              {/* Category: Convert & Sign */}
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2.5 px-1">
                Convert & Sign
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <button
                  onClick={() => {
                    setConvertTab('pdfToWord');
                    setActiveTab('convert');
                  }}
                  className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition group"
                >
                  <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mb-2 group-hover:scale-105 transition">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-gray-800">PDF to Word</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">Editable .docx</span>
                </button>

                <button
                  onClick={() => {
                    setConvertTab('pdfToExcel');
                    setActiveTab('convert');
                  }}
                  className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition group"
                >
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-2 group-hover:scale-105 transition">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-gray-800">PDF to Excel</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">Tables & .xlsx</span>
                </button>

                <button
                  onClick={() => setActiveTab('convert')}
                  className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition group"
                >
                  <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-2 group-hover:scale-105 transition">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-gray-800">Convert Studio</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">Images, TXT & PDF</span>
                </button>

                <button
                  onClick={() => setActiveTab('esign')}
                  className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition group"
                >
                  <div className="w-11 h-11 rounded-xl bg-red-50 text-acrobat-red flex items-center justify-center mb-2 group-hover:scale-105 transition">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-gray-800">Fill & E-Sign</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">Sign, Stamp & Date</span>
                </button>

                <button
                  onClick={() => setActiveTab('reader')}
                  className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition group"
                >
                  <div className="w-11 h-11 rounded-xl bg-blue-50 text-acrobat-blue flex items-center justify-center mb-2 group-hover:scale-105 transition">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-gray-800">01. PDF Reader</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">View & Navigate</span>
                </button>

                <button
                  onClick={() => {
                    setScannerMode('document');
                    setActiveTab('scanner');
                  }}
                  className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition group"
                >
                  <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-2 group-hover:scale-105 transition">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-gray-800">17. Doc Scanner</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">Camera Scan to PDF</span>
                </button>

                <button
                  onClick={() => {
                    setScannerMode('idcard');
                    setActiveTab('scanner');
                  }}
                  className="bg-white p-3.5 rounded-xl border border-blue-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition group ring-1 ring-blue-500/20"
                >
                  <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mb-2 group-hover:scale-105 transition">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-blue-900">ID Card Scanner</span>
                  <span className="text-[10px] text-blue-600 font-semibold mt-0.5">
                    Front & Back (2-in-1)
                  </span>
                </button>
              </div>

              {/* Category: Document Management Tools */}
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2.5 px-1">
                Organize & Security
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <button
                  onClick={() => setActiveTool('merge')}
                  className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition"
                >
                  <span className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm mb-1.5">
                    ⧉
                  </span>
                  <span className="text-xs font-semibold text-gray-800">03. Merge PDF</span>
                  <span className="text-[10px] text-gray-400">Combine Multiple</span>
                </button>

                <button
                  onClick={() => setActiveTool('split')}
                  className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition"
                >
                  <span className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm mb-1.5">
                    ✂
                  </span>
                  <span className="text-xs font-semibold text-gray-800">04. Split PDF</span>
                  <span className="text-[10px] text-gray-400">By Range</span>
                </button>

                <button
                  onClick={() => setActiveTool('compress')}
                  className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition"
                >
                  <span className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm mb-1.5">
                    ▼
                  </span>
                  <span className="text-xs font-semibold text-gray-800">05. Compress</span>
                  <span className="text-[10px] text-gray-400">Reduce Size</span>
                </button>

                <button
                  onClick={() => setActiveTool('rotate')}
                  className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition"
                >
                  <span className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm mb-1.5">
                    ↻
                  </span>
                  <span className="text-xs font-semibold text-gray-800">09. Rotate PDF</span>
                  <span className="text-[10px] text-gray-400">90° / 180° / 270°</span>
                </button>

                <button
                  onClick={() => setActiveTool('protect')}
                  className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition"
                >
                  <span className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm mb-1.5">
                    🔒
                  </span>
                  <span className="text-xs font-semibold text-gray-800">10. Protect</span>
                  <span className="text-[10px] text-gray-400">Password Lock</span>
                </button>

                <button
                  onClick={() => setActiveTool('unlock')}
                  className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition"
                >
                  <span className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm mb-1.5">
                    🔓
                  </span>
                  <span className="text-xs font-semibold text-gray-800">11. Unlock</span>
                  <span className="text-[10px] text-gray-400">Remove Lock</span>
                </button>

                <button
                  onClick={() => setActiveTool('organise')}
                  className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition"
                >
                  <span className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm mb-1.5">
                    ▦
                  </span>
                  <span className="text-xs font-semibold text-gray-800">12-14. Organise</span>
                  <span className="text-[10px] text-gray-400">Delete & Reorder</span>
                </button>

                <button
                  onClick={() => {
                    if (!pdfJsDoc) {
                      showToast('Please open a PDF document first', 'error');
                      return;
                    }
                    setIsSearchOpen(true);
                  }}
                  className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:shadow-md flex flex-col items-center text-center transition"
                >
                  <span className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-sm mb-1.5">
                    🔍
                  </span>
                  <span className="text-xs font-semibold text-gray-800">19. Search PDF</span>
                  <span className="text-[10px] text-gray-400">Full Text Index</span>
                </button>
              </div>

              {/* Quick Recent Files preview on Home */}
              <div className="flex items-center justify-between mb-2.5 px-1">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  18. Recent Documents
                </h3>
                <button
                  onClick={() => setActiveTab('recents')}
                  className="text-xs font-bold text-acrobat-red hover:underline"
                >
                  View All
                </button>
              </div>
              <div className="space-y-2 mb-4">
                {recents.length === 0 ? (
                  <div className="text-center py-3 text-gray-400 text-xs bg-white rounded-xl border border-gray-200">
                    No documents processed yet.
                  </div>
                ) : (
                  recents.slice(0, 3).map((item, idx) => (
                    <div
                      key={`${item.name}-${idx}`}
                      className="bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <span className="text-xs font-bold text-acrobat-red">PDF</span>
                        <span className="text-xs font-semibold text-gray-800 truncate">
                          {item.name}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-500 font-mono tabular-nums">
                        {item.size}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {/* ================= TAB 2: CONVERT HUB ================= */}
        {activeTab === 'convert' && (
          <section className="flex flex-col h-full overflow-hidden bg-gray-50">
            <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between shrink-0 shadow-sm">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center text-white font-black text-xs">
                  ⇄
                </div>
                <div>
                  <h2 className="text-xs font-extrabold text-gray-900 uppercase tracking-wide">
                    Acrobat Convert Hub
                  </h2>
                  <p className="text-[10px] text-gray-500">
                    Instant offline document conversion suite
                  </p>
                </div>
              </div>
            </div>

            {/* Convert Navigation Tabs */}
            <div className="bg-gray-100 px-3 py-2 border-b border-gray-200 flex space-x-2 overflow-x-auto shrink-0">
              {(
                [
                  { id: 'pdfToWord', label: 'PDF ➔ Word (.docx)' },
                  { id: 'pdfToExcel', label: 'PDF ➔ Excel (.xlsx)' },
                  { id: 'imgToPdf', label: 'Images ➔ PDF' },
                  { id: 'pdfToImg', label: 'PDF ➔ Images' },
                  { id: 'pdfToTxt', label: 'PDF ➔ Text (.txt)' },
                  { id: 'txtToPdf', label: 'Text ➔ PDF' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setConvertTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition ${
                    convertTab === tab.id
                      ? 'font-bold bg-white text-gray-900 shadow-sm'
                      : 'font-semibold text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-24">
              <div className="w-full max-w-4xl mx-auto">
                {/* SUB-PANEL: PDF to Word */}
                {convertTab === 'pdfToWord' && (
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2.5">
                        <span className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs">
                          DOC
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-gray-800">
                            Convert PDF to Word (.docx)
                          </h3>
                          <p className="text-[11px] text-gray-500">
                            Extracts structure, headings, and paragraphs into editable Word
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] text-blue-700 font-bold">Word 365</span>
                    </div>

                    <label className="block border-2 border-dashed border-gray-300 rounded-xl p-3.5 bg-gray-50 text-center cursor-pointer hover:border-blue-600 hover:bg-blue-50/30 transition mb-3">
                      <svg
                        className="w-7 h-7 text-blue-700 mx-auto mb-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <span className="text-xs font-bold text-gray-800">
                        Choose PDF Document
                      </span>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {convertWordFile
                          ? `Selected: ${convertWordFile.name} (${formatFileSize(
                              convertWordFile.size
                            )})`
                          : activeFile
                          ? `Ready to process active PDF: ${activeFile.name}`
                          : 'Or automatically processes current active PDF'}
                      </p>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => setConvertWordFile(e.target.files?.[0] || null)}
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">
                          Layout Mode:
                        </label>
                        <select
                          value={wordLayoutMode}
                          onChange={(e) => setWordLayoutMode(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 outline-none bg-white"
                        >
                          <option value="smart">Smart Headings & Paragraphs</option>
                          <option value="exact">Exact Line-by-Line Flow</option>
                          <option value="raw">Raw Paragraph Stream</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">
                          Target Format:
                        </label>
                        <select
                          value={wordTargetFormat}
                          onChange={(e) =>
                            setWordTargetFormat(e.target.value as 'docx' | 'doc')
                          }
                          className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 outline-none bg-white"
                        >
                          <option value="docx">Microsoft Word (.docx)</option>
                          <option value="doc">Word 97-2003 Compatible (.doc)</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={executePdfToWord}
                      className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow transition flex items-center justify-center space-x-1.5"
                    >
                      <span>Analyze & Generate Word Document</span>
                    </button>

                    <div className="mt-4 pt-3 border-t border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-700">
                          Live Document Preview & Editor:
                        </span>
                        <span className="text-[10px] text-gray-400">
                          Click to edit text directly before saving
                        </span>
                      </div>
                      <div
                        ref={wordLivePreviewRef}
                        contentEditable
                        suppressContentEditableWarning
                        className="w-full min-h-[140px] max-h-64 overflow-y-auto bg-gray-50 border border-gray-300 rounded-xl p-3 text-xs text-gray-800 leading-relaxed outline-none focus:bg-white focus:ring-1 focus:ring-blue-600 shadow-inner font-sans select-text"
                      >
                        <p className="text-gray-400 italic text-center py-6">
                          Select a PDF above and tap &quot;Analyze &amp; Generate Word
                          Document&quot; to preview and export here.
                        </p>
                      </div>

                      <div className="flex items-center space-x-2 mt-3">
                        <button
                          onClick={() => downloadLiveWordDocument('docx')}
                          className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow transition"
                        >
                          Download .docx
                        </button>
                        <button
                          onClick={() => downloadLiveWordDocument('doc')}
                          className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition"
                        >
                          Download .doc
                        </button>
                        <button
                          onClick={copyWordLiveText}
                          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* SUB-PANEL: PDF to Excel */}
                {convertTab === 'pdfToExcel' && (
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2.5">
                        <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-xs">
                          XLS
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-gray-800">
                            Convert PDF to Excel (.xlsx / .csv)
                          </h3>
                          <p className="text-[11px] text-gray-500">
                            Detects columns, tabular figures, invoices, and financial data
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] text-emerald-700 font-bold">SheetJS</span>
                    </div>

                    <label className="block border-2 border-dashed border-gray-300 rounded-xl p-3.5 bg-gray-50 text-center cursor-pointer hover:border-emerald-600 hover:bg-emerald-50/30 transition mb-3">
                      <svg
                        className="w-7 h-7 text-emerald-700 mx-auto mb-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <span className="text-xs font-bold text-gray-800">
                        Choose PDF Document
                      </span>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {convertExcelFile
                          ? `Selected: ${convertExcelFile.name} (${formatFileSize(
                              convertExcelFile.size
                            )})`
                          : activeFile
                          ? `Ready to process active PDF: ${activeFile.name}`
                          : 'Or automatically processes current active PDF'}
                      </p>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => setConvertExcelFile(e.target.files?.[0] || null)}
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">
                          Table Detection:
                        </label>
                        <select
                          value={excelSensitivity}
                          onChange={(e) => setExcelSensitivity(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 outline-none bg-white"
                        >
                          <option value="adaptive">Smart Coordinate Grid (Recommended)</option>
                          <option value="spacing">Multi-Space / Column Bins</option>
                          <option value="compact">Tight Number Columns</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">
                          Sheet Allocation:
                        </label>
                        <select
                          value={excelPageMode}
                          onChange={(e) => setExcelPageMode(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 outline-none bg-white"
                        >
                          <option value="consolidated">Single Consolidated Sheet</option>
                          <option value="persheet">Page-by-Page Tabs</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={executePdfToExcel}
                      className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow transition flex items-center justify-center space-x-1.5"
                    >
                      <span>Analyze & Extract Tables</span>
                    </button>

                    <div className="mt-4 pt-3 border-t border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-700">
                          Parsed Spreadsheet Grid:
                        </span>
                        <span className="text-[11px] text-gray-500 font-mono tabular-nums">
                          {activeExcelGrid.length} rows · {maxExcelCols} columns
                        </span>
                      </div>

                      <div className="w-full overflow-x-auto border border-gray-300 rounded-xl max-h-60 bg-white">
                        <table
                          ref={excelTableRef}
                          className="min-w-full divide-y divide-gray-200 text-xs font-mono tabular-nums"
                        >
                          <thead className="bg-gray-100 text-gray-600 font-bold sticky top-0">
                            <tr>
                              <th className="px-2 py-1.5 text-center w-8 bg-gray-200">#</th>
                              {Array.from({ length: maxExcelCols }).map((_, c) => (
                                <th
                                  key={c}
                                  className="px-3 py-1.5 text-left border-l border-gray-200"
                                >
                                  {String.fromCharCode(65 + (c % 26))}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-gray-700">
                            {activeExcelGrid.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={maxExcelCols + 1}
                                  className="px-3 py-6 text-center text-gray-400 italic font-sans"
                                >
                                  No table parsed yet. Load a PDF and tap &quot;Analyze &amp;
                                  Extract Tables&quot;.
                                </td>
                              </tr>
                            ) : (
                              activeExcelGrid.slice(0, 50).map((row, rIdx) => (
                                <tr key={rIdx} className="hover:bg-blue-50/50">
                                  <td className="px-2 py-1 text-[10px] text-center font-bold text-gray-400 bg-gray-50 border-r border-gray-200">
                                    {rIdx + 1}
                                  </td>
                                  {Array.from({ length: maxExcelCols }).map((_, c) => (
                                    <td
                                      key={c}
                                      contentEditable
                                      suppressContentEditableWarning
                                      className="px-3 py-1.5 outline-none focus:bg-white focus:ring-1 focus:ring-emerald-500 whitespace-nowrap overflow-hidden text-ellipsis max-w-[180px] select-text"
                                    >
                                      {row[c] !== undefined ? row[c] : ''}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex items-center space-x-2 mt-3">
                        <button
                          onClick={() => downloadLiveExcelWorkbook('xlsx')}
                          className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow transition"
                        >
                          Download .xlsx
                        </button>
                        <button
                          onClick={() => downloadLiveExcelWorkbook('csv')}
                          className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition"
                        >
                          Download .csv
                        </button>
                        <button
                          onClick={copyExcelTableTsv}
                          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition"
                        >
                          Copy TSV
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* SUB-PANEL: Images to PDF */}
                {convertTab === 'imgToPdf' && (
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center space-x-2.5 mb-3">
                      <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-black text-xs">
                        IMG
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">
                          Convert Images to PDF
                        </h3>
                        <p className="text-[11px] text-gray-500">
                          Combine JPG, PNG, or WebP images into a single PDF
                        </p>
                      </div>
                    </div>

                    <label className="block border-2 border-dashed border-gray-300 rounded-xl p-3.5 bg-gray-50 text-center cursor-pointer hover:border-amber-500 hover:bg-amber-50/30 transition mb-3">
                      <span className="text-xs font-bold text-gray-800">Select Images</span>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Select multiple photos or scans
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleConvertImageSelection}
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">
                          Page Orientation:
                        </label>
                        <select
                          value={imgOrientation}
                          onChange={(e) => setImgOrientation(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 outline-none bg-white"
                        >
                          <option value="portrait">A4 Portrait</option>
                          <option value="landscape">A4 Landscape</option>
                          <option value="fit">Fit to Image Size</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">
                          Page Margins:
                        </label>
                        <select
                          value={imgMargin}
                          onChange={(e) => setImgMargin(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 outline-none bg-white"
                        >
                          <option value="0">No Margins (Full Bleed)</option>
                          <option value="20">Small (20 pt)</option>
                          <option value="36">Standard (36 pt)</option>
                        </select>
                      </div>
                    </div>

                    {selectedImages.length > 0 && (
                      <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
                        {selectedImages.map((img, idx) => (
                          <div
                            key={idx}
                            className="p-2 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center space-x-2 truncate">
                              <img
                                src={img.dataUrl}
                                alt={img.name}
                                className="w-8 h-8 rounded object-cover border border-gray-200"
                              />
                              <span className="font-semibold text-gray-800 truncate">
                                {idx + 1}. {img.name}
                              </span>
                            </div>
                            <span className="text-[10px] text-gray-400 font-mono tabular-nums">
                              {img.size}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={executeImagesToPdf}
                      className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow transition"
                    >
                      Convert Images to PDF
                    </button>
                  </div>
                )}

                {/* SUB-PANEL: PDF to Images */}
                {convertTab === 'pdfToImg' && (
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center space-x-2.5 mb-3">
                      <span className="w-8 h-8 rounded-xl bg-red-100 text-acrobat-red flex items-center justify-center font-black text-xs">
                        JPG
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">
                          Convert PDF to Images
                        </h3>
                        <p className="text-[11px] text-gray-500">
                          Extract every page as a high-resolution JPG or PNG
                        </p>
                      </div>
                    </div>

                    <label className="block border-2 border-dashed border-gray-300 rounded-xl p-3.5 bg-gray-50 text-center cursor-pointer hover:border-acrobat-red hover:bg-red-50/30 transition mb-3">
                      <span className="text-xs font-bold text-gray-800">
                        Choose PDF Document
                      </span>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {convertPdfToImgFile
                          ? `Selected: ${convertPdfToImgFile.name}`
                          : activeFile
                          ? `Ready to extract active PDF: ${activeFile.name}`
                          : 'Or processes active PDF'}
                      </p>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => setConvertPdfToImgFile(e.target.files?.[0] || null)}
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">
                          Image Quality:
                        </label>
                        <select
                          value={pdfImgScale}
                          onChange={(e) => setPdfImgScale(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 outline-none bg-white"
                        >
                          <option value="1.5">Standard HD (1.5x)</option>
                          <option value="2.0">Ultra High Resolution (2.0x)</option>
                          <option value="1.0">Compact Size (1.0x)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">
                          Image Format:
                        </label>
                        <select
                          value={pdfImgFormat}
                          onChange={(e) =>
                            setPdfImgFormat(e.target.value as 'image/jpeg' | 'image/png')
                          }
                          className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 outline-none bg-white"
                        >
                          <option value="image/jpeg">JPEG (.jpg)</option>
                          <option value="image/png">PNG (.png)</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={executePdfToImages}
                      className="w-full py-2.5 bg-acrobat-red hover:bg-acrobat-darkRed text-white rounded-xl text-xs font-bold shadow transition mb-3"
                    >
                      Render & Extract Images
                    </button>

                    {extractedPageImages.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-72 overflow-y-auto pt-2 border-t border-gray-200">
                        {extractedPageImages.map((item) => (
                          <div
                            key={item.page}
                            className="p-2 border border-gray-200 rounded-xl bg-gray-50 flex flex-col items-center"
                          >
                            <img
                              src={item.dataUrl}
                              alt={`Page ${item.page}`}
                              className="w-full h-32 object-contain bg-white rounded border border-gray-200 mb-2"
                            />
                            <a
                              href={item.dataUrl}
                              download={`PAGE_${item.page}.${item.ext}`}
                              className="w-full py-1.5 bg-acrobat-slate text-white rounded-lg text-[11px] font-bold text-center"
                            >
                              Save Page {item.page}
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* SUB-PANEL: PDF to Text */}
                {convertTab === 'pdfToTxt' && (
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center space-x-2.5 mb-3">
                      <span className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs">
                        TXT
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">
                          Convert PDF to Text (.txt)
                        </h3>
                        <p className="text-[11px] text-gray-500">
                          Extract clean readable text from document streams
                        </p>
                      </div>
                    </div>

                    <label className="block border-2 border-dashed border-gray-300 rounded-xl p-3.5 bg-gray-50 text-center cursor-pointer hover:border-purple-600 hover:bg-purple-50/30 transition mb-3">
                      <span className="text-xs font-bold text-gray-800">
                        Choose PDF Document
                      </span>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {convertPdfToTxtFile
                          ? `Selected: ${convertPdfToTxtFile.name}`
                          : activeFile
                          ? `Ready to extract active PDF: ${activeFile.name}`
                          : 'Or uses active PDF'}
                      </p>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => setConvertPdfToTxtFile(e.target.files?.[0] || null)}
                      />
                    </label>

                    <button
                      onClick={executePdfToTxt}
                      className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold shadow transition mb-3"
                    >
                      Extract Text Content
                    </button>

                    <textarea
                      value={extractedTextContent}
                      onChange={(e) => setExtractedTextContent(e.target.value)}
                      placeholder="Extracted text will appear here..."
                      className="w-full h-40 border border-gray-300 rounded-xl p-2.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-purple-600 resize-none font-mono select-text"
                    />

                    <div className="flex items-center space-x-2 mt-2">
                      <button
                        onClick={() => {
                          if (!extractedTextContent)
                            return showToast('No text to copy', 'error');
                          navigator.clipboard.writeText(extractedTextContent);
                          showToast('Copied text to clipboard!', 'success');
                        }}
                        className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition"
                      >
                        Copy Text
                      </button>
                      <button
                        onClick={downloadExtractedText}
                        className="flex-1 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold shadow transition"
                      >
                        Save .txt
                      </button>
                    </div>
                  </div>
                )}

                {/* SUB-PANEL: Text to PDF */}
                {convertTab === 'txtToPdf' && (
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center space-x-2.5 mb-3">
                      <span className="w-8 h-8 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center font-black text-xs">
                        PDF
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">
                          Convert Text to PDF
                        </h3>
                        <p className="text-[11px] text-gray-500">
                          Compile notes or letters into an official PDF document
                        </p>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={txtToPdfTitle}
                      onChange={(e) => setTxtToPdfTitle(e.target.value)}
                      placeholder="Document Title / Subject"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-teal-600 mb-2 font-bold select-text"
                    />
                    <textarea
                      value={txtToPdfBody}
                      onChange={(e) => setTxtToPdfBody(e.target.value)}
                      placeholder="Enter or paste your text notes here..."
                      className="w-full h-40 border border-gray-300 rounded-xl p-2.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-teal-600 resize-none mb-3 select-text"
                    />

                    <button
                      onClick={executeTxtToPdf}
                      className="w-full py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow transition"
                    >
                      Compile into PDF Document
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ================= TAB 3: E-SIGN STUDIO ================= */}
        {activeTab === 'esign' && (
          <section className="flex flex-col h-full overflow-hidden bg-gray-50">
            {/* Studio Header Controls */}
            <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center justify-between shadow-sm z-20 shrink-0">
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setEsignPage((p) => Math.max(1, p - 1))}
                  className="touch-target p-1.5 text-gray-600 hover:text-acrobat-red hover:bg-gray-100 rounded-lg flex items-center justify-center"
                  title="Previous Page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-xs font-bold text-gray-700 font-mono tabular-nums">
                  Page <span className="text-acrobat-red">{esignPage}</span> of{' '}
                  <span>{totalPages || 1}</span>
                </span>
                <button
                  onClick={() => setEsignPage((p) => Math.min(totalPages || 1, p + 1))}
                  className="touch-target p-1.5 text-gray-600 hover:text-acrobat-red hover:bg-gray-100 rounded-lg flex items-center justify-center"
                  title="Next Page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={clearEsignStampsOnCurrentPage}
                  className="touch-target px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition whitespace-nowrap"
                >
                  Clear Stamps
                </button>
                <button
                  onClick={finishAndBakeEsignPdf}
                  className="touch-target px-3.5 py-1.5 bg-acrobat-red hover:bg-acrobat-darkRed text-white rounded-xl text-xs font-bold shadow transition flex items-center space-x-1 whitespace-nowrap"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Finish & Sign</span>
                </button>
              </div>
            </div>

            {/* Adobe Acrobat Fill & Sign Tools Palette Strip */}
            <div className="bg-white text-gray-800 px-2 py-1.5 border-b border-gray-200 flex items-center justify-around space-x-1 overflow-x-auto shrink-0 shadow-sm">
              <button
                onClick={placeOfficialCscSealStamp}
                className="flex flex-col items-center p-1.5 rounded-lg hover:bg-blue-50 text-blue-900 transition shrink-0 min-w-[58px]"
                title="Stamp Official THAWMTE TEC CSC Seal"
              >
                <div className="w-5 h-5 rounded-full overflow-hidden border border-blue-900 bg-white p-0.5 flex items-center justify-center">
                  <ThawmteEmblem />
                </div>
                <span className="text-[10px] font-bold text-blue-900 mt-0.5">CSC Seal</span>
              </button>

              <button
                onClick={() => {
                  if (!pdfJsDoc) {
                    showToast('Please open or load a document first', 'error');
                    return;
                  }
                  setIsSigModalOpen(true);
                }}
                className="flex flex-col items-center p-1.5 rounded-lg hover:bg-red-50 text-acrobat-red transition shrink-0 min-w-[54px]"
              >
                <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
                <span className="text-[10px] font-bold">Signature</span>
              </button>

              <button
                onClick={() => {
                  if (!pdfJsDoc) {
                    showToast('Please open or load a document first', 'error');
                    return;
                  }
                  setTextPromptMode('initials');
                }}
                className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-100 text-gray-700 transition shrink-0 min-w-[50px]"
              >
                <span className="font-extrabold text-sm mb-0.5">TT</span>
                <span className="text-[10px] font-semibold">Initials</span>
              </button>

              <button
                onClick={() => {
                  if (!pdfJsDoc) {
                    showToast('Please open or load a document first', 'error');
                    return;
                  }
                  setTextPromptMode('name');
                }}
                className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-100 text-gray-700 transition shrink-0 min-w-[50px]"
              >
                <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                <span className="text-[10px] font-semibold">Name</span>
              </button>

              <button
                onClick={placeDateStamp}
                className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-100 text-gray-700 transition shrink-0 min-w-[50px]"
              >
                <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <span className="text-[10px] font-semibold">Date</span>
              </button>

              <button
                onClick={() => placeMarkStamp('✓')}
                className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-100 text-emerald-600 transition shrink-0 min-w-[45px]"
              >
                <span className="text-base font-black leading-none mb-1">✓</span>
                <span className="text-[10px] font-semibold">Check</span>
              </button>

              <button
                onClick={() => placeMarkStamp('✕')}
                className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-100 text-acrobat-red transition shrink-0 min-w-[45px]"
              >
                <span className="text-base font-black leading-none mb-1">✕</span>
                <span className="text-[10px] font-semibold">Cross</span>
              </button>
            </div>

            {/* Studio Canvas Viewport */}
            <div
              onClick={() => setSelectedStampId(null)}
              className="flex-1 overflow-auto p-4 pb-24 flex items-start justify-center relative bg-neutral-800"
            >
              <div ref={esignPageWrapperRef} className="relative bg-white shadow-2xl">
                <canvas ref={esignCanvasRef} />
                <div className="absolute inset-0 pointer-events-auto">
                  {(esignStamps[esignPage] || []).map((st) => (
                    <div
                      key={st.id}
                      onMouseDown={(e) => startStampInteraction(e, st, 'move')}
                      onTouchStart={(e) => startStampInteraction(e, st, 'move')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedStampId(st.id);
                      }}
                      style={{
                        left: `${st.x}px`,
                        top: `${st.y}px`,
                        width: `${st.width}px`,
                        height: `${st.height}px`,
                      }}
                      className={`placed-stamp ${selectedStampId === st.id ? 'selected' : ''}`}
                    >
                      <img
                        src={st.dataUrl}
                        alt={st.type}
                        draggable={false}
                        className="w-full h-full object-contain pointer-events-none"
                      />
                      {selectedStampId === st.id && (
                        <>
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeStamp(st.id);
                            }}
                            className="stamp-del-btn"
                            title="Remove Stamp"
                          >
                            ×
                          </button>
                          <div
                            onMouseDown={(e) => startStampInteraction(e, st, 'resize')}
                            onTouchStart={(e) => startStampInteraction(e, st, 'resize')}
                            className="resize-handle"
                            title="Drag to Resize"
                          />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {!pdfJsDoc && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white bg-neutral-900 z-10">
                  <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mb-3">
                    <svg
                      className="w-8 h-8 text-acrobat-red"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-base font-bold">Document Required for E-Sign</h3>
                  <p className="text-xs text-gray-400 mt-1 max-w-xs mb-4">
                    Choose a PDF from your device or load the certified sample document to
                    begin signing.
                  </p>
                  <div className="flex items-center space-x-3">
                    <label className="touch-target px-4 py-2 bg-acrobat-red text-white text-xs font-bold rounded-xl cursor-pointer hover:bg-acrobat-darkRed shadow transition flex items-center">
                      <span>Choose PDF</span>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={handleGlobalPdfUpload}
                      />
                    </label>
                    <button
                      onClick={loadSampleDocument}
                      className="touch-target px-4 py-2 bg-neutral-800 border border-neutral-700 text-white text-xs font-bold rounded-xl hover:bg-neutral-700 transition"
                    >
                      Load Sample PDF
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ================= TAB 4: PDF READER ================= */}
        {activeTab === 'reader' && (
          <section className="flex flex-col h-full overflow-hidden">
            <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center justify-between shadow-sm z-20 shrink-0">
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => {
                    const next = Math.max(1, readerPage - 1);
                    setReaderPage(next);
                    setReaderPageInputVal(String(next));
                  }}
                  className="touch-target p-1.5 text-gray-600 hover:text-acrobat-red hover:bg-gray-100 rounded-lg flex items-center justify-center"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="flex items-center space-x-1 text-xs font-semibold font-mono tabular-nums">
                  <input
                    type="number"
                    value={readerPageInputVal}
                    min={1}
                    max={totalPages || 1}
                    onChange={(e) => {
                      setReaderPageInputVal(e.target.value);
                      const p = parseInt(e.target.value, 10);
                      if (p >= 1 && p <= totalPages) setReaderPage(p);
                    }}
                    className="w-12 text-center border border-gray-300 rounded py-1 text-xs focus:ring-1 focus:ring-acrobat-red outline-none select-text"
                  />
                  <span className="text-gray-400">/</span>
                  <span className="text-gray-600">{totalPages}</span>
                </div>
                <button
                  onClick={() => {
                    const next = Math.min(totalPages || 1, readerPage + 1);
                    setReaderPage(next);
                    setReaderPageInputVal(String(next));
                  }}
                  className="touch-target p-1.5 text-gray-600 hover:text-acrobat-red hover:bg-gray-100 rounded-lg flex items-center justify-center"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() =>
                    setReaderScale((s) => Math.max(0.4, Number((s - 0.15).toFixed(2))))
                  }
                  className="touch-target p-1.5 text-gray-600 hover:text-acrobat-red hover:bg-gray-100 rounded-lg flex items-center justify-center"
                  title="Zoom Out"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                <span className="text-xs font-medium text-gray-600 w-12 text-center font-mono tabular-nums">
                  {Math.round(readerScale * 100)}%
                </span>
                <button
                  onClick={() =>
                    setReaderScale((s) => Math.min(3.0, Number((s + 0.15).toFixed(2))))
                  }
                  className="touch-target p-1.5 text-gray-600 hover:text-acrobat-red hover:bg-gray-100 rounded-lg flex items-center justify-center"
                  title="Zoom In"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button
                  onClick={fitReaderWidth}
                  className="touch-target px-2.5 py-1 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg ml-1"
                >
                  Fit
                </button>
              </div>
            </div>

            <div
              ref={readerViewportRef}
              className="flex-1 overflow-auto bg-neutral-800 p-4 pb-24 flex items-start justify-center relative"
            >
              {pdfJsDoc ? (
                <div className="shadow-2xl bg-white relative">
                  <canvas ref={readerCanvasRef} />
                </div>
              ) : (
                <div className="my-auto text-center text-white p-6">
                  <p className="text-sm font-bold mb-2">No PDF Document Loaded</p>
                  <p className="text-xs text-gray-400 mb-4">
                    Open a PDF file or load the sample document to start reading.
                  </p>
                  <div className="flex items-center justify-center space-x-3">
                    <label className="touch-target px-4 py-2 bg-acrobat-red text-white text-xs font-bold rounded-xl cursor-pointer hover:bg-acrobat-darkRed shadow transition flex items-center">
                      <span>Open PDF</span>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={handleGlobalPdfUpload}
                      />
                    </label>
                    <button
                      onClick={loadSampleDocument}
                      className="touch-target px-4 py-2 bg-neutral-700 text-white text-xs font-bold rounded-xl hover:bg-neutral-600 transition"
                    >
                      Load Sample
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ================= TAB 5: DOCUMENT & ID CARD SCANNER ================= */}
        {activeTab === 'scanner' && (
          <section className="flex flex-col h-full overflow-hidden bg-black text-white relative">
            <div className="bg-neutral-900/90 backdrop-blur-sm border-b border-neutral-800 px-3 py-2 flex items-center justify-between z-20 shrink-0">
              <div className="grid grid-cols-2 bg-neutral-800 p-1 rounded-xl text-xs font-bold max-w-xs">
                <button
                  onClick={() => setScannerMode('document')}
                  className={`py-1.5 px-3 rounded-lg transition flex items-center justify-center space-x-1.5 whitespace-nowrap ${
                    scannerMode === 'document'
                      ? 'bg-acrobat-red text-white shadow'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  <span>Document</span>
                </button>
                <button
                  onClick={() => setScannerMode('idcard')}
                  className={`py-1.5 px-3 rounded-lg transition flex items-center justify-center space-x-1.5 whitespace-nowrap ${
                    scannerMode === 'idcard'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  <span>ID Card (2-in-1)</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setAutoEdgeDetection((v) => !v);
                  showToast(
                    `Auto Edge Detection: ${!autoEdgeDetection ? 'ON' : 'OFF'}`,
                    'info'
                  );
                }}
                className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold transition shadow whitespace-nowrap ${
                  autoEdgeDetection
                    ? 'bg-emerald-950/80 border border-emerald-500/60 text-emerald-400'
                    : 'bg-neutral-800 border border-neutral-700 text-gray-400'
                }`}
              >
                <span>Auto Edge: {autoEdgeDetection ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            {/* Camera Viewfinder */}
            <div className="relative flex-1 w-full overflow-hidden flex items-center justify-center bg-black">
              <video
                ref={scannerVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas
                ref={scannerOverlayRef}
                className="absolute inset-0 w-full h-full pointer-events-none z-10"
              />

              {autoEdgeDetection && (
                <div className="absolute top-3 inset-x-0 mx-auto w-fit z-20 bg-black/70 backdrop-blur-sm border border-emerald-500/50 text-emerald-400 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-lg">
                  {scannerMode === 'idcard'
                    ? 'ID Card Auto-Edge Active'
                    : 'Document Auto-Edge Active'}
                </div>
              )}

              {scannerMode === 'document' ? (
                <div className="absolute inset-x-8 inset-y-8 border-2 border-acrobat-red/80 rounded-2xl pointer-events-none scanner-guide flex flex-col justify-between p-4 max-w-lg mx-auto">
                  <div className="flex justify-between">
                    <div className="w-6 h-6 border-t-4 border-l-4 border-acrobat-red rounded-tl-lg" />
                    <div className="w-6 h-6 border-t-4 border-r-4 border-acrobat-red rounded-tr-lg" />
                  </div>
                  <p className="text-center text-xs text-white/90 bg-black/60 px-3 py-1 rounded-full mx-auto font-medium">
                    Auto-detecting document boundaries
                  </p>
                  <div className="flex justify-between">
                    <div className="w-6 h-6 border-b-4 border-l-4 border-acrobat-red rounded-bl-lg" />
                    <div className="w-6 h-6 border-b-4 border-r-4 border-acrobat-red rounded-br-lg" />
                  </div>
                </div>
              ) : (
                <div className="absolute inset-x-6 sm:inset-x-16 mx-auto max-w-sm w-full aspect-[1.586/1] border-2 border-blue-500 rounded-2xl pointer-events-none scanner-guide flex flex-col justify-between p-3.5 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="w-7 h-7 border-t-4 border-l-4 border-blue-400 rounded-tl-xl" />
                    <span className="text-[11px] font-black tracking-wider uppercase bg-blue-600 text-white px-3 py-1 rounded-full shadow">
                      ALIGN {idCardTarget.toUpperCase()} OF ID CARD
                    </span>
                    <div className="w-7 h-7 border-t-4 border-r-4 border-blue-400 rounded-tr-xl" />
                  </div>
                  <div className="text-center">
                    <div className="w-10 h-6 border border-white/30 rounded mx-auto mb-1 opacity-50 flex items-center justify-center text-[9px] font-mono">
                      CHIP
                    </div>
                    <p className="text-[11px] text-white/80 bg-black/70 px-2.5 py-0.5 rounded-full inline-block">
                      Auto edge locks card borders
                    </p>
                  </div>
                  <div className="flex justify-between">
                    <div className="w-7 h-7 border-b-4 border-l-4 border-blue-400 rounded-bl-xl" />
                    <div className="w-7 h-7 border-b-4 border-r-4 border-blue-400 rounded-br-xl" />
                  </div>
                </div>
              )}
            </div>

            {/* DOCUMENT MODE CONTROLS */}
            {scannerMode === 'document' ? (
              <div className="bg-neutral-900 border-t border-neutral-800 p-4 pb-20 z-20 flex flex-col space-y-3 shrink-0">
                <div className="flex items-center justify-center space-x-2 text-xs">
                  {(
                    [
                      { id: 'color', label: 'Color' },
                      { id: 'bw', label: 'B&W Document' },
                      { id: 'grayscale', label: 'Grayscale' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setScannerFilter(f.id)}
                      className={`px-3 py-1.5 rounded-full font-bold transition ${
                        scannerFilter === f.id
                          ? 'bg-acrobat-red text-white'
                          : 'bg-neutral-800 text-gray-300'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center space-x-2 overflow-x-auto py-1 min-h-[56px]">
                  {scannedPages.length === 0 ? (
                    <span className="text-xs text-gray-500 italic">
                      No pages scanned yet. Tap shutter or Gallery to add.
                    </span>
                  ) : (
                    scannedPages.map((url, idx) => (
                      <div
                        key={idx}
                        className="relative w-12 h-14 rounded-lg overflow-hidden border border-gray-600 shrink-0"
                      >
                        <img src={url} alt={`Scan ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() =>
                            setScannedPages((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="absolute top-0 right-0 bg-red-600 text-white w-4 h-4 text-[9px] flex items-center justify-center font-bold"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 max-w-xl mx-auto w-full">
                  <label className="touch-target text-xs text-gray-300 hover:text-white flex items-center space-x-1.5 cursor-pointer bg-neutral-800 px-3 py-2 rounded-xl">
                    <svg
                      className="w-5 h-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <span>Gallery</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleScannerGalleryUpload}
                    />
                  </label>

                  <button
                    onClick={captureScannerFrame}
                    className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center bg-acrobat-red shadow-lg active:scale-95 transition"
                    title="Capture Document Page"
                  >
                    <div className="w-12 h-12 rounded-full bg-white/20" />
                  </button>

                  <button
                    onClick={exportScannedPdf}
                    className="touch-target px-3.5 py-2 bg-white text-gray-900 rounded-xl text-xs font-bold hover:bg-gray-200 transition shadow flex items-center space-x-1"
                  >
                    <span>Finish PDF</span>
                    <span className="bg-acrobat-red text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1 font-mono tabular-nums">
                      {scannedPages.length}
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              /* ID CARD (FRONT & BACK) CONTROLS */
              <div className="bg-neutral-900 border-t border-neutral-800 p-3 sm:p-4 pb-20 z-20 flex flex-col space-y-3 shrink-0">
                <div className="grid grid-cols-2 gap-2.5 max-w-2xl mx-auto w-full">
                  {/* FRONT SLOT */}
                  <div
                    onClick={() => setIdCardTarget('front')}
                    className={`rounded-xl p-2 relative flex flex-col justify-between cursor-pointer transition ${
                      idCardTarget === 'front'
                        ? 'border-2 border-blue-500 bg-blue-950/40 ring-2 ring-blue-500/20'
                        : 'border border-neutral-700 bg-neutral-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-extrabold uppercase text-blue-400">
                        1. Front Side
                      </span>
                      <span className="text-[9px] text-blue-300 font-bold">
                        {idCardTarget === 'front'
                          ? 'TARGET'
                          : idCardFront
                          ? 'READY'
                          : 'WAITING'}
                      </span>
                    </div>

                    <div className="h-16 w-full rounded-lg bg-black/40 border border-neutral-700 overflow-hidden flex items-center justify-center relative">
                      {idCardFront ? (
                        <img
                          src={idCardFront}
                          alt="ID Front"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-gray-400 text-center px-1">
                          Tap to capture or upload Front
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-white/10 text-[10px]">
                      <label
                        className="text-blue-400 font-semibold cursor-pointer hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleIdCardGalleryUpload(e, 'front')}
                        />
                      </label>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIdCardFront(null);
                        }}
                        className="text-gray-400 hover:text-red-400"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* BACK SLOT */}
                  <div
                    onClick={() => setIdCardTarget('back')}
                    className={`rounded-xl p-2 relative flex flex-col justify-between cursor-pointer transition ${
                      idCardTarget === 'back'
                        ? 'border-2 border-blue-500 bg-blue-950/40 ring-2 ring-blue-500/20'
                        : 'border border-neutral-700 bg-neutral-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-extrabold uppercase text-gray-300">
                        2. Back Side
                      </span>
                      <span className="text-[9px] text-blue-300 font-bold">
                        {idCardTarget === 'back'
                          ? 'TARGET'
                          : idCardBack
                          ? 'READY'
                          : 'WAITING'}
                      </span>
                    </div>

                    <div className="h-16 w-full rounded-lg bg-black/40 border border-neutral-700 overflow-hidden flex items-center justify-center relative">
                      {idCardBack ? (
                        <img
                          src={idCardBack}
                          alt="ID Back"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-gray-400 text-center px-1">
                          Tap to capture or upload Back
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-white/10 text-[10px]">
                      <label
                        className="text-blue-400 font-semibold cursor-pointer hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleIdCardGalleryUpload(e, 'back')}
                        />
                      </label>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIdCardBack(null);
                        }}
                        className="text-gray-400 hover:text-red-400"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-300 pt-0.5 max-w-2xl mx-auto w-full">
                  <div className="flex items-center space-x-1.5">
                    <label className="text-[11px] font-bold text-gray-400">Layout:</label>
                    <select
                      value={idCardLayout}
                      onChange={(e) =>
                        setIdCardLayout(e.target.value as 'stacked' | 'side')
                      }
                      className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-[11px] text-white outline-none"
                    >
                      <option value="stacked">Vertical Stack (Top/Bottom)</option>
                      <option value="side">Side-by-Side (Pocket)</option>
                    </select>
                  </div>

                  <label className="flex items-center space-x-1.5 text-[11px] text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={idCardCertify}
                      onChange={(e) => setIdCardCertify(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-0"
                    />
                    <span className="font-semibold text-emerald-400">
                      CSC Verification Header
                    </span>
                  </label>
                </div>

                <div className="flex items-center justify-between pt-1 max-w-2xl mx-auto w-full">
                  <div className="text-xs">
                    <p className="text-[10px] text-gray-400">Capturing:</p>
                    <p className="text-xs font-black text-blue-400 uppercase tracking-wide">
                      {idCardTarget} SIDE
                    </p>
                  </div>

                  <button
                    onClick={captureScannerFrame}
                    className="w-14 h-14 p-1 rounded-full border-4 border-blue-400 flex items-center justify-center bg-blue-600 shadow-xl active:scale-95 transition"
                    title="Snap active card side"
                  >
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-white text-xs">
                      📸
                    </div>
                  </button>

                  <button
                    onClick={exportIdCardPdf}
                    className="touch-target px-3.5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-extrabold transition shadow-lg flex items-center space-x-1.5 whitespace-nowrap"
                  >
                    <span>Generate 2-in-1 PDF</span>
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ================= TAB 6: RECENTS ================= */}
        {activeTab === 'recents' && (
          <section className="flex flex-col h-full overflow-y-auto p-4 pb-24">
            <div className="w-full max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    Recent PDF Documents
                  </h2>
                  <p className="text-xs text-gray-500">
                    History of your processed and exported PDFs
                  </p>
                </div>
                <button
                  onClick={clearAllRecents}
                  className="text-xs text-red-600 hover:underline font-semibold"
                >
                  Clear History
                </button>
              </div>

              <div className="space-y-3">
                {recents.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-xs bg-white rounded-xl border border-gray-200">
                    No recent PDF documents found.
                  </div>
                ) : (
                  recents.map((item, idx) => (
                    <div
                      key={`${item.name}-${idx}`}
                      className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3 overflow-hidden">
                        <div className="w-9 h-9 rounded-lg bg-red-50 text-acrobat-red flex items-center justify-center font-black text-xs shrink-0">
                          PDF
                        </div>
                        <div className="truncate">
                          <h4 className="text-xs font-bold text-gray-800 truncate">
                            {item.name}
                          </h4>
                          <p className="text-[11px] text-gray-500 font-mono tabular-nums">
                            {item.pageCount} {item.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                            {item.size} · {item.date}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] text-gray-500 font-semibold px-2">
                        Processed
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ================= BOTTOM NAVIGATION BAR ================= */}
      <nav className="bg-white border-t border-gray-200 shadow-lg px-2 py-1 flex items-center justify-around z-30 shrink-0">
        <button
          onClick={() => setActiveTab('home')}
          className={`touch-target flex flex-col items-center justify-center flex-1 py-1 transition ${
            activeTab === 'home' ? 'text-acrobat-red' : 'text-gray-400 hover:text-gray-700'
          }`}
        >
          <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
            />
          </svg>
          <span className="text-[10px] font-bold">Tools</span>
        </button>

        <button
          onClick={() => setActiveTab('convert')}
          className={`touch-target flex flex-col items-center justify-center flex-1 py-1 transition ${
            activeTab === 'convert'
              ? 'text-acrobat-red'
              : 'text-gray-400 hover:text-gray-700'
          }`}
        >
          <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
          <span className="text-[10px] font-bold">Convert</span>
        </button>

        <button
          onClick={() => setActiveTab('esign')}
          className={`touch-target flex flex-col items-center justify-center flex-1 py-1 transition ${
            activeTab === 'esign' ? 'text-acrobat-red' : 'text-gray-400 hover:text-gray-700'
          }`}
        >
          <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
          <span className="text-[10px] font-bold">E-Sign</span>
        </button>

        <button
          onClick={() => setActiveTab('reader')}
          className={`touch-target flex flex-col items-center justify-center flex-1 py-1 transition ${
            activeTab === 'reader' ? 'text-acrobat-red' : 'text-gray-400 hover:text-gray-700'
          }`}
        >
          <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          <span className="text-[10px] font-bold">Reader</span>
        </button>

        <button
          onClick={() => setActiveTab('scanner')}
          className={`touch-target flex flex-col items-center justify-center flex-1 py-1 transition ${
            activeTab === 'scanner'
              ? 'text-acrobat-red'
              : 'text-gray-400 hover:text-gray-700'
          }`}
        >
          <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-[10px] font-bold">Scanner</span>
        </button>
      </nav>

      {/* ================= MODALS ================= */}
      <CropAdjustModal
        isOpen={cropModalState.isOpen}
        imageSource={cropModalState.imageSource}
        isIdCard={cropModalState.isIdCard}
        initialQuad={autoEdgeDetection ? liveDetectedQuadRef.current : null}
        scannerFilter={scannerFilter}
        autoDeskewInstant={autoDeskewInstant}
        onUpdateAutoDeskew={setAutoDeskewInstant}
        onCancel={() =>
          setCropModalState((prev) => ({ ...prev, isOpen: false, onComplete: null }))
        }
        onComplete={(croppedDataUrl) => {
          const cb = cropModalState.onComplete;
          setCropModalState((prev) => ({ ...prev, isOpen: false, onComplete: null }));
          if (cb) cb(croppedDataUrl);
        }}
        showToast={showToast}
      />

      <SignatureModal
        isOpen={isSigModalOpen}
        onClose={() => setIsSigModalOpen(false)}
        onApplySignature={(stamp) => {
          placeStampOnCurrentPage(stamp);
          showToast('Signature stamp placed! Drag to position.', 'success');
        }}
        showToast={showToast}
      />

      <ToolModals
        activeTool={activeTool}
        onCloseTool={() => setActiveTool(null)}
        setProgress={setProgress}
        downloadPdfBytes={downloadPdfBytes}
        showToast={showToast}
        isAboutOpen={isAboutOpen}
        onCloseAbout={() => setIsAboutOpen(false)}
        onStampCscSealFromAbout={() => {
          setIsAboutOpen(false);
          setActiveTab('esign');
          setTimeout(() => placeOfficialCscSealStamp(), 80);
        }}
        isSearchOpen={isSearchOpen}
        onCloseSearch={() => setIsSearchOpen(false)}
        pdfJsDoc={pdfJsDoc}
        totalPages={totalPages}
        onJumpToPageFromSearch={(page) => {
          setIsSearchOpen(false);
          setReaderPage(page);
          setReaderPageInputVal(String(page));
          setActiveTab('reader');
        }}
        textPromptMode={textPromptMode}
        onCloseTextPrompt={() => setTextPromptMode(null)}
        onConfirmTextPrompt={handleConfirmTextPrompt}
      />

      {/* ================= TOAST NOTIFICATION ================= */}
      <div
        className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold text-white transition-all transform duration-200 pointer-events-none flex items-center space-x-2 ${
          toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        } ${
          toast.type === 'success'
            ? 'bg-emerald-600'
            : toast.type === 'error'
            ? 'bg-acrobat-red'
            : 'bg-neutral-900'
        }`}
      >
        <span>
          {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
        </span>
        <span>{toast.message}</span>
      </div>

      {/* ================= PROGRESS MODAL ================= */}
      {progress.show && (
        <div className="fixed inset-0 bg-black/70 z-50 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-6 max-w-xs w-full text-center shadow-2xl flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-gray-200 border-t-acrobat-red rounded-full animate-spin mb-4" />
            <h4 className="text-sm font-bold text-gray-800">{progress.title}</h4>
            <p className="text-xs text-gray-500 mt-1 mb-3">{progress.subtitle}</p>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2 overflow-hidden">
              <div
                className="bg-acrobat-red h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="text-[11px] font-bold text-acrobat-red font-mono tabular-nums">
              {Math.round(progress.percent)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
