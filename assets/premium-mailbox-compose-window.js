(function (global) {
  'use strict';

  const DESKTOP_BREAKPOINT = 900, VIEWPORT_MARGIN = 8, MIN_WIDTH = 560, MIN_HEIGHT = 480;

  function create(options = {}) {
    const documentRef = options.document || global.document;
    const windowRef = options.window || global;
    const overlay = documentRef?.getElementById('compose-overlay');
    const box = overlay?.querySelector?.('.compose-box');
    const handle = overlay?.querySelector?.('[data-mailbox-compose-drag-handle]');
    const resizeZones = Array.from(overlay?.querySelectorAll?.('[data-mailbox-compose-resize-zone]') || []);
    const closeButton = overlay?.querySelector?.('[data-mailbox-action="close-compose"]');
    let drag = null;
    let resize = null;

    function viewport() { return { width: Number(windowRef.innerWidth) || documentRef?.documentElement?.clientWidth || 0, height: Number(windowRef.innerHeight) || documentRef?.documentElement?.clientHeight || 0 }; }

    function limits() {
      const current = viewport();
      const maxWidth = Math.max(320, current.width - (VIEWPORT_MARGIN * 2)), maxHeight = Math.max(320, current.height - (VIEWPORT_MARGIN * 2));
      return { ...current, maxWidth, maxHeight, minWidth: Math.min(MIN_WIDTH, maxWidth), minHeight: Math.min(MIN_HEIGHT, maxHeight) };
    }

    function isDesktop() { return viewport().width > DESKTOP_BREAKPOINT; }

    function reset() {
      drag = null;
      resize = null;
      ['data-compose-dragging', 'data-compose-resizing', 'data-compose-sized'].forEach((attribute) => box?.removeAttribute?.(attribute));
      ['position', 'left', 'top', 'width', 'height', 'maxWidth', 'maxHeight', 'margin', 'animation'].forEach(
        (property) => box?.style?.removeProperty?.(property)
      );
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max));
    }

    function place(left, top, width, height) {
      Object.assign(box.style, {
        position: 'fixed', left: `${Math.round(left)}px`, top: `${Math.round(top)}px`,
        width: `${Math.round(width)}px`, height: `${Math.round(height)}px`,
        maxWidth: 'none', maxHeight: 'none', margin: '0', animation: 'none',
      });
      box.setAttribute('data-compose-sized', 'true');
    }

    function fitToViewport(center = false) {
      if (!box || !overlay?.classList?.contains?.('open')) return;
      if (!isDesktop()) return reset();
      const rect = box.getBoundingClientRect();
      const bounds = limits();
      const width = clamp(rect.width || 1040, bounds.minWidth, bounds.maxWidth);
      const height = clamp(rect.height || 700, bounds.minHeight, bounds.maxHeight);
      const left = center ? (bounds.width - width) / 2 : rect.left;
      const top = center ? (bounds.height - height) / 2 : rect.top;
      place(clamp(left, VIEWPORT_MARGIN, bounds.width - width - VIEWPORT_MARGIN), clamp(top, VIEWPORT_MARGIN, bounds.height - height - VIEWPORT_MARGIN), width, height);
    }

    function open() { fitToViewport(true); }

    function move(event) {
      if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const bounds = limits();
      place(
        clamp(drag.left + Number(event.clientX - drag.clientX), VIEWPORT_MARGIN, bounds.width - drag.width - VIEWPORT_MARGIN),
        clamp(drag.top + Number(event.clientY - drag.clientY), VIEWPORT_MARGIN, bounds.height - drag.height - VIEWPORT_MARGIN),
        drag.width,
        drag.height
      );
      event.preventDefault?.();
    }

    function stop(event) {
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
      handle?.releasePointerCapture?.(drag.pointerId);
      drag = null;
      box?.removeAttribute?.('data-compose-dragging');
    }

    function start(event) {
      if (!box || !isDesktop() || event.button > 0 || event.target?.closest?.('[data-mailbox-compose-no-drag], button, input, textarea, a, select')) return;
      const rect = box.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      };
      place(drag.left, drag.top, drag.width, drag.height);
      box.setAttribute('data-compose-dragging', 'true');
      handle?.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
    }

    function moveResize(event) {
      if (!resize || (event.pointerId != null && event.pointerId !== resize.pointerId)) return;
      const bounds = limits();
      const deltaX = Number(event.clientX) - resize.clientX;
      const deltaY = Number(event.clientY) - resize.clientY;
      let left = resize.left, top = resize.top, width = resize.width, height = resize.height;
      if (resize.edge.includes('e')) {
        width = clamp(resize.width + deltaX, bounds.minWidth, bounds.width - resize.left - VIEWPORT_MARGIN);
      }
      if (resize.edge.includes('s')) {
        height = clamp(resize.height + deltaY, bounds.minHeight, bounds.height - resize.top - VIEWPORT_MARGIN);
      }
      if (resize.edge.includes('w')) {
        left = clamp(resize.left + deltaX, VIEWPORT_MARGIN, resize.right - bounds.minWidth);
        width = resize.right - left;
      }
      if (resize.edge.includes('n')) {
        top = clamp(resize.top + deltaY, VIEWPORT_MARGIN, resize.bottom - bounds.minHeight);
        height = resize.bottom - top;
      }
      place(left, top, width, height);
      event.preventDefault?.();
      event.stopPropagation?.();
    }

    function stopResize(event) {
      if (!resize || (event?.pointerId != null && event.pointerId !== resize.pointerId)) return;
      resize.zone?.releasePointerCapture?.(resize.pointerId);
      resize = null;
      box?.removeAttribute?.('data-compose-resizing');
      event?.stopPropagation?.();
    }

    function startResize(event) {
      if (!box || !isDesktop() || event.button > 0) return;
      const zone = event.currentTarget;
      const edge = String(zone?.dataset?.mailboxComposeResizeZone || '').trim().toLowerCase();
      if (!/^(n|ne|e|se|s|sw|w|nw)$/.test(edge)) return;
      const rect = box.getBoundingClientRect();
      resize = {
        pointerId: event.pointerId,
        zone,
        edge,
        clientX: Number(event.clientX),
        clientY: Number(event.clientY),
        left: rect.left,
        top: rect.top,
        right: rect.right ?? (rect.left + rect.width),
        bottom: rect.bottom ?? (rect.top + rect.height),
        width: rect.width,
        height: rect.height,
      };
      box.setAttribute('data-compose-resizing', 'true');
      zone?.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
      event.stopPropagation?.();
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
      resizeZones.forEach((zone) => {
        zone?.addEventListener?.('pointerdown', startResize);
        zone?.addEventListener?.('pointermove', moveResize);
        zone?.addEventListener?.('pointerup', stopResize);
        zone?.addEventListener?.('pointercancel', stopResize);
      });
      closeButton?.addEventListener?.('pointerdown', (event) => event.stopPropagation?.());
      overlay?.addEventListener?.('wheel', forwardBackgroundWheel, { passive: false });
      windowRef.addEventListener?.('resize', fitToViewport, { passive: true });
    }

    return { bind, fitToViewport, open, reset };
  }

  const api = { create };
  global.SoftoraMailboxComposeWindow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
