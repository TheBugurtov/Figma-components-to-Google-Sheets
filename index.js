const fetch = require('node-fetch');
const { google } = require('googleapis');

// ЖЁСТКИЕ НАСТРОЙКИ
const CONFIG = {
  FIGMA_TOKEN: process.env.FIGMA_TOKEN,
  FIGMA_FILE_KEY: 'oZGlxnWyOHTAgG6cyLkNJh',
  GOOGLE_SHEETS_ID: '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI',
  GOOGLE_CREDENTIALS: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  MAX_COMPONENTS: 10 // НЕ МЕНЯТЬ!
};

// Жёстко ограничиваем обработку
function enforceLimit(components) {
  console.log(`🛑 Жёсткое ограничение: ${CONFIG.MAX_COMPONENTS} компонентов`);
  return components.slice(0, CONFIG.MAX_COMPONENTS);
}

async function getComponents() {
  console.log('🔐 Получаем ровно 10 компонентов...');
  const response = await fetch(
    `https://api.figma.com/v1/files/${CONFIG.FIGMA_FILE_KEY}/components`,
    { headers: { 'X-FIGMA-TOKEN': CONFIG.FIGMA_TOKEN } }
  );
  
  const data = await response.json();
  return enforceLimit(data.meta?.components || []);
}

async function updateSheets(components) {
  const auth = new google.auth.GoogleAuth({
    credentials: CONFIG.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  
  // 1. Жёсткая очистка
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1:Z1000'
  });

  // 2. Подготовка ровно 10 строк
  const rows = [
    ['№', 'Компонент', 'Использований'],
    ...components.map((c, i) => [i + 1, c.name, c.instances_count || 0])
  ];

  // 3. Запись
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });
}

async function main() {
  try {
    console.log('🔄 Старт (строго 10 компонентов)...');
    const components = await getComponents();
    
    if (components.length !== CONFIG.MAX_COMPONENTS) {
      throw new Error(`Ожидалось ${CONFIG.MAX_COMPONENTS} компонентов`);
    }
    
    console.log('📝 Список компонентов:');
    console.log(components.map(c => `- ${c.name}`).join('\n'));
    
    await updateSheets(components);
    console.log('✅ Готово! Проверьте таблицу.');
  } catch (error) {
    console.error('💥 Критическая ошибка:', error.message);
    process.exit(1);
  }
}

// Запуск
main();