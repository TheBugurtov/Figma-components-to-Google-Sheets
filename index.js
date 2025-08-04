const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FIGMA_FILE_KEY: 'oZGlxnWyOHTAgG6cyLkNJh',
  GOOGLE_SHEETS_ID: '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI',
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  COMPONENTS_LIMIT: 10
};

async function getFigmaComponents() {
  console.log('🔍 Получаем компоненты из Figma...');
  const response = await fetch(`https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/components`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  
  if (!response.ok) throw new Error(`Ошибка API: ${response.statusText}`);
  
  const data = await response.json();
  return data.meta?.components?.slice(0, CONFIG.COMPONENTS_LIMIT) || [];
}

async function getComponentUsage(componentIds) {
  console.log('📊 Получаем данные об использовании...');
  const response = await fetch(
    `https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/component_usages?ids=${componentIds.join(',')}`,
    { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
  );
  
  if (!response.ok) throw new Error(`Ошибка получения данных: ${response.statusText}`);
  return await response.json();
}

async function updateGoogleSheets(components, usageData) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Подготовка данных
  const rows = [
    ['Компонент', 'Количество использований', 'Ссылка'],
    ...components.map(comp => {
      const usage = usageData.meta[comp.node_id] || {};
      return [
        comp.name,
        usage.instances_count || 0,
        `https://www.figma.com/file/${CONFIG.FIGMA_FILE_KEY}/?node-id=${comp.node_id}`
      ];
    })
  ];

  console.log('📝 Пример данных:', rows.slice(1, 3));

  // Очистка и запись
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
    
    // Получаем компоненты
    const components = await getFigmaComponents();
    if (components.length === 0) throw new Error('Не найдено компонентов');
    
    console.log(`🔧 Обрабатываем ${components.length} компонентов`);
    
    // Получаем данные об использовании
    const componentIds = components.map(c => c.node_id);
    const usageData = await getComponentUsage(componentIds);
    
    // Записываем в таблицу
    await updateGoogleSheets(components, usageData);
    
    console.log(`✅ Готово! Таблица обновлена: 
    https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEETS_ID}/edit`);
  } catch (error) {
    console.error('💥 Ошибка:', error.message);
    process.exit(1);
  }
}

main();