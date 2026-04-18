#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 8000;
const DURATION_SECONDS = 60;
const TOTAL_SAMPLES = SAMPLE_RATE * DURATION_SECONDS;
const OUTPUT_PATH = path.join(__dirname, '..', 'assets', 'office-8k.raw');
const LOOP_FADE_SAMPLES = SAMPLE_RATE / 2;

let seed = 0x5f3759df;

function rand() {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0xffffffff;
}

function randSigned() {
  return rand() * 2 - 1;
}

function onePoleLowpass(input, state, alpha) {
  state.value += alpha * (input - state.value);
  return state.value;
}

function onePoleHighpass(input, state, alpha) {
  const output = alpha * (state.output + input - state.input);
  state.input = input;
  state.output = output;
  return output;
}

function clampSample(value) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

const samples = new Float32Array(TOTAL_SAMPLES);
const roomLp = { value: 0 };
const murmurLp = { value: 0 };
const murmurHp = { input: 0, output: 0 };
const hissLp = { value: 0 };
let clickEnergy = 0;
let nextClickAt = Math.floor(SAMPLE_RATE * (0.2 + rand() * 0.8));

for (let i = 0; i < TOTAL_SAMPLES; i += 1) {
  const t = i / SAMPLE_RATE;

  const roomNoise = onePoleLowpass(randSigned(), roomLp, 0.012);
  const chatterNoise = onePoleLowpass(randSigned(), murmurLp, 0.11);
  const chatterBand = onePoleHighpass(chatterNoise, murmurHp, 0.88);
  const hissNoise = onePoleLowpass(randSigned(), hissLp, 0.35);

  const murmurEnvelope =
    0.22 +
    0.09 * Math.sin((2 * Math.PI * t) / 8.7) +
    0.06 * Math.sin((2 * Math.PI * t) / 13.1 + 0.9) +
    0.04 * Math.sin((2 * Math.PI * t) / 4.1 + 2.2);

  if (i >= nextClickAt) {
    clickEnergy = 0.05 + rand() * 0.08;
    nextClickAt = i + Math.floor(SAMPLE_RATE * (0.18 + rand() * 1.1));
  }

  const keyboardClick = clickEnergy * (0.55 + 0.45 * rand()) * (rand() > 0.4 ? 1 : -1);
  clickEnergy *= 0.91;

  const hvacHum =
    0.018 * Math.sin(2 * Math.PI * 120 * t) +
    0.008 * Math.sin(2 * Math.PI * 240 * t) +
    0.004 * Math.sin(2 * Math.PI * 360 * t);

  const roomTone = roomNoise * 0.09;
  const distantMurmur = chatterBand * murmurEnvelope * 0.2;
  const air = hissNoise * 0.018;

  samples[i] = roomTone + distantMurmur + air + hvacHum + keyboardClick;
}

let mean = 0;
for (const sample of samples) mean += sample;
mean /= samples.length || 1;
for (let i = 0; i < samples.length; i += 1) samples[i] -= mean;

for (let i = 0; i < LOOP_FADE_SAMPLES; i += 1) {
  const weight = i / Math.max(1, LOOP_FADE_SAMPLES - 1);
  const head = samples[i];
  const tailIndex = TOTAL_SAMPLES - LOOP_FADE_SAMPLES + i;
  const tail = samples[tailIndex];
  const blended = tail * (1 - weight) + head * weight;
  samples[i] = blended;
  samples[tailIndex] = blended;
}

let peak = 0;
for (const sample of samples) {
  peak = Math.max(peak, Math.abs(sample));
}
const targetPeak = 16000;
const scale = peak > 0 ? targetPeak / peak : 1;

const out = Buffer.alloc(TOTAL_SAMPLES * 2);
for (let i = 0; i < TOTAL_SAMPLES; i += 1) {
  out.writeInt16LE(clampSample(samples[i] * scale), i * 2);
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, out);

console.log(`Generated ${OUTPUT_PATH} (${out.length} bytes)`);
