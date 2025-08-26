// utils/fileManager.js
// ===============================================================
//  Modul helper manajemen file & folder untuk bot File-Explorer
//  Berisi fungsi-fungsi:
//   - sanitizePath : mencegah path traversal
//   - resolveStoragePath : gabung path relatif dengan storage root
//   - ensureStorageReady : buat folder storage & db bila belum ada
//   - listFolders / listFiles : membaca direktori di storage
//   - createFolder / createFile : membuat folder / file dengan aman
//   - readFilePreview : membaca sebagian awal file untuk preview
//  Semua fungsi menggunakan fs-extra (promise-based).
// ===============================================================

const fs = require('fs-extra');
const path = require('path');

// ---------------------------------------------------------------
//  Utils dasar
// ---------------------------------------------------------------
function sanitizePath(inputPath) {
  // Hilangkan karakter tidak aman dan cegah ../../
  const normalized = path.normalize(inputPath).replace(/^([/\\])+/, '');
  if (normalized.includes('..')) throw new Error('Path traversal terdeteksi!');
  return normalized;
}

function resolveStoragePath(CONFIG, relative) {
  const storageRoot = path.resolve(CONFIG.paths?.storage || './tempatallsc');
  const safeRel = sanitizePath(relative);
  return path.join(storageRoot, safeRel);
}

async function ensureStorageReady(CONFIG) {
  const storageRoot = path.resolve(CONFIG.paths?.storage || './tempatallsc');
  const dbRoot = path.resolve(CONFIG.paths?.db || './db');
  await fs.ensureDir(storageRoot);
  await fs.ensureDir(dbRoot);
  // Init logs file bila belum ada
  const logFile = path.join(dbRoot, 'logs.json');
  if (!await fs.pathExists(logFile)) {
    await fs.writeJson(logFile, []);
  }
}

// ---------------------------------------------------------------
//  Listing & operasi
// ---------------------------------------------------------------
async function listFolders(CONFIG) {
  const storageRoot = path.resolve(CONFIG.paths?.storage || './tempatallsc');
  const entries = await fs.readdir(storageRoot, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}

async function listFiles(CONFIG, folderRel) {
  const folderPath = resolveStoragePath(CONFIG, folderRel);
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => e.name);
}

async function createFolder(CONFIG, folderRel) {
  const dirPath = resolveStoragePath(CONFIG, folderRel);
  await fs.ensureDir(dirPath);
  return dirPath;
}

async function createFile(CONFIG, fileRel, content = '') {
  const filePath = resolveStoragePath(CONFIG, fileRel);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content);
  return filePath;
}

async function readFilePreview(filePath, maxChars = 1000) {
  if (!await fs.pathExists(filePath)) return '';
  const data = await fs.readFile(filePath, 'utf-8');
  return data.slice(0, maxChars);
}

module.exports = {
  sanitizePath,
  resolveStoragePath,
  ensureStorageReady,
  listFolders,
  listFiles,
  createFolder,
  createFile,
  readFilePreview,
};