import { Check } from 'lucide-react';
import OutfitTile from './OutfitTile';
import { deriveObjDisplayName } from '@/lib/deriveObjName';

// Single-column list row: icon left (same proxy/lazy-load/WIP as OutfitTile),
// derived .obj name right. Selection ring + checkmark behave identically to the
// previous tile grid.
export default function OutfitListRow({ item, isSelected, onSelect }) {
  const label = deriveObjDisplayName(item.objFileName, item.category, item.name);
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-pressed={isSelected}
      aria-label={label}
      className={`relative flex w-full items-center gap-3 rounded-lg px-2 py-1 text-left transition ${
        isSelected ? 'ring-2 ring-sky-400 bg-white/[0.04]' : 'ring-2 ring-transparent hover:ring-white/20'
      }`}
    >
      <div className="relative h-12 w-12 shrink-0">
        <OutfitTile driveFileId={item.driveFileId} name={item.name} />
        {isSelected && (
          <span className="absolute top-0 right-0 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-sky-400 text-black">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <span className="truncate text-sm text-white/80">{label}</span>
    </button>
  );
}
