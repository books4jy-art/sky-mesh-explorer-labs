import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Ported from ThatMeshStudio (SCOTL)'s renderer/viewer.js drawUvMap(), adapted
// to draw into a React-managed canvas instead of mutating globals directly.
function drawUvMap(canvas, rect, uvSet, indices, view) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#101318';
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (!uvSet?.uvs?.length) {
    ctx.fillStyle = '#81999e';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No UV data', rect.width / 2, rect.height / 2);
    return;
  }

  const bounds = uvSet.stats || {};
  const minU = Math.min(0, bounds.minU ?? 0), maxU = Math.max(1, bounds.maxU ?? 1);
  const minV = Math.min(0, bounds.minV ?? 0), maxV = Math.max(1, bounds.maxV ?? 1);
  const scale = Math.max(1, Math.min((rect.width - 36) / (maxU - minU), (rect.height - 36) / (maxV - minV))) * view.zoom;
  const x = (rect.width - (maxU - minU) * scale) / 2 - minU * scale + view.x;
  const y = (rect.height - (maxV - minV) * scale) / 2 - minV * scale + view.y;

  for (let row = 0; row < 16; row += 1) {
    for (let col = 0; col < 16; col += 1) {
      ctx.fillStyle = (row + col) % 2 ? '#292920' : '#39382e';
      ctx.fillRect(x + (col * scale) / 16, y + (row * scale) / 16, scale / 16, scale / 16);
    }
  }
  ctx.strokeStyle = '#918a72';
  ctx.strokeRect(x, y, scale, scale);

  ctx.strokeStyle = '#ffd3bb';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  const { uvs } = uvSet;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vi = indices[i + corner] * 2;
      const px = x + uvs[vi] * scale, py = y + uvs[vi + 1] * scale;
      if (corner === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  ctx.stroke();

  ctx.fillStyle = '#eef4ff';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(uvSet.name, 8, 15);
}

export default function UvInspector({ parsed }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const [, forceRedraw] = useState(0);
  const [selectedName, setSelectedName] = useState(parsed.primaryUvSet || parsed.uvSets?.[0]?.name || '');

  const uvSet = useMemo(
    () => parsed.uvSets?.find((set) => set.name === selectedName) || null,
    [parsed, selectedName]
  );

  const redraw = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    drawUvMap(canvas, rect, uvSet, parsed.indices, viewRef.current);
  };

  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uvSet]);

  const zoom = (factor) => {
    viewRef.current.zoom = Math.max(0.1, Math.min(20, viewRef.current.zoom * factor));
    redraw();
    forceRedraw((n) => n + 1);
  };

  const resetView = () => {
    viewRef.current = { zoom: 1, x: 0, y: 0 };
    redraw();
    forceRedraw((n) => n + 1);
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.dragging = '1';
  };
  const onPointerMove = (e) => {
    if (e.currentTarget.dataset.dragging !== '1') return;
    viewRef.current.x += e.movementX;
    viewRef.current.y += e.movementY;
    redraw();
  };
  const onPointerUp = (e) => { e.currentTarget.dataset.dragging = '0'; };

  const stats = uvSet?.stats;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Select value={selectedName} onValueChange={setSelectedName}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="UV channel" />
          </SelectTrigger>
          <SelectContent>
            {(parsed.uvSets || []).map((set) => (
              <SelectItem key={set.name} value={set.name}>
                {set.name}{set.name === parsed.primaryUvSet ? ' (primary)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => zoom(0.8)} title="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => zoom(1.25)} title="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={resetView} title="Fit">
            <Scan className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative h-56 cursor-grab overflow-hidden rounded-xl border border-white/10 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>

      {stats && (
        <div className="space-y-1 text-[11px] text-white/45">
          <div className="flex justify-between"><span>Decode</span><span className="font-mono text-white/70">{uvSet.decode}</span></div>
          <div className="flex justify-between"><span>U range</span><span className="font-mono text-white/70">{stats.minU.toFixed(3)} – {stats.maxU.toFixed(3)}</span></div>
          <div className="flex justify-between"><span>V range</span><span className="font-mono text-white/70">{stats.minV.toFixed(3)} – {stats.maxV.toFixed(3)}</span></div>
          {uvSet.source && (
            <div className="flex justify-between"><span>Stride</span><span className="font-mono text-white/70">{uvSet.source.stride}B @ {uvSet.source.bits}bit</span></div>
          )}
        </div>
      )}
    </div>
  );
}
