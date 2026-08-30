// Shared "list children of a Drive folder, one page at a time" helper used by
// the maintenance scripts under server/scripts/.
export async function listChildren(folderId, auth, fields = 'files(id,name,mimeType),nextPageToken') {
  const children = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields,
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 600));
      res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth });
    }
    if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const f of data.files || []) children.push(f);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return children;
}

export function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const eq = arg.match(/^--([^=]+)=(.*)$/);
    const flag = arg.match(/^--([^=]+)$/);
    if (eq) out[eq[1]] = eq[2];
    else if (flag) out[flag[1]] = true;
  }
  return out;
}
