import React, { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

export default function DropZone({ onFile }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const handleFiles = (files) => {
    if (files && files[0]) onFile(files[0]);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border border-dashed transition-all duration-300 px-10 py-16 text-center ${
        over ? 'border-sky-400/70 bg-sky-400/5' : 'border-white/15 hover:border-white/30 bg-white/[0.02]'
      }`}
    >
      <UploadCloud className="mx-auto h-8 w-8 text-sky-300/80" strokeWidth={1.25} />
      <p className="mt-5 text-sm tracking-wide text-white/80">Drop a <span className="text-white">.mesh</span> file here</p>
      <p className="mt-1 text-xs text-white/40">or click to browse — everything is decoded locally</p>
      <input
        ref={inputRef}
        type="file"
        accept=".mesh"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
