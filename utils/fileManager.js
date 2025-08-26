/**
 * utils/fileManager.js
 * Helper utilitas file/direktori: list, read preview, write, sanitasi path.
 * Catatan: selalu sanitasi agar tidak keluar dari root project.
 */

const fs = require('fs-extra');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function sanitizeRelative(targetPath) {
  // Normalisasi dan cegah traversal keluar dari root
  const normalized = path.normalize(targetPath).replace(/\\/g, '/');
  if (normalized.includes('..')) {
    throw new Error('Path traversal terdeteksi. Ditolak.');
  }
  return normalized;
}

function resolveUnderRoot(relativePath) {
  const safeRel = sanitizeRelative(relativePath);
  const abs = path.resolve(PROJECT_ROOT, safeRel);
  if (!abs.startsWith(PROJECT_ROOT)) {
    throw new Error('Target path keluar dari root.');
  }
  return abs;
}

async function listDirectories(dirAbs) {
  const exist = await fs.pathExists(dirAbs);
  if (!exist) return [];
  const entries = await fs.readdir(dirAbs);
  const dirs = [];
  for (const e of entries) {
    const st = await fs.stat(path.join(dirAbs, e));
    if (st.isDirectory()) dirs.push(e);
  }
  return dirs.sort();
}

async function listFiles(dirAbs) {
  const exist = await fs.pathExists(dirAbs);
  if (!exist) return [];
  const entries = await fs.readdir(dirAbs);
  const files = [];
  for (const e of entries) {
    const st = await fs.stat(path.join(dirAbs, e));
    if (st.isFile()) files.push(e);
  }
  return files.sort();
}

async function readPreview(fileAbs, maxLen = 1000) {
  try {
    const txt = await fs.readFile(fileAbs, 'utf8');
    return txt.slice(0, maxLen);
  } catch (e) {
    return '';
  }
}

async function writeFileSafe(targetAbs, content) {
  await fs.ensureDir(path.dirname(targetAbs));
  await fs.writeFile(targetAbs, content);
}

module.exports = {
  sanitizeRelative,
  resolveUnderRoot,
  listDirectories,
  listFiles,
  readPreview,
  writeFileSafe,
};