async function resumeWebsitePreviewBatch(deps) {
  const {
    window, document, fetch, getStoredWebsitePreviewBatchJobId,
    clearStoredWebsitePreviewBatchJobId, setStoredWebsitePreviewBatchJobId,
    mountScanBatchShell, scheduleWebsitePreviewBatchPoll,
  } = deps;
  const path = String(window.location.pathname || '');
  if (path.indexOf('premium-websitegenerator') === -1) return;
  const out = document.getElementById('scan-output');
  if (!out) return;

  let jobId = getStoredWebsitePreviewBatchJobId();
  let hasResumed = false;

  if (jobId) {
    try {
      const response = await fetch(`/api/website-preview/batch/${encodeURIComponent(jobId)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload?.job?.id && payload.job.status === 'running') {
          hasResumed = true;
        } else {
          clearStoredWebsitePreviewBatchJobId();
          jobId = '';
        }
      } else if (response.status === 404 || response.status === 403) {
        clearStoredWebsitePreviewBatchJobId();
        jobId = '';
      }
    } catch (_) {
      hasResumed = false;
    }
  }

  if (!jobId || !hasResumed) {
    try {
      const response = await fetch('/api/website-preview/batch/current', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.job?.id && payload.job.status === 'running') {
        jobId = String(payload.job.id);
        setStoredWebsitePreviewBatchJobId(jobId);
      } else {
        clearStoredWebsitePreviewBatchJobId();
        jobId = '';
      }
    } catch (_) {}
  }

  if (!hasResumed && !jobId) return;
  mountScanBatchShell(out, 'Preview hervatten…');
  scheduleWebsitePreviewBatchPoll();
}


if (typeof module === 'object' && module.exports) module.exports = { resumeWebsitePreviewBatch };
if (typeof window !== 'undefined') window.SoftoraWebsitePreviewResume = { resumeWebsitePreviewBatch };
