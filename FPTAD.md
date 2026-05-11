
# FunPay Tools Plugin Architecture & Documentation (FPTAD) - ULTIMATE TIER

Добро пожаловать в документацию по созданию плагинов для Android-приложения **FunPay Tools**.
Наш нативный JS-мост позволяет плагинам управлять **ВСЕМИ** функциями приложения. 

Важное отличие от расширений в браузере: вам **НЕ НУЖНО** бороться с Cloudflare. При использовании методов `fpt.chat.send`, `fpt.orders.refund` или `fpt.network.get` на стороне Android-приложения используется `OkHttp`, в который **автоматически** вшиты куки вашего аккаунта.

## 1. Структура плагина (Единый файл `.js`)
Вся мета-информация указывается в комментариях в начале `.js` файла:

```javascript
// @name Мой Комбайн
// @author XaviersDev
// @version 3.0
// @description Мощнейший плагин, управляющий всем.
// @banner https://i.imgur.com/example.png

fpt.app.log("God Plugin запущен!");
```

## 2. События (Event Listeners)
Приложение умеет транслировать события в WebView.
```javascript
fpt.on("onNewMessage", function(msgData) {
    fpt.app.log("Новое сообщение в чате " + msgData.chatId + ": " + msgData.text);
    if(msgData.text === "!ping") fpt.chat.send(msgData.chatId, "Pong!");
});
```

## 3. Глобальный объект API: `fpt`

### 💬 `fpt.chat` (Чаты)
*   `getList()` — возвращает:
    ```json
    [{ "id": "users-12-34", "username": "Vasya", "lastMessage": "Привет", "isUnread": true, "avatarUrl": "https...", "date": "14:00" }]
    ```
*   `getHistory(chatId)` — возвращает массив сообщений.
    ```json
    [{ "id": "12345", "author": "Vasya", "text": "Ку!", "isMe": false, "time": "14:00", "imageUrl": null, "isSystem": false }]
    ```
*   `getInfo(chatId)` — возвращает инфо о профиле:
    ```json
    { "lookingAtLink": "...", "lookingAtName": "...", "registrationDate": "12 мая 2021", "language": "Русский", "userStatus": "Онлайн" }
    ```
*   `resolveUserId(nodeId)` — превращает ID чата `users-123-456` в `456`.
*   `send(chatId, text)`
*   `sendWithImage(chatId, text, imgUri, imgFirst)`
*   `markRead(chatId)`

### 📦 `fpt.orders` (Заказы)
*   `getDetails(id)` — возвращает исчерпывающую информацию:
    ```json
    {
      "id": "A1B2C",
      "status": "Оплачен",
      "gameTitle": "World of Warcraft",
      "shortDesc": "1000 Gold",
      "price": "100 ₽",
      "buyerName": "Petya",
      "buyerAvatar": "https...",
      "canRefund": true,
      "canConfirm": false,
      "hasReview": false,
      "reviewRating": 0,
      "reviewText": "",
      "sellerReply": "",
      "params": { "Сервер": "EU-Gordunni" },
      "hasAutoDelivery": false,
      "lotId": "999888",
      "isBuyer": false,
      "buyerId": "123456"
    }
    ```
*   `confirm(id)` / `refund(id)`
*   `review.reply(id, text, stars)` / `review.write(id, text, stars)`

### 🛒 `fpt.lots` (Лоты)
*   `getMy()` — возвращает:
    ```json
    [{ "id": "999888", "title": "Голда", "nodeId": "10", "categoryName": "WoW", "price": 100.0, "currency": "₽", "amount": 10, "isActive": true, "hasAutoDelivery": false }]
    ```
*   `getFields(id)` — возвращает все скрытые поля лота, включая CSRF:
    ```json
    { "fields": {"price": {"value": "100.00"}}, "currency": "₽", "csrfToken": "abc...", "activeCookies": "..." }
    ```
*   `raiseAll()` / `toggle(id, active_bool)` / `delete(id)` / `changePrice(id, newPrice_double)`
*   `copy(id, targetNodeId)` — возвращает JSON объект результата.

### 👥 `fpt.users` (Пользователи и Продажи)
*   `getProfile()` — возвращает:
    ```json
    { "id": "123", "username": "Me", "isOnline": true, "totalBalance": "1000 ₽", "activeSales": 5, "activePurchases": 1, "rating": 5.0, "reviewCount": 100 }
    ```
*   `getRmtHub(username)` — пробив по базе RMTHub.
*   `getSales()` — возвращает массив продаж.
*   `getOrdersWith(username, isSales_bool)`

### 📥 `fpt.autodelivery` (Автовыдача)
*   `getSettings()` — возвращает `{ enabled: true, multiDelivery: true, lots: [{id: "...", lotName: "...", productsFileName: "goods.txt"}] }`
*   `saveSettings(jsonStr)`
*   `getFileCount("goods.txt")` — вернет количество строк (товаров).
*   `readFile("goods.txt")` / `saveFile("goods.txt", "account:pass")`

### 📉 `fpt.dumper` (XD Dumper)
*   `getSettings()` — конфиг демпера.
*   `saveSettings(jsonStr)`
*   `runCycle()` — форсировать цикл демпинга лотов.

### 🆘 `fpt.support` (Поддержка)
*   `getTickets()` — возвращает массив тикетов.
*   `getDetails(id)` — возвращает:
    ```json
    { "id": "123", "title": "Проблема", "status": "Открыт", "comments": [{"author": "Агент", "text": "Здравствуйте", "timestamp": "14:00", "isMyComment": false}] }
    ```
*   `create(catId, fieldsJsonStr, msg)` / `reply(id, msg)`

### ⚙️ `fpt.settings` (Настройки приложения)
*   Управление папками: `getFolders()`, `saveFolders(jsonStr)`
*   Метки чатов: `getLabels()`, `getChatLabels()`, `saveChatLabels(jsonStr)`
*   Режим занятости: `getBusyMode()`, `saveBusyMode(jsonStr)`
*   Автоответы: `getCommands()`, `saveCommands(jsonStr)`
*   Шаблоны: `getTemplates()`, `saveTemplates(jsonStr)`
*   Напоминания о заказах: `getReminders()`, `saveReminders(jsonStr)`

### 👤 `fpt.accounts` (Мультиаккаунты)
*   `getAll()` — массив сохраненных аккаунтов.
*   `getActive()`
*   `switch(id)` — переключиться на другой аккаунт в приложении.

### 🌐 `fpt.network` (Запросы в обход Cloudflare)
*   `get(url, headersJsonStr)` / `post(url, bodyStr, headersJsonStr)`
    Возвращает `{ code: 200, body: "<html>..." }`

### 📱 `fpt.app` (Система)
*   `toast(msg)` / `notify(title, msg)` / `vibrate(ms)` / `log(msg)`
*   `updateWidgets()`

### 🧠 `fpt.ai` (Нейросети и перевод)
*   `ask(prompt)` — задать вопрос встроенной нейросети.
*   `rewrite(text, context_string)` — переписать текст отзыва/сообщения.
*   `translate(text)` — перевести RU->EN с защитой эмодзи.

### 💾 `fpt.storage` (Хранилище)
*   `get(key)` / `set(key, val)`

---

## 4. Server-Driven UI (Интерфейсы для плагинов)

Вы можете рисовать свой UI в настройках приложения.
Используйте функцию: `fpt.ui.setSlot("settings_ВАШ_АЙДИ", jsonUI)`

### Пример UI:
```javascript
// @name God Notifier
// @author Dev

let pluginId = "my_god_notifier";

function renderUi() {
    let ui = {
        type: "Card",
        children: [
            { type: "Text", text: "Настройки Notifier", bold: true, fontSize: 16.0 },
            { 
                type: "Row", 
                children: [
                    { type: "Text", text: "Включить вибрацию" },
                    { type: "Switch", stateKey: "vibro_enabled" }
                ]
            },
            { type: "Button", text: "Тест уведомления", onClick: "testNotif()" }
        ]
    };
    fpt.ui.setSlot("settings_" + pluginId, ui);
}

window.testNotif = function() {
    fpt.app.notify("Тест", "Плагины работают!");
    if (fpt.ui.getState("vibro_enabled") === "true") {
        fpt.app.vibrate(500);
    }
};

renderUi();
```
