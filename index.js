const fs = require('fs');
const fetch = require('node-fetch');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// === Настройки ===
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

// === Функция получения компонентов из Figma ===
async function getFigmaComponents(fileKey) {
    const url = `https://api.figma.com/v1/files/${fileKey}/components`;
    const res = await fetch(url, {
        headers: { 'X-Figma-Token': FIGMA_TOKEN }
    });

    if (!res.ok) {
        throw new Error(`Ошибка Figma API: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.meta.components || [];
}

// === Основная функция ===
(async () => {
    console.log('🚀 Старт процесса...');

    // Читаем список файлов из figma_files.txt
    const files = fs.readFileSync('figma_files.txt', 'utf8')
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean);

    // Подключение к Google Sheets
    const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_ID);
    await doc.useServiceAccountAuth(GOOGLE_CREDENTIALS);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.clear();
    await sheet.setHeaderRow(['name', 'description', 'page']);

    for (const fileUrl of files) {
        console.log(`🔍 Обработка файла: ${fileUrl}`);
        const fileKey = fileUrl.split('/file/')[1].split('/')[0];

        const components = await getFigmaComponents(fileKey);
        console.log(`   Всего компонентов в файле: ${components.length}`);

        // Фильтрация по наличию #
        const componentsWithTags = components.filter(c =>
            typeof c.description === 'string' && c.description.includes('#')
        );

        console.log(`   Компонентов с тегами: ${componentsWithTags.length}`);

        // Запись в таблицу
        await sheet.addRows(
            componentsWithTags.map(c => ({
                name: c.name,
                description: c.description || '',
                page: c.pageName || ''
            }))
        );
    }

    console.log('✅ Готово! Все компоненты с тегами записаны в Google Sheets.');
})();
