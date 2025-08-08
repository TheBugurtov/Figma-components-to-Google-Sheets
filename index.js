// index.js (CommonJS)

const fetch = require('node-fetch');
const fs = require('fs/promises');
const { google } = require('googleapis');
const path = require('path');
const process = require('process');

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const FIGMA_FILES_LIST_PATH = './figma_files.txt';

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function getFigmaFile(fileKey) {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });
  if (!res.ok) throw new Error(`Ошибка загрузки Figma-файла: ${res.statusText}`);
  return res.json();
}

function extractTaggedComponents(node, result = []) {
  const source = `${node.name} ${node.description || ''}`;
  const hasTag = source.includes('#');

  if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && hasTag) {
    const tags = source
      .split(/\s+/)
      .filter((tag) => tag.startsWith('#'))
      .map((tag) => tag.slice(1));

    result.push({
      name: node.name,
      description: node.description || '',
      tags: tags.join(', '),
    });
  }

  if (node.children) {
    node.children.forEach((child) => extractTaggedComponents(child, result));
  }
  return result;
}

async function processFigmaFile(nameAndKey) {
  try {
    const [name, fileKey] = nameAndKey.split(',').map((s) => s.trim());
    console.log(`\n🔍 Обрабатываем файл: ${name}`);
    const file = await getFigmaFile(fileKey);
    const pages = file.document.children;
    console.log(`   Найдено страниц: ${pages.length}`);

    const allTaggedComponents = [];
    for (const page of pages) {
      const components = extractTaggedComponents(page);
      components.forEach((c) => console.debug(`[DEBUG] ${c.name} — description: ${c.description}`));
      allTaggedComponents.push(...components);
    }

    console.log(`   Всего компонентов с тегами: ${allTaggedComponents.length}`);
    return allTaggedComponents;
  } catch (error) {
    console.error(`Ошибка обработки файла ${nameAndKey}:`, error);
    return [];
  }
}

async function writeToGoogleSheet(rows) {
  const values = [
    ['Component Name', 'Description', 'Tags'],
    ...rows.map((c) => [c.name, c.description, c.tags]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'FigmaComponents!A1',
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  console.log('✅ Данные успешно записаны в Google Sheets');
}

async function main() {
  console.log('🚀 Запуск процесса...');
  const file = await fs.readFile(FIGMA_FILES_LIST_PATH, 'utf-8');
  const figmaFiles = file
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = line.match(/https:\/\/www\.figma\.com\/file\/([\w\d]+)(?:\/([\w-]+))?/);
      if (match) return [`${match[2] || 'Figma File'}`, match[1]].join(',');
      return null;
    })
    .filter(Boolean);

  let allComponents = [];
  for (const file of figmaFiles) {
    const components = await processFigmaFile(file);
    allComponents.push(...components);
  }

  if (allComponents.length === 0) {
    console.log(`ℹ️ Компоненты с тегами не найдены. Проверьте:\n1. Наличие тегов (#tag) в описании компонентов\n2. Права доступа токена к файлу`);
  } else {
    await writeToGoogleSheet(allComponents);
  }
}

main();
