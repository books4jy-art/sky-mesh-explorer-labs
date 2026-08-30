import { Check } from 'lucide-react';
import OutfitTile from './OutfitTile';

// Wraps OutfitTile with selection highlight + click handling.
// OutfitTile's lazy-load / proxy / concurrency logic is untouched.
export default function OutfitSelectableTile({ id, driveFileId, name, isSelected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={isSelected}
      aria-label={name || 'outfit tile'}
      className={`relative w-full rounded-lg ring-2 transition ${
        isSelected ? 'ring-sky-400' : 'ring-transparent hover:ring-white/20'
      }`}
    >
      <OutfitTile driveFileId={driveFileId} name={name} />
      {isSelected && (
        <span className="absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-sky-400 text-black">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
