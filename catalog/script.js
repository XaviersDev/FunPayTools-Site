// Смена темы по клику на луну
const moonLogo = document.getElementById('moonLogo');
moonLogo.addEventListener('click', () => {
    document.body.classList.toggle('dark-violet');
    // Меняем цвет луны в SVG Base64 (небольшой хак с фильтрами или заменой src)
    if(document.body.classList.contains('dark-violet')) {
        moonLogo.src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iIzRhMTRjOCIgZD0iTTggMEE4IDggMCAxIDAgOCAxNmE4IDggMCAwIDAgMC0xNnptMCAxNGExIDExIDAgMCAxIDAtMTIgNiA2IDAgMSAxIDAgMTJ6Ii8+PC9zdmc+";
    } else {
        moonLogo.src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iI2E4NTVmNyIgZD0iTTggMEE4IDggMCAxIDAgOCAxNmE4IDggMCAwIDAgMC0xNnptMCAxNGExIDExIDAgMCAxIDAtMTIgNiA2IDAgMSAxIDAgMTJ6Ii8+PC9zdmc+";
    }
});

// Модалки
const devModal = document.getElementById('devModal');
document.getElementById('btnDevDocs').onclick = () => devModal.style.display = 'flex';
document.getElementById('closeDevModal').onclick = () => devModal.style.display = 'none';

const packModal = document.getElementById('packModal');
document.getElementById('closeModal').onclick = () => packModal.style.display = 'none';

// Глобальная переменная для хранения редактируемого пака
let currentEditedPack = null;

// Имитация загрузки из GitHub API (позже замените на fetch(api))
const mockCatalog = [
    {
        id: "pack_1",
        version: 1,
        author: "AlliSighs",
        name: "Базовый пак продавца",
        description: "Отличные шаблоны для старта продаж. Включает выдачу и автоответы.",
        data: {
            templates: [
                { id: "t1", name: "Выдача товара", text: "Здравствуйте, $username! Ваш товар: [ВСТАВИТЬ]" },
                { id: "t2", name: "Просьба отзыва", text: "Спасибо за покупку! Оставьте отзыв, пожалуйста." }
            ],
            auto_responses: [
                { id: "a1", trigger: "!привет", response: "Приветствую! Чем могу помочь?" }
            ]
        }
    },
    {
        id: "pack_2",
        version: 1,
        author: "TrollMaster",
        name: "Токсичный ИИ + Мемы",
        description: "Настройки для тех, кто любит шутить над покупателями.",
        data: {
            ai_settings: { style: "Отвечай дерзко, с сарказмом, используй молодежный сленг." },
            review_replies: { "1": "Сам такой!", "5": "Спс бро." }
        }
    }
];

function initCatalog() {
    const grid = document.getElementById('catalogGrid');
    grid.innerHTML = '';
    
    // В реальности: fetch('https://api.github.com/repos/YOUR_REPO/contents/packs')...
    mockCatalog.forEach(pack => {
        const card = document.createElement('div');
        card.className = 'pack-card';
        card.innerHTML = `
            <h3>${pack.name}</h3>
            <div class="author">👤 ${pack.author}</div>
            <div class="desc">${pack.description}</div>
        `;
        card.onclick = () => openPackEditor(pack);
        grid.appendChild(card);
    });
}

function openPackEditor(pack) {
    currentEditedPack = JSON.parse(JSON.stringify(pack)); // Глубокая копия
    
    document.getElementById('modalPackName').innerText = pack.name;
    document.getElementById('modalPackAuthor').innerText = `Автор: ${pack.author}`;
    document.getElementById('modalPackDesc').innerText = pack.description;

    const tree = document.getElementById('packDataTree');
    tree.innerHTML = '';

    // Генерируем чекбоксы и поля
    for (const [category, items] of Object.entries(currentEditedPack.data)) {
        const catHeader = document.createElement('h4');
        catHeader.innerText = translateCategory(category);
        catHeader.style.marginTop = "15px";
        catHeader.style.color = "var(--primary-color)";
        tree.appendChild(catHeader);

        if (Array.isArray(items)) {
            items.forEach((item, index) => {
                tree.appendChild(createTreeItem(category, item, index));
            });
        } else if (typeof items === 'object') {
            tree.appendChild(createTreeItem(category, items, null, true));
        }
    }

    packModal.style.display = 'flex';
}

function translateCategory(cat) {
    const dict = { "templates": "Шаблоны", "auto_responses": "Автоответы", "ai_settings": "Настройки ИИ", "review_replies": "Ответы на отзывы" };
    return dict[cat] || cat;
}

function createTreeItem(category, item, index, isObject = false) {
    const div = document.createElement('div');
    div.className = 'tree-item';

    const header = document.createElement('div');
    header.className = 'tree-header';
    
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true; // По умолчанию включено
    cb.dataset.category = category;
    cb.dataset.index = index;

    const title = document.createElement('span');
    title.innerText = item.name || item.trigger || (isObject ? "Общие настройки" : "Элемент");

    header.appendChild(cb);
    header.appendChild(title);
    div.appendChild(header);

    const inputsDiv = document.createElement('div');
    inputsDiv.className = 'tree-inputs';

    // Создаем поля для редактирования значений перед скачиванием
    for (const [key, value] of Object.entries(item)) {
        if(key === 'id') continue; // Скрываем технические ID
        
        const input = document.createElement(value.length > 50 ? 'textarea' : 'input');
        input.value = value;
        input.placeholder = key;
        input.onchange = (e) => {
            if(isObject) currentEditedPack.data[category][key] = e.target.value;
            else currentEditedPack.data[category][index][key] = e.target.value;
        };
        inputsDiv.appendChild(input);
    }
    
    // Если чекбокс снят, поля становятся полупрозрачными
    cb.onchange = () => { inputsDiv.style.opacity = cb.checked ? "1" : "0.3"; };

    div.appendChild(inputsDiv);
    return div;
}

// Генерация и скачивание .fptools
document.getElementById('btnDownload').onclick = () => {
    const finalData = {
        version: currentEditedPack.version,
        author: currentEditedPack.author,
        description: currentEditedPack.description,
        data: {}
    };

    // Собираем только то, что отмечено галочками
    const checkboxes = document.querySelectorAll('#packDataTree input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            const cat = cb.dataset.category;
            const idx = cb.dataset.index;
            
            if (!finalData.data[cat]) {
                finalData.data[cat] = Array.isArray(currentEditedPack.data[cat]) ? [] : {};
            }

            if (idx !== "null") {
                finalData.data[cat].push(currentEditedPack.data[cat][idx]);
            } else {
                finalData.data[cat] = currentEditedPack.data[cat];
            }
        }
    });

    // Создаем файл
    const jsonString = JSON.stringify(finalData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-${currentEditedPack.author.toLowerCase()}.fptools`;
    a.click();
    URL.revokeObjectURL(url);
};

initCatalog();
