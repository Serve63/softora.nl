(function initSportschoolLogbookGesture(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraSportschoolLogbookGesture = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const DELETE_WIDTH = 108;
  const COMPLETE_WIDTH = 96;
  const INTENT_DISTANCE = 10;
  const DIRECTION_BIAS = 1.15;
  const COMMIT_DISTANCE = 56;
  const COMMIT_FLICK_DISTANCE = 48;

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function classifySwipeIntent(options = {}) {
    const dx = finiteNumber(options.dx);
    const dy = finiteNumber(options.dy);
    const startOffset = finiteNumber(options.startOffset);
    const horizontalDistance = Math.abs(dx);
    const verticalDistance = Math.abs(dy);

    if (verticalDistance >= INTENT_DISTANCE && verticalDistance > horizontalDistance * DIRECTION_BIAS) {
      return 'scroll';
    }
    if (horizontalDistance < INTENT_DISTANCE || horizontalDistance <= verticalDistance * DIRECTION_BIAS) {
      return 'pending';
    }
    if (startOffset > 0) return 'delete';
    return dx < 0 ? 'complete' : 'delete';
  }

  function swipeOffset(options = {}) {
    const intent = options.intent;
    const dx = finiteNumber(options.dx);
    const startOffset = finiteNumber(options.startOffset);
    if (intent === 'delete') return clamp(startOffset + dx, 0, DELETE_WIDTH);
    if (intent === 'complete') return -clamp(Math.abs(Math.min(0, dx)), 0, COMPLETE_WIDTH);
    return startOffset;
  }

  function resolveSwipeEnd(options = {}) {
    const intent = options.intent;
    const offset = finiteNumber(options.offset);
    const dx = finiteNumber(options.dx);
    const startOffset = finiteNumber(options.startOffset);
    const completed = options.completed === true;

    if (options.cancelled === true || intent === 'pending' || intent === 'scroll') {
      return {
        action: startOffset > 0 ? 'open-delete' : 'close',
        completed,
        targetOffset: startOffset > 0 ? DELETE_WIDTH : 0,
      };
    }

    if (intent === 'complete') {
      const committed = offset <= -COMMIT_DISTANCE || dx <= -COMMIT_FLICK_DISTANCE;
      return {
        action: committed ? 'toggle-complete' : 'close',
        completed: committed ? !completed : completed,
        targetOffset: 0,
      };
    }

    const shouldOpenDelete = offset >= COMMIT_DISTANCE || (startOffset <= 0 && dx >= COMMIT_FLICK_DISTANCE);
    return {
      action: shouldOpenDelete ? 'open-delete' : 'close',
      completed,
      targetOffset: shouldOpenDelete ? DELETE_WIDTH : 0,
    };
  }

  return {
    COMPLETE_WIDTH,
    DELETE_WIDTH,
    classifySwipeIntent,
    resolveSwipeEnd,
    swipeOffset,
  };
});
