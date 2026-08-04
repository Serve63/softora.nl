#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_DIRECTORY_NAME = '.vercel-static';
const PUBLIC_SOURCE_DIRECTORIES = Object.freeze(['assets']);

function copyDirectory(sourceDirectory, targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks zijn niet toegestaan in publieke Vercel-assets: ${sourcePath}`);
    }
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Onverwacht bestandstype in publieke Vercel-assets: ${sourcePath}`);
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function buildVercelStaticOutput(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const outputDirectory = path.join(repoRoot, OUTPUT_DIRECTORY_NAME);
  if (path.dirname(outputDirectory) !== repoRoot || path.basename(outputDirectory) !== OUTPUT_DIRECTORY_NAME) {
    throw new Error('Ongeldig Vercel static-outputpad.');
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  for (const directoryName of PUBLIC_SOURCE_DIRECTORIES) {
    const sourceDirectory = path.join(repoRoot, directoryName);
    if (!fs.statSync(sourceDirectory).isDirectory()) {
      throw new Error(`Publieke brondirectory ontbreekt: ${directoryName}`);
    }
    copyDirectory(sourceDirectory, path.join(outputDirectory, directoryName));
  }

  return {
    outputDirectory,
    publicSourceDirectories: [...PUBLIC_SOURCE_DIRECTORIES],
  };
}

if (require.main === module) {
  const result = buildVercelStaticOutput();
  console.log(`[vercel-static] Alleen ${result.publicSourceDirectories.join(', ')} naar ${OUTPUT_DIRECTORY_NAME} gekopieerd.`);
}

module.exports = {
  OUTPUT_DIRECTORY_NAME,
  PUBLIC_SOURCE_DIRECTORIES,
  buildVercelStaticOutput,
};
