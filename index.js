const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FIGMA_FILE_KEY: 'oZGlxnWyOHTAgG6cyLkNJh',
  GOOGLE_SHEETS_ID: '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI',
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  MAX_RESULTS: 100 // Лимит результатов (можно увеличить)
};

async function getComponentsWithDescription() {
  console.log('🔍 Получаем компоненты с описанием...');
  const response = await fetch(`https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/components`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  
  if (!response.ok) throw new Error(`Ошибка API: ${response.statusText}`);
  
  const data = await response.json();
  
  // Фильтруем компоненты с непустым description
  return (data.meta?.components || [])
    .filter(comp => comp.description && comp.description.trim() !== '')
    .slice(0, CONFIG.MAX_RESULTS);
}

async function updateGoogleSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Подготовка данных
  const rows = [
    ['Компонент', 'Описание', 'Использований', 'Ссылка'],
    ...components.map(comp => [
      comp.name,
      comp.description,
      comp.instances_count || 0,
      `https://www.figma.com/file/${CONFIG.FIGMA_FILE_KEY}/?node-id=${comp.node_id}`
    ])
  ];

  console.log(`📝 Найдено ${components.length} компонентов с описанием`);

  // Очистка и запись
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1:Z1000'
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
    
    const components = await getComponentsWithDescription();
    
    if (components.length === 0) {
      console.log('ℹ️ Компоненты с описанием не найдены');
      return;
    }
    
    console.log(`🔧 Найдено ${components.length} компонентов с описанием:`);
    console.log(components.map(c => `- ${c.name}: ${c.description}`).join('\n'));
    
    await updateGoogleSheets(components);
    
    console.log(`✅ Готово! Таблица обновлена: 
    https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEETS_ID}/edit`);
  } catch (error) {
    console.error('💥 Ошибка:', error.message);
    process.exit(1);
  }
}

main();