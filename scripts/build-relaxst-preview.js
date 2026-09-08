'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILES = [
  ['relaxst-configurator-demo.html', 'index.html'],
  ['assets/relaxst-configurator-demo.css', 'assets/relaxst-configurator-demo.css'],
  ['assets/relaxst-configurator-demo.js', 'assets/relaxst-configurator-demo.js'],
  ['assets/relaxst/chair-framing.js', 'assets/relaxst/chair-framing.js'],
  ...['comfora', 'linea', 'zeus'].flatMap((model) => ['original.jpg', 'variants-v1.webp'].map((image) => {
    const file = `assets/relaxst/chairs/${model}-${image}`;
    return [file, file];
  })),
];

function buildRelaxstPreview(root, output = path.join(root, '.vercel/output')) {
  if (fs.existsSync(output)) throw new Error('Output bestaat al; kies een lege outputmap.');
  const hashes = {};
  for (const [source, target] of FILES) {
    const content = fs.readFileSync(path.join(root, source));
    const destination = path.join(output, 'static', target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
    hashes[target] = crypto.createHash('sha256').update(content).digest('hex');
  }
  const config = {
    version: 3,
    routes: [
      { src: '^/relaxst-configurator-demo/?$', dest: '/index.html' },
      { handle: 'filesystem' },
    ],
  };
  fs.writeFileSync(path.join(output, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return { output, files: Object.keys(hashes), hashes };
}

if (require.main === module) {
  console.log(JSON.stringify(buildRelaxstPreview(path.resolve(__dirname, '..')), null, 2));
}
module.exports = { buildRelaxstPreview };
