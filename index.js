const fetch = require('node-fetch');
const { google } = require('googleapis');

const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FIGMA_FILE_KEY: process.env.FIGMA_FILE_KEY,
  GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  MAX_COMPONENTS: 2000,
  SCAN_DEPTH: 999
};

// Функция для извлечения тегов из описания
function extractTags(description) {
  if (!description) return [];
  
  // Ищем все слова, начинающиеся с #
  const tagRegex = /#(\w+)/g;
  const matches = description.match(tagRegex);
  
  // Удаляем дубликаты и символ #
  return matches 
    ? [...new Set(matches.map(tag => tag.substring(1)))]
    : [];
}

async function getFullFileStructure() {
  console.log('📂 Получаем структуру файла...');
  const response = await fetch(`https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`🚨 Ошибка при получении структуры файла: HTTP ${response.status} ${response.statusText}`);
    console.error('Ответ сервера:', text);
    throw new Error(`Ошибка ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

function findComponentsWithTags(node, pageName, results = []) {
  if (!node) return results;

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const tags = extractTags(node.description);
    const hasTags = tags.length > 0;

    console.log(`[${hasTags ? '✅' : '❌'}] ${node.name} (${node.type})`);
    if (!hasTags) console.log('   ⛔ Нет тегов в описании');

    if (hasTags) {
      results.push({
        id: node.id,
        name: node.name.replace(/\n/g, ' '),
        tags: tags.join(', '), // Теги через запятую
        page: pageName
      });
    }
  }

  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => {
      findComponentsWithTags(child, pageName, results);
    });
  }

  return results;
}

async function getComponentsUsage(componentIds) {
  console.log('📊 Получаем данные об использовании...');
  const chunkSize = 100;
  const usageData = {};

  for (let i = 0; i < componentIds.length; i += chunkSize) {
    const chunk = componentIds.slice(i, i + chunkSize);
    const response = await fetch(
      `https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/component_usages?ids=${chunk.join(',')}`,
      { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
    );

    if (!response.ok) {
      console.error(`Ошибка для чанка ${i}-${i + chunkSize}:`, response.status);
      continue;
    }

    const data = await response.json();
    Object.assign(usageData, data.meta);
  }

  return usageData;
}

async function getAllComponentsWithTags() {
  try {
    console.log('🔍 Начинаем сканирование (только компоненты с тегами)...');
    const { document } = await getFullFileStructure();

    let allComponents = [];

    for (const page of document.children) {
      console.log(`📄 Обрабатываем страницу: ${page.name}`);
      const pageComponents = findComponentsWithTags(page, page.name);

      allComponents = [...allComponents, ...pageComponents];
      console.log(`   Найдено: ${pageComponents.length} компонентов с тегами`);

      if (allComponents.length >= CONFIG.MAX_COMPONENTS) {
        console.log(`⚠️ Достигнут лимит в ${CONFIG.MAX_COMPONENTS} компонентов`);
        break;
      }
    }

    return allComponents;

  } catch (error) {
    console.error('🚨 Ошибка при сканировании:', error);
    throw error;
  }
}

async function updateSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const rows = [
    ['Компонент', 'Теги', 'Ссылка'],
    ...components.map(comp => [
      comp.name,
      comp.tags,
      `https://www.figma.com/file/${CONFIG.FIGMA_FILE_KEY}/?node-id=${comp.id}`
    ])
  ];

  console.log('📝 Пример данных:', rows.slice(1, 4));

  // Очищаем лист перед записью
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1:C1000'
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });
}

async function main() {
  try {
    console.log('🚀 Запуск процесса...');
    const startTime = Date.now();

    const components = await getAllComponentsWithTags();
    console.log(`✅ Найдено компонентов с тегами: ${components.length}`);

    if (components.length > 0) {
      await updateSheets(components);
      console.log(`🔄 Данные записаны за ${Math.round((Date.now() - startTime) / 1000)} сек`);
      console.log(`🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEETS_ID}/edit`);
    } else {
      console.log('ℹ️ Компоненты с тегами не найдены. Проверьте:');
      console.log('1. Наличие компонентов с тегами (#tag) в описании');
      console.log('2. Права доступа токена');
    }
  } catch (error) {
    console.error('💥 Критическая ошибка:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);