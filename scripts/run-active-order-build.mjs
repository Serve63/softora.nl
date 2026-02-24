#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildSiteBundle } = require('../assets/premium-site-engine.js');

function readArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function parseOrdersFromHtml(html) {
  const orders = [];
  const re = /<div class="order-card" id="order-(\d+)"[\s\S]*?<div class="order-client">([^<]+)<\/div>[\s\S]*?<div class="order-title">([^<]+)<\/div>[\s\S]*?<div class="order-desc">([^<]+)<\/div>[\s\S]*?<div class="order-price-value">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = String(m[1]);
    const clientLine = stripTags(m[2]);
    const title = stripTags(m[3]);
    const description = stripTags(m[4]);
    const priceText = stripTags(m[5]);
    const priceNum = Number(priceText.replace(/[^0-9]/g, '')) || 0;

    const parts = clientLine.split('—').map(s => s.trim()).filter(Boolean);
    const clientName = parts[0] || `Opdracht ${id}`;
    const location = parts[1] || '';

    orders.push({
      id,
      clientName,
      location,
      title,
      description,
      budget: priceNum,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  return orders;
}

function readCustomOrder(orderArg) {
  if (!orderArg) return null;

  const maybePath = path.resolve(process.cwd(), orderArg);
  let raw = orderArg;
  if (fs.existsSync(maybePath)) {
    raw = fs.readFileSync(maybePath, 'utf8');
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Custom order JSON is ongeldig.');
  }

  return {
    id: String(parsed.id || `custom-${Date.now()}`),
    clientName: String(parsed.clientName || 'Custom Bedrijf').trim(),
    location: String(parsed.location || '').trim(),
    title: String(parsed.title || 'Premium Website traject').trim(),
    description: String(parsed.description || 'Conversiegerichte website met premium uitstraling.').trim(),
    budget: Number(parsed.budget || 0),
    createdAt: Number(parsed.createdAt || Date.now()),
    updatedAt: Number(parsed.updatedAt || Date.now()),
  };
}

function selectActiveOrder({ orders, explicitId, statePath }) {
  if (explicitId) {
    const found = orders.find(o => String(o.id) === String(explicitId));
    if (found) return found;
  }

  if (fs.existsSync(statePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (raw?.lastOrderId) {
        const found = orders.find(o => String(o.id) === String(raw.lastOrderId));
        if (found) return found;
      }
    } catch {
      // ignore invalid state file
    }
  }

  const byRecency = orders
    .slice()
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  if (byRecency.length) return byRecency[0];

  return orders[0] || null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function collectPreviousSignatures(outRoot, activeOrderId) {
  if (!fs.existsSync(outRoot)) return [];
  const signatures = [];
  const dirs = fs.readdirSync(outRoot, { withFileTypes: true }).filter(d => d.isDirectory());
  dirs.forEach((entry) => {
    if (String(entry.name) === String(activeOrderId)) return;
    const qaPath = path.join(outRoot, entry.name, 'qa.json');
    if (!fs.existsSync(qaPath)) return;
    try {
      const qa = JSON.parse(fs.readFileSync(qaPath, 'utf8'));
      if (qa?.signature?.tokens && Array.isArray(qa.signature.tokens)) signatures.push(qa.signature);
    } catch {
      // ignore invalid qa file
    }
  });
  return signatures;
}

function writeBundleToOutput(bundle, outRoot) {
  const orderDir = path.join(outRoot, String(bundle.order_id));
  ensureDir(orderDir);

  Object.entries(bundle.files).forEach(([rel, content]) => {
    const full = path.join(orderDir, rel);
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, content, 'utf8');
  });

  return orderDir;
}

function printSummary(active, bundle, orderDir) {
  const generated = Object.keys(bundle.files).sort();
  console.log(`Active order: ${active.id} (${active.clientName})`);
  console.log(`Theme/mode: ${bundle.theme}/${bundle.mode}`);
  console.log(`Output dir: ${orderDir}`);
  console.log('Generated files:');
  generated.forEach(f => console.log(`- ${f}`));
  console.log(`QA passed: ${bundle.qa?.passed ? 'yes' : 'no'}`);
  if (!bundle.qa?.passed && bundle.qa?.findings?.length) {
    console.log('QA findings:');
    bundle.qa.findings.forEach(x => console.log(`- ${x}`));
  }
}

const sourceArg = readArg('--source', 'actieve-opdrachten.html');
const sourcePath = path.resolve(process.cwd(), sourceArg);
const explicitId = readArg('--id', null);
const customOrderArg = readArg('--order-json', null);

const mode = readArg('--mode', 'premium') === 'quick' ? 'quick' : 'premium';
const themeArg = readArg('--theme', null);
const inferredTheme = /premium-actieve-opdrachten\.html$/i.test(sourceArg) ? 'dark' : 'light';
const theme = (themeArg === 'dark' || themeArg === 'light') ? themeArg : inferredTheme;

let orders = [];

if (customOrderArg) {
  const custom = readCustomOrder(customOrderArg);
  orders = [custom];
} else {
  if (!fs.existsSync(sourcePath)) {
    console.error(`Source not found: ${sourcePath}`);
    process.exit(1);
  }
  const html = fs.readFileSync(sourcePath, 'utf8');
  orders = parseOrdersFromHtml(html);
}

if (!orders.length) {
  console.error('Geen opdrachten gevonden om te genereren.');
  process.exit(1);
}

const outRoot = path.resolve(process.cwd(), 'output');
ensureDir(outRoot);
const statePath = path.join(outRoot, `.order-state-${theme}.json`);

const active = selectActiveOrder({ orders, explicitId, statePath });
if (!active) {
  console.error('Kon geen actieve opdracht selecteren.');
  process.exit(1);
}

const runId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const previousSignatures = collectPreviousSignatures(outRoot, active.id);

const bundle = buildSiteBundle({
  orderId: String(active.id),
  mode,
  theme,
  source: customOrderArg ? 'cli-custom-order' : 'cli-test-run',
  runId,
  previousSignatures,
  meta: active,
});

const orderDir = writeBundleToOutput(bundle, outRoot);
fs.writeFileSync(statePath, JSON.stringify({
  lastOrderId: active.id,
  updatedAt: new Date().toISOString(),
  source: customOrderArg ? 'custom-order' : sourceArg,
}, null, 2), 'utf8');

printSummary(active, bundle, orderDir);
