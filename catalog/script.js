// Смена темы по клику на луну
const moonLogo = document.getElementById('moonLogo');
moonLogo.addEventListener('click', () => {
    document.body.classList.toggle('dark-violet');
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

const uploadModal = document.getElementById('uploadModal');
document.getElementById('btnUpload').onclick = () => uploadModal.style.display = 'flex';
document.getElementById('closeUploadModal').onclick = () => uploadModal.style.display = 'none';

const packModal = document.getElementById('packModal');
document.getElementById('closeModal').onclick = () => packModal.style.display = 'none';

let currentEditedPack = null;
let allPacks = [];

// 1. ЗАГРУЗКА ИЗ SUPABASE
async function fetchCatalog() {
    const grid = document.getElementById('catalogGrid');
    try {
        const res = await fetch('/api/catalog');
        allPacks = await res.json();
        
        if(allPacks.length === 0) {
            grid.innerHTML = '<div class="loading">Каталог пока пуст</div>';
            return;
        }
        renderGrid(allPacks);
    } catch (e) {
        grid.innerHTML = '<div class="loading" style="color:red;">Ошибка загрузки каталога</div>';
    }
}

function renderGrid(packs) {
    const grid = document.getElementById('catalogGrid');
    grid.innerHTML = '';
    packs.forEach(pack => {
        const card = document.createElement('div');
        card.className = 'pack-card';
        card.innerHTML = `
            <h3>${escapeHTML(pack.name)}</h3>
            <div class="author">👤 ${escapeHTML(pack.author)}</div>
            <div class="desc">${escapeHTML(pack.description)}</div>
        `;
        card.onclick = () => openPackEditor(pack);
        grid.appendChild(card);
    });
}

// Поиск
document.getElementById('searchInput').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allPacks.filter(p => p.name.toLowerCase().includes(q) || p.author.toLowerCase().includes(q));
    renderGrid(filtered);
});

// 2. ОТКРЫТИЕ РЕДАКТОРА
function openPackEditor(pack) {
    currentEditedPack = JSON.parse(JSON.stringify(pack)); 
    
    document.getElementById('modalPackName').innerText = pack.name;
    document.getElementById('modalPackAuthor').innerText = `Автор: ${pack.author}`;
    document.getElementById('modalPackDesc').innerText = pack.description;

    const tree = document.getElementById('packDataTree');
    tree.innerHTML = '';

    for (const [category, items] of Object.entries(currentEditedPack.pack_data)) {
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
    const dict = { "templates": "Шаблоны", "auto_responses": "Автоответы", "ai_settings": "Настройки ИИ" };
    return dict[cat] || cat;
}

function createTreeItem(category, item, index, isObject = false) {
    const div = document.createElement('div');
    div.className = 'tree-item';

    const header = document.createElement('div');
    header.className = 'tree-header';
    
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true; 
    cb.dataset.category = category;
    cb.dataset.index = index;

    const title = document.createElement('span');
    title.innerText = item.name || item.trigger || (isObject ? "Общие настройки" : "Элемент");

    header.appendChild(cb);
    header.appendChild(title);
    div.appendChild(header);

    const inputsDiv = document.createElement('div');
    inputsDiv.className = 'tree-inputs';

    for (const [key, value] of Object.entries(item)) {
        if(key === 'id') continue; 
        
        const input = document.createElement(String(value).length > 50 ? 'textarea' : 'input');
        input.value = value;
        input.placeholder = key;
        input.onchange = (e) => {
            if(isObject) currentEditedPack.pack_data[category][key] = e.target.value;
            else currentEditedPack.pack_data[category][index][key] = e.target.value;
        };
        inputsDiv.appendChild(input);
    }
    
    cb.onchange = () => { inputsDiv.style.opacity = cb.checked ? "1" : "0.3"; };
    div.appendChild(inputsDiv);
    return div;
}

// 3. ГЕНЕРАЦИЯ И СКАЧИВАНИЕ .fptools
document.getElementById('btnDownload').onclick = () => {
    const finalData = {
        version: 1,
        author: currentEditedPack.author,
        description: currentEditedPack.description,
        data: {}
    };

    const checkboxes = document.querySelectorAll('#packDataTree input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            const cat = cb.dataset.category;
            const idx = cb.dataset.index;
            
            if (!finalData.data[cat]) {
                finalData.data[cat] = Array.isArray(currentEditedPack.pack_data[cat]) ? [] : {};
            }

            if (idx !== "null") {
                finalData.data[cat].push(currentEditedPack.pack_data[cat][idx]);
            } else {
                finalData.data[cat] = currentEditedPack.pack_data[cat];
            }
        }
    });

    const jsonString = JSON.stringify(finalData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-${currentEditedPack.author.toLowerCase()}.fptools`;
    a.click();
    URL.revokeObjectURL(url);
};

// 4. ПУБЛИКАЦИЯ ПАКА (POST на Vercel)
document.getElementById('btnSubmitUpload').onclick = async () => {
    const btn = document.getElementById('btnSubmitUpload');
    const err = document.getElementById('upError');
    
    const author = document.getElementById('upAuthor').value.trim();
    const name = document.getElementById('upName').value.trim();
    const description = document.getElementById('upDesc').value.trim();
    const jsonText = document.getElementById('upJson').value.trim();

    if(!author || !name || !jsonText) {
        err.innerText = "Заполните автора, название и вставьте JSON.";
        return;
    }

    let packData;
    try {
        packData = JSON.parse(jsonText);
        // Если юзер вставил целиком файл .fptools, берем блок data
        if(packData.data) packData = packData.data; 
    } catch(e) {
        err.innerText = "Ошибка: неверный формат JSON.";
        return;
    }

    btn.disabled = true;
    btn.innerText = "Публикация...";
    err.innerText = "";

    try {
        const res = await fetch('/api/catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ author, name, description, pack_data: packData })
        });

        const result = await res.json();
        if(res.ok) {
            uploadModal.style.display = 'none';
            document.getElementById('upAuthor').value = '';
            document.getElementById('upName').value = '';
            document.getElementById('upDesc').value = '';
            document.getElementById('upJson').value = '';
            fetchCatalog(); // Обновляем список
        } else {
            err.innerText = result.error || "Ошибка сервера";
        }
    } catch (e) {
        err.innerText = "Ошибка сети.";
    }

    btn.disabled = false;
    btn.innerText = "Опубликовать";
};

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

// Старт
fetchCatalog();
