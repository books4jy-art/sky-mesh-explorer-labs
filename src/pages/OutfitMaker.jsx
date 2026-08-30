import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import OutfitCategoryTabs from '@/components/outfit/OutfitCategoryTabs';
import OutfitIconGrid from '@/components/outfit/OutfitIconGrid';
import OutfitPreviewPanel from '@/components/outfit/OutfitPreviewPanel';
import { orderCategories, extraCategories } from '@/lib/outfitTaxonomy';
import { sortItemsByGroupKey } from '@/lib/outfitGroupSort';

export default function OutfitMaker() {
  const [items, setItems] = useState(null);
  const [cats, setCats] = useState([]);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  // In-memory selection: one id per category. { [category]: itemId }
  const [selected, setSelected] = useState({});

  const handleSelect = (category, id) => {
    setSelected((prev) => {
      if (prev[category] === id) {
        const next = { ...prev };
        delete next[category];
        return next;
      }
      return { ...prev, [category]: id };
    });
  };

  const clearOutfit = () => setSelected({});

  useEffect(() => {
    base44.functions.invoke('outfitCatalog', {})
      .then((res) => {
        const data = res.data || res;
        const items = data.items || [];
        setItems(items);
        const catsFromRes = data.categories || [];
        setCats(catsFromRes);
        const found = catsFromRes.map((c) => c.category);
        const extras = extraCategories(found);
        if (extras.length) console.info('[OutfitMaker] extra categories appended:', extras);
        setActive(orderCategories(found)[0] || null);
      })
      .catch((e) => setError(e?.message || 'Failed to load outfit catalog'));
  }, []);

  const categories = cats.length ? orderCategories(cats.map((c) => c.category)) : [];

  if (error) {
    return (
      <div className="min-h-screen bg-[#0b0d12] text-white p-10">
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }
  if (items === null) {
    return (
      <div className="min-h-screen bg-[#0b0d12] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  const activeItems = active ? sortItemsByGroupKey((items || []).filter((i) => i.category === active)) : [];
  const selectedCount = Object.keys(selected).length;

  return (
    <div className="min-h-screen bg-[#0b0d12] text-white px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white/80">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
          <h1 className="text-sm font-medium tracking-[0.2em] uppercase text-white/40">Outfit Maker</h1>
        </div>
        <button
          type="button"
          onClick={clearOutfit}
          disabled={selectedCount === 0}
          className="text-xs px-3 py-1.5 rounded-md border border-white/15 text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          Clear outfit{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
      </div>
      <div className="md:grid md:grid-cols-[1fr_340px] md:gap-6">
        <div className="md:order-1 min-w-0">
          <OutfitCategoryTabs categories={categories} active={active} onChange={setActive} />
          <OutfitIconGrid
            items={activeItems}
            selectedItem={active ? selected[active] : undefined}
            onSelect={(id) => handleSelect(active, id)}
          />
        </div>
        <div className="md:order-2 md:sticky md:top-5 md:self-start">
          <OutfitPreviewPanel selected={selected} items={items || []} />
        </div>
      </div>
    </div>
  );
}
