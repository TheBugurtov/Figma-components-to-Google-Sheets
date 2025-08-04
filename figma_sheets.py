const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = 'oZGlxnWyOHTAgG6cyLkNJh';
const GOOGLE_SHEETS_ID = '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI';
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const COMPONENTS_LIMIT = 10; // ЖЁСТКОЕ ограничение - только 10 компонентов

async function getFigmaComponents() {
  console.log('🔍 Запрашиваем компоненты...');
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/components`, {
    headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN }
  });
  
  if (!response.ok) throw new Error(`Ошибка Figma API: ${response.statusText}`);
  
  const data = await response.json();
  const allComponents = data.meta?.components || [];
  
  console.log(`📊 Всего найдено: ${allComponents.length} компонентов`);
  return allComponents.slice(0, COMPONENTS_LIMIT); // Берём ТОЛЬКО первые 10
}

async function updateGoogleSheets(components) {
  console.log('✍️ Готовим данные для записи...');
  
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Жёсткая очистка всего листа
  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A:Z', // Удаляем ВСЕ данные
  });

  // 2. Подготовка данных (ровно 10 строк)
  const rows = [
    ['№', 'Компонент', 'Использований', 'Ссылка'],
    ...components.map((comp, index) => [
      index + 1,
      comp.name,
      comp.instances_count || 0,
      `https://www.figma.com/file/${FIGMA_FILE_KEY}/?node-id=${comp.node_id}`
    ])
  ];

  console.log('✅ Будут записаны 10 компонентов:');
  console.log(rows.slice(1).map(row => row[1]).join('\n'));

  // 3. Запись
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    resource: { values: rows }
  });

  console.log('🚀 Данные успешно записаны!');
}

async function main() {
  try {
    console.log('🔄 Старт обработки...');
    const components = await getFigmaComponents();
    
    if (components.length === 0) {
      throw new Error('Не найдено компонентов для обработки');
    }
    
    console.log(`🛠 Обрабатывается: ${components.length} компонентов`);
    await updateGoogleSheets(components);
    
    console.log(`🎉 Готово! Проверьте таблицу: 
    https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/edit`);
  } catch (error) {
    console.error('💥 ОШИБКА:', error.message);
    process.exit(1);
  }
}

main();