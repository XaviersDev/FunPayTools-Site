// Управление модалками
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
let uploadedJsonData = null; // Хранит распарсенный JSON перед публикацией

// 1. ЗАГРУЗКА ИЗ SUPABASE
async function fetchCatalog() {
    const grid = document.getElementById('catalogGrid');
    try {
        const res = await fetch('/api/catalog');
        allPacks = await res.json();
        
        if(!allPacks || allPacks.length === 0) {
            grid.innerHTML = '<div class="loading">Каталог пока пуст</div>';
            return;
        }
        renderGrid(allPacks);
    } catch (e) {
        grid.innerHTML = '<div class="loading" style="color:#ef4444;">Ошибка загрузки каталога</div>';
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
            <div class="author">Автор: ${escapeHTML(pack.author)}</div>
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

// 2. ОТКРЫТИЕ РЕДАКТОРА (Для скачивания)
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
        catHeader.style.marginTop = "20px";
        catHeader.style.marginBottom = "10px";
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
    const dict = { 
        "templates": "Шаблоны", 
        "auto_responses": "Автоответы", 
        "ai_settings": "Настройки ИИ",
        "review_reply_settings": "Ответы на отзывы",
        "greeting_settings": "Приветствия",
        "order_confirm_settings": "Просьба отзыва",
        "feedback_bonus_settings": "Бонусы за отзыв"
    };
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
    title.innerText = item.name || item.trigger || (isObject ? "Общие настройки" : "Блок настроек");

    header.appendChild(cb);
    header.appendChild(title);
    div.appendChild(header);

    const inputsDiv = document.createElement('div');
    inputsDiv.className = 'tree-inputs';

    for (const [key, value] of Object.entries(item)) {
        if(key === 'id') continue; 
        
        if (typeof value === 'string' || typeof value === 'number') {
            const input = document.createElement(String(value).length > 50 ? 'textarea' : 'input');
            input.value = value;
            input.placeholder = key;
            input.onchange = (e) => {
                if(isObject) currentEditedPack.pack_data[category][key] = e.target.value;
                else currentEditedPack.pack_data[category][index][key] = e.target.value;
            };
            inputsDiv.appendChild(input);
        }
    }
    
    cb.onchange = () => { div.style.opacity = cb.checked ? "1" : "0.5"; };
    div.appendChild(inputsDiv);
    return div;
}

// 3. СКАЧИВАНИЕ .fptools
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

// 4. ЛОГИКА DRAG & DROP
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadFileInfo = document.getElementById('uploadFileInfo');
const uploadFileName = document.getElementById('uploadFileName');
const btnRemoveFile = document.getElementById('btnRemoveFile');
const btnSubmitUpload = document.getElementById('btnSubmitUpload');
const errText = document.getElementById('upError');

dropZone.onclick = () => fileInput.click();

dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
dropZone.ondragleave = () => dropZone.classList.remove('dragover');
dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
};

fileInput.onchange = (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
};

function handleFile(file) {
    errText.innerText = "";
    // Проверка размера на клиенте: 1 МБ
    if (file.size > 1000000) {
        errText.innerText = "В файле сломан формат JSON, обратитесь к разработчикам";
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            let json = JSON.parse(e.target.result);
            if(json.data) json = json.data; // Извлекаем саму начинку
            
            uploadedJsonData = json;
            uploadFileName.innerText = file.name;
            dropZone.style.display = 'none';
            uploadFileInfo.style.display = 'flex';
            checkFormValidity();
        } catch(err) {
            errText.innerText = "В файле сломан формат JSON, обратитесь к разработчикам";
        }
    };
    reader.readAsText(file);
}

btnRemoveFile.onclick = () => {
    uploadedJsonData = null;
    fileInput.value = "";
    dropZone.style.display = 'block';
    uploadFileInfo.style.display = 'none';
    checkFormValidity();
};

function checkFormValidity() {
    const author = document.getElementById('upAuthor').value.trim();
    const name = document.getElementById('upName').value.trim();
    btnSubmitUpload.disabled = !(author && name && uploadedJsonData);
}

document.querySelectorAll('.up-input').forEach(i => i.addEventListener('input', checkFormValidity));

// 5. ОТПРАВКА НА СЕРВЕР (POST)
document.getElementById('btnSubmitUpload').onclick = async () => {
    const author = document.getElementById('upAuthor').value.trim();
    const name = document.getElementById('upName').value.trim();
    const description = document.getElementById('upDesc').value.trim();

    // Локальная защита от спама
    const lastUpload = localStorage.getItem('lastPackUploadTime');
    if (lastUpload && (Date.now() - parseInt(lastUpload)) < 24 * 60 * 60 * 1000) {
        errText.innerText = "Вы можете публиковать только 1 пак в день. Приходите завтра!";
        return;
    }

    btnSubmitUpload.disabled = true;
    btnSubmitUpload.innerText = "Публикация...";
    errText.innerText = "";

    try {
        const res = await fetch('/api/catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ author, name, description, pack_data: uploadedJsonData })
        });

        const result = await res.json();
        if (res.ok) {
            localStorage.setItem('lastPackUploadTime', Date.now().toString());
            
            uploadModal.style.display = 'none';
            document.getElementById('upAuthor').value = '';
            document.getElementById('upName').value = '';
            document.getElementById('upDesc').value = '';
            btnRemoveFile.click();
            fetchCatalog();
        } else {
            errText.innerText = result.error || "Ошибка сервера";
        }
    } catch (e) {
        errText.innerText = "Ошибка сети. Проверьте подключение.";
    }

    btnSubmitUpload.disabled = false;
    btnSubmitUpload.innerText = "Опубликовать";
};

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

// Старт
fetchCatalog();
