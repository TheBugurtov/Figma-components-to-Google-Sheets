const fetch = require('node-fetch');
const { google } = require('googleapis');

// Конфигурация
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = 'oZGlxnWyOHTAgG6cyLkNJh';
const GOOGLE_SHEETS_ID = '1liLtRG7yUe1T5wfwEqdOy_B4H-tne2cDoBMIbZZnTUI';
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// Получаем данные из Figma API
async function getFigmaComponents() {
  const url = `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/components`;
  const response = await fetch(url, {
    headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN }
  });
  
  if (!response.ok) {
    throw new Error(`Figma API error: ${response.statusText}`);
  }
  
  return await response.json();
}

// Получаем информацию об использовании компонентов
async function getComponentUsage(componentIds) {
  const ids = componentIds.join(',');
  const url = `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/component_usages?ids=${ids}`;
  const response = await fetch(url, {
    headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN }
  });
  
  if (!response.ok) {
    throw new Error(`Figma API error: ${response.statusText}`);
  }
  
  return await response.json();
}

// Получаем полную информацию о компонентах
async function getFullComponentsInfo() {
  const componentsData = await getFigmaComponents();
  const componentIds = componentsData.meta.components.map(c => c.node_id);
  const usageData = await getComponentUsage(componentIds);
  
  // Сопоставляем данные компонентов с данными об использовании
  return componentsData.meta.components.map(component => {
    const usage = usageData.meta[component.node_id] || {};
    return {
      name: component.name,
      usageCount: usage.instances_count || 0,
      link: `https://www.figma.com/file/${FIGMA_FILE_KEY}/?node-id=${component.node_id}`,
      description: component.description || '',
      // Дополнительные параметры можно получить из полного описания узла
      // Для этого потребуется дополнительный запрос к Figma API
    };
  });
}

// Записываем данные в Google Sheets
async function updateGoogleSheets(data) {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  const sheets = google.sheets({ version: 'v4', auth });
  
  // Подготавливаем данные для записи
  const values = [
    ['Название компонента', 'Количество использований', 'Ссылка', 'Описание', 'Параметры']
  ];
  
  data.forEach(component => {
    values.push([
      component.name,
      component.usageCount,
      component.link,
      component.description,
      JSON.stringify(component.params || {})
    ]);
  });
  
  // Очищаем лист и записываем новые данные
  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1:Z1000',
  });
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    resource: { values }
  });
}

// Основная функция
async function main() {
  try {
    const components = await getFullComponentsInfo();
    await updateGoogleSheets(components);
    console.log('Данные успешно обновлены в Google Sheets');
  } catch (error) {
    console.error('Ошибка:', error);
    process.exit(1);
  }
}

main();