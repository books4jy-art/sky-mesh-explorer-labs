import React from 'react';

function Stat({ label, value }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/5 py-2.5">
      <span className="text-[11px] uppercase tracking-[0.15em] text-white/35">{label}</span>
      <span className="font-mono text-sm text-white/90">{value}</span>
    </div>
  );
}

const FLAG_LABELS = {
  stripAnimation: 'StripAnim',
  computeOcclusions: 'CompOcc',
  compressedPositions: 'ZipPos',
  compressedUvs: 'ZipUvs',
  strippedUv13: 'StripUv13',
  strippedNormals: 'StripNorm',
  copyFrameDelay: 'CopyFrameDelay',
};

export default function MeshStats({ parsed }) {
  const n = (x) => x.toLocaleString();
  const vertexCount = parsed.vertices.length / 3;
  const triangleCount = parsed.indices.length / 3;
  const activeFlags = Object.entries(parsed.flags || {})
    .filter(([, on]) => on)
    .map(([key]) => FLAG_LABELS[key] || key);

  return (
    <div>
      <p className="truncate text-sm text-white/90">{parsed.fileName}</p>
      {parsed.modelName && <p className="truncate text-xs text-white/40">{parsed.modelName}</p>}
      <div className="mt-4">
        {parsed.version != null && <Stat label="Version" value={`0x${parsed.version.toString(16)}`} />}
        <Stat label="Vertices" value={n(vertexCount)} />
        <Stat label="Triangles" value={n(triangleCount)} />
        <Stat label="Bones" value={parsed.skeleton?.length ? `${parsed.skeleton.length} bones` : (parsed.animated ? 'skinned (no skeleton)' : 'none')} />
        <Stat label="UV map" value={parsed.primaryUvSet || 'none'} />
        <Stat label="Format" value={activeFlags.length ? activeFlags.join(', ') : 'plain'} />
        {parsed.embeddedReferences?.length > 0 && (
          <Stat label="Refs" value={`${parsed.embeddedReferences.length} found`} />
        )}
      </div>
    </div>
  );
}
