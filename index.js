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

async function getAllComponents() {
  console.log('🔍 Получаем все компоненты файла...');
  const response = await fetch(`https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/components`, {
    headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN }
  });
  
  if (!response.ok) throw new Error(`Ошибка API: ${response.statusText}`);
  
  const data = await response.json();
  return data.meta?.components || [];
}

async function updateGoogleSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Подготовка данных
  const rows = [
    ['Компонент', 'Использований', 'Ссылка'],
    ...components.slice(0, CONFIG.COMPONENTS_LIMIT).map(comp => [
      comp.name,
      comp.instances_count || 0,
      `https://www.figma.com/file/${CONFIG.FIGMA_FILE_KEY}/?node-id=${comp.node_id}`
    ])
  ];

  console.log('📝 Записываем данные:', rows.slice(0, 3));

  // Очистка и запись
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
    
    const allComponents = await getAllComponents();
    console.log(`📊 Найдено компонентов: ${allComponents.length}`);
    
    await updateGoogleSheets(allComponents);
    
    console.log(`✅ Готово! Обновлено ${CONFIG.COMPONENTS_LIMIT} компонентов: 
    https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEETS_ID}/edit`);
  } catch (error) {
    console.error('💥 Ошибка:', error.message);
    process.exit(1);
  }
}

main();