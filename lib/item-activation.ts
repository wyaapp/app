type ItemClick = { detail: number; timeStamp: number; clientX: number; clientY: number };

/** Mouse uses the OS double-click threshold; touch and pen use a short double tap. */
export function createItemActivation() {
  let pointerType = 'mouse';
  let lastTap: ItemClick | null = null;
  return {
    pointerDown(type: string) {
      pointerType = type;
    },
    cancel() {
      lastTap = null;
    },
    click(event: ItemClick, selected: boolean) {
      if (pointerType === 'mouse' || event.detail === 0) {
        lastTap = null;
        return false;
      }
      const elapsed = lastTap ? event.timeStamp - lastTap.timeStamp : Infinity;
      if (
        selected &&
        lastTap &&
        elapsed >= 0 &&
        elapsed <= 400 &&
        Math.hypot(event.clientX - lastTap.clientX, event.clientY - lastTap.clientY) <= 24
      ) {
        lastTap = null;
        return true;
      }
      lastTap = {
        detail: event.detail,
        timeStamp: event.timeStamp,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      return false;
    },
    doubleClick() {
      // Touch can also emit dblclick after the second click. Open only once.
      return pointerType === 'mouse';
    },
  };
}
