import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { X, FileBox, Loader2, Search, RefreshCw, Folder, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 50;

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export default function LibraryPanel({ onClose, onPick, loadingFile }) {
  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const browse = useCallback(async (p, s, f) => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('browseMeshFiles', { search: s, folder: f, page: p, pageSize: PAGE_SIZE });
      setFiles(res.data.files || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      setError(e?.message || 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch top-level folders + last sync time on mount
  useEffect(() => {
    base44.functions.invoke('browseMeshFiles', { listFolders: true })
      .then((res) => {
        setFolders(res.data.folders || []);
        setLastSyncedAt(res.data.lastSyncedAt || null);
        setNeedsSync(!!res.data.needsSync);
        setStatusLoaded(true);
      })
      .catch(() => setStatusLoaded(true));
    browse(1, '', '');
  }, [browse]);

  // Debounce the search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Re-fetch when page / debounced search / folder changes
  useEffect(() => { browse(page, debouncedSearch, folder); }, [page, debouncedSearch, folder, browse]);

  const onSearchChange = (val) => { setSearch(val); setPage(1); };
  const onFolderChange = (val) => { setFolder(val); setPage(1); };

  const refresh = async () => {
    setRefreshing(true);
    setRefreshMsg('Syncing library from Drive…');
    try {
      const res = await base44.functions.invoke('syncDriveLibrary', {});
      setRefreshMsg(`Synced ${res.data.synced} new file(s) — ${res.data.total} total.`);
      setNeedsSync(false);
      const r = await base44.functions.invoke('browseMeshFiles', { refreshCache: true, listFolders: true });
      setFolders(r.data.folders || []);
      setLastSyncedAt(r.data.lastSyncedAt || null);
      browse(1, '', '');
    } catch (e) {
      setRefreshMsg('Sync failed: ' + (e?.message || 'unknown error'));
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(''), 6000);
    }
  };

  // Auto-sync the library if the cache is missing or the last sync is older than 24h
  useEffect(() => {
    if (!statusLoaded) return;
    const stale = !lastSyncedAt || (Date.now() - new Date(lastSyncedAt).getTime() > 24 * 60 * 60 * 1000);
    if (!stale && !needsSync) return;
    let cancelled = false;
    setRefreshing(true);
    setRefreshMsg(needsSync ? 'Building library cache…' : 'Auto-syncing library from Drive…');
    base44.functions.invoke('syncDriveLibrary', {})
      .then((res) => {
        if (cancelled) return;
        setRefreshMsg(`Synced ${res.data.synced} file(s) — ${res.data.total} total.`);
        setNeedsSync(false);
        return base44.functions.invoke('browseMeshFiles', { refreshCache: true, listFolders: true });
      })
      .then((r) => {
        if (cancelled || !r) return;
        setFolders(r.data.folders || []);
        setLastSyncedAt(r.data.lastSyncedAt || null);
        browse(1, '', '');
        setTimeout(() => { if (!cancelled) setRefreshMsg(''); }, 5000);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRefreshing(false); });
    return () => { cancelled = true; };
  }, [statusLoaded, lastSyncedAt, needsSync, browse]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0d12] p-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileBox className="h-5 w-5 text-sky-300" />
            <h2 className="text-sm font-medium tracking-wide text-white/90">Mesh Library</h2>
            <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/60">{total.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={refresh} disabled={refreshing} className="flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-white/80 disabled:opacity-40">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={onClose} className="ml-1 text-white/40 transition-colors hover:text-white/80"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {refreshMsg && (
          <p className="mt-2 text-[11px] text-sky-300/80">{refreshMsg}</p>
        )}

        {/* Search + folder filter */}
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search models…"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white/90 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
          </div>
          <div className="relative">
            <Folder className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <select
              value={folder}
              onChange={(e) => onFolderChange(e.target.value)}
              className="appearance-none rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-7 text-sm text-white/80 focus:border-white/30 focus:outline-none"
            >
              <option value="" className="bg-[#0b0d12]">All folders</option>
              {folders.map((f) => <option key={f} value={f} className="bg-[#0b0d12]">{f}</option>)}
            </select>
          </div>
        </div>

        {/* File list */}
        <div className="mt-3 max-h-[50vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-white/40"><Loader2 className="h-5 w-5 animate-spin" /></div>
          )}
          {error && <p className="py-8 text-center text-xs text-red-300/80">{error}</p>}
          {!loading && !error && files.length === 0 && <p className="py-8 text-center text-xs text-white/40">No matching .obj files.</p>}
          {!loading && !error && files.map((f) => (
            <button
              key={f.driveFileId}
              onClick={() => onPick(f)}
              disabled={loadingFile}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-white/80 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              <span className="truncate">{f.name}</span>
              <span className="ml-3 shrink-0 font-mono text-[11px] text-white/35">{formatSize(f.size)}</span>
            </button>
          ))}
        </div>

        {/* Pagination */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-white/45">
          <span>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="rounded p-1 transition-colors hover:text-white/80 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="rounded p-1 transition-colors hover:text-white/80 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {loadingFile && (
          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-white/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading model…</div>
        )}
      </div>
    </div>
  );
}
