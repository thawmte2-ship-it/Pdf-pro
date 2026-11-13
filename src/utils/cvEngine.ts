export interface Point2D {
  x: number;
  y: number;
}

/**
 * Core Computer Vision: Grayscale, Sobel Gradients, Quadrant Extreme Points & Aspect Snapping
 */
export function detectDocumentCornersAlgorithm(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  isIdCard: boolean
): Point2D[] {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 1. Grayscale luminance buffer
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  // 2. Sobel Edge Magnitude
  const mag = new Uint8Array(w * h);
  let totalMag = 0;
  let countMag = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx =
        -gray[idx - w - 1] +
        gray[idx - w + 1] -
        2 * gray[idx - 1] +
        2 * gray[idx + 1] -
        gray[idx + w - 1] +
        gray[idx + w + 1];
      const gy =
        -gray[idx - w - 1] -
        2 * gray[idx - w] -
        gray[idx - w + 1] +
        gray[idx + w - 1] +
        2 * gray[idx + w] +
        gray[idx + w + 1];

      const val = Math.min(255, Math.abs(gx) + Math.abs(gy));
      mag[idx] = val;
      if (val > 40) {
        totalMag += val;
        countMag++;
      }
    }
  }

  // Dynamic edge threshold
  const threshold = countMag > 50 ? Math.max(65, (totalMag / countMag) * 0.9) : 75;

  // 3. Find 4 extreme boundary corners in 4 quadrants
  const midX = w / 2;
  const midY = h / 2;

  let tl = { x: w * 0.12, y: h * 0.15, score: 999999 };
  let tr = { x: w * 0.88, y: h * 0.15, score: 999999 };
  let br = { x: w * 0.88, y: h * 0.85, score: 999999 };
  let bl = { x: w * 0.12, y: h * 0.85, score: 999999 };

  let edgePointsFound = 0;

  const minX = Math.round(w * 0.05);
  const maxX = Math.round(w * 0.95);
  const minY = Math.round(h * 0.05);
  const maxY = Math.round(h * 0.95);

  for (let y = minY; y < maxY; y += 2) {
    for (let x = minX; x < maxX; x += 2) {
      const idx = y * w + x;
      if (mag[idx] >= threshold) {
        edgePointsFound++;
        if (x < midX && y < midY) {
          const sc = x + y;
          if (sc < tl.score) tl = { x, y, score: sc };
        } else if (x >= midX && y < midY) {
          const sc = w - x + y;
          if (sc < tr.score) tr = { x, y, score: sc };
        } else if (x >= midX && y >= midY) {
          const sc = w - x + (h - y);
          if (sc < br.score) br = { x, y, score: sc };
        } else {
          const sc = x + (h - y);
          if (sc < bl.score) bl = { x, y, score: sc };
        }
      }
    }
  }

  // 4. Fallback / Sanity Check
  if (edgePointsFound < 80 || tr.x - tl.x < w * 0.35 || br.y - tr.y < h * 0.25) {
    if (isIdCard) {
      const cardW = 0.82;
      const cardH = Math.min(0.76, (cardW * (w / h)) / 1.586);
      const marginX = (1 - cardW) / 2;
      const marginY = Math.max(0.12, (1 - cardH) / 2);
      return [
        { x: marginX, y: marginY },
        { x: 1 - marginX, y: marginY },
        { x: 1 - marginX, y: marginY + cardH },
        { x: marginX, y: marginY + cardH },
      ];
    } else {
      return [
        { x: 0.12, y: 0.1 },
        { x: 0.88, y: 0.1 },
        { x: 0.88, y: 0.9 },
        { x: 0.12, y: 0.9 },
      ];
    }
  }

  return [
    { x: Math.max(0.02, Math.min(0.98, tl.x / w)), y: Math.max(0.02, Math.min(0.98, tl.y / h)) },
    { x: Math.max(0.02, Math.min(0.98, tr.x / w)), y: Math.max(0.02, Math.min(0.98, tr.y / h)) },
    { x: Math.max(0.02, Math.min(0.98, br.x / w)), y: Math.max(0.02, Math.min(0.98, br.y / h)) },
    { x: Math.max(0.02, Math.min(0.98, bl.x / w)), y: Math.max(0.02, Math.min(0.98, bl.y / h)) },
  ];
}

/**
 * Piecewise Affine Triangle Interpolation (Projective Homography Approximation)
 */
export function perspectiveHomographyWarp(
  ctx: CanvasRenderingContext2D,
  srcImg: HTMLImageElement | HTMLCanvasElement,
  quad: Point2D[],
  dstW: number,
  dstH: number
) {
  const GRID = 14;
  const [tl, tr, br, bl] = quad;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const getQuadPoint = (u: number, v: number): Point2D => {
    const topX = lerp(tl.x, tr.x, u);
    const topY = lerp(tl.y, tr.y, u);
    const botX = lerp(bl.x, br.x, u);
    const botY = lerp(bl.y, br.y, u);
    return {
      x: lerp(topX, botX, v),
      y: lerp(topY, botY, v),
    };
  };

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const u0 = gx / GRID;
      const u1 = (gx + 1) / GRID;
      const v0 = gy / GRID;
      const v1 = (gy + 1) / GRID;

      const p00 = getQuadPoint(u0, v0);
      const p10 = getQuadPoint(u1, v0);
      const p11 = getQuadPoint(u1, v1);
      const p01 = getQuadPoint(u0, v1);

      const dx0 = u0 * dstW;
      const dx1 = u1 * dstW;
      const dy0 = v0 * dstH;
      const dy1 = v1 * dstH;

      drawAffineTriangle(ctx, srcImg, dx0, dy0, dx1, dy0, dx0, dy1, p00.x, p00.y, p10.x, p10.y, p01.x, p01.y);
      drawAffineTriangle(ctx, srcImg, dx1, dy0, dx1, dy1, dx0, dy1, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y);
    }
  }
}

function drawAffineTriangle(
  ctx: CanvasRenderingContext2D,
  im: HTMLImageElement | HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();

  const denom = sx0 * (sy1 - sy2) - sx1 * (sy0 - sy2) + sx2 * (sy0 - sy1);
  if (Math.abs(denom) > 0.0001) {
    const m11 = -(sy0 * (x1 - x2) - sy1 * (x0 - x2) + sy2 * (x0 - x1)) / denom;
    const m12 = (sy0 * (y1 - y2) - sy1 * (y0 - y2) + sy2 * (y0 - y1)) / denom;
    const m21 = (sx0 * (x1 - x2) - sx1 * (x0 - x2) + sx2 * (x0 - x1)) / denom;
    const m22 = -(sx0 * (y1 - y2) - sx1 * (y0 - y2) + sx2 * (y0 - y1)) / denom;
    const dx =
      (sx0 * (sy1 * x2 - sy2 * x1) - sy0 * (sx1 * x2 - sx2 * x1) + (sx1 * sy2 - sx2 * sy1) * x0) / denom;
    const dy =
      (sx0 * (sy1 * y2 - sy2 * y1) - sy0 * (sx1 * y2 - sx2 * y1) + (sx1 * sy2 - sx2 * sy1) * y0) / denom;

    ctx.transform(m11, m12, m21, m22, dx, dy);
    ctx.drawImage(im, 0, 0);
  }
  ctx.restore();
}

export function applyFilterToCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  filter: 'color' | 'bw' | 'grayscale'
) {
  if (filter === 'color') return;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (filter === 'grayscale') {
      d[i] = d[i + 1] = d[i + 2] = gray;
    } else if (filter === 'bw') {
      const v = gray > 140 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Renders any text, cursive signature, date stamp, or mark into a crisp transparent PNG data URL
 */
export function renderTextStampToPng(
  text: string,
  options: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    fontWeight?: string;
    paddingX?: number;
    paddingY?: number;
  } = {}
): { dataUrl: string; width: number; height: number } {
  const {
    fontFamily = "'Plus Jakarta Sans', sans-serif",
    fontSize = 42,
    color = '#0A3871',
    fontWeight = '700',
    paddingX = 24,
    paddingY = 18,
  } = options;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSpec = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.font = fontSpec;

  const metrics = ctx.measureText(text);
  const textW = Math.max(60, Math.ceil(metrics.width));
  const textH = Math.ceil(fontSize * 1.35);

  canvas.width = textW + paddingX * 2;
  canvas.height = textH + paddingY * 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = fontSpec;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  // Return display size scaled down 2x for crisp Retina rendering on page
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: Math.max(48, Math.round(canvas.width / 2)),
    height: Math.max(28, Math.round(canvas.height / 2)),
  };
}
