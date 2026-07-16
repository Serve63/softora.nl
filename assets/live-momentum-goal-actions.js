(() => {
  const DRAG_THRESHOLD_PX = 6;
  const CLICK_SUPPRESSION_MS = 350;

  function createController({ grid, getGoalRows }) {
    let pointerGesture = null;
    let suppressClickUntil = 0;

    function reset(actions) {
      const removeButton = actions?.querySelector('[data-goal-action="remove"]');
      if (!removeButton) {
        return;
      }
      removeButton.dataset.confirmRemove = 'false';
      removeButton.textContent = 'Verwijderen';
    }

    function close(options = {}) {
      getGoalRows().forEach((row) => {
        const actions = row.querySelector('.goal-row-actions');
        const handle = row.querySelector('.goal-drag-handle');
        if (!actions || actions.hidden) {
          return;
        }
        actions.hidden = true;
        handle?.setAttribute('aria-expanded', 'false');
        reset(actions);
        if (options.restoreFocus === true && row.dataset.goalId === options.goalId) {
          handle?.focus();
        }
      });
    }

    function position(actions, handle) {
      const handleRect = handle.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const viewportPadding = 8;
      const preferredTop = handleRect.bottom + 6;
      const fallbackTop = handleRect.top - actionsRect.height - 6;
      actions.style.left = `${Math.max(viewportPadding, Math.min(
        window.innerWidth - actionsRect.width - viewportPadding,
        handleRect.right - actionsRect.width
      ))}px`;
      actions.style.top = `${preferredTop + actionsRect.height <= window.innerHeight - viewportPadding
        ? preferredTop
        : Math.max(viewportPadding, fallbackTop)}px`;
    }

    function toggle(handle) {
      const row = handle?.closest('.habit-name');
      const actions = row?.querySelector('.goal-row-actions');
      if (!row || !actions) {
        return;
      }
      const shouldOpen = actions.hidden;
      close();
      if (!shouldOpen) {
        return;
      }
      actions.hidden = false;
      handle.setAttribute('aria-expanded', 'true');
      reset(actions);
      position(actions, handle);
      actions.querySelector('[data-goal-action="remove"]')?.focus();
    }

    function suppressClick() {
      suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
      close();
    }

    function handlePointerDown(event) {
      const handle = event.target.closest('.goal-drag-handle');
      if (!handle || !grid.contains(handle)) {
        return;
      }
      pointerGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };
    }

    function handlePointerMove(event) {
      if (!pointerGesture || pointerGesture.pointerId !== event.pointerId || pointerGesture.moved) {
        return;
      }
      const distance = Math.hypot(event.clientX - pointerGesture.startX, event.clientY - pointerGesture.startY);
      if (distance >= DRAG_THRESHOLD_PX) {
        pointerGesture.moved = true;
        suppressClick();
      }
    }

    function clearPointerGesture(event) {
      if (pointerGesture?.pointerId === event.pointerId) {
        pointerGesture = null;
      }
    }

    return {
      clearPointerGesture,
      close,
      create(goal) {
        const actions = document.createElement('div');
        const removeButton = document.createElement('button');
        actions.className = 'goal-row-actions';
        actions.hidden = true;
        actions.setAttribute('role', 'menu');
        actions.setAttribute('aria-label', `Acties voor ${goal.label || 'dit doel'}`);
        removeButton.className = 'goal-remove-action';
        removeButton.type = 'button';
        removeButton.dataset.goalAction = 'remove';
        removeButton.dataset.confirmRemove = 'false';
        removeButton.setAttribute('role', 'menuitem');
        removeButton.textContent = 'Verwijderen';
        actions.append(removeButton);
        return actions;
      },
      handlePointerDown,
      handlePointerMove,
      isClickSuppressed: () => Date.now() < suppressClickUntil,
      reset,
      suppressClick,
      toggle
    };
  }

  window.SoftoraMomentumGoalActions = { createController };
})();
