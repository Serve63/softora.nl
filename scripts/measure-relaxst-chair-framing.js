'use strict';

// Read the existing pixels to register the photographs; never rewrite image assets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

async function measureFrames(file, columns, rows) {
  const content = fs.readFileSync(file);
  const { data, info } = await sharp(content).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const frames = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = Math.round(column * width / columns);
      const top = Math.round(row * height / rows);
      const right = Math.round((column + 1) * width / columns);
      const bottom = Math.round((row + 1) * height / rows);
      const bounds = [right, bottom, left, top];
      const include = (box, x, y) => {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x + 1);
        box[3] = Math.max(box[3], y + 1);
      };
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const pixel = (y * width + x) * channels;
          // Exclude the white background and faint generated shadows.
          if (Math.min(data[pixel], data[pixel + 1], data[pixel + 2]) < 205) include(bounds, x, y);
        }
      }
      const foot = [right, bottom, left, top];
      for (let y = Math.round(bounds[3] - (bounds[3] - bounds[1]) * 0.17); y < bounds[3]; y += 1) {
        for (let x = left; x < right; x += 1) {
          const pixel = (y * width + x) * channels;
          if (Math.max(data[pixel], data[pixel + 1], data[pixel + 2]) < 80) include(foot, x, y);
        }
      }
      if (bounds[3] <= bounds[1] || foot[2] <= foot[0]) throw new Error(`Missing chair or pedestal in ${file}, ${column}/${row}`);
      frames.push({ tile: [left, top, right - left, bottom - top], bounds, foot });
    }
  }
  return { width, height, sha256: crypto.createHash('sha256').update(content).digest('hex'), frames };
}

async function measureChairFraming(root) {
  const framing = {};
  for (const model of ['comfora', 'linea', 'zeus']) {
    const directory = path.join(root, 'assets/relaxst/chairs');
    const [original, variants] = await Promise.all([
      measureFrames(path.join(directory, `${model}-original.jpg`), 1, 1),
      measureFrames(path.join(directory, `${model}-variants-v1.webp`), 5, 3),
    ]);
    framing[model] = { original, variants };
  }
  return framing;
}

function serializeFraming(framing) {
  const models = Object.entries(framing).map(([model, sources]) => {
    const entries = Object.entries(sources).map(([name, { frames, ...source }]) => {
      return `    ${name}: { ...${JSON.stringify(source)}, frames: [\n${frames.map((frame) => `      ${JSON.stringify(frame)}`).join(',\n')}\n    ] }`;
    });
    return `  ${model}: {\n${entries.join(',\n')}\n  }`;
  });
  return '// Measured from unchanged source pixels by scripts/measure-relaxst-chair-framing.js.\n'
    + `window.RelaxstChairFraming = {\n${models.join(',\n')}\n};\n`;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  measureChairFraming(root).then((framing) => {
    fs.writeFileSync(path.join(root, 'assets/relaxst/chair-framing.js'), serializeFraming(framing));
    console.log('Registered 3 original photographs and 45 material/color variants; source images unchanged.');
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { measureChairFraming, serializeFraming };
