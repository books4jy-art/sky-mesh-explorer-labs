import OutfitListRow from './OutfitListRow';

export default function OutfitIconGrid({ items, selectedItem, onSelect }) {
  if (!items || items.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center text-sm text-white/40">
        No items in this category.
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-1">
      {items.map((item) => (
        <OutfitListRow
          key={item.id}
          item={item}
          isSelected={selectedItem === item.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
