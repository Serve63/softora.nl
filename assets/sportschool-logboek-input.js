(function (root) {
  'use strict';

  function isExerciseInputActive(documentRef, list) {
    const active = documentRef?.activeElement;
    return Boolean(active && list?.contains?.(active) && active.matches?.('input, textarea'));
  }

  function captureActiveExerciseInput(documentRef, list) {
    const active = documentRef?.activeElement;
    if (!isExerciseInputActive(documentRef, list) || !active?.dataset?.exerciseField) return null;
    return {
      field: active.dataset.exerciseField,
      order: active.dataset.exerciseOrder,
      selectionEnd: active.selectionEnd,
      selectionStart: active.selectionStart,
    };
  }

  function restoreActiveExerciseInput(list, focusState) {
    if (!focusState || !list?.querySelector) return;
    const selector =
      `[data-exercise-order="${focusState.order}"] [data-exercise-field="${focusState.field}"]`;
    const input = list.querySelector(selector);
    if (!input) return;
    input.focus({ preventScroll: true });
    if (Number.isInteger(focusState.selectionStart) && Number.isInteger(focusState.selectionEnd)) {
      try {
        input.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
      } catch (_error) {
        // Niet elk mobiel invoertype ondersteunt selectieherstel.
      }
    }
  }

  const api = { captureActiveExerciseInput, isExerciseInputActive, restoreActiveExerciseInput };
  if (root) root.SoftoraSportschoolLogbookInput = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
