'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/** Match the desktop container breakpoint, including a narrow dashboard preview. */
export function useProfileViewport() {
  const surface = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const measure = () => setCompact(element.clientWidth <= 960);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { surface, compact };
}
