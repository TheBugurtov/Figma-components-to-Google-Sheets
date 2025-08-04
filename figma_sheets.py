const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = 'oZGlxnWyOHTAgG6cyLkNJh';
const GOOGLE_SHEETS_ID = '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI';
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const TEST_MODE = true; // Режим тестирования
const MAX_COMPONENTS = 10; // Лимит компонентов для теста

async function getFigmaComponents() {
  console.log('🔄 Запрашиваем компоненты из Figma...');
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/components`, {
    headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN }
  });
  
  if (!response.ok) throw new Error(`Figma API error: ${response.statusText}`);
  return await response.json();
}

async function updateGoogleSheets(data) {
  console.log('📊 Подготавливаем данные для Google Sheets...');
  
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Проверка доступа
  try {
    console.log('🔍 Проверяем доступ к таблице...');
    await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEETS_ID });
  } catch (error) {
    throw new Error(`🚫 Ошибка доступа: ${error.message}\nУбедитесь что ${GOOGLE_CREDENTIALS.client_email} имеет доступ к таблице`);
  }

  // Подготовка данных
  const header = ['Название', 'Использований', 'Ссылка', 'Описание'];
  const rows = data.map(comp => [
    comp.name,
    comp.instances_count || 0,
    `=HYPERLINK("https://www.figma.com/file/${FIGMA_FILE_KEY}/?node-id=${comp.node_id}", "Открыть")`,
    comp.description || '—'
  ]);

  // Запись данных
  console.log('✍️ Записываем данные...');
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [header, ...rows] }
  });

  console.log('✅ Данные успешно записаны!');
  console.log('🔗 Ссылка на таблицу: https://docs.google.com/spreadsheets/d/' + GOOGLE_SHEETS_ID);
}

async function main() {
  try {
    console.log('🚀 Запуск процесса...');
    
    // Получаем компоненты
    const { meta } = await getFigmaComponents();
    if (!meta?.components) throw new Error('Компоненты не найдены');
    
    console.log(`📦 Получено ${meta.components.length} компонентов`);
    
    // Выбираем первые 10 для теста
    const testData = meta.components.slice(0, MAX_COMPONENTS);
    console.log(`🧪 Тестовый режим: обрабатываем ${testData.length} компонентов`);
    console.log('📝 Список:', testData.map(c => c.name).join(', '));
    
    // Обновляем таблицу
    await updateGoogleSheets(testData);
    
    console.log('🎉 Готово! Проверьте таблицу');
  } catch (error) {
    console.error('💥 Ошибка:', error.message);
    process.exit(1);
  }
}

main();