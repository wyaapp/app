'use client';

import { useEffect, useState } from 'react';

// Keep the window (and any editor inside it) alive until its exit finishes.
export function useWindowPresence(open: boolean, active: boolean, layer: number) {
  const [snapshot, setSnapshot] = useState({ open, closing: false, active, layer });

  if (snapshot.open !== open) {
    setSnapshot({
      open,
      closing: !open,
      active: open ? active : snapshot.active,
      layer: open ? layer : snapshot.layer,
    });
  } else if (open && (snapshot.active !== active || snapshot.layer !== layer)) {
    setSnapshot({ ...snapshot, active, layer });
  }

  function finishExit() {
    setSnapshot((current) =>
      current.open || !current.closing ? current : { ...current, closing: false },
    );
  }

  useEffect(() => {
    if (open || !snapshot.closing) return;
    // Also finish when motion is disabled or the browser cancels the animation.
    const timeout = window.setTimeout(finishExit, 200);
    return () => window.clearTimeout(timeout);
  }, [open, snapshot.closing]);

  return {
    present: open || snapshot.closing,
    active: open ? active : snapshot.active,
    layer: open ? layer : snapshot.layer,
    state: open ? 'open' : snapshot.closing ? 'closing' : 'closed',
    finishExit,
  };
}
