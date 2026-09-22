const test = require('node:test');
const assert = require('node:assert/strict');
const { resumeWebsitePreviewBatch } = require('../../assets/premium-websitegenerator-job-resume');

async function resume({ storedId = '', status }) {
  let savedId = storedId;
  let polls = 0;
  let shells = 0;
  const context = {
    window: { location: { pathname: '/premium-websitegenerator' } },
    document: { getElementById: () => ({}) },
    getStoredWebsitePreviewBatchJobId: () => savedId,
    clearStoredWebsitePreviewBatchJobId: () => { savedId = ''; },
    setStoredWebsitePreviewBatchJobId: id => { savedId = id; },
    mountScanBatchShell: () => { shells += 1; },
    scheduleWebsitePreviewBatchPoll: () => { polls += 1; },
    fetch: async () => ({ ok: true, json: async () => ({ job: { id: 'rob-job', status } }) }),
  };
  await resumeWebsitePreviewBatch(context);
  return { savedId, polls, shells };
}

for (const status of ['error', 'done']) {
  for (const storedId of ['', 'rob-job']) {
    test(`page refresh does not revive a ${status} job with stored id ${Boolean(storedId)}`, async () => {
      assert.deepEqual(await resume({ status, storedId }), { savedId: '', polls: 0, shells: 0 });
    });
  }
}
for (const storedId of ['', 'rob-job']) {
  test(`page refresh resumes a running job with stored id ${Boolean(storedId)}`, async () => {
    assert.deepEqual(await resume({ status: 'running', storedId }), { savedId: 'rob-job', polls: 1, shells: 1 });
  });
}
