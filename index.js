const fetch = require('node-fetch');
const fs = require('fs/promises');
const { google } = require('googleapis');

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const FIGMA_FILES_LIST_PATH = './figma_files.txt';

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function fetchFileStructure(fileKey) {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });
  if (!res.ok) throw new Error(`Ошибка загрузки файла: ${res.statusText}`);
  return res.json();
}

function extractTags(description) {
  if (!description) return [];
  const tags = description.match(/#([\p{L}\p{N}_\-]+)/gu);
  return tags ? tags.map(t => t.substring(1)) : [];
}

function findComponentsInNode(node, components = []) {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    components.push(node);
  }
  if (node.children) {
    for (const child of node.children) {
      findComponentsInNode(child, components);
    }
  }
  return components;
}

async function processFile(line) {
  const match = line.match(/https:\/\/www\.figma\.com\/file\/([\w\d]+)/);
  if (!match) {
    console.warn(`❌ Не удалось распарсить файл из строки: ${line}`);
    return [];
  }
  const fileKey = match[1];
  console.log(`\n🔍 Обрабатываем файл: ${fileKey}`);

  const data = await fetchFileStructure(fileKey);
  if (!data.document?.children?.length) {
    console.warn('❌ Нет страниц в файле');
    return [];
  }

  let results = [];

  for (const page of data.document.children) {
    // Ищем компоненты по всем страницам
    const components = findComponentsInNode(page);
    for (const comp of components) {
      const tags = extractTags(comp.description);
      if (tags.length > 0) {
        results.push({
          name: comp.name,
          description: comp.description || '',
          tags: tags.join(', '),
          fileKey,
          pageName: page.name,
          link: `https://www.figma.com/file/${fileKey}/?node-id=${comp.id}`
        });
      }
    }
  }

  console.log(`   Всего компонентов с тегами: ${results.length}`);
  return results;
}

async function writeToSheet(components) {
  const values = [
    ['Файл', 'Страница', 'Компонент', 'Теги', 'Описание', 'Ссылка'],
    ...components.map(c => [c.fileKey, c.pageName, c.name, c.tags, c.description, c.link])
  ];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1:Z10000',
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  console.log('✅ Данные записаны в Google Sheets');
}

async function main() {
  try {
    console.log('🚀 Запуск процесса...');
    const fileContent = await fs.readFile(FIGMA_FILES_LIST_PATH, 'utf-8');
    const lines = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    if (lines.length === 0) {
      throw new Error('❌ Нет ссылок на Figma файлы в figma_files.txt');
    }

    let allComponents = [];

    for (const line of lines) {
      const comps = await processFile(line);
      allComponents = allComponents.concat(comps);
    }

    if (allComponents.length === 0) {
      console.log('ℹ️ Компоненты с тегами не найдены. Проверьте описания и права токена');
      return;
    }

    await writeToSheet(allComponents);

  } catch (error) {
    console.error('💥 Ошибка:', error);
  }
}

main();
