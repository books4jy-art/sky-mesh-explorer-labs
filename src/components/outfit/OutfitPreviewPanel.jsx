import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, RotateCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { base44 } from '@/api/base44Client';
import { parseObj } from '@/lib/objParser';
import { downloadObj } from '@/lib/meshExport';
import MeshCanvas from '@/components/viewer/MeshCanvas';

// Serialize the decoded meshes (the same set fed to MeshCanvas) to a combined OBJ
// string, preserving each piece's world coordinates (relative positions) with
// sequential vertex/uv offsets. Mirrors the OBJ line format meshToObj produces —
// no new exporter/decoder, no GLB/glTF.
function meshesToObj(meshes) {
  const lines = ['# SkyMesh Outfit Maker export'];
  let vOffset = 0;
  let uvOffset = 0;
  for (const m of meshes) {
    if (!m || !m.positions || !m.indices) continue;
    const vCount = m.positions.length / 3;
    for (let i = 0; i < vCount; i++) {
      lines.push(`v ${m.positions[i * 3].toFixed(6)} ${m.positions[i * 3 + 1].toFixed(6)} ${m.positions[i * 3 + 2].toFixed(6)}`);
    }
    const hasUv = !!m.uvs;
    if (hasUv) {
      const uvCount = m.uvs.length / 2;
      for (let i = 0; i < uvCount; i++) {
        lines.push(`vt ${m.uvs[i * 2].toFixed(6)} ${m.uvs[i * 2 + 1].toFixed(6)}`);
      }
    }
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i] + vOffset + 1, b = m.indices[i + 1] + vOffset + 1, c = m.indices[i + 2] + vOffset + 1;
      if (hasUv) {
        const ua = m.indices[i] + uvOffset + 1, ub = m.indices[i + 1] + uvOffset + 1, uc = m.indices[i + 2] + uvOffset + 1;
        lines.push(`f ${a}/${ua} ${b}/${ub} ${c}/${uc}`);
      } else {
        lines.push(`f ${a} ${b} ${c}`);
      }
    }
    vOffset += vCount;
    if (hasUv) uvOffset += m.uvs.length / 2;
  }
  return lines.join('\n');
}

/**
 * Inline 3D preview for the Outfit Maker. Renders the currently selected outfit
 * pieces via the shared MeshCanvas (6a `meshes` array contract). Each piece's
 * geometry is loaded + decoded with the SAME path the Mesh Viewer uses
 * (fetchDriveObjFile -> parseObj); failed pieces are skipped.
 */
export default function OutfitPreviewPanel({ selected, items }) {
  const cacheRef = useRef({}); // objDriveFileId -> { positions, uvs, indices } | '__err'
  const [tick, setTick] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);

  const selectedIds = useMemo(() => new Set(Object.values(selected)), [selected]);
  const selectedItems = useMemo(
    () => (items || []).filter((it) => selectedIds.has(it.id)),
    [items, selectedIds]
  );

  // Load + decode any selected piece not yet cached. Runs once per selection change.
  useEffect(() => {
    let cancelled = false;
    const pending = selectedItems.filter((it) => {
      const k = it.objDriveFileId;
      return k && !cacheRef.current[k] && !cacheRef.current[k + '__err'];
    });
    if (!pending.length) return;
    (async () => {
      for (const it of pending) {
        const k = it.objDriveFileId;
        try {
          const res = await base44.functions.invoke('fetchDriveObjFile', { fileId: k });
          const text = res.data;
          const { positions, uvs, indices } = parseObj(text);
          if (cancelled) return;
          cacheRef.current[k] = { positions, uvs, indices };
        } catch (e) {
          if (cancelled) return;
          cacheRef.current[k + '__err'] = true;
        }
        setTick((t) => t + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedItems]);

  const meshes = useMemo(
    () =>
      selectedItems
        .filter((it) => it.objDriveFileId && cacheRef.current[it.objDriveFileId])
        .map((it) => cacheRef.current[it.objDriveFileId]),
    [selectedItems, tick]
  );

  const loading = selectedItems.some((it) => {
    const k = it.objDriveFileId;
    return k && !cacheRef.current[k] && !cacheRef.current[k + '__err'];
  });
  const empty = meshes.length === 0;
  const canExport = meshes.length > 0;
  const handleExport = () => {
    if (!canExport) return;
    downloadObj(meshesToObj(meshes), 'outfit.obj');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-[38vh] md:h-[78vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d12]">
        <div className="pointer-events-none absolute left-3 top-2 z-10 text-[10px] tracking-[0.2em] uppercase text-white/30">Preview</div>
        <MeshCanvas meshes={meshes} autoRotate={autoRotate} />
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        )}
        {empty && !loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/30">
            No pieces selected
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-white/60">
          <RotateCw className="h-3.5 w-3.5" /> Auto rotate
          <Switch checked={autoRotate} onCheckedChange={setAutoRotate} />
        </label>
      </div>
      <button
        type="button"
        onClick={handleExport}
        disabled={!canExport}
        className="flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-sky-400/90 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Download className="h-3.5 w-3.5" /> Export OBJ
      </button>
    </div>
  );
}
