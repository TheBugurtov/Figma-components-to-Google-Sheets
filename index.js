const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { google } = require('googleapis');

// ============ CONFIG ============

const CONFIG = {
  MAX_COMPONENTS: 5000,
  SPREADSHEET_RANGE: 'A1',
  SHEET_NAME: 'Компоненты',
  FILE_LIST_PATH: path.join(__dirname, 'figma_files.txt')
};

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// ============ GOOGLE SHEETS ============

async function authorizeGoogleSheets() {
  const auth = new google.auth.JWT({
    email: GOOGLE_CREDENTIALS.client_email,
    key: GOOGLE_CREDENTIALS.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function writeToGoogleSheet(sheets, rows) {
  const request = {
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `${CONFIG.SHEET_NAME}!${CONFIG.SPREADSHEET_RANGE}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: rows
    }
  };
  await sheets.spreadsheets.values.append(request);
}

// ============ FIGMA API ============

async function getFullFileStructure(fileKey) {
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN }
  });
  if (!response.ok) throw new Error(`Ошибка загрузки Figma-файла: ${response.statusText}`);
  return response.json();
}

function extractComponentsFromTree(node, path = []) {
  let components = [];

  const currentPath = [...path, node.name || 'Unnamed'];

  // Фильтрация только COMPONENT и COMPONENT_SET
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const tags = (node.description?.match(/#(\w+)/g) || []).map(t => t.slice(1));

    // Debug: показать, что видим
    console.log(`[DEBUG] ${node.name} — description:`, node.description);

    if (tags.length > 0) {
      components.push({
        id: node.id,
        name: node.name || 'Без имени',
        tags,
        description: node.description || '',
        page: path[0] || 'Unknown',
        fullPath: currentPath.join(' / ')
      });
    }
  }

  if (node.children) {
    for (const child of node.children) {
      components = components.concat(extractComponentsFromTree(child, currentPath));
    }
  }

  return components;
}

async function processFigmaFile(file) {
  console.log(`\n🔍 Обрабатываем файл: ${file.name}`);
  try {
    const fileStructure = await getFullFileStructure(file.key);
    const documentRoot = fileStructure.document;

    console.log(`   Найдено страниц: ${documentRoot.children?.length}`);

    let components = [];
    for (const page of documentRoot.children || []) {
      components = components.concat(extractComponentsFromTree(page, [page.name]));
    }

    console.log(`   Всего компонентов с тегами: ${components.length}`);

    return components.slice(0, CONFIG.MAX_COMPONENTS).map(comp => ({
      ...comp,
      file: file.name,
      link: `https://www.figma.com/file/${file.key}/?node-id=${encodeURIComponent(comp.id)}`
    }));

  } catch (error) {
    console.error(`Ошибка обработки файла ${file.name}:`, error);
    return [];
  }
}

// ============ MAIN ============

async function main() {
  console.log('🚀 Запуск процесса...');

  const fileList = fs.readFileSync(CONFIG.FILE_LIST_PATH, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [name, key] = line.split(',').map(s => s.trim());
      return { name, key };
    });

  const sheets = await authorizeGoogleSheets();

  let allComponents = [];
  for (const file of fileList) {
    const components = await processFigmaFile(file);
    allComponents = allComponents.concat(components);
  }

  if (allComponents.length === 0) {
    console.log('ℹ️ Компоненты с тегами не найдены. Проверьте:\n1. Наличие тегов (#tag) в описании компонентов\n2. Права доступа токена к файлу');
    return;
  }

  const rows = allComponents.map(c => [
    c.name,
    c.tags.join(', '),
    c.description,
    c.page,
    c.fullPath,
    c.file,
    c.link
  ]);

  await writeToGoogleSheet(sheets, rows);
  console.log(`✅ В таблицу добавлено ${rows.length} компонентов.`);
}

main().catch(console.error);
