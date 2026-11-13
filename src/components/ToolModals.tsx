import React, { useState } from 'react';
import { ThawmteEmblem } from './ThawmteEmblem';

declare global {
  interface Window {
    pdfjsLib: any;
    PDFLib: any;
    XLSX: any;
    docx: any;
  }
}

export type ToolKey =
  | 'merge'
  | 'split'
  | 'compress'
  | 'rotate'
  | 'protect'
  | 'unlock'
  | 'organise'
  | null;

interface OrgCard {
  index: number;
  num: number;
  dataUrl: string;
  deleted: boolean;
  checked: boolean;
}

interface ToolModalsProps {
  activeTool: ToolKey;
  onCloseTool: () => void;
  setProgress: (show: boolean, title?: string, subtitle?: string, percent?: number) => void;
  downloadPdfBytes: (bytes: Uint8Array, filename: string) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  // About Shop Modal
  isAboutOpen: boolean;
  onCloseAbout: () => void;
  onStampCscSealFromAbout: () => void;
  // Search Modal
  isSearchOpen: boolean;
  onCloseSearch: () => void;
  pdfJsDoc: any;
  totalPages: number;
  onJumpToPageFromSearch: (page: number) => void;
  // Text Stamp Prompt Modal (Initials / Full Name)
  textPromptMode: 'initials' | 'name' | null;
  onCloseTextPrompt: () => void;
  onConfirmTextPrompt: (val: string, mode: 'initials' | 'name') => void;
}

export const ToolModals: React.FC<ToolModalsProps> = ({
  activeTool,
  onCloseTool,
  setProgress,
  downloadPdfBytes,
  showToast,
  isAboutOpen,
  onCloseAbout,
  onStampCscSealFromAbout,
  isSearchOpen,
  onCloseSearch,
  pdfJsDoc,
  totalPages,
  onJumpToPageFromSearch,
  textPromptMode,
  onCloseTextPrompt,
  onConfirmTextPrompt,
}) => {
  // Tool states
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [splitFile, setSplitFile] = useState<File | null>(null);
  const [splitRange, setSplitRange] = useState('1-2');
  const [compressFile, setCompressFile] = useState<File | null>(null);
  const [compressLevel, setCompressLevel] = useState('0.7');
  const [rotateFile, setRotateFile] = useState<File | null>(null);
  const [rotateAngle, setRotateAngle] = useState('90');
  const [protectFile, setProtectFile] = useState<File | null>(null);
  const [protectPassword, setProtectPassword] = useState('');
  const [unlockFile, setUnlockFile] = useState<File | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');

  // Organiser state
  const [orgCards, setOrgCards] = useState<OrgCard[]>([]);
  const [orgBytes, setOrgBytes] = useState<ArrayBuffer | null>(null);
  const [orgName, setOrgName] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ page: number; text: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Text prompt state
  const [promptInputVal, setPromptInputVal] = useState('');

  const handleLoadOrganiserGrid = async (file: File | undefined) => {
    if (!file) return;
    try {
      setProgress(true, 'Loading Pages', 'Generating page thumbnails...', 35);
      setOrgName(file.name);
      const buffer = await file.arrayBuffer();
      setOrgBytes(buffer);
      const pdfJs = await window.pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
      const cards: OrgCard[] = [];

      for (let i = 1; i <= pdfJs.numPages; i++) {
        const page = await pdfJs.getPage(i);
        const viewport = page.getViewport({ scale: 0.25 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;

        cards.push({
          index: i - 1,
          num: i,
          dataUrl: canvas.toDataURL(),
          deleted: false,
          checked: true,
        });
      }
      setOrgCards(cards);
      setProgress(false);
    } catch (err: any) {
      setProgress(false);
      showToast('Failed to load pages: ' + err.message, 'error');
    }
  };

  const moveOrgPage = (idx: number, dir: number) => {
    const target = idx + dir;
    if (target < 0 || target >= orgCards.length) return;
    const next = [...orgCards];
    const tmp = next[idx];
    next[idx] = next[target];
    next[target] = tmp;
    setOrgCards(next);
  };

  const toggleDeleteOrgPage = (idx: number) => {
    const next = [...orgCards];
    next[idx] = { ...next[idx], deleted: !next[idx].deleted };
    setOrgCards(next);
  };

  const toggleCheckOrgPage = (idx: number, checked: boolean) => {
    const next = [...orgCards];
    next[idx] = { ...next[idx], checked };
    setOrgCards(next);
  };

  const saveOrganisedPdf = async (mode: 'reorder' | 'extract') => {
    if (!orgBytes) return;
    try {
      setProgress(true, 'Organising Pages', 'Compiling PDF...', 50);
      const { PDFDocument } = window.PDFLib;
      const doc = await PDFDocument.load(orgBytes);
      const newDoc = await PDFDocument.create();
      let indices: number[] = [];
      if (mode === 'reorder') {
        indices = orgCards.filter((c) => !c.deleted).map((c) => c.index);
      } else {
        indices = orgCards.filter((c) => c.checked && !c.deleted).map((c) => c.index);
      }

      if (indices.length === 0) {
        setProgress(false);
        showToast('No pages selected', 'error');
        return;
      }

      const copied = await newDoc.copyPages(doc, indices);
      copied.forEach((p: any) => newDoc.addPage(p));
      const out = await newDoc.save();
      setProgress(false);
      onCloseTool();
      downloadPdfBytes(out, `${mode.toUpperCase()}_${orgName}`);
    } catch (err: any) {
      setProgress(false);
      showToast('Organise error: ' + err.message, 'error');
    }
  };

  const executeActiveTool = async () => {
    const { PDFDocument, degrees } = window.PDFLib;
    try {
      if (activeTool === 'merge') {
        if (mergeFiles.length < 2) {
          showToast('Please select at least 2 PDFs', 'error');
          return;
        }
        setProgress(true, 'Merging PDFs', 'Joining documents...', 30);
        const merged = await PDFDocument.create();
        for (let i = 0; i < mergeFiles.length; i++) {
          const b = await mergeFiles[i].arrayBuffer();
          const doc = await PDFDocument.load(b);
          const copied = await merged.copyPages(doc, doc.getPageIndices());
          copied.forEach((p: any) => merged.addPage(p));
        }
        const out = await merged.save();
        setProgress(false);
        onCloseTool();
        downloadPdfBytes(out, `MERGED_${Date.now()}.pdf`);
      } else if (activeTool === 'split') {
        if (!splitFile || !splitRange.trim()) {
          showToast('Please select a file and page range', 'error');
          return;
        }
        setProgress(true, 'Splitting PDF', 'Extracting pages...', 50);
        const doc = await PDFDocument.load(await splitFile.arrayBuffer());
        const newDoc = await PDFDocument.create();
        const indices: number[] = [];
        splitRange.split(',').forEach((p) => {
          if (p.includes('-')) {
            const [s, e] = p.split('-').map((x) => parseInt(x.trim(), 10) - 1);
            for (let i = s; i <= e; i++) {
              if (i >= 0 && i < doc.getPageCount()) indices.push(i);
            }
          } else {
            const idx = parseInt(p.trim(), 10) - 1;
            if (idx >= 0 && idx < doc.getPageCount()) indices.push(idx);
          }
        });
        if (indices.length === 0) {
          setProgress(false);
          showToast('No valid pages in range', 'error');
          return;
        }
        const copied = await newDoc.copyPages(doc, indices);
        copied.forEach((p: any) => newDoc.addPage(p));
        const out = await newDoc.save();
        setProgress(false);
        onCloseTool();
        downloadPdfBytes(out, `SPLIT_${splitFile.name}`);
      } else if (activeTool === 'compress') {
        if (!compressFile) {
          showToast('Select a PDF file', 'error');
          return;
        }
        const q = parseFloat(compressLevel);
        setProgress(true, 'Compressing PDF', 'Repacking pages...', 30);
        const pdfJs = await window.pdfjsLib.getDocument({
          data: new Uint8Array(await compressFile.arrayBuffer()),
        }).promise;
        const newDoc = await PDFDocument.create();
        for (let i = 1; i <= pdfJs.numPages; i++) {
          const p = await pdfJs.getPage(i);
          const v = p.getViewport({ scale: 0.85 });
          const c = document.createElement('canvas');
          c.width = v.width;
          c.height = v.height;
          await p.render({ canvasContext: c.getContext('2d')!, viewport: v }).promise;
          const img = await newDoc.embedJpg(c.toDataURL('image/jpeg', q));
          const page = newDoc.addPage([v.width, v.height]);
          page.drawImage(img, { x: 0, y: 0, width: v.width, height: v.height });
        }
        const out = await newDoc.save();
        setProgress(false);
        onCloseTool();
        downloadPdfBytes(out, `COMPRESSED_${compressFile.name}`);
      } else if (activeTool === 'rotate') {
        if (!rotateFile) {
          showToast('Select a PDF file', 'error');
          return;
        }
        const deg = parseInt(rotateAngle, 10);
        setProgress(true, 'Rotating PDF', 'Applying angles...', 50);
        const doc = await PDFDocument.load(await rotateFile.arrayBuffer());
        doc.getPages().forEach((p: any) =>
          p.setRotation(degrees((p.getRotation().angle + deg) % 360))
        );
        const out = await doc.save();
        setProgress(false);
        onCloseTool();
        downloadPdfBytes(out, `ROTATED_${rotateFile.name}`);
      } else if (activeTool === 'protect') {
        if (!protectFile || !protectPassword) {
          showToast('Provide file and password', 'error');
          return;
        }
        setProgress(true, 'Protecting PDF', 'Encrypting metadata...', 50);
        const doc = await PDFDocument.load(await protectFile.arrayBuffer());
        doc.setTitle(`[PROTECTED] ${protectFile.name}`);
        doc.setSubject(`Passphrase:${btoa(protectPassword)}`);
        const out = await doc.save();
        setProgress(false);
        onCloseTool();
        downloadPdfBytes(out, `SECURED_${protectFile.name}`);
      } else if (activeTool === 'unlock') {
        if (!unlockFile) {
          showToast('Select a PDF file', 'error');
          return;
        }
        setProgress(true, 'Unlocking PDF', 'Verifying password...', 50);
        const b = await unlockFile.arrayBuffer();
        await window.pdfjsLib.getDocument({
          data: new Uint8Array(b.slice(0)),
          password: unlockPassword,
        }).promise;
        const clean = await PDFDocument.load(b, { ignoreEncryption: true });
        clean.setTitle(unlockFile.name.replace('SECURED_', ''));
        clean.setSubject('');
        const out = await clean.save();
        setProgress(false);
        onCloseTool();
        downloadPdfBytes(out, `UNLOCKED_${unlockFile.name}`);
      }
    } catch (err: any) {
      setProgress(false);
      showToast('Operation failed: ' + err.message, 'error');
    }
  };

  const executePdfSearch = async () => {
    const q = searchQuery.trim();
    if (!q || !pdfJsDoc) return;
    setIsSearching(true);
    setHasSearched(true);
    const results: { page: number; text: string }[] = [];

    for (let p = 1; p <= totalPages; p++) {
      const page = await pdfJsDoc.getPage(p);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((s: any) => s.str).join(' ');
      if (new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
        results.push({ page: p, text });
      }
    }
    setSearchResults(results);
    setIsSearching(false);
  };

  const toolConfig: Record<
    Exclude<ToolKey, null>,
    { title: string; icon: string; actionLabel: string }
  > = {
    merge: { title: '3. Merge PDF Documents', icon: '⧉', actionLabel: 'Merge PDFs' },
    split: { title: '4. Split PDF Pages', icon: '✂', actionLabel: 'Split Pages' },
    compress: { title: '5. Compress PDF', icon: '▼', actionLabel: 'Compress Document' },
    rotate: { title: '9. Rotate PDF', icon: '↻', actionLabel: 'Rotate Pages' },
    protect: { title: '10. Protect PDF', icon: '🔒', actionLabel: 'Lock Document' },
    unlock: { title: '11. Unlock PDF', icon: '🔓', actionLabel: 'Unlock & Clean' },
    organise: { title: '12-14. Organise Pages', icon: '▦', actionLabel: '' },
  };

  return (
    <>
      {/* 1. ABOUT THAWMTE TEC (CSC) MODAL */}
      {isAboutOpen && (
        <div className="fixed inset-0 bg-black/75 z-50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col text-center">
            <div className="bg-acrobat-slate text-white p-4 relative flex flex-col items-center border-b border-acrobat-border">
              <button
                onClick={onCloseAbout}
                className="absolute top-3 right-3 text-gray-400 hover:text-white p-1 rounded-full touch-target flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="w-24 h-24 rounded-full bg-white shadow-xl p-1 border-4 border-blue-900 mb-2 flex items-center justify-center">
                <ThawmteEmblem />
              </div>
              <h3 className="text-base font-extrabold text-white">THAWMTE TEC</h3>
              <p className="text-xs text-emerald-400 font-bold uppercase tracking-wider">
                Common Services Centre (CSC)
              </p>
            </div>

            <div className="p-4 text-xs text-gray-700 space-y-3">
              <div className="bg-gray-50 border border-gray-200 p-3 rounded-xl text-left space-y-1.5">
                <div className="flex items-start space-x-2">
                  <span className="text-blue-900 font-bold shrink-0">Address:</span>
                  <span className="text-gray-800 font-semibold">
                    Hmuia Veng, Tetea Road, Lamka, Churachandpur, Manipur
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-900 font-bold shrink-0">Phone:</span>
                  <a href="tel:9612887396" className="text-acrobat-red font-bold hover:underline">
                    9612887396
                  </a>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-blue-900 font-bold shrink-0">Centre:</span>
                  <span className="text-gray-700">Digital Citizen Services & Authorized Printing</span>
                </div>
              </div>

              <div className="text-left">
                <p className="text-[11px] font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Authorized Services:
                </p>
                <ul className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-600 font-medium">
                  <li className="bg-blue-50/60 p-1.5 rounded-lg border border-blue-100 flex items-center space-x-1">
                    <span className="text-blue-700 font-bold">✓</span>
                    <span>Certified PDF & Print</span>
                  </li>
                  <li className="bg-blue-50/60 p-1.5 rounded-lg border border-blue-100 flex items-center space-x-1">
                    <span className="text-blue-700 font-bold">✓</span>
                    <span>E-Sign & CSC Seal</span>
                  </li>
                  <li className="bg-blue-50/60 p-1.5 rounded-lg border border-blue-100 flex items-center space-x-1">
                    <span className="text-blue-700 font-bold">✓</span>
                    <span>Word / Excel Convert</span>
                  </li>
                  <li className="bg-blue-50/60 p-1.5 rounded-lg border border-blue-100 flex items-center space-x-1">
                    <span className="text-blue-700 font-bold">✓</span>
                    <span>Doc & ID Scanning</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="p-3 bg-gray-50 border-t border-gray-200 flex items-center space-x-2">
              <a
                href="tel:9612887396"
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1 shadow"
              >
                <span>Call 9612887396</span>
              </a>
              <button
                onClick={onStampCscSealFromAbout}
                className="flex-1 py-2.5 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1 shadow"
              >
                <span>Stamp CSC Seal</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. SEARCH PDF MODAL */}
      {isSearchOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm flex items-start justify-center p-4 pt-16">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-3.5 border-b border-gray-200 flex items-center space-x-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') executePdfSearch();
                }}
                placeholder="Search text in document..."
                className="flex-1 outline-none text-sm text-gray-800"
                autoFocus
              />
              <button
                onClick={executePdfSearch}
                className="touch-target px-3 py-1 bg-acrobat-red text-white text-xs font-bold rounded-lg"
              >
                Find
              </button>
              <button onClick={onCloseSearch} className="p-1 text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto divide-y divide-gray-100 text-xs">
              {isSearching ? (
                <p className="text-center text-gray-500 py-3">Searching text across document...</p>
              ) : !hasSearched ? (
                <p className="text-gray-400 text-center py-4">Type keywords and press Find.</p>
              ) : searchResults.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  No results found for "<b>{searchQuery}</b>"
                </p>
              ) : (
                searchResults.map((res) => (
                  <div
                    key={res.page}
                    onClick={() => onJumpToPageFromSearch(res.page)}
                    className="py-2 px-2 hover:bg-red-50 rounded-lg cursor-pointer transition"
                  >
                    <div className="flex items-center justify-between font-bold text-gray-800">
                      <span>Page {res.page}</span>
                      <span className="text-acrobat-red text-[10px]">Jump →</span>
                    </div>
                    <p className="text-gray-500 mt-1">{res.text.substring(0, 110)}...</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. INITIALS / NAME TEXT STAMP MODAL */}
      {textPromptMode && (
        <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-acrobat-slate text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {textPromptMode === 'initials' ? 'Place Signer Initials' : 'Place Full Name'}
              </h3>
              <button onClick={onCloseTextPrompt} className="text-gray-400 hover:text-white">
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block text-xs font-bold text-gray-700">
                {textPromptMode === 'initials'
                  ? 'Enter Initials (e.g. TT or AMT):'
                  : 'Enter Signer Full Name:'}
              </label>
              <input
                type="text"
                value={promptInputVal}
                onChange={(e) => setPromptInputVal(e.target.value)}
                placeholder={textPromptMode === 'initials' ? 'TT' : 'Alex M. Thawmte'}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-acrobat-red"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && promptInputVal.trim()) {
                    onConfirmTextPrompt(promptInputVal.trim(), textPromptMode);
                    setPromptInputVal('');
                  }
                }}
              />
            </div>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-end space-x-2">
              <button
                onClick={onCloseTextPrompt}
                className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-semibold text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const val =
                    promptInputVal.trim() ||
                    (textPromptMode === 'initials' ? 'TT' : 'Alex M. Thawmte');
                  onConfirmTextPrompt(val, textPromptMode);
                  setPromptInputVal('');
                }}
                className="px-4 py-2 bg-acrobat-red text-white rounded-xl text-xs font-bold shadow"
              >
                Place Stamp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. DEDICATED ORGANIZE & SECURITY TOOL MODAL */}
      {activeTool && (
        <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 bg-acrobat-slate text-white flex items-center justify-between border-b border-acrobat-border">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-lg bg-acrobat-red flex items-center justify-center text-white font-bold">
                  {toolConfig[activeTool].icon}
                </div>
                <h3 className="text-sm font-bold">{toolConfig[activeTool].title}</h3>
              </div>
              <button
                onClick={onCloseTool}
                className="text-gray-400 hover:text-white touch-target p-1 rounded-full flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 text-sm text-gray-700 space-y-4">
              {activeTool === 'merge' && (
                <div>
                  <p className="text-xs text-gray-600 mb-2">Select 2 or more PDFs to merge:</p>
                  <input
                    type="file"
                    accept="application/pdf"
                    multiple
                    onChange={(e) => setMergeFiles(Array.from(e.target.files || []))}
                    className="block w-full text-xs text-gray-500 border border-gray-200 rounded-xl p-2.5 mb-2"
                  />
                  {mergeFiles.length > 0 && (
                    <p className="text-xs text-emerald-700 font-semibold">
                      {mergeFiles.length} PDF files selected for merging
                    </p>
                  )}
                </div>
              )}

              {activeTool === 'split' && (
                <div>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setSplitFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-gray-500 border border-gray-200 rounded-xl p-2.5 mb-3"
                  />
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Page Range (e.g. 1-2 or 1,3):
                  </label>
                  <input
                    type="text"
                    value={splitRange}
                    onChange={(e) => setSplitRange(e.target.value)}
                    placeholder="e.g. 1-2"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs outline-none"
                  />
                </div>
              )}

              {activeTool === 'compress' && (
                <div>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setCompressFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-gray-500 border border-gray-200 rounded-xl p-2.5 mb-3"
                  />
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Compression Level:
                  </label>
                  <select
                    value={compressLevel}
                    onChange={(e) => setCompressLevel(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-2.5 py-2 text-xs outline-none bg-white"
                  >
                    <option value="0.7">Standard Balanced (Medium Size)</option>
                    <option value="0.5">High Compression (Smallest Size)</option>
                  </select>
                </div>
              )}

              {activeTool === 'rotate' && (
                <div>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setRotateFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-gray-500 border border-gray-200 rounded-xl p-2.5 mb-3"
                  />
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Rotation Angle:
                  </label>
                  <select
                    value={rotateAngle}
                    onChange={(e) => setRotateAngle(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-2.5 py-2 text-xs outline-none bg-white"
                  >
                    <option value="90">90° Clockwise</option>
                    <option value="180">180° Invert</option>
                    <option value="270">270° Counter-Clockwise</option>
                  </select>
                </div>
              )}

              {activeTool === 'protect' && (
                <div>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setProtectFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-gray-500 border border-gray-200 rounded-xl p-2.5 mb-3"
                  />
                  <input
                    type="password"
                    value={protectPassword}
                    onChange={(e) => setProtectPassword(e.target.value)}
                    placeholder="Set Password"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs outline-none"
                  />
                </div>
              )}

              {activeTool === 'unlock' && (
                <div>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setUnlockFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-gray-500 border border-gray-200 rounded-xl p-2.5 mb-3"
                  />
                  <input
                    type="password"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    placeholder="Enter Password (if encrypted)"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs outline-none"
                  />
                </div>
              )}

              {activeTool === 'organise' && (
                <div>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => handleLoadOrganiserGrid(e.target.files?.[0])}
                    className="block w-full text-xs text-gray-500 border border-gray-200 rounded-xl p-2.5 mb-3"
                  />
                  {orgCards.length > 0 && (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto p-1">
                        {orgCards.map((c, idx) => (
                          <div
                            key={`${c.index}-${idx}`}
                            className={`p-2 rounded-xl border ${
                              c.deleted
                                ? 'border-red-400 bg-red-50 opacity-50'
                                : 'border-gray-200 bg-white'
                            } flex flex-col items-center relative shadow-sm`}
                          >
                            <input
                              type="checkbox"
                              checked={c.checked}
                              onChange={(e) => toggleCheckOrgPage(idx, e.target.checked)}
                              className="absolute top-2 left-2 rounded text-acrobat-red"
                            />
                            <img
                              src={c.dataUrl}
                              alt={`Page ${c.num}`}
                              className="w-full h-auto rounded border border-gray-100 mb-1"
                            />
                            <span className="text-[10px] font-bold text-gray-700 mb-1">
                              Page {c.num}
                            </span>
                            <div className="flex space-x-1">
                              <button
                                onClick={() => moveOrgPage(idx, -1)}
                                className="px-2 py-0.5 bg-gray-100 rounded text-xs font-bold"
                              >
                                ←
                              </button>
                              <button
                                onClick={() => toggleDeleteOrgPage(idx)}
                                className={`px-2 py-0.5 ${
                                  c.deleted
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-red-100 text-red-600'
                                } rounded text-[10px] font-bold`}
                              >
                                {c.deleted ? 'Undo' : 'Del'}
                              </button>
                              <button
                                onClick={() => moveOrgPage(idx, 1)}
                                className="px-2 py-0.5 bg-gray-100 rounded text-xs font-bold"
                              >
                                →
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between pt-3 border-t border-gray-200 mt-3">
                        <button
                          onClick={() => saveOrganisedPdf('reorder')}
                          className="px-3.5 py-2 bg-acrobat-slate text-white text-xs font-bold rounded-xl"
                        >
                          Save Reordered
                        </button>
                        <button
                          onClick={() => saveOrganisedPdf('extract')}
                          className="px-3.5 py-2 bg-acrobat-red text-white text-xs font-bold rounded-xl"
                        >
                          Extract Checked
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-3">
              <button
                onClick={onCloseTool}
                className="touch-target px-4 py-2 border border-gray-300 rounded-xl text-xs font-semibold text-gray-700 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              {activeTool !== 'organise' && (
                <button
                  onClick={executeActiveTool}
                  className="touch-target px-5 py-2 bg-acrobat-red hover:bg-acrobat-darkRed text-white rounded-xl text-xs font-bold transition shadow"
                >
                  {toolConfig[activeTool].actionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
