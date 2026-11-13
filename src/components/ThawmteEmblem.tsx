import React from 'react';

export const THAWMTE_EMBLEM_RAW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%">
  <defs>
    <path id="coreTopArc" d="M 52,200 A 148,148 0 0,1 348,200" fill="none" />
    <path id="coreBottomArc" d="M 52,192 A 148,148 0 0,0 348,192" fill="none" />
    <linearGradient id="coreBannerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#210F38"/>
      <stop offset="30%" stop-color="#3D1259"/>
      <stop offset="32%" stop-color="#FFFFFF"/>
      <stop offset="68%" stop-color="#E2E8F0"/>
      <stop offset="72%" stop-color="#F59E0B"/>
      <stop offset="100%" stop-color="#FBBF24"/>
    </linearGradient>
  </defs>
  <circle cx="200" cy="200" r="195" fill="#FFFFFF" />
  <circle cx="200" cy="200" r="190" fill="#FFFFFF" stroke="#0D2B82" stroke-width="14" />
  <circle cx="200" cy="200" r="126" fill="#FFFFFF" stroke="#0D2B82" stroke-width="3.5" />
  <text fill="#006E33" font-family="'Plus Jakarta Sans', sans-serif" font-weight="900" font-size="33" letter-spacing="4">
    <textPath href="#coreTopArc" startOffset="50%" text-anchor="middle">THAWMTE TEC</textPath>
  </text>
  <text fill="#006E33" font-family="'Plus Jakarta Sans', sans-serif" font-weight="900" font-size="21.5" letter-spacing="2.5">
    <textPath href="#coreBottomArc" startOffset="50%" text-anchor="middle">COMMON SERVICES CENTRE</textPath>
  </text>
  <g transform="translate(80, 118)">
    <rect x="0" y="0" width="240" height="58" rx="7" fill="url(#coreBannerGrad)" />
    <rect x="4" y="4" width="48" height="50" rx="5" fill="#1C0D30" opacity="0.6"/>
    <text x="12" y="38" fill="#5B21B6" font-family="'Plus Jakarta Sans', sans-serif" font-weight="900" font-size="32" font-style="italic">T</text>
    <text x="26" y="40" fill="#3B82F6" font-family="'Plus Jakarta Sans', sans-serif" font-weight="900" font-size="32" font-style="italic">T</text>
    <text x="60" y="39" fill="#FFFFFF" font-family="'Plus Jakarta Sans', sans-serif" font-weight="900" font-size="23" stroke="#CBD5E1" stroke-width="0.5">THAWMT</text>
    <text x="168" y="39" fill="#1E293B" font-family="'Plus Jakarta Sans', sans-serif" font-weight="900" font-size="23">E TEC</text>
  </g>
  <g transform="translate(95, 206)">
    <path d="M 46,14 C 40,5 29,1 18,1 C 8,1 1,8 1,19 C 1,30 8,37 18,37 C 29,37 40,33 46,24" fill="none" stroke="#0066B2" stroke-width="11" stroke-linecap="round" />
    <path d="M 103,13 C 99,6 92,2 84,2 C 73,2 67,7 67,14 C 67,25 104,21 104,33 C 104,40 97,46 85,46 C 75,46 67,41 62,34" fill="none" stroke="#75787B" stroke-width="11" stroke-linecap="round" />
    <path d="M 166,14 C 160,5 149,1 138,1 C 128,1 121,8 121,19 C 121,30 128,37 138,37 C 149,37 160,33 166,24" fill="none" stroke="#0066B2" stroke-width="11" stroke-linecap="round" />
    <text x="105" y="60" fill="#0066B2" font-family="'Plus Jakarta Sans', sans-serif" font-weight="800" font-size="11.5" text-anchor="middle" letter-spacing="0.5">Common Services Center</text>
  </g>
</svg>`;

let cachedEmblemPng: string | null = null;

export function getThawmteEmblemPngDataUrl(): Promise<string> {
  if (cachedEmblemPng) return Promise.resolve(cachedEmblemPng);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, 400, 400);
        cachedEmblemPng = canvas.toDataURL('image/png');
        resolve(cachedEmblemPng);
      } else {
        resolve('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(THAWMTE_EMBLEM_RAW_SVG));
      }
    };
    img.onerror = () => {
      resolve('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(THAWMTE_EMBLEM_RAW_SVG));
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(THAWMTE_EMBLEM_RAW_SVG);
  });
}

export const ThawmteEmblem: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: THAWMTE_EMBLEM_RAW_SVG }}
    />
  );
};
