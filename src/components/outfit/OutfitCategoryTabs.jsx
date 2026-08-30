export default function OutfitCategoryTabs({ categories, active, onChange }) {
  return (
    <div role="tablist" aria-label="Outfit categories" className="flex gap-2 overflow-x-auto">
      {categories.map((cat) => (
        <button
          key={cat}
          type="button"
          role="tab"
          aria-selected={active === cat}
          onClick={() => onChange(cat)}
          className={`shrink-0 inline-flex h-11 min-w-[44px] items-center justify-center rounded-full px-4 text-sm transition-colors ${active === cat ? 'bg-sky-400 text-slate-900' : 'bg-white/5 text-white/60 hover:text-white/90'}`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
