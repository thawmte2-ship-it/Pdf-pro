import React, { useEffect, useRef, useState } from 'react';
import { renderTextStampToPng } from '../utils/cvEngine';

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplySignature: (stamp: { dataUrl: string; width: number; height: number; type: string }) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type SigMode = 'draw' | 'type' | 'image';
type CursiveFont = 'caveat' | 'dancing' | 'vibes' | 'sacramento';

const FONT_MAP: Record<CursiveFont, string> = {
  caveat: "'Caveat', cursive",
  dancing: "'Dancing Script', cursive",
  vibes: "'Great Vibes', cursive",
  sacramento: "'Sacramento', cursive",
};

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  onClose,
  onApplySignature,
  showToast,
}) => {
  const [mode, setMode] = useState<SigMode>('draw');
  const [penColor, setPenColor] = useState<string>('#0A3871');
  const [hasDrawn, setHasDrawn] = useState(false);

  const [typedText, setTypedText] = useState('Alex M. Thawmte');
  const [selectedFont, setSelectedFont] = useState<CursiveFont>('caveat');

  const [uploadedImgUrl, setUploadedImgUrl] = useState<string | null>(null);

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (isOpen && mode === 'draw') {
      setTimeout(() => {
        clearSigCanvas();
      }, 40);
    }
  }, [isOpen, mode]);

  const clearSigCanvas = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const getCanvasPoint = (clientX: number, clientY: number) => {
    const canvas = sigCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDraw = (clientX: number, clientY: number) => {
    isDrawingRef.current = true;
    const pt = getCanvasPoint(clientX, clientY);
    lastPtRef.current = pt;
    const ctx = sigCanvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = penColor;
      ctx.fill();
      setHasDrawn(true);
    }
  };

  const moveDraw = (clientX: number, clientY: number) => {
    if (!isDrawingRef.current || !sigCanvasRef.current || !lastPtRef.current) return;
    const pt = getCanvasPoint(clientX, clientY);
    const ctx = sigCanvasRef.current.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPtRef.current = pt;
    setHasDrawn(true);
  };

  const endDraw = () => {
    isDrawingRef.current = false;
    lastPtRef.current = null;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rawUrl = ev.target?.result as string;
      // Convert near-white background pixels to transparent so signature looks clean on PDF
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const maxW = 500;
        const sc = Math.min(1, maxW / img.width);
        c.width = Math.round(img.width * sc);
        c.height = Math.round(img.height * sc);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const imgData = ctx.getImageData(0, 0, c.width, c.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum > 235) {
            d[i + 3] = 0;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        setUploadedImgUrl(c.toDataURL('image/png'));
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleStampDocument = () => {
    if (mode === 'draw') {
      const canvas = sigCanvasRef.current;
      if (!canvas || !hasDrawn) {
        showToast('Please draw your signature first', 'error');
        return;
      }
      onApplySignature({
        dataUrl: canvas.toDataURL('image/png'),
        width: 150,
        height: 75,
        type: 'signature',
      });
      onClose();
    } else if (mode === 'type') {
      if (!typedText.trim()) {
        showToast('Please enter your name', 'error');
        return;
      }
      const rendered = renderTextStampToPng(typedText.trim(), {
        fontFamily: FONT_MAP[selectedFont],
        fontSize: 54,
        color: penColor,
        fontWeight: '700',
      });
      onApplySignature({
        ...rendered,
        type: 'signature',
      });
      onClose();
    } else if (mode === 'image') {
      if (!uploadedImgUrl) {
        showToast('Please upload a signature image first', 'error');
        return;
      }
      onApplySignature({
        dataUrl: uploadedImgUrl,
        width: 150,
        height: 75,
        type: 'signature',
      });
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-acrobat-slate text-white flex items-center justify-between border-b border-acrobat-border">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-acrobat-red flex items-center justify-center text-white text-xs font-bold">
              ✍️
            </div>
            <h3 className="text-sm font-bold">Create E-Signature Stamp</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white touch-target p-1 rounded-full flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-3 bg-gray-100 p-1 border-b border-gray-200 text-xs font-bold text-center">
          <button
            onClick={() => setMode('draw')}
            className={`py-1.5 rounded-lg transition ${
              mode === 'draw' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            1. Draw
          </button>
          <button
            onClick={() => setMode('type')}
            className={`py-1.5 rounded-lg transition ${
              mode === 'type' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            2. Type
          </button>
          <button
            onClick={() => setMode('image')}
            className={`py-1.5 rounded-lg transition ${
              mode === 'image' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            3. Image
          </button>
        </div>

        {/* Body: DRAW MODE */}
        {mode === 'draw' && (
          <div className="p-4 flex flex-col items-center">
            <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-gray-50 relative mb-3 w-full flex justify-center">
              <canvas
                ref={sigCanvasRef}
                width={360}
                height={180}
                onMouseDown={(e) => startDraw(e.clientX, e.clientY)}
                onMouseMove={(e) => moveDraw(e.clientX, e.clientY)}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={(e) => {
                  if (e.touches[0]) startDraw(e.touches[0].clientX, e.touches[0].clientY);
                }}
                onTouchMove={(e) => {
                  if (e.touches[0]) moveDraw(e.touches[0].clientX, e.touches[0].clientY);
                }}
                onTouchEnd={endDraw}
                className="cursor-crosshair w-full max-w-[360px] h-[180px]"
              />
              <span className="absolute bottom-2 right-2 text-[10px] text-gray-400 font-medium pointer-events-none">
                Sign using finger, stylus, or mouse
              </span>
            </div>

            <div className="flex items-center justify-between w-full text-xs">
              <div className="flex items-center space-x-2">
                <span className="text-gray-500 font-medium">Ink:</span>
                <button
                  onClick={() => setPenColor('#0A3871')}
                  className={`w-6 h-6 rounded-full bg-[#0A3871] ${
                    penColor === '#0A3871' ? 'ring-2 ring-offset-1 ring-blue-900' : ''
                  }`}
                />
                <button
                  onClick={() => setPenColor('#000000')}
                  className={`w-6 h-6 rounded-full bg-black ${
                    penColor === '#000000' ? 'ring-2 ring-offset-1 ring-black' : ''
                  }`}
                />
                <button
                  onClick={() => setPenColor('#E5252A')}
                  className={`w-6 h-6 rounded-full bg-acrobat-red ${
                    penColor === '#E5252A' ? 'ring-2 ring-offset-1 ring-acrobat-red' : ''
                  }`}
                />
              </div>
              <button
                onClick={clearSigCanvas}
                className="text-xs text-red-600 hover:underline font-semibold"
              >
                Clear Canvas
              </button>
            </div>
          </div>
        )}

        {/* Body: TYPE MODE */}
        {mode === 'type' && (
          <div className="p-4 flex flex-col">
            <label className="block font-bold text-xs text-gray-700 mb-1">
              Enter your full name:
            </label>
            <input
              type="text"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-acrobat-red mb-3"
            />

            <label className="block font-bold text-xs text-gray-700 mb-2">
              Select Cursive Style:
            </label>
            <div className="space-y-2 mb-3">
              {(
                [
                  { id: 'caveat', label: 'Caveat', cls: 'font-caveat text-2xl' },
                  { id: 'dancing', label: 'Dancing Script', cls: 'font-dancing text-xl' },
                  { id: 'vibes', label: 'Great Vibes', cls: 'font-vibes text-2xl' },
                  { id: 'sacramento', label: 'Sacramento', cls: 'font-sacramento text-2xl' },
                ] as const
              ).map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => setSelectedFont(opt.id)}
                  className={`p-2.5 rounded-xl cursor-pointer flex justify-between items-center transition ${
                    selectedFont === opt.id
                      ? 'border-2 border-acrobat-blue bg-blue-50/50'
                      : 'border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className={`${opt.cls} text-blue-900 truncate`}>
                    {typedText || 'Signature'}
                  </span>
                  <span className="text-[10px] text-gray-400 font-sans ml-2 shrink-0">
                    {opt.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body: IMAGE MODE */}
        {mode === 'image' && (
          <div className="p-4 flex flex-col items-center">
            <label className="block border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-acrobat-red bg-gray-50 transition w-full mb-3">
              <svg
                className="w-8 h-8 text-acrobat-red mx-auto mb-1.5"
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
              <span className="text-xs font-bold text-gray-800">Upload Signature Image</span>
              <p className="text-[10px] text-gray-400 mt-0.5">
                PNG or JPG with transparent/white background
              </p>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
            </label>
            <div className="w-full h-24 border border-gray-200 rounded-xl flex items-center justify-center overflow-hidden bg-gray-50 p-2">
              {uploadedImgUrl ? (
                <img src={uploadedImgUrl} alt="Uploaded signature" className="max-h-full object-contain" />
              ) : (
                <span className="text-xs text-gray-400 italic">No image chosen</span>
              )}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="touch-target px-4 py-2 border border-gray-300 rounded-xl text-xs font-semibold text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleStampDocument}
            className="touch-target px-5 py-2 bg-acrobat-red hover:bg-acrobat-darkRed text-white rounded-xl text-xs font-bold shadow transition"
          >
            Stamp on Document
          </button>
        </div>
      </div>
    </div>
  );
};
