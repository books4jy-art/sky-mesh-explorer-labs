import React, { useState } from 'react';
import { Download, Grid3x3, RotateCw, X, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Image } from '@/components/ui/image';
import * as THREE from 'three';
import { meshToObj } from '@/lib/skyMeshToObj';
import { downloadObj as exportObjFile } from '@/lib/meshExport';
import { loadTextureBytes } from '@/lib/skyTextureDecoder';
import DropZone from '@/components/viewer/DropZone';
import MeshStats from '@/components/viewer/MeshStats';
import MeshCanvas from '@/components/viewer/MeshCanvas';
import TexturePaster from '@/components/viewer/TexturePaster';
import { base44 } from '@/api/base44Client';
import { parseObj } from '@/lib/objParser';
import LibraryPanel from '@/components/viewer/LibraryPanel';
import { Link } from 'react-router-dom';
import { Shirt } from 'lucide-react';

export default function Viewer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [texture, setTexture] = useState(null);
  const [textureName, setTextureName] = useState(null);
  const [textureError, setTextureError] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const handleFile = async (file) => {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { obj, mesh } = meshToObj(bytes, file.name);
      const positions = new Float32Array(mesh.vertices.length * 3);
      for (let i = 0; i < mesh.vertices.length; i++) {
        positions[i * 3] = mesh.vertices[i][0];
        positions[i * 3 + 1] = mesh.vertices[i][1];
        positions[i * 3 + 2] = mesh.vertices[i][2];
      }
      let uvs = null;
      if (mesh.uvs) {
        uvs = new Float32Array(mesh.uvs.length * 2);
        for (let i = 0; i < mesh.uvs.length; i++) { uvs[i * 2] = mesh.uvs[i][0]; uvs[i * 2 + 1] = mesh.uvs[i][1]; }
      }
      const IndexCtor = mesh.vertexCount > 65535 ? Uint32Array : Uint16Array;
      const indices = new IndexCtor(mesh.triangles.length * 3);
      for (let i = 0; i < mesh.triangles.length; i++) {
        indices[i * 3] = mesh.triangles[i][0]; indices[i * 3 + 1] = mesh.triangles[i][1]; indices[i * 3 + 2] = mesh.triangles[i][2];
      }
      const topFlags = bytes.length > 0x48 ? bytes[0x48] : 0;
      const hasSkin = (topFlags & 1) !== 0;
      setData({ fileName: file.name, obj, mesh, positions, uvs, indices, hasSkin });
    } catch (e) {
      setData(null);
      setError(e.message || 'Failed to decode this file.');
    }
  };

  const downloadObj = () => {
    exportObjFile(data.obj, data.fileName.replace(/\.mesh$/i, '') + '.obj');
  };

  const handleTexture = async (file) => {
    setTextureError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = loadTextureBytes(bytes, file.name);
      if (!asset.rgba) {
        setTextureError(asset.meta ? `Unsupported format (${asset.meta.format || 'unknown'}) — not decoded to RGBA.` : 'Texture not decoded to RGBA.');
        return;
      }
      const tex = new THREE.DataTexture(asset.rgba.data, asset.rgba.width, asset.rgba.height);
      tex.needsUpdate = true;
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      setTexture(tex);
      setTextureName(file.name);
    } catch (e) {
      setTextureError(e.message || 'Failed to decode texture.');
    }
  };

  const clearTexture = () => { setTexture(null); setTextureName(null); setTextureError(null); };

  const handleLoadObj = async (file) => {
    setError(null);
    setLibraryLoading(true);
    try {
      const res = await base44.functions.invoke('fetchDriveObjFile', { fileId: file.driveFileId });
      const text = res.data;
      const { positions, uvs, indices, vertexCount, triangleCount } = parseObj(text);
      setData({ fileName: file.name, obj: text, positions, uvs, indices, mesh: { vertexCount, triangles: new Array(triangleCount), uvs: !!uvs }, hasSkin: false });
      setLibraryOpen(false);
    } catch (e) {
      setError(e.message || 'Failed to load this model.');
    } finally {
      setLibraryLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0d12] text-white">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5">
          <Image src="https://media.base44.com/images/public/6a82c111d9211acd4e9b81f8/a81d9e585_UILogo.png" alt="Sky logo" className="h-10 w-10" fittingType="fit" />
          <span className="text-sm font-medium tracking-[0.2em] uppercase text-white/40">Mesh Viewer</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setLibraryOpen(true)} className="flex items-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white/80">
            <BookOpen className="h-3.5 w-3.5" /> Library
          </button>
          <Link to="/outfit-maker" className="flex items-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white/80">
            <Shirt className="h-3.5 w-3.5" /> Outfit Maker
          </Link>
          {data && (
            <button onClick={() => setData(null)} className="flex items-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white/80">
              <X className="h-3.5 w-3.5" /> Close
            </button>
          )}
        </div>
      </header>

      {!data ? (
        <main className="mx-auto max-w-xl px-6 pb-24 pt-10 md:pt-24">
          <h1 className="font-display text-3xl font-light leading-tight tracking-tight md:text-4xl">
            Open a Sky <span className="text-sky-300">.mesh</span> file
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/45">
            Compressed ZipPos / ZipUvs meshes are decoded right in your browser, rendered in 3D, and can be exported to OBJ.
          </p>
          <div className="mt-10">
            <DropZone onFile={handleFile} />
          </div>
          {error && (
            <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-xs leading-relaxed text-red-300">
              {error}
            </p>
          )}
        </main>
      ) : (
        <main className="grid gap-6 px-6 pb-10 md:grid-cols-[1fr_280px] md:px-10">
          <div className="h-[55vh] overflow-hidden rounded-2xl border border-white/10 md:h-[78vh]">
            <MeshCanvas
              positions={data.positions}
              uvs={data.uvs}
              indices={data.indices}
              wireframe={wireframe}
              autoRotate={autoRotate}
              texture={texture}
            />
          </div>

          <aside className="space-y-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <MeshStats fileName={data.fileName} mesh={data.mesh} hasSkin={data.hasSkin} hasUvs={!!data.uvs} />

            <TexturePaster onFile={handleTexture} textureName={textureName} onClear={clearTexture} error={textureError} />

            <div className="space-y-4">
              <label className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-white/60"><Grid3x3 className="h-4 w-4" /> Wireframe</span>
                <Switch checked={wireframe} onCheckedChange={setWireframe} />
              </label>
              <label className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-white/60"><RotateCw className="h-4 w-4" /> Auto rotate</span>
                <Switch checked={autoRotate} onCheckedChange={setAutoRotate} />
              </label>
            </div>

            <Button onClick={downloadObj} className="w-full bg-sky-400 text-slate-900 hover:bg-sky-300">
              <Download className="mr-2 h-4 w-4" /> Export OBJ
            </Button>

            <p className="text-[11px] leading-relaxed text-white/30">
              Drag to orbit · scroll to zoom. Normals are computed from the geometry; bone transforms are not applied.
            </p>
          </aside>
        </main>
      )}
      {libraryOpen && (
        <LibraryPanel onClose={() => setLibraryOpen(false)} onPick={handleLoadObj} loadingFile={libraryLoading} />
      )}
    </div>
  );
}
