export function attachStageGestures(element, { onPinch, onSwipeEv, onTap }) {
  const pointers = new Map();
  let pinchDistance = 0;
  let single = null;

  const distance = () => {
    const [a, b] = pointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function handleDown(e) {
    element.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      single = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        lastY: e.clientY,
        startedAt: performance.now(),
        moved: false,
        swiping: false,
      };
    } else if (pointers.size === 2) {
      single = null;
      pinchDistance = distance();
    }
  }

  function handleMove(e) {
    const pointer = pointers.get(e.pointerId);
    if (!pointer) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;

    if (pointers.size === 2) {
      const d = distance();
      if (pinchDistance > 0 && d > 0) onPinch(d / pinchDistance);
      pinchDistance = d;
      return;
    }

    if (!single || single.id !== e.pointerId) return;
    const dx = e.clientX - single.x;
    const dy = e.clientY - single.y;
    if (Math.hypot(dx, dy) > 10) single.moved = true;
    if (!single.swiping && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.5) single.swiping = true;
    if (single.swiping) onSwipeEv(-(e.clientY - single.lastY) * 0.012);
    single.lastY = e.clientY;
  }

  function handleEnd(e, cancelled) {
    const wasSingle = single && single.id === e.pointerId;
    if (wasSingle && !cancelled && !single.moved && performance.now() - single.startedAt < 300) {
      onTap(single.x, single.y);
    }
    pointers.delete(e.pointerId);
    if (wasSingle) single = null;
    if (pointers.size < 2) pinchDistance = 0;
  }

  const onUp = (e) => handleEnd(e, false);
  const onCancel = (e) => handleEnd(e, true);

  element.addEventListener('pointerdown', handleDown);
  element.addEventListener('pointermove', handleMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onCancel);

  return () => {
    element.removeEventListener('pointerdown', handleDown);
    element.removeEventListener('pointermove', handleMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onCancel);
  };
}
