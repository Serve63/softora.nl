#!/usr/bin/env node
// Source and licence: https://freesound.org/people/dnlburnett/sounds/335711/ (CC BY 4.0).
// First decode the public MP3 preview to 8 kHz mono PCM16 WAV, e.g. with afconvert.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error('Usage: node prepare-callcenter-ambience.js source-8k.wav output.raw');
const wav = fs.readFileSync(inputPath);
if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
  throw new Error('Input must be a PCM WAV file');
}
let format;
let pcm;
for (let offset = 12; offset + 8 <= wav.length;) {
  const size = wav.readUInt32LE(offset + 4);
  const end = offset + 8 + size;
  if (end > wav.length) throw new Error('Truncated WAV chunk');
  const chunk = wav.subarray(offset + 8, end);
  if (wav.toString('ascii', offset, offset + 4) === 'fmt ') format = chunk;
  if (wav.toString('ascii', offset, offset + 4) === 'data') pcm = chunk;
  offset = end + (size & 1);
}
if (!format || format.length < 16 || !pcm || format.readUInt16LE(0) !== 1 ||
    format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== 8000 || format.readUInt16LE(14) !== 16) {
  throw new Error('Decode to 8 kHz, mono, signed PCM16 WAV first');
}

const frameSamples = 160;
const count = Math.floor(pcm.length / 2 / frameSamples) * frameSamples;
const overlap = 12000; // A 1.5 second overlap, aligned to the 20 ms phone frames.
if (count <= 2 * overlap) throw new Error('Recording is too short');
const filtered = new Float64Array(count);
const highPass = Math.exp(-2 * Math.PI * 120 / 8000);
const lowPass = 1 - Math.exp(-2 * Math.PI * 1800 / 8000);
let previous = 0;
let high = 0;
let low = 0;
for (let i = 0; i < count; i += 1) {
  const sample = pcm.readInt16LE(i * 2);
  high = highPass * (high + sample - previous);
  previous = sample;
  low += lowPass * (high - low);
  filtered[i] = low;
}

// Play the middle, then blend the tail into the head. The wrap continues with
// the very next original sample rather than restarting a fade from silence.
const loop = new Float64Array(count - overlap);
loop.set(filtered.subarray(overlap, count - overlap));
for (let i = 0; i < overlap; i += 1) {
  const phase = i / (overlap - 1) * Math.PI / 2;
  loop[count - 2 * overlap + i] = filtered[count - overlap + i] * Math.cos(phase) + filtered[i] * Math.sin(phase);
}
let energy = 0;
for (const sample of loop) energy += sample * sample;
const rms = Math.sqrt(energy / loop.length);
if (rms < 1) throw new Error('Recording contains no usable audio');
const gain = 2200 / rms;
const out = Buffer.alloc(loop.length * 2);
let peak = 0;
let outputEnergy = 0;
for (let i = 0; i < loop.length; i += 1) {
  const sample = Math.round(12000 * Math.tanh(loop[i] * gain / 12000));
  out.writeInt16LE(sample, i * 2);
  peak = Math.max(peak, Math.abs(sample));
  outputEnergy += sample * sample;
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, out);
console.log(JSON.stringify({
  file: outputPath, bytes: out.length, durationSeconds: loop.length / 8000,
  rms: Math.round(Math.sqrt(outputEnergy / loop.length)), peak,
  joinDelta: Math.abs(out.readInt16LE(0) - out.readInt16LE(out.length - 2)),
  sha256: crypto.createHash('sha256').update(out).digest('hex'),
}));
