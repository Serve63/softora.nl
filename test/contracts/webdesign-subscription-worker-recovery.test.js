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
w.urlopen = forbidden
w.subprocess.run = forbidden
def state(slot=0): return json.loads(w.state_file(slot).read_text())
${script}
`], { cwd: path.join(__dirname, '../..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

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
