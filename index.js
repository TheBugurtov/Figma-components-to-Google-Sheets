const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FIGMA_FILE_KEY: 'oZGlxnWyOHTAgG6cyLkNJh',
  GOOGLE_SHEETS_ID: '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI',
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  SCAN_DEPTH: 3, // Глубина сканирования (1-4)
  MAX_COMPONENTS: 500 // Лимит для безопасности
};

// 1. Получаем структуру файла
async function getFileStructure() {
  const response = await fetch(`https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  if (!response.ok) throw new Error('Ошибка загрузки структуры файла');
  return await response.json();
}

// 2. Рекурсивный поиск компонентов
function findComponents(node, result = []) {
  if (node.type === 'COMPONENT' && 
      node.description && 
      !node.name.includes('=')) {
    result.push({
      id: node.id,
      name: node.name,
      description: node.description,
      page: node.pageName // Добавляем имя страницы
    });
  }

  if (node.children) {
    node.children.forEach(child => {
      if (CONFIG.SCAN_DEPTH > 1) {
        findComponents(child, result);
      }
    });
  }

  return result;
}

// 3. Получаем данные об использовании
async function getUsageCounts(componentIds) {
  const chunks = [];
  for (let i = 0; i < componentIds.length; i += 50) {
    chunks.push(componentIds.slice(i, i + 50));
  }

  const usageData = {};
  for (const chunk of chunks) {
    const response = await fetch(
      `https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/component_usages?ids=${chunk.join(',')}`,
      { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
    );
    const data = await response.json();
    Object.assign(usageData, data.meta);
  }

  return usageData;
}

// 4. Основная функция сбора данных
async function getAllValidComponents() {
  console.log('🔄 Начинаем сканирование файла...');
  
  // Получаем структуру файла
  const { document } = await getFileStructure();
  
  // Собираем компоненты со всех страниц
  let allComponents = [];
  const pageIds = document.children.map(page => page.id);
  
  console.log(`📄 Найдено страниц: ${pageIds.length}`);
  
  for (const pageId of pageIds) {
    const response = await fetch(
      `https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/nodes?ids=${pageId}`,
      { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
    );
    const { nodes } = await response.json();
    const pageComponents = findComponents(nodes[pageId]);
    allComponents = [...allComponents, ...pageComponents];
    
    if (allComponents.length >= CONFIG.MAX_COMPONENTS) {
      console.log(`⚠️ Достигнут лимит в ${CONFIG.MAX_COMPONENTS} компонентов`);
      break;
    }
  }
  
  // Получаем данные об использовании
  const componentIds = allComponents.map(c => c.id);
  const usageData = await getUsageCounts(componentIds);
  
  // Обогащаем компоненты данными
  return allComponents.map(comp => ({
    ...comp,
    instances_count: usageData[comp.id]?.instances_count || 0
  }));
}

// 5. Запись в Google Sheets
async function updateGoogleSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Подготовка данных
  const rows = [
    ['Страница', 'Компонент', 'Описание', 'Использований', 'Ссылка'],
    ...components.map(comp => [
      comp.page,
      comp.name,
      comp.description,
      comp.instances_count,
      `https://www.figma.com/file/${CONFIG.FIGMA_FILE_KEY}/?node-id=${comp.id}`
    ])
  ];

  // Запись
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });
}

// Главная функция
async function main() {
  try {
    console.log('🚀 Запуск процесса...');
    
    const components = await getAllValidComponents();
    console.log(`✅ Найдено компонентов: ${components.length}`);
    
    if (components.length > 0) {
      await updateGoogleSheets(components);
      console.log(`📊 Данные записаны в таблицу: 
      https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEETS_ID}/edit`);
    } else {
      console.log('ℹ️ Подходящих компонентов не найдено');
    }
  } catch (error) {
    console.error('💥 Критическая ошибка:', error.message);
    process.exit(1);
  }
}

main();