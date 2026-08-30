import React, { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';

export default function TexturePaster({ onFile, textureName, onClear, error }) {
  const inputRef = useRef(null);
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.15em] text-white/35">Texture</span>
        {textureName && (
          <button onClick={onClear} className="text-white/40 transition-colors hover:text-white/80" aria-label="Clear texture">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button
        onClick={() => inputRef.current?.click()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-3 py-3 text-xs text-white/50 transition-colors hover:border-white/30 hover:text-white/80"
      >
        <ImagePlus className="h-4 w-4 shrink-0" />
        {textureName ? <span className="truncate">{textureName}</span> : 'Paste texture (.pvr / .ktx)'}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
      {error && <p className="mt-2 text-[11px] leading-relaxed text-red-300/80">{error}</p>}
    </div>
  );
}
