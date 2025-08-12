const fs = require('fs');
const fetch = require('node-fetch');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// Добавим CSV-конвертер
const { Parser } = require('json2csv');

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const FILES_LIST = 'figma_files.txt';

// helper
async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'X-Figma-Token': FIGMA_TOKEN } });
  if (!res.ok) throw new Error(`Ошибка Figma API: ${res.status} ${res.statusText}`);
  return res.json();
}

function extractTagsFromDescription(desc) {
  if (!desc || typeof desc !== 'string') return [];
  const re = /#[\w\u0400-\u04FF-]+/gi;
  const m = desc.match(re);
  if (!m) return [];
  return [...new Set(m.map(t => t.replace(/^#/, '')))];
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function writeRowsToSheet(rows) {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_ID);
  await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];

  await sheet.clear();
  await sheet.setHeaderRow(['Component', 'Tags', 'Link', 'File']);

  const batches = chunkArray(rows, 500);
  for (const b of batches) {
    await sheet.addRows(b);
  }
}

// Новая функция — запись CSV
function writeRowsToCsv(rows, filePath) {
  const fields = ['Component', 'Tags', 'Link', 'File'];
  const parser = new Parser({ fields });
  const csv = parser.parse(rows);
  fs.writeFileSync(filePath, csv, 'utf8');
  console.log(`📄 CSV сохранён: ${filePath}`);
}

// main
(async () => {
  try {
    console.log('🚀 Запуск...');
    const raw = fs.readFileSync(FILES_LIST, 'utf8');
    const filesList = raw.split('\n').map(s => s.trim()).filter(Boolean);

    const allRows = [];

    for (const fileUrl of filesList) {
      console.log(`🔍 Обработка: ${fileUrl}`);
      const m = fileUrl.match(/file\/([a-zA-Z0-9]+)\/?([^?\n]*)/);
      if (!m) {
        console.warn('⚠ Не удалось распарсить URL:', fileUrl);
        continue;
      }
      const fileKey = m[1];

      const fileData = await fetchJson(`https://api.figma.com/v1/files/${fileKey}`);
      const fileName = fileData.name || (m[2] ? decodeURIComponent(m[2]).replace(/[-_]/g, ' ') : fileKey);
      const documentTree = fileData.document;

      const compsResp = await fetchJson(`https://api.figma.com/v1/files/${fileKey}/components`);
      const compsObj = compsResp.meta?.components || {};

      const parentSetMap = {};
      (function walk(node, currentSetName = null) {
        if (!node) return;
        if (node.type === 'COMPONENT_SET') currentSetName = node.name || currentSetName;
        if (node.id) parentSetMap[node.id] = currentSetName || null;
        if (Array.isArray(node.children)) {
          for (const ch of node.children) walk(ch, currentSetName);
        }
      })(documentTree, null);

      const compsList = Object.values(compsObj);
      console.log(`   Всего компонентов из /components: ${compsList.length}`);

      let hitCount = 0;
      for (const c of compsList) {
        const desc = c.description || '';
        if (!desc.includes('#')) continue;
        hitCount++;

        const nodeId = c.node_id || c.nodeId || c.key || c.id || '';
        const parentSetName = parentSetMap[nodeId] || null;
        const displayName = parentSetName ? parentSetName : (c.name || '');
        const tags = extractTagsFromDescription(desc).join(', ');
        const link = `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(nodeId)}`;

        allRows.push({
          Component: displayName,
          Tags: tags,
          Link: link,
          File: fileName
        });
      }

      console.log(`   Найдено компонентов с тегами: ${hitCount}`);
    }

    console.log(`📦 Всего строк для записи: ${allRows.length}`);
    await writeRowsToSheet(allRows); // В Google Sheets
    writeRowsToCsv(allRows, 'components.csv'); // В CSV

    console.log('✅ Готово.');
  } catch (err) {
    console.error('❌ Ошибка:', err);
    process.exit(1);
  }
})();
