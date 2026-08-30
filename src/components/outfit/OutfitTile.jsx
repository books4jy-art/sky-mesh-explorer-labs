import { useEffect, useRef, useState } from 'react';

const PROXY_URL = '/api/functions/getOutfitIconImage';
const PLACEHOLDER_DRIVE_FILE_ID = '1Or3YuWpZjH4WOqVLgp812Q0hRmzSonUP';
const PLACEHOLDER_PROXY_URL = `${PROXY_URL}?driveFileId=${PLACEHOLDER_DRIVE_FILE_ID}`;
const MAX_CONCURRENCY = 6;
const RETRY_DELAY = 800;

// Module-level concurrency limiter — shared across all tile instances
let activeCount = 0;
const pendingCallbacks = [];

function acquireSlot(callback) {
  if (activeCount < MAX_CONCURRENCY) {
    activeCount++;
    callback();
  } else {
    pendingCallbacks.push(callback);
  }
}

function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1);
  if (pendingCallbacks.length > 0 && activeCount < MAX_CONCURRENCY) {
    activeCount++;
    const next = pendingCallbacks.shift();
    next();
  }
}

export default function OutfitTile({ driveFileId, name }) {
  const [isInView, setIsInView] = useState(false);
  const [src, setSrc] = useState(undefined);
  const containerRef = useRef(null);
  const slotAcquiredRef = useRef(false);
  const hasRetriedRef = useRef(false);
  const hasFallenBackRef = useRef(false);
  const unmountedRef = useRef(false);
  const retryTimeoutRef = useRef(null);

  const tileUrl = driveFileId
    ? `${PROXY_URL}?driveFileId=${driveFileId}`
    : PLACEHOLDER_PROXY_URL;

  // IntersectionObserver: detect when tile is near viewport, then stop observing
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px', threshold: 0 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Acquire concurrency slot and set src when tile enters viewport
  useEffect(() => {
    if (!isInView) return;
    let cancelled = false;
    const load = () => {
      if (cancelled || unmountedRef.current) {
        releaseSlot();
        return;
      }
      slotAcquiredRef.current = true;
      setSrc(tileUrl);
    };
    acquireSlot(load);
    return () => {
      cancelled = true;
      if (slotAcquiredRef.current) {
        releaseSlot();
        slotAcquiredRef.current = false;
      }
    };
  }, [isInView, tileUrl]);

  // Cleanup on unmount: release slot, clear retry timer
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (slotAcquiredRef.current) releaseSlot();
    };
  }, []);

  const handleLoad = () => {
    if (slotAcquiredRef.current) {
      releaseSlot();
      slotAcquiredRef.current = false;
    }
  };

  const handleError = () => {
    if (slotAcquiredRef.current) {
      releaseSlot();
      slotAcquiredRef.current = false;
    }
    if (unmountedRef.current) return;

    if (!hasRetriedRef.current) {
      hasRetriedRef.current = true;
      retryTimeoutRef.current = setTimeout(() => {
        if (unmountedRef.current) return;
        acquireSlot(() => {
          if (unmountedRef.current) {
            releaseSlot();
            return;
          }
          slotAcquiredRef.current = true;
          setSrc(`${tileUrl}&_r=1`);
        });
      }, RETRY_DELAY);
    } else if (!hasFallenBackRef.current) {
      hasFallenBackRef.current = true;
      setSrc(PLACEHOLDER_PROXY_URL);
    }
  };

  return (
    <div ref={containerRef} className="aspect-square rounded-lg overflow-hidden bg-white/5">
      {src !== undefined && (
        <img
          src={src}
          className="w-full h-full object-contain"
          alt={name || ''}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  );
}
