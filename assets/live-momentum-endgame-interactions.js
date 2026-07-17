(() => {
  const DRAG_THRESHOLD = 8;
  const DRAG_DIRECTION_BIAS = 1.12;
  const CLICK_SUPPRESSION_MS = 350;
  const EDGE_SCROLL_ZONE = 72;
  const MAX_EDGE_SCROLL_STEP = 18;
  const WHEEL_EASING = 0.16;
  const MAX_WHEEL_STEP = 48;

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

  function createController({ track, scrollContainer, isReady, onOrderChange }) {
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    let dragState = null;
    let suppressClickUntil = 0;
    let wheelTarget = scrollContainer?.scrollLeft || 0;
    let wheelFrame = 0;

    const getCards = () => Array.from(track.querySelectorAll('[data-end-game-card-id]'));
    const getVisibleCardIds = () => getCards().map((card) => card.dataset.endGameCardId).filter(Boolean);

    function cancelWheelScroll() {
      if (wheelFrame) window.cancelAnimationFrame(wheelFrame);
      wheelFrame = 0;
      wheelTarget = scrollContainer?.scrollLeft || 0;
      scrollContainer?.classList.remove('is-wheel-scrolling');
    }

    function animateReflow(previousPositions, draggedCard) {
      if (prefersReducedMotion) return;
      getCards().forEach((card) => {
        if (card === draggedCard || !previousPositions.has(card)) return;
        const offset = previousPositions.get(card) - card.getBoundingClientRect().left;
        if (Math.abs(offset) < 1) return;
        card.style.transition = 'none';
        card.style.transform = `translate3d(${offset}px, 0, 0)`;
        window.requestAnimationFrame(() => {
          card.style.transition = 'transform 180ms cubic-bezier(.2, .8, .2, 1)';
          card.style.transform = '';
          window.setTimeout(() => {
            if (card.style.transform === '') card.style.transition = '';
          }, 190);
        });
      });
    }

    function moveDraggedCard(clientX) {
      const draggedCard = dragState?.card;
      if (!draggedCard) return;
      const siblings = getCards().filter((card) => card !== draggedCard);
      const movableSiblings = siblings.filter((card) => card.dataset.endGameCardFixed !== 'true');
      const fixedEndCard = siblings.find((card) => card.classList.contains('end-game-goal-card--destination')) || null;
      const insertBefore = movableSiblings.find((card) => (
        clientX < card.getBoundingClientRect().left + (card.offsetWidth / 2)
      )) || fixedEndCard;
      if (draggedCard.nextElementSibling === insertBefore || (!insertBefore && draggedCard === track.lastElementChild)) return;

      const previousPositions = new Map(siblings.map((card) => [card, card.getBoundingClientRect().left]));
      const previousLeft = draggedCard.getBoundingClientRect().left;
      if (insertBefore) track.insertBefore(draggedCard, insertBefore);
      else track.append(draggedCard);
      const layoutShift = draggedCard.getBoundingClientRect().left - previousLeft;
      dragState.startX += layoutShift;
      animateReflow(previousPositions, draggedCard);
    }

    function applyEdgeScroll(clientX) {
      if (!scrollContainer) return;
      const bounds = scrollContainer.getBoundingClientRect();
      let scrollStep = 0;
      if (clientX < bounds.left + EDGE_SCROLL_ZONE) {
        scrollStep = -MAX_EDGE_SCROLL_STEP * (1 - ((clientX - bounds.left) / EDGE_SCROLL_ZONE));
      } else if (clientX > bounds.right - EDGE_SCROLL_ZONE) {
        scrollStep = MAX_EDGE_SCROLL_STEP * (1 - ((bounds.right - clientX) / EDGE_SCROLL_ZONE));
      }
      if (scrollStep) scrollContainer.scrollLeft += scrollStep;
    }

    function updateDragPosition(event) {
      const scrollDelta = (scrollContainer?.scrollLeft || 0) - dragState.startScrollLeft;
      const translateX = event.clientX - dragState.startX + scrollDelta;
      dragState.card.style.transform = `translate3d(${translateX}px, 0, 0)`;
    }

    function startDrag(event) {
      dragState.dragging = true;
      suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
      scrollContainer?.classList.add('is-card-reordering');
      dragState.card.classList.add('is-card-dragging');
      dragState.card.setAttribute('aria-grabbed', 'true');
      dragState.card.setPointerCapture?.(event.pointerId);
    }

    function finishDrag(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const { card, dragging } = dragState;
      if (card.hasPointerCapture?.(event.pointerId)) card.releasePointerCapture(event.pointerId);
      dragState = null;
      if (!dragging) return;
      suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
      scrollContainer?.classList.remove('is-card-reordering');
      card.classList.remove('is-card-dragging');
      card.classList.add('is-card-settling');
      card.removeAttribute('aria-grabbed');
      card.style.transform = '';
      window.setTimeout(() => card.classList.remove('is-card-settling'), 190);
      onOrderChange(getVisibleCardIds());
    }

    track.addEventListener('pointerdown', (event) => {
      if (!isReady() || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (event.target.closest('[data-end-game-card-action]')) return;
      const card = event.target.closest('[data-end-game-card-id]');
      if (!card || card.dataset.endGameCardFixed === 'true') return;
      dragState = {
        card,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: scrollContainer?.scrollLeft || 0,
        dragging: false
      };
    });

    track.addEventListener('pointermove', (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (!dragState.dragging) {
        if (Math.abs(deltaY) > DRAG_THRESHOLD && Math.abs(deltaY) >= Math.abs(deltaX)) {
          dragState = null;
          return;
        }
        if (Math.abs(deltaX) < DRAG_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * DRAG_DIRECTION_BIAS) return;
        startDrag(event);
      }
      event.preventDefault();
      applyEdgeScroll(event.clientX);
      moveDraggedCard(event.clientX);
      updateDragPosition(event);
    });

    track.addEventListener('pointerup', finishDrag);
    track.addEventListener('pointercancel', finishDrag);

    track.addEventListener('keydown', (event) => {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key) || event.target.closest('[data-end-game-card-action]')) return;
      const card = event.target.closest('[data-end-game-card-id]');
      if (!card || card.dataset.endGameCardFixed === 'true' || event.target !== card || !isReady()) return;
      const cards = getCards();
      const index = cards.indexOf(card);
      const nextIndex = event.key === 'ArrowLeft' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= cards.length || cards[nextIndex]?.dataset.endGameCardFixed === 'true') return;
      event.preventDefault();
      const previousPositions = new Map(cards.filter((item) => item !== card).map((item) => [item, item.getBoundingClientRect().left]));
      if (event.key === 'ArrowLeft') track.insertBefore(card, cards[nextIndex]);
      else track.insertBefore(card, cards[nextIndex].nextElementSibling);
      animateReflow(previousPositions, card);
      onOrderChange(getVisibleCardIds());
      card.focus();
    });

    function animateWheelScroll() {
      if (!scrollContainer) return;
      const distance = wheelTarget - scrollContainer.scrollLeft;
      if (prefersReducedMotion || Math.abs(distance) < 0.75) {
        scrollContainer.scrollLeft = wheelTarget;
        wheelFrame = 0;
        scrollContainer.classList.remove('is-wheel-scrolling');
        return;
      }
      const step = clamp(distance * WHEEL_EASING, -MAX_WHEEL_STEP, MAX_WHEEL_STEP);
      scrollContainer.scrollLeft += step;
      wheelFrame = window.requestAnimationFrame(animateWheelScroll);
    }

    scrollContainer?.addEventListener('wheel', (event) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const maximum = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
      const base = wheelFrame ? wheelTarget : scrollContainer.scrollLeft;
      const nextTarget = clamp(base + event.deltaY, 0, maximum);
      const canMove = Math.abs(nextTarget - scrollContainer.scrollLeft) > 0.5;
      if (!canMove) return;
      event.preventDefault();
      wheelTarget = nextTarget;
      if (!wheelFrame) {
        scrollContainer.classList.add('is-wheel-scrolling');
        wheelFrame = window.requestAnimationFrame(animateWheelScroll);
      }
    }, { passive: false });

    scrollContainer?.addEventListener('pointerdown', cancelWheelScroll);
    scrollContainer?.addEventListener('scroll', () => {
      if (!wheelFrame) wheelTarget = scrollContainer.scrollLeft;
    }, { passive: true });

    return {
      shouldSuppressClick: () => Boolean(dragState?.dragging) || Date.now() < suppressClickUntil
    };
  }

  window.SoftoraMomentumEndGameInteractions = { createController };
})();
