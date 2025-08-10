const fs = require('fs');
const fetch = require('node-fetch');
const { google } = require('googleapis');

// ====== CONFIG ======
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

// ====== GOOGLE AUTH ======
const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ====== FIGMA API CALLS ======
async function fetchFigma(url) {
  const res = await fetch(url, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN }
  });
  if (!res.ok) throw new Error(`Ошибка Figma API: ${res.status} ${res.statusText}`);
  return res.json();
}

async function getFileNodes(fileKey) {
  const data = await fetchFigma(`https://api.figma.com/v1/files/${fileKey}`);
  return data.document;
}

async function getNodeFromOriginalFile(fileKey, nodeId) {
  const data = await fetchFigma(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`
  );
  const node = data.nodes[nodeId]?.document;
  return {
    name: node?.name || '',
    description: node?.description || ''
  };
}

// ====== RECURSIVE WALK ======
async function walk(node, components = []) {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    let description = node.description || '';

    if (node.remote && node.mainComponent?.fileKey && node.mainComponent?.nodeId) {
      const original = await getNodeFromOriginalFile(
        node.mainComponent.fileKey,
        node.mainComponent.nodeId
      );
      description = original.description;
    }

    components.push({
      name: node.name,
      description
    });
  }

  if (node.children) {
    for (const child of node.children) {
      await walk(child, components);
    }
  }

  return components;
}

// ====== MAIN ======
async function main() {
  console.log('🚀 Старт процесса...');
  const fileUrls = fs.readFileSync('figma_files.txt', 'utf8').split('\n').filter(Boolean);

  let allComponents = [];

  for (const url of fileUrls) {
    console.log(`🔍 Обработка файла: ${url}`);
    const match = url.match(/file\/([a-zA-Z0-9]+)\//);
    if (!match) {
      console.error(`❌ Не удалось извлечь fileKey из URL: ${url}`);
      continue;
    }
    const fileKey = match[1];
    const doc = await getFileNodes(fileKey);
    const components = await walk(doc);
    console.log(`   Всего компонентов в файле: ${components.length}`);
    allComponents = allComponents.concat(components);
  }

  console.log(`📦 Всего компонентов во всех файлах: ${allComponents.length}`);

  const values = [['Name', 'Description'], ...allComponents.map(c => [c.name, c.description])];

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: { values }
  });

  console.log('✅ Готово! Все компоненты записаны в Google Sheets.');
}

main().catch(err => {
  console.error(`❌ Ошибка: ${err}`);
  process.exit(1);
});
