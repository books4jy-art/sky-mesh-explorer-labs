// Talks to our own Express backend (server/) instead of a hosted Base44 app.
// Kept as `base44.functions.invoke(name, body)` so the existing call sites
// (LibraryPanel, Viewer, OutfitMaker, OutfitPreviewPanel) don't need to change.
export const base44 = {
  functions: {
    async invoke(name, body) {
      const res = await fetch(`/api/functions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const contentType = res.headers.get('Content-Type') || '';
      const data = contentType.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) {
        const message = (data && data.error) || `Request failed: ${res.status}`;
        throw new Error(message);
      }
      return { data };
    },
  },
};
