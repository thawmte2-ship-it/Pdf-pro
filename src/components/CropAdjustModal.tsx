import React, { useEffect, useRef, useState } from 'react';
import {
  Point2D,
  applyFilterToCanvas,
  detectDocumentCornersAlgorithm,
  perspectiveHomographyWarp,
} from '../utils/cvEngine';

interface CropAdjustModalProps {
  isOpen: boolean;
  imageSource: string | null;
  isIdCard: boolean;
  initialQuad: Point2D[] | null;
  scannerFilter: 'color' | 'bw' | 'grayscale';
  autoDeskewInstant: boolean;
  onUpdateAutoDeskew: (val: boolean) => void;
  onCancel: () => void;
  onComplete: (croppedDataUrl: string) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const CropAdjustModal: React.FC<CropAdjustModalProps> = ({
  isOpen,
  imageSource,
  isIdCard,
  initialQuad,
  scannerFilter,
  autoDeskewInstant,
  onUpdateAutoDeskew,
  onCancel,
  onComplete,
  showToast,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loupeRef = useRef<HTMLDivElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgObjRef = useRef<HTMLImageElement | null>(null);
  const cornersRef = useRef<Point2D[]>([]);
  const activeHandleRef = useRef<number>(-1);

  const [skipNext, setSkipNext] = useState(autoDeskewInstant);

  useEffect(() => {
    setSkipNext(autoDeskewInstant);
  }, [autoDeskewInstant]);

  useEffect(() => {
    if (!isOpen || !imageSource) return;

    const img = new Image();
    img.onload = () => {
      imgObjRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      if (initialQuad && initialQuad.length === 4) {
        cornersRef.current = initialQuad.map((p) => ({
          x: p.x * img.width,
          y: p.y * img.height,
        }));
      } else {
        runAutoDetect(img);
      }

      drawCropCanvas();

      if (autoDeskewInstant) {
        handleApplyCrop();
      }
    };
    img.src = imageSource;
  }, [isOpen, imageSource]);

  const runAutoDetect = (img: HTMLImageElement) => {
    const temp = document.createElement('canvas');
    temp.width = 240;
    temp.height = Math.max(120, Math.round((img.height / (img.width || 1)) * 240));
    const tCtx = temp.getContext('2d')!;
    tCtx.drawImage(img, 0, 0, temp.width, temp.height);

    const detected = detectDocumentCornersAlgorithm(tCtx, temp.width, temp.height, isIdCard);
    cornersRef.current = detected.map((p) => ({
      x: p.x * img.width,
      y: p.y * img.height,
    }));
  };

  const drawCropCanvas = () => {
    const canvas = canvasRef.current;
    const img = imgObjRef.current;
    const pts = cornersRef.current;
    if (!canvas || !img || pts.length !== 4) return;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.lineTo(pts[3].x, pts[3].y);
    ctx.closePath();
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.lineTo(pts[3].x, pts[3].y);
    ctx.closePath();

    const themeColor = isIdCard ? '#3B82F6' : '#10B981';
    ctx.lineWidth = Math.max(3, canvas.width * 0.005);
    ctx.strokeStyle = themeColor;
    ctx.stroke();

    const radius = Math.max(14, canvas.width * 0.022);
    const labels = ['TL', 'TR', 'BR', 'BL'];

    pts.forEach((p, idx) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = activeHandleRef.current === idx ? '#E5252A' : themeColor;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(radius * 0.75)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[idx], p.x, p.y);
    });

    ctx.restore();
  };

  const getPointerPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
      screenX: clientX,
      screenY: clientY,
    };
  };

  const updateLoupe = (screenX: number, screenY: number, corner: Point2D) => {
    const loupe = loupeRef.current;
    const loupeCanvas = loupeCanvasRef.current;
    const img = imgObjRef.current;
    if (!loupe || !loupeCanvas || !img) return;

    loupe.style.display = 'block';
    loupe.style.left = `${screenX - 50}px`;
    loupe.style.top = `${Math.max(12, screenY - 120)}px`;

    const lCtx = loupeCanvas.getContext('2d')!;
    lCtx.clearRect(0, 0, 100, 100);
    lCtx.save();
    lCtx.scale(2.2, 2.2);
    lCtx.drawImage(
      img,
      corner.x - 50 / 2.2,
      corner.y - 50 / 2.2,
      100 / 2.2,
      100 / 2.2,
      0,
      0,
      100 / 2.2,
      100 / 2.2
    );
    lCtx.restore();
  };

  const handlePointerDown = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || cornersRef.current.length !== 4) return;
    const pos = getPointerPos(clientX, clientY);
    const threshold = Math.max(40, canvas.width * 0.06);

    let closestIdx = -1;
    let minDist = 999999;

    cornersRef.current.forEach((p, idx) => {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < threshold && d < minDist) {
        minDist = d;
        closestIdx = idx;
      }
    });

    if (closestIdx !== -1) {
      activeHandleRef.current = closestIdx;
      updateLoupe(pos.screenX, pos.screenY, cornersRef.current[closestIdx]);
      drawCropCanvas();
    }
  };

  const handlePointerMove = (clientX: number, clientY: number) => {
    if (activeHandleRef.current === -1 || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const pos = getPointerPos(clientX, clientY);
    cornersRef.current[activeHandleRef.current] = {
      x: Math.max(0, Math.min(canvas.width, pos.x)),
      y: Math.max(0, Math.min(canvas.height, pos.y)),
    };
    updateLoupe(pos.screenX, pos.screenY, cornersRef.current[activeHandleRef.current]);
    drawCropCanvas();
  };

  const handlePointerUp = () => {
    activeHandleRef.current = -1;
    if (loupeRef.current) loupeRef.current.style.display = 'none';
    drawCropCanvas();
  };

  const handleReDetect = () => {
    if (!imgObjRef.current) return;
    runAutoDetect(imgObjRef.current);
    drawCropCanvas();
    showToast('Edges re-detected!', 'success');
  };

  const handleResetFull = () => {
    const img = imgObjRef.current;
    if (!img) return;
    const m = 15;
    cornersRef.current = [
      { x: m, y: m },
      { x: img.width - m, y: m },
      { x: img.width - m, y: img.height - m },
      { x: m, y: img.height - m },
    ];
    drawCropCanvas();
    showToast('Reset to full boundaries', 'info');
  };

  const handleIdCardAspect = () => {
    const img = imgObjRef.current;
    if (!img) return;
    const cardAspect = 1.586;
    let targetW = img.width * 0.85;
    let targetH = targetW / cardAspect;

    if (targetH > img.height * 0.85) {
      targetH = img.height * 0.85;
      targetW = targetH * cardAspect;
    }

    const x1 = (img.width - targetW) / 2;
    const y1 = (img.height - targetH) / 2;
    cornersRef.current = [
      { x: x1, y: y1 },
      { x: x1 + targetW, y: y1 },
      { x: x1 + targetW, y: y1 + targetH },
      { x: x1, y: y1 + targetH },
    ];
    drawCropCanvas();
    showToast('Snapped to ID Card (CR80) standard', 'success');
  };

  const handleRotate90 = () => {
    const img = imgObjRef.current;
    if (!img) return;
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = img.height;
    rotCanvas.height = img.width;
    const ctx = rotCanvas.getContext('2d')!;
    ctx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
    ctx.rotate((90 * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    const newImg = new Image();
    newImg.onload = () => {
      imgObjRef.current = newImg;
      if (canvasRef.current) {
        canvasRef.current.width = newImg.width;
        canvasRef.current.height = newImg.height;
      }
      runAutoDetect(newImg);
      drawCropCanvas();
    };
    newImg.src = rotCanvas.toDataURL('image/jpeg', 0.95);
  };

  const handleApplyCrop = () => {
    const img = imgObjRef.current;
    const pts = cornersRef.current;
    if (!img || pts.length !== 4) return;

    onUpdateAutoDeskew(skipNext);

    const widthTop = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const widthBottom = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y);
    let targetW = Math.max(100, Math.round(Math.max(widthTop, widthBottom)));

    const heightLeft = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
    const heightRight = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
    let targetH = Math.max(100, Math.round(Math.max(heightLeft, heightRight)));

    if (isIdCard) {
      targetW = Math.round(Math.max(targetW, targetH * 1.586));
      targetH = Math.round(targetW / 1.586);
    }

    const maxDim = 1800;
    if (targetW > maxDim || targetH > maxDim) {
      const sc = maxDim / Math.max(targetW, targetH);
      targetW = Math.round(targetW * sc);
      targetH = Math.round(targetH * sc);
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetW;
    outCanvas.height = targetH;
    const outCtx = outCanvas.getContext('2d')!;

    perspectiveHomographyWarp(outCtx, img, pts, targetW, targetH);
    applyFilterToCanvas(outCtx, targetW, targetH, scannerFilter);

    const finalDataUrl = outCanvas.toDataURL('image/jpeg', 0.92);
    onComplete(finalDataUrl);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-neutral-950/95 z-50 backdrop-blur-md flex flex-col justify-between select-none"
      onMouseMove={(e) => handlePointerMove(e.clientX, e.clientY)}
      onMouseUp={handlePointerUp}
      onTouchMove={(e) => {
        if (e.touches[0]) handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }}
      onTouchEnd={handlePointerUp}
    >
      {/* Crop Header */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-4 py-3 flex items-center justify-between shrink-0 text-white">
        <div className="flex items-center space-x-2.5">
          <span className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center font-black text-xs">
            📐
          </span>
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-wide">
              Adjust Edges & Perspective
            </h3>
            <p className="text-[10px] text-gray-400">
              Drag 4 corner handles to align document boundaries
            </p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-white p-1.5 rounded-full touch-target flex items-center justify-center"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Crop Workspace Viewport */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center p-3">
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => handlePointerDown(e.clientX, e.clientY)}
          onTouchStart={(e) => {
            if (e.touches[0]) handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
          }}
          className="max-w-full max-h-full object-contain shadow-2xl rounded-lg cursor-crosshair"
        />
        {/* Touch Magnifier Loupe */}
        <div
          ref={loupeRef}
          className="fixed w-[100px] h-[100px] border-[3px] border-acrobat-red rounded-full overflow-hidden shadow-2xl pointer-events-none hidden bg-black z-60"
        >
          <canvas ref={loupeCanvasRef} width={100} height={100} className="w-full h-full" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-2.5 h-2.5 border-2 border-red-500 rounded-full" />
          </div>
        </div>
      </div>

      {/* Crop Quick Adjustment Toolbar */}
      <div className="bg-neutral-900 border-t border-neutral-800 p-3 flex flex-col space-y-2.5 shrink-0">
        <div className="flex items-center justify-between space-x-2 overflow-x-auto text-xs pb-1">
          <button
            onClick={handleReDetect}
            className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-emerald-400 border border-emerald-500/40 font-bold whitespace-nowrap flex items-center space-x-1"
          >
            <span>Auto Detect</span>
          </button>
          <button
            onClick={handleResetFull}
            className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-gray-200 border border-neutral-700 font-bold whitespace-nowrap"
          >
            <span>Full Image</span>
          </button>
          <button
            onClick={handleIdCardAspect}
            className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-blue-400 border border-blue-500/40 font-bold whitespace-nowrap flex items-center space-x-1"
          >
            <span>ID Card Fit</span>
          </button>
          <button
            onClick={handleRotate90}
            className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-yellow-400 border border-yellow-500/40 font-bold whitespace-nowrap"
          >
            <span>Rotate 90°</span>
          </button>
        </div>

        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center space-x-1.5 text-[11px] text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={skipNext}
              onChange={(e) => setSkipNext(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-0"
            />
            <span>Auto-crop instantly next time</span>
          </label>

          <div className="flex items-center space-x-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              onClick={handleApplyCrop}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg transition flex items-center space-x-1.5 active:scale-95 whitespace-nowrap"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Done & Straighten</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
