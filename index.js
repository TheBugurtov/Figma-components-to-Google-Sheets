// index.js — CommonJS версия
const fs = require('fs');
const fetch = require('node-fetch');

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = '7V4UQ61IVRxGArYZ20n7MH'; // твой fileKey
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // ключ с доступом на запись

async function getFigmaComponents() {
  const url = `https://api.figma.com/v1/files/${FILE_KEY}/components`;
  const res = await fetch(url, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN }
  });
  if (!res.ok) throw new Error(`Ошибка Figma API: ${res.status}`);
  const data = await res.json();
  return data.meta.components || [];
}

async function writeToGoogleSheets(rows) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/A1:append?valueInputOption=RAW&key=${GOOGLE_API_KEY}`;
  const body = {
    values: rows
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Ошибка записи в Google Sheets: ${res.status} ${txt}`);
  }
}

(async () => {
  try {
    console.log('🚀 Старт процесса...');
    const components = await getFigmaComponents();
    console.log(`   Всего компонентов в файле: ${components.length}`);

    // Преобразуем в массив строк для Google Sheets
    const rows = [['Name', 'Description', 'Type', 'Node ID']];
    components.forEach(c => {
      rows.push([
        c.name || '',
        c.description || '',
        c.type || '',
        c.node_id || ''
      ]);
    });

    await writeToGoogleSheets(rows);
    console.log('✅ Готово! Все компоненты записаны в Google Sheets.');
  } catch (err) {
    console.error('❌ Ошибка:', err);
    process.exit(1);
  }
})();
