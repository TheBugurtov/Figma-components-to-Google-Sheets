const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { google } = require('googleapis');

// === Конфигурация ===
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const filesListPath = path.join(__dirname, 'figma_files.txt');

// === Figma API ===
async function getFullFileStructure(fileKey) {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN }
  });

  if (!res.ok) throw new Error('Ошибка загрузки Figma-файла: ' + res.statusText);
  const data = await res.json();
  return data.document;
}

function extractComponentsFromTree(node, path = []) {
  const components = [];

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const description = node.description || '';
    const tags = (description.match(/#(\w+)/g) || []).map(t => t.slice(1));

    // Для отладки
    console.log(`[DEBUG] ${node.name} — description:`, description);

    components.push({
      id: node.id,
      name: node.name || 'Без имени',
      tags,
      description,
      page: path[0] || 'Unknown',
      fullPath: [...path, node.name].join(' / ')
    });
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      components.push(...extractComponentsFromTree(child, [...path, node.name]));
    }
  }

  return components;
}

// === Google Sheets API ===
async function writeToGoogleSheet(components) {
  const auth = new google.auth.JWT(
    GOOGLE_CREDENTIALS.client_email,
    null,
    GOOGLE_CREDENTIALS.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });

  const header = ['Название', 'Page', 'Path', 'Description', 'Теги'];
  const rows = [header];

  for (const comp of components) {
    rows.push([
      comp.name,
      comp.page,
      comp.fullPath,
      comp.description,
      comp.tags.join(', ')
    ]);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: { values: rows }
  });

  console.log(`✅ В таблицу записано: ${components.length} компонентов`);
}

// === Основной процесс ===
async function processFigmaFile(name, fileKey) {
  try {
    console.log(`\n🔍 Обрабатываем файл: ${name}`);

    const fileTree = await getFullFileStructure(fileKey);
    const pages = fileTree.children || [];

    console.log(`   Найдено страниц: ${pages.length}`);

    let allComponents = [];
    for (const page of pages) {
      const components = extractComponentsFromTree(page, [page.name]);
      allComponents.push(...components);
    }

    const withTags = allComponents.filter(c => c.tags.length > 0);

    console.log(`   Всего компонентов с тегами: ${withTags.length}`);

    return withTags;
  } catch (err) {
    console.error(`Ошибка обработки файла ${name}:`, err);
    return [];
  }
}

// === Точка входа ===
async function main() {
  console.log('🚀 Запуск процесса...');

  const lines = fs.readFileSync(filesListPath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  const fileEntries = lines.map(line => {
    const [name, key] = line.split(',');
    return { name: name.trim(), key: key.trim() };
  });

  let allTaggedComponents = [];

  for (const { name, key } of fileEntries) {
    const components = await processFigmaFile(name, key);
    allTaggedComponents.push(...components);
  }

  if (allTaggedComponents.length === 0) {
    console.log(`ℹ️ Компоненты с тегами не найдены. Проверьте:
1. Наличие тегов (#tag) в описании компонентов
2. Права доступа токена к файлу`);
  } else {
    await writeToGoogleSheet(allTaggedComponents);
  }
}

main();
