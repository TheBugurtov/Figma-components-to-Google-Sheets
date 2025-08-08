const fetch = require('node-fetch');
const fs = require('fs/promises');
const { google } = require('googleapis');
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

async function fetchFileTree(fileKey) {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });
  if (!res.ok) throw new Error(`Ошибка загрузки дерева Figma-файла: ${res.statusText}`);
  return res.json();
}

function extractTagsFromDescription(name, description) {
  const source = `${name || ''} ${description || ''}`;
  const regex = /#([\p{L}\p{N}_\-]+)/gu;
  const tags = [];
  let match;
  while ((match = regex.exec(source)) !== null) {
    tags.push(match[1]);
  }
  return tags.length > 0 ? tags : null;
}

function walkTree(node, result = []) {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    result.push(node);
  }
  if (node.children) {
    for (const child of node.children) {
      walkTree(child, result);
    }
  }
  return result;
}

async function processFigmaFile(nameAndKey) {
  try {
    const [name, fileKey] = nameAndKey.split(',').map((s) => s.trim());
    console.log(`\n🔍 Обрабатываем файл: ${name}`);

    const data = await fetchFileTree(fileKey);
    const components = walkTree(data.document);
    console.log(`   Найдено компонентов: ${components.length}`);

    const taggedComponents = [];

    console.log(`   Всего компонентов для анализа: ${components.length}`);

    for (const comp of components) {
      const tags = extractTagsFromDescription(comp.name, comp.description);
      console.log(`[DEBUG] Компонент: "${comp.name}"`);
      console.log(`        Описание: "${comp.description || ''}"`);
      console.log(`        Теги: ${tags ? tags.join(', ') : '(нет тегов)'}`);

      if (tags) {
        taggedComponents.push({
          name: comp.name,
          description: comp.description || '',
          tags: tags.join(', '),
        });
      }
    }

    console.log(`   Всего компонентов с тегами: ${taggedComponents.length}`);
    return taggedComponents;
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
