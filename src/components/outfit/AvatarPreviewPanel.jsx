import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, RotateCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { parseMeshBuffer } from '@/lib/skyMeshParser';
import { exportMeshesToGlb } from '@/lib/glbExport';
import MeshCanvas from '@/components/viewer/MeshCanvas';

/**
 * Same as OutfitPreviewPanel, except each piece's geometry is a raw Sky .mesh
 * file (fetchDriveMeshFile -> parseMeshBuffer) instead of a pre-converted OBJ
 * (fetchDriveObjFile -> parseObj) — decoded in-browser via skyMeshParser.js,
 * the same decoder the Mesh Viewer uses for dropped .mesh files. Keyed off
 * altObjDriveFileId instead of objDriveFileId. Export produces a combined
 * .glb (exportMeshesToGlb) instead of a combined .obj.
 */
export default function AvatarPreviewPanel({ selected, items }) {
  const cacheRef = useRef({}); // altObjDriveFileId -> { positions, uvs, indices, normals } | '__err'
  const [tick, setTick] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const selectedIds = useMemo(() => new Set(Object.values(selected)), [selected]);
  const selectedItems = useMemo(
    () => (items || []).filter((it) => selectedIds.has(it.id)),
    [items, selectedIds]
  );

  useEffect(() => {
    let cancelled = false;
    const pending = selectedItems.filter((it) => {
      const k = it.altObjDriveFileId;
      return k && !cacheRef.current[k] && !cacheRef.current[k + '__err'];
    });
    if (!pending.length) return;
    (async () => {
      for (const it of pending) {
        const k = it.altObjDriveFileId;
        try {
          const res = await fetch(`/api/functions/fetchDriveMeshFile?driveFileId=${encodeURIComponent(k)}`);
          if (!res.ok) throw new Error(`Failed to download (${res.status})`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          const parsed = parseMeshBuffer(bytes, { fileName: it.altObjFileName });
          const positions = Float32Array.from(parsed.vertices);
          const uvs = parsed.uvs && parsed.uvs.length ? Float32Array.from(parsed.uvs) : null;
          const normals = parsed.normals && parsed.normals.length ? Float32Array.from(parsed.normals) : null;
          const vertexCount = parsed.vertices.length / 3;
          const IndexCtor = vertexCount > 65535 ? Uint32Array : Uint16Array;
          const indices = IndexCtor.from(parsed.indices);
          // Kept for GLB export only (see exportMeshesToGlb) — MeshCanvas only
          // reads positions/uvs/indices, so skinning doesn't affect the preview.
          const skeleton = parsed.skeleton?.length ? parsed.skeleton : null;
          const boneWeights = skeleton ? parsed.boneWeights : null;
          if (cancelled) return;
          cacheRef.current[k] = { positions, uvs, normals, indices, skeleton, boneWeights };
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
        .filter((it) => it.altObjDriveFileId && cacheRef.current[it.altObjDriveFileId])
        .map((it) => cacheRef.current[it.altObjDriveFileId]),
    [selectedItems, tick]
  );

  const loading = selectedItems.some((it) => {
    const k = it.altObjDriveFileId;
    return k && !cacheRef.current[k] && !cacheRef.current[k + '__err'];
  });
  const empty = meshes.length === 0;
  const canExport = meshes.length > 0 && !exporting;

  const handleExport = async () => {
    if (!canExport) return;
    setExportError(null);
    setExporting(true);
    try {
      const glb = await exportMeshesToGlb(meshes);
      const blob = new Blob([glb], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'avatar.glb';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e.message || 'Failed to export GLB.');
    } finally {
      setExporting(false);
    }
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
        <Download className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export GLB'}
      </button>
      {exportError && (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] leading-relaxed text-red-300">
          {exportError}
        </p>
      )}
    </div>
  );
}
