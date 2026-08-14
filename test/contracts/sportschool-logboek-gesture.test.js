const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPLETE_WIDTH,
  DELETE_WIDTH,
  classifySwipeIntent,
  resolveSwipeEnd,
  swipeOffset,
} = require('../../assets/sportschool-logboek-gesture');

test('verticale touchbeweging blijft scrollen en opent geen kaartactie', () => {
  assert.equal(classifySwipeIntent({ dx: 7, dy: 46, startOffset: 0 }), 'scroll');
  assert.equal(classifySwipeIntent({ dx: 8, dy: 5, startOffset: 0 }), 'pending');
});

test('linksswipe schakelt voltooid vloeiend aan en weer uit', () => {
  const intent = classifySwipeIntent({ dx: -74, dy: 5, startOffset: 0 });
  const offset = swipeOffset({ intent, dx: -74, startOffset: 0 });
  assert.equal(intent, 'complete');
  assert.equal(offset, -74);
  assert.deepEqual(resolveSwipeEnd({ intent, offset, dx: -74, completed: false }), {
    action: 'toggle-complete',
    completed: true,
    targetOffset: 0,
  });
  assert.equal(resolveSwipeEnd({ intent, offset, dx: -74, completed: true }).completed, false);
  assert.equal(swipeOffset({ intent, dx: -200, startOffset: 0 }), -COMPLETE_WIDTH);
});

test('rechtsswipe opent alleen verwijderen na duidelijke horizontale intentie', () => {
  const intent = classifySwipeIntent({ dx: 72, dy: 4, startOffset: 0 });
  const offset = swipeOffset({ intent, dx: 72, startOffset: 0 });
  assert.equal(intent, 'delete');
  assert.equal(offset, 72);
  assert.deepEqual(resolveSwipeEnd({ intent, offset, dx: 72, completed: false }), {
    action: 'open-delete',
    completed: false,
    targetOffset: DELETE_WIDTH,
  });
});

test('linksswipe op een geopende verwijderactie sluit eerst zonder af te vinken', () => {
  const intent = classifySwipeIntent({ dx: -90, dy: 3, startOffset: DELETE_WIDTH });
  const offset = swipeOffset({ intent, dx: -90, startOffset: DELETE_WIDTH });
  const result = resolveSwipeEnd({ intent, offset, dx: -90, startOffset: DELETE_WIDTH, completed: false });
  assert.equal(intent, 'delete');
  assert.equal(offset, 18);
  assert.deepEqual(result, { action: 'close', completed: false, targetOffset: 0 });
});

test('pointercancel commit nooit een swipeactie', () => {
  assert.deepEqual(
    resolveSwipeEnd({ intent: 'complete', offset: -90, dx: -90, completed: false, cancelled: true }),
    { action: 'close', completed: false, targetOffset: 0 }
  );
});
