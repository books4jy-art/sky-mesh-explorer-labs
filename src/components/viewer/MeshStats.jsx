import React from 'react';

function Stat({ label, value }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/5 py-2.5">
      <span className="text-[11px] uppercase tracking-[0.15em] text-white/35">{label}</span>
      <span className="font-mono text-sm text-white/90">{value}</span>
    </div>
  );
}

export default function MeshStats({ fileName, mesh, hasSkin, hasUvs }) {
  const n = (x) => x.toLocaleString();
  return (
    <div>
      <p className="truncate text-sm text-white/90">{fileName}</p>
      <div className="mt-4">
        <Stat label="Vertices" value={n(mesh.vertexCount)} />
        <Stat label="Triangles" value={n(mesh.triangles.length)} />
        <Stat label="Bones" value={hasSkin ? 'skinned' : 'none'} />
        <Stat label="UVs" value={hasUvs ? 'yes' : 'none'} />
        <Stat label="Format" value="ZipPos / ZipUvs" />
      </div>
    </div>
  );
}
