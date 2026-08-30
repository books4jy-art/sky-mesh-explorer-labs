// meshExport.js — shared OBJ export emission (download trigger).
//
// Reuses the OBJ string produced by the existing exporter (meshToObj in
// src/lib/skyMeshToObj.js, or the OBJ text returned by parseObj). This module
// only handles Blob + anchor download, so any page can emit the SAME .obj output
// the Mesh Viewer already produces. No new/second exporter logic lives here, and no
// GLB/glTF is added.
export function downloadObj(objString, fileName) {
  const url = URL.createObjectURL(new Blob([objString], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
