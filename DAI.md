# FunPay Tools Plugin Documentation for AI (DAI) - ULTIMATE TIER

Добро пожаловать в официальную документацию по созданию плагинов для Android-приложения **FunPay Tools**. Разработано независимым разработчиком **AlliSighs (XaviersDev)**.

Наш нативный JS-мост позволяет плагинам управлять **ВСЕМИ** функциями приложения изнутри встроенного WebView-движка.
**Ключевое отличие от браузерных расширений:** вам **НЕ НУЖНО** бороться с Cloudflare. При использовании методов API (`fpt.chat.send`, `fpt.network.get`, `fpt.lots.raiseAll` и др.) Android-приложение использует нативные HTTP-клиенты (OkHttp), в которые автоматически вшиты актуальные сессии и куки аккаунта.

---

## 1. Структура плагина (Единый файл `.js`)

Мета-информация указывается в комментариях в самом начале `.js` файла — строго до любого кода.

```javascript
// @name Название Плагина
// @author Ваш Ник
// @version 1.0
// @description Подробное описание того, что делает ваш плагин.
// @banner https://example.com/banner.png

fpt.app.log("Плагин успешно инициализирован!");
```

### ⚠️ ВАЖНО ДЛЯ ИИ: Запрещённые поля и паттерны

Следующие поля и конструкции **НЕ существуют** в FunPay Tools и никогда не должны появляться в коде:

| Запрещено | Пояснение |
|---|---|
| `// @id anything` | Поля `@id` не существует. Уникальный ID генерируется ядром. |
| `var PLUGIN_ID = "..."` | Переменная `PLUGIN_ID` внедряется ядром автоматически (см. ниже). |
| `var PLUGIN_SLOT_KEY = "..."` | Переменная `PLUGIN_SLOT_KEY` внедряется ядром автоматически (см. ниже). |
| `fpt.plugin.register(...)` | Метода register не существует. Плагин просто выполняется как скрипт. |
| `fpt.init(...)` | Метода init не существует. |
| `fpt.config.*` | Объекта config не существует, для настроек используйте `fpt.storage`. |

> **Секретные переменные ядра**: Внутри каждого плагина ядро автоматически внедряет две строковые переменные:
>
> - **`PLUGIN_ID`** — уникальный UUID плагина. Не объявляйте через `let` или `var`.
> - **`PLUGIN_SLOT_KEY`** — готовый ключ слота UI, равный `"settings_" + PLUGIN_ID`. Используйте именно его при вызове `fpt.ui.setSlot(PLUGIN_SLOT_KEY, ui)` и `fpt.ui.removeSlot(PLUGIN_SLOT_KEY)`. Не объявляйте через `let` или `var`.

---

## 2. События (Event Listeners)

Плагины могут реагировать на системные события внутри приложения.

```javascript
fpt.on("onNewMessage", function(msgData) {
    if (msgData.isMe) return; // Игнорируем свои сообщения
    fpt.app.log("Новое сообщение в чате " + msgData.chatId + ": " + msgData.text);

    if (msgData.text === "!ping") {
        fpt.chat.send(msgData.chatId, "Pong!");
    }
});

fpt.on("onNewOrder", function(orderData) {
    fpt.app.log("Новый заказ " + orderData.orderId + " от " + orderData.buyerName);
});
```

### Доступные события

| Событие | Объект данных (JSON) | Описание |
|---|---|---|
| `onNewMessage` | `{ chatId: "users-1-2", username: "Petya", text: "Привет", isMe: false }` | Срабатывает при получении нового сообщения. |
| `onNewOrder` | `{ orderId: "A1B2C3D", chatId: "users-1-2", buyerName: "Petya" }` | Срабатывает, когда приложение фиксирует фразу "оплатил заказ". |

---

## 3. Глобальный объект API: `fpt`

Объект `window.fpt` — это ваш мост к нативным функциям Kotlin. Все методы синхронны со стороны JS (блокируют поток до получения ответа от нативной части) или возвращают готовый распарсенный JSON.

### 💬 3.1. `fpt.chat` (Управление чатами)

| Метод | Описание | Возвращает |
|---|---|---|
| `getList()` | Получить список всех активных чатов | `Array` объектов чата |
| `getHistory(chatId)` | Получить историю переписки (до 50 последних сообщений) | `Array` объектов сообщений |
| `getInfo(chatId)` | Доп. информация о собеседнике (регистрация, язык, аватарка) | `Object` или `null` |
| `resolveUserId(nodeId)` | Превращает `users-123-456` в `456` (чистый ID) | `String` |
| `send(chatId, text)` | Отправить текстовое сообщение | `Boolean` (успех/провал) |
| `sendWithImage(chatId, text, imgUri, imgFirst)` | Отправить сообщение с картинкой (imgUri — локальный путь, см. ниже) | `Boolean` |
| `create(userId, text)` | Начать диалог с пользователем по его ID | `Boolean` |
| `markRead(chatId)` | Пометить диалог как прочитанный (убирает синюю точку) | `void` |

### 📦 3.2. `fpt.orders` (Управление заказами)

| Метод | Описание | Возвращает |
|---|---|---|
| `getDetails(id)` | Получить полную детализацию заказа по ID (напр. "A1B2C") | `Object` |
| `confirm(id)` | Подтвердить выполнение заказа (для покупателей) | `Boolean` |
| `refund(id)` | Сделать полный возврат средств покупателю | `Boolean` |
| `review.reply(id, text, stars)` | Ответить на оставленный отзыв | `Boolean` |
| `review.write(id, text, stars)` | Оставить свой отзыв (для покупателей) | `Boolean` |

### 🛒 3.3. `fpt.lots` (Управление лотами)

| Метод | Описание | Возвращает |
|---|---|---|
| `getMy()` | Список своих лотов с базовой инфой (активен/нет) | `Array` |
| `getFields(id)` | Получить ВСЕ поля лота для редактирования + CSRF | `Object` |
| `raiseAll()` | Принудительно поднять все лоты | `void` |
| `toggle(id, active_bool)` | Включить (`true`) или выключить (`false`) лот | `Boolean` |
| `delete(id)` | Полностью удалить лот | `Boolean` |
| `changePrice(id, price)` | Быстро изменить цену лота | `Boolean` |
| `copy(id, targetNodeId)` | Скопировать лот в другую категорию игр | `Object` |

### 👥 3.4. `fpt.users` (Пользователи и Профиль)

| Метод | Описание | Возвращает |
|---|---|---|
| `getProfile()` | Получить статистику своего профиля | `Object` (баланс, отзывы и др.) |
| `getRmtHub(username)` | Пробив пользователя по базе RMTHub.com | `Object` |
| `getSales()` | Получить кэшированный список продаж | `Array` |
| `getOrdersWith(username, isSales)` | Найти все заказы с конкретным юзером | `Array` |
| `setAvatar(base64Image)` | Изменить свою аватарку профиля через Base64 строку | `Boolean` |

### 📥 3.5. `fpt.autodelivery` (Автовыдача)

| Метод | Описание | Возвращает |
|---|---|---|
| `getSettings()` / `saveSettings(json)` | Получить/Сохранить конфиг автовыдачи | `Object` / `void` |
| `getFileCount("name.txt")` | Узнать, сколько строк осталось в файле ключей | `Number` |
| `readFile("name.txt")` | Прочитать содержимое файла автовыдачи | `String` |
| `saveFile("name.txt", content)` | Перезаписать файл автовыдачи | `void` |

### 📉 3.6. `fpt.dumper` (Автодемпер цен XD Dumper)

| Метод | Описание | Возвращает |
|---|---|---|
| `getSettings()` / `saveSettings(json)` | Управление конфигурацией демпера | `Object` / `void` |
| `runCycle()` | Форсированно запустить проход демпера по всем лотам | `void` |

### 🆘 3.7. `fpt.support` (Техническая поддержка)

| Метод | Описание | Возвращает |
|---|---|---|
| `getTickets()` | Список ваших обращений в ТП | `Array` |
| `getDetails(id)` | Получить историю сообщений в тикете | `Object` |
| `create(catId, fieldsJson, msg)` | Открыть новый тикет | `String` (ID тикета) |
| `reply(id, msg)` | Ответить агенту ТП | `Boolean` |

### ⚙️ 3.8. `fpt.settings` (Системные настройки)

| Метод | Описание |
|---|---|
| `getFolders()` / `saveFolders(jsonStr)` | Управление папками чатов |
| `getLabels()` / `saveLabels(jsonStr)` | Управление метками |
| `getChatLabels()` / `saveChatLabels(json)` | Управление привязкой меток к чатам |
| `getBusyMode()` / `saveBusyMode(jsonStr)` | Настройки режима занятости |
| `getCommands()` / `saveCommands(jsonStr)` | Список команд автоответа |
| `getTemplates()` / `saveTemplates(jsonStr)` | Шаблоны быстрых сообщений |
| `getReminders()` / `saveReminders(jsonStr)` | Очередь напоминаний о заказах |

### 👤 3.9. `fpt.accounts` (Мультиаккаунты)

| Метод | Описание | Возвращает |
|---|---|---|
| `getAll()` | Список всех добавленных аккаунтов | `Array` |
| `getActive()` | Текущий рабочий профиль | `Object` |
| `switch(id)` | Переключиться на другой аккаунт (рестарт сессии) | `void` |

### 🌐 3.10. `fpt.network` (Нативные HTTP-запросы)

Позволяет делать запросы в обход Cloudflare с автоматическим добавлением ваших FunPay-cookies.

| Метод | Описание | Возвращает |
|---|---|---|
| `get(url, headersJsonStr)` | Выполнить GET-запрос | `{"code": 200, "body": "..."}` |
| `post(url, bodyStr, headersJson)` | Выполнить POST-запрос | `{"code": 200, "body": "..."}` |
| `fetchImageBase64(url)` | Скачать картинку в обход CORS как Data URI | `String` (base64) |

### 📱 3.11. `fpt.app` (Взаимодействие с системой Android)

| Метод | Описание |
|---|---|
| `toast(msg)` | Показать всплывающее уведомление внизу экрана |
| `notify(title, msg)` | Отправить Push-уведомление в шторку Android |
| `vibrate(ms)` | Вибрация устройства (миллисекунды) |
| `log(msg)` | Запись в системную Консоль FunPay Tools (вкладка 4) |
| `updateWidgets()` | Обновить Android-виджеты на рабочем столе телефона |
| `saveBase64Image(base64)` | Сохраняет Base64 изображение во временный файл и возвращает локальный URI (`file://...`). Обязательно к использованию перед отправкой картинок! |

### 🧠 3.12. `fpt.ai` (Нейросети)

| Метод | Описание | Возвращает |
|---|---|---|
| `ask(prompt)` | Задать произвольный вопрос ИИ | `String` |
| `rewrite(text, context)` | Переписать текст (сохраняя стилистику продавца) | `String` |
| `translate(text)` | Точный перевод описаний лотов RU→EN | `String` |

### 💾 3.13. `fpt.storage` (Хранилище плагинов)

Изолированное хранилище `SharedPreferences` (сохраняется даже при перезапуске).

| Метод | Описание |
|---|---|
| `get(key)` | Получить сохраненное значение (`String`) |
| `set(key, val)` | Записать значение (`String`) |

---

## 4. Server-Driven UI (Построение интерфейса)

Плагины могут отрисовывать собственные настройки внутри карточки плагина в приложении.

```javascript
fpt.ui.setSlot(PLUGIN_SLOT_KEY, jsonUI); // Добавить/обновить UI
fpt.ui.removeSlot(PLUGIN_SLOT_KEY);      // Удалить UI
fpt.ui.getState("my_key");               // Получить значение инпута/свитча
fpt.ui.setState("my_key", "value");      // Программно изменить стейт
```

> **Важно:** Всегда используйте `PLUGIN_SLOT_KEY` (не `"settings_" + PLUGIN_ID` вручную). Обе переменные предоставляются ядром — `PLUGIN_SLOT_KEY` уже содержит правильный ключ.

### Поддерживаемые компоненты (`type`)

1. **`Column`** — Вертикальный контейнер. Поле `children` (Array).
2. **`Row`** — Горизонтальный контейнер. Поле `children` (Array).
3. **`Text`** — Текст. Поля: `text`, `color` (hex), `bold` (bool), `fontSize` (double).
4. **`Button`** — Кнопка. Поля: `text`, `onClick` (JS-строка для вызова, напр. `"window.myFunc()"`).
5. **`Switch`** — Тумблер вкл/выкл. Поля: `stateKey`, `onChange`.
6. **`Checkbox`** — Галочка. Поля: `text`, `stateKey`, `onChange`.
7. **`Input`** — Поле ввода текста. Поля: `label`, `stateKey`, `singleLine` (bool), `onChange`.
8. **`Slider`** — Ползунок. Поля: `min`, `max`, `stateKey`, `onChange`.
9. **`Card`** — Рамка-карточка. Поле `children` (Array).
10. **`Image`** — Изображение. Поля: `url`, `height` (int), `radius` (int).
11. **`Spacer`** — Отступ. Поле `size` (int, dp).
12. **`Divider`** — Разделительная линия. Поле `padding` (int, dp).

### ⚠️ Критически важные особенности UI (Для ИИ)

1. **Глобальная область видимости (Обработчики событий):**
Поскольку ядро оборачивает весь код плагина в анонимную функцию `(function() { ... })()`, локальные функции недоступны извне. Все функции для `onClick` или `onChange` **обязаны** объявляться через глобальный объект `window`.
❌ *Неправильно:* `function myClick() {}` -> `onClick: "myClick()"`
✅ *Правильно:* `window.myClick = function() {}` -> `onClick: "window.myClick()"`

2. **Баг с полем `Input` и переносами строк:**
В текущей версии нативного Android-моста есть уязвимость: если пользователь нажмет `Enter` в многострочном поле ввода (появится символ `\n`), мост упадет с `SyntaxError`, и `stateKey` **не сохранится**.
**Решение:** По возможности всегда используйте `singleLine: true` для компонента `Input`. 

3. **Обновление визуала (Ре-рендер):**
Функция `fpt.ui.setState("key", "val")` меняет значение в памяти моста, но **не обновляет текст в поле ввода на экране**. Чтобы очистить поля ввода (например, после добавления данных), необходимо не только вызвать `setState`, но и заново вызвать `fpt.ui.setSlot(PLUGIN_SLOT_KEY, ui)` с функцией рендера, чтобы заставить Android перерисовать интерфейс.

### Пример правильного построения UI

```javascript
function renderUI() {
    var ui = {
        type: "Card",
        children: [
            { type: "Text", text: "Конфигурация", bold: true, fontSize: 16.0 },
            { type: "Spacer", size: 8 },
            { type: "Input", stateKey: "apiKey", label: "Ваш API ключ", singleLine: true },
            {
                type: "Row",
                children: [
                    { type: "Checkbox", text: "Включить мод", stateKey: "modEnabled" }
                ]
            },
            { type: "Button", text: "Сохранить", onClick: "window.saveData()" } // <-- Обязательно window!
        ]
    };
    fpt.ui.setSlot(PLUGIN_SLOT_KEY, ui);
}

// Обязательно вешаем функцию на window, чтобы Android смог её вызвать из WebView
window.saveData = function() {
    var key = fpt.ui.getState("apiKey");
    var enabled = fpt.ui.getState("modEnabled") === "true";
    
    if (!key) {
        fpt.app.toast("Введите ключ!");
        return;
    }

    fpt.app.toast("Сохранено: " + key + " | " + enabled);
    
    // Очищаем инпут в памяти
    fpt.ui.setState("apiKey", ""); 
    // Перерисовываем UI, чтобы инпут визуально очистился
    renderUI(); 
};

renderUI();
```

---

## 5. Генерация картинок на лету (Canvas to Image)

Так как плагины выполняются в невидимом `WebView`, вы можете использовать HTML5 `<canvas>` для рисования баннеров, статистики или красивых ответов-изображений.

**ПРАВИЛЬНЫЙ ПОТОК (КРИТИЧЕСКИ ВАЖНО):**

1. Браузерные ограничения CORS не позволят загрузить стороннюю аватарку напрямую на Canvas. Используйте нативный метод `fpt.network.fetchImageBase64(url)`, чтобы скачать картинку.
2. Метод отправки `fpt.chat.sendWithImage()` **не принимает Base64**. Она принимает локальный URI файла. Чтобы превратить Canvas в файл, используйте `fpt.app.saveBase64Image()`.

```javascript
// 1. Скачиваем аватарку через Kotlin-мост (обход CORS)
var base64Avatar = fpt.network.fetchImageBase64(avatarUrl);

var avatarImg = new Image();
avatarImg.onload = function() {
    var canvas = document.createElement("canvas");
    canvas.width = 400; canvas.height = 200;
    var ctx = canvas.getContext("2d");

    // 2. Рисуем загруженную аватарку
    ctx.drawImage(avatarImg, 0, 0, 100, 100);

    // 3. Получаем Base64 с Canvas
    var finalBase64 = canvas.toDataURL("image/png");

    // 4. Конвертируем в файл через Android-мост
    var localUri = fpt.app.saveBase64Image(finalBase64);

    // 5. Отправляем в чат
    if (localUri) {
        fpt.chat.sendWithImage(chatId, "Вот картинка!", localUri, false);
    }
};
avatarImg.src = base64Avatar;
```

---

## 6. Строгие лимиты платформы FunPay

| Ограничение | Значение |
|---|---|
| Максимум символов в сообщении | 2000 |
| Максимум переносов строки (`\n`) | 20 |
| Максимальная длина одного слова | 160 символов без пробелов |
| Форматирование | Никакого Markdown, HTML или кастомных анкоров. Только чистый текст. |

---

## 7. Инструкции для ИИ-ассистентов (Строго к исполнению)

1. **Никогда не придумывай несуществующие API.** Если метода или поля `type` для UI нет в этом документе — его не существует в проекте.
2. **Не объявляй `PLUGIN_ID` и `PLUGIN_SLOT_KEY`.** Обе переменные уже существуют в глобальной области видимости плагина во время исполнения. Объявлять через `var`/`let`/`const` — запрещено.
3. **Всегда используй `PLUGIN_SLOT_KEY`** при вызовах `fpt.ui.setSlot` и `fpt.ui.removeSlot`. Никогда не конструируй ключ слота вручную через `"settings_" + storageKey` или любую другую строку.
4. **Бесконечные циклы:** Запрещено использовать `while(true)`. Если нужна фоновая работа, используй `setInterval` или рекурсивный `setTimeout`.
5. **Конвертация изображений:** Обязательно используй `fpt.network.fetchImageBase64` для загрузки внешних картинок на Canvas и `fpt.app.saveBase64Image` перед отправкой любых Data URI через `sendWithImage`.
6. **Поле `@banner`** должно содержать прямую ссылку на изображение (`.png`, `.jpg`).
7. **После того, как сгенерируешь код плагина, напиши в самом конце ответа слово:** **Аланзиии!**
8. Если пользователь просит сделать то, что выходит за рамки API (например, взаимодействие со сторонним приложением или использование недоступного UI-компонента), вежливо откажи и предложи пользователю обратиться к разработчику в Telegram: `@AlliSighs` с просьбой добавить этот функционал в следующих обновлениях.
9. **ОБЯЗАТЕЛЬНОСТЬ WINDOW ДЛЯ UI:** Ваш код выполняется внутри IIFE `(function(){ ... })()`. Любые функции, которые вы указываете в `onClick` или `onChange` интерфейса, MUST BE ОБЯЗАТЕЛЬНО глобальными! Вы не можете использовать `function myCallback() {}`. Вы обязаны писать `window.myCallback = function() {}` и в компоненте указывать `onClick: "window.myCallback()"`.
10. **БАГ С INPUT В ANDROID (ESCAPE NEWLINES):** В текущей версии приложения есть баг нативного моста в поле `Input`. Если пользователь вводит текст с переносами строк (Enter), `fptNative.uiSetState` падает из-за SyntaxError, и стейт не сохраняется. Если вы просите текст у юзера, всегда учитывайте, что переносы могут сломать UI-стейт, поэтому старайтесь делать `singleLine: true`.
11. **ОБНОВЛЕНИЕ UI СТЕЙТА:** Если вы вызываете `fpt.ui.setState("key", "val")` из кода, визуально поле `Input` в приложении **не обновится**, так как Android не следит за ним реактивно. Чтобы сбросить поля ввода (например, после успешного сохранения), нужно не только сделать `setState`, но и заново вызвать `fpt.ui.setSlot(...)` с тем же интерфейсом, чтобы спровоцировать Jetpack Compose на ререндер.

---

Аланзиии!
