(function (global) {
  'use strict';

  function create(options = {}) {
    const documentRef = options.document || global.document;
    const windowRef = options.window || global;
    const overlay = documentRef?.getElementById('compose-overlay');
    const box = overlay?.querySelector?.('.compose-box');
    const handle = overlay?.querySelector?.('[data-mailbox-compose-drag-handle]');
    let drag = null;

    function reset() {
      drag = null;
      box?.removeAttribute?.('data-compose-dragging');
      ['position', 'left', 'top', 'width', 'maxWidth', 'margin', 'animation'].forEach(
        (property) => box?.style?.removeProperty?.(property)
      );
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max));
    }

    function move(event) {
      if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const viewportWidth = Number(windowRef.innerWidth) || documentRef?.documentElement?.clientWidth || drag.width;
      const viewportHeight = Number(windowRef.innerHeight) || documentRef?.documentElement?.clientHeight || drag.height;
      const left = clamp(drag.left + Number(event.clientX - drag.clientX), 8, viewportWidth - drag.width - 8);
      const top = clamp(drag.top + Number(event.clientY - drag.clientY), 8, viewportHeight - drag.height - 8);
      box.style.left = `${Math.round(left)}px`;
      box.style.top = `${Math.round(top)}px`;
      event.preventDefault?.();
    }

    function stop(event) {
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
      handle?.releasePointerCapture?.(drag.pointerId);
      drag = null;
      box?.removeAttribute?.('data-compose-dragging');
    }

    function start(event) {
      if (!box || event.button > 0 || event.target?.closest?.('button, input, textarea, a, select')) return;
      const rect = box.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      Object.assign(box.style, {
        position: 'fixed',
        left: `${Math.round(rect.left)}px`,
        top: `${Math.round(rect.top)}px`,
        width: `${Math.round(rect.width)}px`,
        maxWidth: 'none',
        margin: '0',
        animation: 'none',
      });
      box.setAttribute('data-compose-dragging', 'true');
      handle?.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
    }

    function isScrollable(element) {
      if (!element || element === documentRef?.body) return false;
      const style = windowRef.getComputedStyle?.(element);
      const overflow = `${style?.overflow || ''} ${style?.overflowY || ''} ${style?.overflowX || ''}`;
      return /(auto|scroll)/.test(overflow) && (
        Number(element.scrollHeight) > Number(element.clientHeight) ||
        Number(element.scrollWidth) > Number(element.clientWidth)
      );
    }

    function findScrollTarget(element) {
      let candidate = element;
      while (candidate && candidate !== documentRef?.documentElement) {
        if (isScrollable(candidate)) return candidate;
        candidate = candidate.parentElement;
      }
      return documentRef?.scrollingElement || documentRef?.documentElement;
    }

    function forwardBackgroundWheel(event) {
      if (!overlay?.classList?.contains('open') || box?.contains?.(event.target)) return;
      const previousPointerEvents = overlay.style.pointerEvents;
      overlay.style.pointerEvents = 'none';
      const behind = documentRef?.elementFromPoint?.(event.clientX, event.clientY);
      overlay.style.pointerEvents = previousPointerEvents;
      const scrollTarget = findScrollTarget(behind);
      if (!scrollTarget) return;
      if (typeof scrollTarget.scrollBy === 'function') {
        scrollTarget.scrollBy({ left: event.deltaX, top: event.deltaY, behavior: 'auto' });
      } else {
        scrollTarget.scrollLeft += Number(event.deltaX) || 0;
        scrollTarget.scrollTop += Number(event.deltaY) || 0;
      }
      event.preventDefault?.();
    }

    function bind() {
      handle?.addEventListener?.('pointerdown', start);
      handle?.addEventListener?.('pointermove', move);
      handle?.addEventListener?.('pointerup', stop);
      handle?.addEventListener?.('pointercancel', stop);
      overlay?.addEventListener?.('wheel', forwardBackgroundWheel, { passive: false });
      windowRef.addEventListener?.('resize', reset);
    }

    return { bind, reset };
  }

  const api = { create };
  global.SoftoraMailboxComposeWindow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
