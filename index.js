const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FIGMA_FILE_KEY: 'oZGlxnWyOHTAgG6cyLkNJh',
  GOOGLE_SHEETS_ID: '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI',
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  MAX_COMPONENTS: 2000,
  SCAN_DEPTH: 999
};

async function getFullFileStructure() {
  console.log('📂 Получаем структуру файла...');
  const response = await fetch(`https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  if (!response.ok) throw new Error(`Ошибка ${response.status}: ${await response.text()}`);
  return await response.json();
}

function findComponentsRecursive(node, pageName, results = []) {
  if (!node) return results;

  if (node.type === 'COMPONENT') {
    const isValid = (
      node.description && 
      node.description.trim() && 
      !node.name.includes('=') &&
      !node.name.startsWith('_')
    );

    if (isValid) {
      results.push({
        id: node.id,
        name: node.name.replace(/\n/g, ' '),
        description: node.description.trim(),
        page: pageName
      });
    }
  }

  if (node.children) {
    node.children.forEach(child => {
      findComponentsRecursive(child, pageName, results);
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

async function getAllComponents() {
  try {
    console.log('🔍 Начинаем сканирование...');
    const { document } = await getFullFileStructure();
    
    let allComponents = [];
    const pageNames = {};

    document.children.forEach(page => {
      pageNames[page.id] = page.name;
    });

    for (const page of document.children) {
      console.log(`📄 Обрабатываем страницу: ${page.name}`);
      
      const response = await fetch(
        `https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/nodes?ids=${page.id}&depth=${CONFIG.SCAN_DEPTH}`,
        { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
      );
      
      const { nodes } = await response.json();
      const pageComponents = findComponentsRecursive(nodes[page.id], page.name);
      
      allComponents = [...allComponents, ...pageComponents];
      console.log(`   Найдено: ${pageComponents.length} компонентов`);

      if (allComponents.length >= CONFIG.MAX_COMPONENTS) {
        console.log(`⚠️ Достигнут лимит в ${CONFIG.MAX_COMPONENTS} компонентов`);
        break;
      }
    }

    const usageData = await getComponentsUsage(allComponents.map(c => c.id));
    
    return allComponents.map(comp => ({
      ...comp,
      instances_count: usageData[comp.id] ? usageData[comp.id].instances_count : 0
    }));

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
    ['Страница', 'Компонент', 'Описание', 'Использований', 'Ссылка'],
    ...components.map(comp => [
      comp.page,
      comp.name,
      comp.description,
      comp.instances_count,
      `https://www.figma.com/file/${CONFIG.FIGMA_FILE_KEY}/?node-id=${comp.id}`
    ])
  ];

  console.log('📝 Пример данных:', rows.slice(1, 4));

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
    
    const components = await getAllComponents();
    console.log(`✅ Найдено компонентов: ${components.length}`);
    
    if (components.length > 0) {
      await updateSheets(components);
      console.log(`🔄 Данные записаны за ${Math.round((Date.now() - startTime)/1000)} сек`);
      console.log(`🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEETS_ID}/edit`);
    } else {
      console.log('ℹ️ Компоненты не найдены. Проверьте:');
      console.log('1. Наличие компонентов в файле');
      console.log('2. Права доступа токена');
      console.log('3. Фильтры (описание и отсутствие = в названии)');
    }
  } catch (error) {
    console.error('💥 Критическая ошибка:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);