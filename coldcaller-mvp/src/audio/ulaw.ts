const MU_LAW_BIAS = 0x84;
const MU_LAW_CLIP = 32635;

function decodeMuLawSample(byte: number): number {
  const ulaw = ~byte & 0xff;
  const sign = ulaw & 0x80;
  const exponent = (ulaw >> 4) & 0x07;
  const mantissa = ulaw & 0x0f;

  let sample = ((mantissa << 3) + MU_LAW_BIAS) << exponent;
  sample -= MU_LAW_BIAS;

  return sign ? -sample : sample;
}

function encodeMuLawSample(sample: number): number {
  let pcm = sample;
  let sign = 0;

  if (pcm < 0) {
    sign = 0x80;
    pcm = -pcm;
  }

  if (pcm > MU_LAW_CLIP) {
    pcm = MU_LAW_CLIP;
  }

  pcm += MU_LAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent -= 1, expMask >>= 1) {
    // loop body intentional
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  const ulawByte = ~(sign | (exponent << 4) | mantissa);
  return ulawByte & 0xff;
}

export function estimateUlawEnergy(buffer: Buffer): number {
  if (!buffer.length) return 0;

  let totalAbs = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const sample = decodeMuLawSample(buffer[i]);
    totalAbs += Math.abs(sample);
  }

  const avgAbs = totalAbs / buffer.length;
  return avgAbs / 32768;
}

export function chunkUlaw(buffer: Buffer, frameBytes = 160): Buffer[] {
  if (!buffer.length) return [];

  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += frameBytes) {
    const end = Math.min(offset + frameBytes, buffer.length);
    chunks.push(buffer.subarray(offset, end));
  }
  return chunks;
}

// Downsample 16k PCM16LE naar 8k u-law voor Twilio playback.
export function pcm16le16kToUlaw8k(buffer: Buffer): Buffer {
  if (!buffer.length) return Buffer.alloc(0);
  const sampleCount = Math.floor(buffer.length / 2);
  const outputLength = Math.floor(sampleCount / 2);
  if (outputLength <= 0) return Buffer.alloc(0);

  const output = Buffer.allocUnsafe(outputLength);
  for (let outIdx = 0; outIdx < outputLength; outIdx += 1) {
    const inputSampleOffsetBytes = outIdx * 4; // skip elke 2e sample (16k -> 8k)
    const pcmSample = buffer.readInt16LE(inputSampleOffsetBytes);
    output[outIdx] = encodeMuLawSample(pcmSample);
  }

  return output;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
