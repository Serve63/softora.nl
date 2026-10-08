const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function worker(script) {
  const result = spawnSync('python3', ['-c', `
import importlib.util, pathlib, tempfile, json, sys, types
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('worker', 'scripts/webdesign_subscription_worker.py')
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
w.BASE = pathlib.Path(tempfile.mkdtemp())
job = {'id': 'recovery-job-1234567890123456', 'claim': '11111111-1111-1111-1111-111111111111', 'prompt': 'fixture'}
def forbidden(*args, **kwargs): raise AssertionError('Unexpected external action')
w.reference_blank = lambda reference: False
w.urlopen = forbidden
w.subprocess.run = forbidden
def state(slot=0): return json.loads(w.state_file(slot).read_text())
${script}
`], { cwd: path.join(__dirname, '../..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('an incomplete capture rejected before imagegen recovers once using the other provider', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
job['referenceUrls'] = ['https://image.thum.io/get/fixture', 'https://s0.wordpress.com/mshots/v1/fixture']
captures, executions = [], []
def capture(task, target):
 captures.append(task['referenceUrls'])
 reference = target / 'homepage-reference.png'; reference.write_bytes(b'fixture')
 (target / 'reference-attempts.json').write_text(json.dumps([{'provider': 0, 'result': 'ready'}]))
 return reference
w.download_reference = capture
w.codex_binary = lambda: '/fixture/codex'
w.check_job_active = lambda task: None
def execute(args, **kwargs):
 if args[1:3] == ['login', 'status']:
  return types.SimpleNamespace(returncode=0, stdout='ChatGPT', stderr='')
 executions.append(args[args.index('-i') + 1])
 if len(executions) == 1:
  (folder / 'answer.json').write_text(json.dumps({'status': 'blocked', 'generated_images': 0, 'reason': 'bronbeeld onleesbaar: logo en inhoud ontbreken'}))
 else:
  (folder / 'design.png').write_bytes(b'generated-once')
 kwargs['stdout'].write(json.dumps({'type': 'turn.completed'}) + '\\n')
 return types.SimpleNamespace(returncode=0)
w.subprocess.run = execute
w.encode_result = lambda target: (target / 'design.jpg').write_bytes(b'encoded')
w.generate(job, folder)
assert len(executions) == 2 and captures == [job['referenceUrls'], job['referenceUrls'][1:]]
assert executions[0] != executions[1]
assert (folder / 'source-retry' / 'answer.json').exists()
assert (folder / 'design.jpg').exists()
assert w.alternate_reference(job, folder) is None
`));

test('source fallback stops on uncertainty, previous images, quota and a persisted retry', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
job['referenceUrls'] = ['https://image.thum.io/get/fixture', 'https://s0.wordpress.com/mshots/v1/fixture']
(folder / 'homepage-reference.png').write_bytes(b'fixture')
(folder / 'reference-attempts.json').write_text(json.dumps([{'provider': 0, 'result': 'ready'}]))
(folder / 'answer.json').write_text(json.dumps({'status': 'blocked', 'generated_images': 0, 'reason': 'bronbeeld onleesbaar'}))
w.download_reference = forbidden
events = folder / 'codex-events.jsonl'
for entries in [[], [{'type':'turn.started'}], [{'type':'error'}, {'type':'turn.completed'}],
 [{'type':'item.completed','item':{'type':'image_generation'}}, {'type':'turn.completed'}],
 [{'type':'item.completed','item':{'type':'command_execution','command':'generate image'}}, {'type':'turn.completed'}],
 [{'type':'item.completed','item':{'type':'agent_message','text':'usage_limit_reached'}}, {'type':'turn.completed'}]]:
 events.write_text('\\n'.join(json.dumps(entry) for entry in entries))
 assert w.alternate_reference(job, folder) is None
events.write_text(json.dumps({'type':'turn.completed'}))
(folder / 'design.png').write_bytes(b'existing')
assert w.alternate_reference(job, folder) is None
(folder / 'design.png').unlink()
(folder / 'source-retry').mkdir()
assert w.alternate_reference(job, folder) is None
`));

test('a second source rejection never invokes a third model run', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
w.codex_binary = lambda: '/fixture/codex'
w.check_job_active = lambda task: None
w.download_reference = lambda task, target: target / 'reference.png'
alternates, executions = [], []
w.alternate_reference = lambda task, target: (alternates.append(True) or target / 'alternate.png')
def execute(args, **kwargs):
 if args[1:3] == ['login', 'status']:
  return types.SimpleNamespace(returncode=0, stdout='ChatGPT', stderr='')
 executions.append(True)
 (folder / 'answer.json').write_text(json.dumps({'status': 'blocked', 'generated_images': 0, 'reason': 'bronbeeld onleesbaar'}))
 return types.SimpleNamespace(returncode=0)
w.subprocess.run = execute
try: w.generate(job, folder)
except RuntimeError: pass
else: raise AssertionError('Two unusable captures must stop')
assert len(executions) == 2 and len(alternates) == 1
assert w.source_reference_blocked(folder)
`));

test('reference fallback rejects an image of an error page before trying the alternate provider', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
urls = ['https://image.thum.io/get/fixture', 'https://s0.wordpress.com/mshots/v1/fixture']
job['referenceUrls'] = urls
calls = []
w.time.sleep = lambda seconds: None
w.check_job_active = lambda job: None
class Response:
 def __init__(self, data): self.data = data
 def __enter__(self): return self
 def __exit__(self, *args): pass
 def read(self, limit): return self.data
def download(request, **kwargs):
 calls.append(request.full_url)
 return Response(b'\\x89PNG' + (b'blocked' if len(calls) == 1 else b'homepage'))
w.urlopen = download
w.reference_blank = lambda reference: b'blocked' in reference.read_bytes()
reference = w.download_reference(job, folder)
assert calls == urls and reference.read_bytes() == b'\\x89PNGhomepage'
w.reference_blank = lambda reference: True
calls.clear()
try: w.download_reference(job, folder)
except w.ReferenceUnavailable: pass
else: raise AssertionError('Rejected references must stop before generation after bounded retries')
assert calls == urls * 3
w.urlopen = lambda *args, **kwargs: (_ for _ in ()).throw(TimeoutError('offline'))
try: w.download_reference(job, folder)
except w.ReferenceUnavailable: pass
else: raise AssertionError('No reference may not start generation')
`));

test('claim and upload timeouts reuse their checkpoint without repeating generation', () => worker(`
calls, generations = [], []
def offline(route, payload):
 calls.append((route, payload)); raise TimeoutError('response lost')
w.call = offline
try: w.step()
except TimeoutError: pass
claim = state()['claim']
assert state()['phase'] == 'claim'
def recovered(route, payload):
 calls.append((route, payload))
 if route == '/poll':
  assert payload['claim'] == claim
  return {'ok': True, 'job': dict(job, claim=claim)}
 raise TimeoutError('upload response lost')
def generated(job, folder, slot):
 generations.append(job['id'])
 w.write_state({'phase': 'generating', 'job': job}, slot)
 (folder / 'design.jpg').write_bytes(b'fixture')
w.call, w.generate = recovered, generated
try: w.step()
except TimeoutError: pass
assert state()['phase'] == 'deliver' and generations == [job['id']]
w.call = lambda route, payload: (calls.append((route, payload)) or {'ok': True, 'done': True})
w.generate = forbidden
w.step()
assert state() == {} and calls[-1][0] == '/report'
assert calls[-1][1]['dataUrl'] == calls[-2][1]['dataUrl']
`));

test('pending server preparation preserves its existing claim for the next poll', () => worker(`
calls = []
w.call = lambda route, payload: (calls.append(payload) or {'ok': True, 'job': None, 'waiting': True})
w.step(); first = state()
w.step()
assert state() == first and state()['phase'] == 'claim'
assert calls[0]['claim'] == calls[1]['claim']
`));

test('a stopped preparation clears the slot before any authentication or reference request', () => worker(`
w.write_state({'phase': 'prepare', 'job': job})
w.codex_binary = forbidden
w.download_reference = forbidden
calls = []
def stopped(route, payload):
 calls.append((route, payload))
 return {'ok': True, 'allowed': False} if route == '/poll' else {'ok': True, 'done': True}
w.call = stopped
assert w.step() is True
assert state() == {} and [call[0] for call in calls] == ['/poll', '/report']
assert calls[-1][1].get('error') and 'dataUrl' not in calls[-1][1]
`));

test('unconfirmed or transient preparation stays retryable and observes a later job stop', () => worker(`
w.write_state({'phase': 'prepare', 'job': job})
w.codex_binary = forbidden
w.call = lambda *args: {'ok': False}
try: w.step()
except RuntimeError: pass
assert state()['phase'] == 'prepare'
w.codex_binary = lambda: '/fixture/codex'
w.subprocess.run = lambda *args, **kwargs: types.SimpleNamespace(returncode=0, stdout='ChatGPT', stderr='')
w.call = lambda *args: {'ok': True, 'allowed': True}
downloads = []
def unavailable(*args):
 downloads.append(True); raise OSError('reference unavailable')
w.download_reference = unavailable
try: w.step()
except OSError: pass
assert state()['phase'] == 'prepare' and len(downloads) == 1
w.call = lambda route, payload: {'ok': True, 'allowed': False} if route == '/poll' else {'ok': True, 'done': True}
w.step()
assert state() == {} and len(downloads) == 1
`));

test('cancellation during reference preparation cannot cross the generation boundary', () => worker(`
w.write_state({'phase': 'prepare', 'job': job})
w.codex_binary = lambda: '/fixture/codex'
def login(args, **kwargs):
 assert args[1:3] == ['login', 'status']
 return types.SimpleNamespace(returncode=0, stdout='ChatGPT', stderr='')
w.subprocess.run = login
w.download_reference = lambda job, folder: folder / 'reference.png'
heartbeats = []
def heartbeat(route, payload):
 if route == '/report': return {'ok': True, 'done': True}
 heartbeats.append(payload)
 return {'ok': True, 'allowed': len(heartbeats) == 1}
w.call = heartbeat
w.step()
assert state() == {} and len(heartbeats) == 2
assert all(entry['heartbeatJobId'] == job['id'] for entry in heartbeats)
`));

test('a restarted quota failure pauses new work even during upload retry but permits existing deliveries', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
(folder / 'codex-events.jsonl').write_text(json.dumps({'type': 'turn.failed', 'error': {'message': 'usage_limit_reached'}}))
w.write_state({'phase': 'generating', 'job': job})
w.generation_running = lambda folder: False
w.generate = forbidden
reports = []
def offline(route, payload):
 reports.append(payload); raise TimeoutError('report unavailable')
w.call = offline
try: w.step()
except TimeoutError: pass
assert state()['phase'] == 'deliver' and state()['limit'] is True
assert state()['retryAt'] > w.time.time()
assert reports[-1]['errorKind'] == 'subscription-limit'
w.call = forbidden
w.step(1)
assert not w.state_file(1).exists()
other = dict(job, id='other-job-1234567890123456789')
other_folder = w.BASE / other['id']; other_folder.mkdir(); (other_folder / 'design.jpg').write_bytes(b'fixture')
w.write_state({'phase': 'deliver', 'job': other}, 1)
w.call = lambda route, payload: (reports.append(payload) or {'ok': True, 'done': True})
w.step(1)
assert state(1) == {} and reports[-1]['dataUrl'].startswith('data:image/jpeg;base64,')
w.step(0)
assert state()['phase'] == 'cooldown'
w.write_state({'phase': 'cooldown', 'retryAt': w.time.time() - 1})
w.call = lambda route, payload: {'ok': True, 'job': None}
w.step(1)
assert state(1) == {}
`));

test('a peer quota pause appearing during preparation blocks the model boundary', () => worker(`
w.write_state({'phase': 'prepare', 'job': job})
w.codex_binary = lambda: '/fixture/codex'
def login(args, **kwargs):
 assert args[1:3] == ['login', 'status']
 return types.SimpleNamespace(returncode=0, stdout='ChatGPT', stderr='')
w.subprocess.run = login
def reference(job, folder):
 w.write_state({'phase': 'cooldown', 'retryAt': w.time.time() + 600}, 1)
 return folder / 'reference.png'
w.download_reference = reference
w.call = lambda *args: {'ok': True, 'allowed': True}
try: w.step()
except RuntimeError: pass
assert state()['phase'] == 'prepare'
`));

test('blocked source references keep their typed report across generation recovery and report retry without regenerating', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
answer = {'status': 'blocked', 'generated_images': 0, 'reason': 'De referentie toont uitsluitend een Cloudflare-blokkade, geen klantwebsite.'}
(folder / 'answer.json').write_text(json.dumps(answer))
for phase in ('prepare', 'generating'):
 w.write_state({'phase': phase, 'job': job})
 reports, generated = [], []
 def no_image(job, folder, slot):
  generated.append(True)
  w.write_state({'phase': 'generating', 'job': job}, slot)
  raise RuntimeError('No output')
 w.generate = no_image if phase == 'prepare' else forbidden
 w.generation_running = lambda folder: False
 def offline(route, payload):
  assert route == '/report'
  reports.append(payload); raise TimeoutError('response lost')
 w.call = offline
 try: w.step()
 except TimeoutError: pass
 assert state()['phase'] == 'deliver'
 assert reports[-1]['errorKind'] == 'source-reference' and 'dataUrl' not in reports[-1]
 assert 'Cloudflare' not in reports[-1]['error']
 w.generate = forbidden
 w.call = lambda route, payload: (reports.append(payload) or {'ok': True, 'done': True})
 w.step()
 assert state() == {} and reports[0] == reports[1]
 assert len(generated) == (1 if phase == 'prepare' else 0)
`));

test('native image safety failures survive recovery and report retry without another generation', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
events = folder / 'codex-events.jsonl'
native = '2026-10-08T18:34:58.609873Z ERROR codex_core::tools::router: error=image generation failed: http 400 Bad Request: moderation_blocked'
events.write_text(json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': native}}))
assert w.image_safety_blocked(folder) is False
events.write_text(native.replace('moderation_blocked', 'unknown_error'))
assert w.image_safety_blocked(folder) is False
events.write_text(native)
assert w.image_safety_blocked(folder) is True
for name in ('design.png', 'design.jpg'):
 output = folder / name; output.write_bytes(b'existing')
 assert w.image_safety_blocked(folder) is False
 output.unlink()
w.write_state({'phase': 'generating', 'job': job})
w.generation_running = lambda folder: False
w.generate = forbidden
reports = []
def offline(route, payload):
 reports.append(payload); raise TimeoutError('report lost')
w.call = offline
try: w.step()
except TimeoutError: pass
assert state()['phase'] == 'deliver' and reports[0]['errorKind'] == 'image-safety'
assert 'dataUrl' not in reports[0] and 'moderation_blocked' not in reports[0]['error']
w.call = lambda route, payload: (reports.append(payload) or {'ok': True, 'done': True})
w.step()
assert reports[0] == reports[1] and state() == {}
events.unlink(); events.symlink_to(folder / 'outside-events')
assert w.image_safety_blocked(folder) is False
`));

test('source reference classification requires bounded explicit zero-generation evidence and no image', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
answer = folder / 'answer.json'
valid = {'status': 'blocked', 'generated_images': 0, 'reason': 'Het screenshot bevat een onleesbaar bronbeeld.'}
for invalid in ({}, [], dict(valid, status='error'), dict(valid, generated_images=1), dict(valid, generated_images=False), dict(valid, reason='Cloudflare'), dict(valid, reason='referentie mist'), dict(valid, reason='x'*4001)):
 answer.write_text(json.dumps(invalid)); assert w.source_reference_blocked(folder) is False
answer.write_text('{broken'); assert w.source_reference_blocked(folder) is False
answer.write_text('x'*32769); assert w.source_reference_blocked(folder) is False
answer.write_text(json.dumps(valid)); assert w.source_reference_blocked(folder) is True
for name in ('design.png', 'design.jpg'):
 output = folder / name; output.write_bytes(b'existing')
 assert w.source_reference_blocked(folder) is False
 output.unlink()
answer.unlink(); answer.symlink_to(folder / 'outside-answer')
assert w.source_reference_blocked(folder) is False
`));

// No new image request and no endless preparation retry after a rejected source.
test('an unusable screenshot is reported durably before generation and survives a report timeout', () => worker(`
w.write_state({'phase': 'prepare', 'job': job})
def rejected(job, folder, slot): raise w.SourceUnusable('Blank reference')
w.generate = rejected
w.call = lambda route, payload: (_ for _ in ()).throw(TimeoutError('Report timeout'))
try: w.step()
except TimeoutError: pass
assert state()['phase'] == 'deliver' and state()['sourceUnusable'] is True
calls = []
w.generate = forbidden
w.call = lambda route, payload: (calls.append(payload) or {'ok': True, 'done': True})
assert w.step() is True
assert calls[0]['errorKind'] == 'source-reference' and 'dataUrl' not in calls[0]
assert state() == {}
`));


test('the native thumbnail check rejects blank or malformed images while allowing a light page with a colored header', () => worker(`
import struct
reference = w.BASE / 'reference.png'; reference.write_bytes(b'fixture')
def bitmap(dark_rows):
 header = bytearray(54); header[:2] = b'BM'
 struct.pack_into('<I', header, 10, 54); struct.pack_into('<I', header, 14, 40)
 struct.pack_into('<ii', header, 18, 100, 100); struct.pack_into('<HH', header, 26, 1, 24)
 return bytes(header) + bytes([30, 60, 10]) * (100 * dark_rows) + bytes([255]) * (3 * 100 * (100-dark_rows))
current = bitmap(0)
def converted(args, **kwargs):
 pathlib.Path(args[-1]).write_bytes(current)
 return types.SimpleNamespace(returncode=0)
w.subprocess.run = converted
assert w.native_reference_blank(reference) is True
current = bitmap(20)
assert w.native_reference_blank(reference) is False
current = b'invalid'
try: w.native_reference_blank(reference)
except w.SourceUnusable: pass
else: raise AssertionError('Unreadable source must not be silently accepted')
`));


test('loading placeholders recover after backoff without starting image generation', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
job['referenceUrls'] = ['https://image.thum.io/get/fixture', 'https://s0.wordpress.com/mshots/v1/fixture']
calls, sleeps, heartbeats = [], [], []
class Response:
 def __enter__(self): return self
 def __exit__(self, *args): pass
 def read(self, limit): return b'GIF89a loading' if len(calls) <= 2 else b'\\x89PNGready'
w.urlopen = lambda request, **kw: (calls.append(request.full_url) or Response())
w.time.sleep = sleeps.append
w.check_job_active = lambda job: heartbeats.append(job['id'])
result = w.download_reference(job, folder)
assert result.read_bytes() == b'\\x89PNGready'
assert len(calls) == 3 and sleeps == [5] and heartbeats == [job['id']]
audit = json.loads((folder / 'reference-attempts.json').read_text())
assert [item['result'] for item in audit] == ['not-png-or-jpeg', 'not-png-or-jpeg', 'ready']
assert audit[-1]['round'] == 2
`));

test('cancellation during screenshot backoff stops before another fetch or generation', () => worker(`
folder = w.BASE / job['id']; folder.mkdir()
job['referenceUrls'] = ['https://image.thum.io/get/fixture']
calls = []
def offline(*args, **kwargs): calls.append('fetch'); raise TimeoutError()
w.urlopen = offline
w.time.sleep = lambda seconds: None
w.check_job_active = lambda job: (_ for _ in ()).throw(w.JobStopped('cancelled'))
try: w.download_reference(job, folder)
except w.JobStopped: pass
else: raise AssertionError('Cancellation must stop retries')
assert calls == ['fetch']
`));

test('exhausted screenshot transport reports a technical failure and preserves it across upload retry', () => worker(`
w.write_state({'phase': 'prepare', 'job': job})
w.generate = lambda *args: (_ for _ in ()).throw(w.ReferenceUnavailable('providers offline'))
w.call = lambda *args: (_ for _ in ()).throw(TimeoutError())
try: w.step()
except TimeoutError: pass
assert state()['phase'] == 'deliver' and state()['referenceUnavailable'] is True
assert not state().get('sourceUnusable')
reports = []
w.generate = forbidden
w.call = lambda route, payload: (reports.append(payload) or {'ok': True, 'done': True})
w.step()
assert reports[0]['errorKind'] == 'reference-fetch' and 'dataUrl' not in reports[0]
assert state() == {}
`));
