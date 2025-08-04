const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = 'oZGlxnWyOHTAgG6cyLkNJh';
const GOOGLE_SHEETS_ID = '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI';
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const COMPONENTS_LIMIT = 10; // Жёсткое ограничение на 10 компонентов

async function getFigmaComponents() {
  console.log('🔍 Запрашиваем компоненты из Figma...');
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/components`, {
    headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN }
  });
  
  if (!response.ok) throw new Error(`Figma API error: ${response.statusText}`);
  const data = await response.json();
  
  if (!data.meta?.components?.length) {
    throw new Error('Не найдено ни одного компонента');
  }
  
  console.log(`📊 Всего компонентов: ${data.meta.components.length}`);
  return data.meta.components.slice(0, COMPONENTS_LIMIT); // Берём только первые 10
}

async function updateGoogleSheets(components) {
  console.log('📝 Подготавливаем данные для записи...');
  
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Очищаем лист полностью
  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A:Z', // Очищаем все колонки
  });

  // 2. Подготавливаем данные
  const rows = [
    ['№', 'Название компонента', 'Использований', 'Ссылка', 'Дата обновления'],
    ...components.map((comp, index) => [
      index + 1,
      comp.name,
      comp.instances_count || 0,
      `=HYPERLINK("https://www.figma.com/file/${FIGMA_FILE_KEY}/?node-id=${comp.node_id}", "Открыть")`,
      new Date().toLocaleString()
    ])
  ];

  console.log('Пример данных:', rows.slice(0, 3)); // Логируем первые 3 строки

  // 3. Записываем данные
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1', // Начинаем с первой строки
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });

  console.log('✅ Успешно записано 10 компонентов!');
}

async function main() {
  try {
    console.log('🚀 Запускаем процесс...');
    
    // Получаем ровно 10 компонентов
    const components = await getFigmaComponents();
    console.log('🔧 Обрабатываем 10 компонентов:');
    console.log(components.map(c => `- ${c.name}`).join('\n'));
    
    // Обновляем таблицу
    await updateGoogleSheets(components);
    
    console.log(`🎉 Готово! Проверьте таблицу: 
    https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/edit`);
  } catch (error) {
    console.error('💥 Ошибка:', error.message);
    process.exit(1);
  }
}

main();