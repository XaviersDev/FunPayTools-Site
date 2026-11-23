// @name AutoStars
// @author @AntiDoxService | Telegram
// @version 0.6.8
// @description AutoStars: полный плагин FP Tools с лицензией, автоматической обработкой оплат и серверной выдачей Stars/Premium.
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/main/catalog/plugins_assets/autostars_ADS_banner.png
// Распространение разрешает @AntiDoxService | TG @AntiDoxService. Перед публикацией требуется проверка на устройстве.
(function () {
    "use strict";
    // Заменить перед передачей администратору FunPay Tools после запуска сервера.
    var API_BASE = "https://162.35.126.120";
    var BOT_URL = "https://t.me/FPTAutoStarsBot";
    var prefix = "ubk_loader_" + PLUGIN_ID + "_";
    var activateName = "ubkActivate_" + String(PLUGIN_ID).replace(/[^A-Za-z0-9_]/g, "_");
    var diagnosticName = activateName + "Check";
    var migrationName = activateName + "Legacy";
    var restartName = activateName + "RestartRequired";
    var activationStage = "ожидание";
    var busy = false;
    var identity = null;
    var session = null;
    var runtime = null;
    var authQueue = Promise.resolve();
    var accountId = null;
    var profileCheckedAt = 0;
    var accessEpoch = 0;
    var statusPending = false;
    var retryActivation = false;
    var pendingKey = "";

    // The build inserts the complete runtime here BEFORE obfuscating the whole plugin.
    // This private function is called only after signed server-side license checks.
    function startEmbedded(fpt, slotKey, license, request, prefix) {
        // AutoStars by @AntiDoxService — https://funpay.com/users/14621693/
// FunPay authentication stays in the native app. Only minimal order facts leave it.
"use strict";
var alive = true, running = false, settings = null, orders = [], lastError = "";
var lastErrorCode = "", errorRevision = 0;
var callback = prefix.replace(/[^A-Za-z0-9_]/g, "_") + "runtime";
var queue = Promise.resolve();
var hintLimit = 100, hintLifetime = 24 * 60 * 60 * 1000;
var hintStorageKey = prefix + "pending_orders_v1_" + license.licenseId;
var hints = restoreHints();
var lastDetected = Object.keys(hints).slice(-1)[0] || "";
function restoreHints() {
    var result = {};
    try {
        var stored = JSON.parse(fpt.storage.get(hintStorageKey) || "{}");
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) return result;
        Object.keys(stored).slice(0, hintLimit).forEach(function (id) {
            var hint = stored[id];
            if (!/^[A-Z0-9]{6,16}$/.test(id) || !hint || !Number.isSafeInteger(hint.expiresAt) || hint.expiresAt <= Date.now()) return;
            result[id] = { chatId: chatNode(hint.chatId), expiresAt: hint.expiresAt, nextAt: 0 };
        });
    } catch (ignored) { /* Continue with new events if local storage is unavailable. */ }
    return result;
}
function saveHints() {
    if (!fpt.storage) return;
    try { fpt.storage.set(hintStorageKey, JSON.stringify(hints)); }
    catch (ignored) { fpt.app.log("AutoStars: не удалось сохранить ожидающие заказы в FP Tools."); }
}
function removeHint(id) { delete hints[id]; saveHints(); }
function pruneHints() {
    var now = Date.now();
    var expired = Object.keys(hints).filter(function (id) { return hints[id].expiresAt <= now; });
    if (!expired.length) return;
    expired.forEach(function (id) { delete hints[id]; });
    saveHints();
}
function enqueue(work){
    queue=queue.catch(function(){}).then(function(){if(!alive)return;running=true;return work();}).catch(error).then(function(){running=false;if(alive)render(false);});
    return queue;
}
function orderId(value){
    if(typeof value!=="string"||value.length>1000)return "";
    var plain=messageText(value),url=/^https:\/\/funpay\.com\/orders\/([A-Za-z0-9]{6,16})\/?(?:[?#][^\s]*)?$/.exec(plain);
    if(url)return url[1].toUpperCase();
    var id=plain.replace(/^(?:заказ\s*)?#\s*/i,"").replace(/[.!,:;]$/,"").trim().toUpperCase();
    return /^[A-Z0-9]{6,16}$/.test(id)?id:"";
}
function eventData(value){
    if(typeof value==="string"&&value.length<=30000){try{value=JSON.parse(value);}catch(ignored){return null;}}
    return value&&typeof value==="object"&&!Array.isArray(value)?value:null;
}
function messageText(value){
    if(typeof value!=="string"||value.length>20000)return "";
    // Read text only; never execute HTML or follow links from a notification.
    return value.replace(/\[([^\]\r\n]{1,500})\]\(https?:\/\/[^\s)]{1,1000}\)/gi,"$1")
        .replace(/<[^>]{0,2000}>/g,"").replace(/\*\*|__/g,"")
        .replace(/&nbsp;|&#160;|&#x0*a0;/gi," ").replace(/&#35;|&#x0*23;/gi,"#")
        .replace(/&#32;|&#x0*20;/gi," ").replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g,"").trim();
}
function paymentId(value){
    var match=/^Покупатель\s+.{1,150}?\s+оплатил\s+заказ\s*#\s*([A-Za-z0-9]{6,16})(?=[\s.,!]|$)/i.exec(messageText(value));
    return match?match[1].toUpperCase():"";
}
function chatNode(value){
    if(typeof value!=="string"||value.length>100)return "";
    var node=value.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g,"").trim().toLowerCase();
    return /^users-[1-9]\d*-[1-9]\d*$/.test(node)?node:"";
}
function sameChat(left,right){return left&&right&&left.slice(6).split("-").sort().join("-")===right.slice(6).split("-").sort().join("-");}
function text(value, size) { return { type: "Text", text: value, fontSize: size || 13.0 }; }
function input(key, label) { return { type: "Input", stateKey: prefix + key, label: label, singleLine: true }; }
function button(label, action) { return { type: "Button", text: label, onClick: "window." + callback + "('" + action + "')" }; }
function get(key) { return String(fpt.ui.getState(prefix + key) || ""); }
function explanation(value) {
    var messages={
        FRAGMENT_JWT_REQUIRED:"Введите Fragment connection JWT и разрешите его сохранение на сервере.",
        SERVER_STORAGE_CONSENT_REQUIRED:"Отметьте согласие на хранение JWT Fragment на сервере.",
        AUTO_METHOD_MISSING:"FunPay не вернул способ доставки. Выдача остановлена; заказ нужно обработать самостоятельно.",
        AUTO_AMOUNT_UNCLEAR:"Не удалось определить число купленных наборов. Выдача остановлена.",
        AUTO_QUANTITY_UNCLEAR:"Не удалось однозначно определить количество звёзд. Выдача остановлена.",
        AUTO_STARS_RANGE:"Количество звёзд не поддерживается: допустимо от 50 до 1 000 000.",
        AUTO_PREMIUM_MULTIPLE:"Несколько подписок в одном заказе нужно обработать самостоятельно.",
        AUTO_PREMIUM_TERM:"Автовыдача Premium поддерживает только 3, 6 или 12 месяцев."
    };
    return messages[value]||value;
}
function clearError() { lastError = ""; lastErrorCode = ""; }
function error(err) {
    lastErrorCode = String(err.code || ""); errorRevision++;
    var detail = lastErrorCode === "LOCAL_TEMPORARY"
        ? "LOCAL_TEMPORARY: " + (err.message && err.message !== lastErrorCode ? err.message : "FP Tools временно не вернул данные профиля или не завершил локальную проверку.") + " Проверка повторится автоматически. Откройте FP Tools и нужный профиль FunPay."
        : explanation(String(err.code || err.message || "Сервис недоступен"));
    lastError = detail.replace(/\b(?:UBK|SES)-[A-Za-z0-9_-]+/g, "[ключ скрыт]").replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[данные скрыты]").slice(0, 350);
    fpt.app.log("AutoStars @AntiDoxService: " + lastError);
}
function readFunpay(orderId, keys) {
    if (!alive || !/^[A-Z0-9]{6,16}$/.test(orderId)) throw new Error("Проверка заказа остановлена.");
    request.checkProfile();
    // The native bridge adds its own session only for the FunPay host. Never read,
    // construct or forward Cookie/golden_key, account objects or delivery secrets.
    var response = fpt.network.post("https://funpay.com/api/orders/get", JSON.stringify({ order_uids: [orderId], include: ["details", "users"] }), JSON.stringify({ "Content-Type": "application/json", "Accept-Language": "ru", "Cache-Control": "no-cache" }));
    request.checkAccount();
    var body;
    try { if(typeof response==="string")response=JSON.parse(response);body = typeof response.body==="string"?JSON.parse(response.body):response.body; } catch (err) { throw new Error("FunPay не вернул состояние заказа."); }
    if (Number(response.code) !== 200 || !body || body.status !== "SUCCESS" || !body.data || !body.data[orderId]) throw new Error("Не удалось проверить заказ на FunPay.");
    var raw = body.data[orderId];
    if (raw.order_uid !== orderId || String(raw.seller && raw.seller.user_id) !== license.funpayUserId) throw new Error("Заказ не принадлежит текущему продавцу.");
    var type = raw.type_data || {}, fields = {};
    (keys || Object.keys(type.fields || {})).slice(0, 100).forEach(function (key) {
        var value = type.fields && type.fields[key];
        if (value && (typeof value.value === "string" || typeof value.value === "number")) fields[key] = { name: String(value.name || "").slice(0, 100), value: String(value.value).slice(0, 2000) };
    });
    return { order_uid: orderId, status: typeof raw.status === "string" ? raw.status : "unknown", seller: { user_id: String(raw.seller.user_id) }, buyer: { user_id: String(raw.buyer && raw.buyer.user_id) }, chat: { node_name: String(raw.chat && raw.chat.node_name || "") }, section: { type_id: String(raw.section && raw.section.type_id || ""), local_id: String(raw.section && raw.section.local_id || "") }, type_data: { amount: typeof type.amount === "number" || typeof type.amount === "string" ? type.amount : null, player: typeof type.player === "string" ? type.player.slice(0, 100) : "", fields: fields } };
}
function checked(orderId, chatId, purpose) {
    return request("prepare", { orderId: orderId, purpose: purpose }).then(function (check) {
        if (!alive) return;
        var data = { orderId: orderId, chatId: chatId, checkToken: check.checkToken };
        var retryMs = 60000;
        try {
            data.evidence = readFunpay(orderId, check.fieldKeys);
            var actualChat=chatNode(data.evidence.chat.node_name),eventChat=chatNode(chatId);
            // Event chat IDs are hints, not authorization. Native bridges may
            // supply no node_name or an opaque numeric ID. Use the order's own
            // chat; the server still verifies its seller and buyer. A conflicting
            // explicit users-A-B hint must fail the existing server comparison.
            if(!actualChat)throw new Error("FunPay не вернул чат заказа #"+orderId+". Проверка повторится автоматически.");
            data.chatId=eventChat&&!sameChat(eventChat,actualChat)?eventChat:actualChat;
        }
        catch (err) {
            if (err.code === "LOCAL_TEMPORARY") retryMs = 15000;
            error(err); data.unavailable = true;
        }
        if (!alive) return;
        request.checkAccount();
        return request("report", data).then(function (result) {
            return data.unavailable && purpose === "register" ? { retryMs: retryMs } : result;
        });
    });
}
function render(reset) {
    if (!alive || !settings) return;
    if (reset) {
        fpt.ui.setState(prefix + "enabled", String(settings.enabled));
        fpt.ui.setState(prefix + "sender", String(settings.showSender));
        fpt.ui.setState(prefix + "currency", settings.currency);
        fpt.ui.setState(prefix + "jwt", "");
        fpt.ui.setState(prefix + "consent", "false");
        Object.keys(settings.texts).forEach(function (key) { fpt.ui.setState(prefix + "text_" + key, settings.texts[key].replace(/\n/g, "\\n")); });
    }
    var children = [text("AutoStars · @AntiDoxService", 18.0), text("https://funpay.com/users/14621693/", 12.0),
        text("Профиль FunPay: " + license.funpayUsername + " · " + license.funpayUserId + ". Лицензия: " + (license.expiresAt ? new Date(license.expiresAt).toLocaleString() : "бессрочно")),
        text("Смена ника требует платного сброса лицензии в Telegram-боте. Остаток срока сохраняется.", 12.0),
        text(settings.live ? "Серверная выдача доступна." : "Тестовый режим: списания Fragment на сервере отключены."),
        text(settings.enabled?"Автоподхват новых оплат включён.":"Автовыдача выключена. Включите галочку и сохраните настройки."),
        text(lastDetected?"Последний обнаруженный заказ: #"+lastDetected:"Ожидаем новую оплату от FP Tools."),
        Object.keys(hints).length ? text("Ожидают проверки FunPay: " + Object.keys(hints).length, 12.0) : { type: "Spacer", size: 0 },
        text("Товар, количество и получатель определяются из заказа FunPay автоматически. Stars: от 50 звёзд, по username. Premium: 3, 6 или 12 месяцев, подарком без входа в аккаунт. Другие категории и способы доставки пропускаются.", 12.0),
        text("Обрабатываются новые оплаты, полученные работающим FP Tools. Старые пропущенные заказы здесь не добавляются. В поле получателя заказа @ можно пропустить: например, AntiDoxService будет обработан как @AntiDoxService. Получатель всегда берётся из вашего заказа. Если юзернейм пустой или некорректный, плагин запросит его у покупателя.", 12.0),
        { type: "Checkbox", text: "Включить автовыдачу Telegram Stars / Premium", stateKey: prefix + "enabled" },
        input("currency", "Валюта Fragment: ton или usdt_ton"),
        { type: "Checkbox", text: "Показывать отправителя", stateKey: prefix + "sender" },
        text("FunPay проверяется этим приложением. Fragment JWT: " + (settings.hasFragmentJwt ? "сохранён" : "не настроен")),
        input("jwt", "Fragment connection JWT (пусто — сохранить прежний)"),
        text("Сервер получает JWT Fragment и необходимые сведения о заказе. Данные входа FunPay остаются в приложении. Для новых выдач и повторов приложение должно работать. Поле JWT видимо — не публикуйте его скриншоты.", 12.0),
        { type: "Checkbox", text: "Разрешаю хранение JWT Fragment на сервере", stateKey: prefix + "consent" },
        text("Тексты: {orderId}, {username}, {goods}, {fragmentId}, {state}, {transactionUrl}. Перенос строки: \\n", 12.0),
        input("text_ask", "Запрос @username"), input("text_waiting", "Ожидание выдачи"), input("text_sent", "Данные операции и напоминание"), input("text_cancelled", "Выдача отменена"), input("text_review", "Нужна проверка"),
        button("Сохранить настройки на сервере", "save"), button("Обновить статус и журнал", "refresh"),
        text("Перед самостоятельной выдачей ожидающего заказа остановите его в журнале. Остановка не возвращает деньги. Если операция уже отправлена или результат неизвестен, сначала проверьте Fragment.", 12.0),
        text(lastError ? "Последняя ошибка: " + lastError : "Сервер подключён.", 12.0), text("Последние заказы", 15.0)];
    orders.slice(0, 10).forEach(function (order) {
        children.push(text("#" + order.orderId + " · " + order.state + (order.reason ? " · " + explanation(order.reason) : ""), 12.0));
        if(/^(QUEUED|CHECKING|WAITING_BALANCE|WAITING_FUNPAY|WAITING_USERNAME|WAITING_AUTH|REVIEW)$/.test(order.state)&&orderId(order.orderId)===order.orderId)children.push(button("Остановить автовыдачу #"+order.orderId,"cancel:"+order.orderId));
    });
    children.push(text("@AntiDoxService · Копирование и распространение без разрешения автора запрещены.", 12.0));
    fpt.ui.setSlot(slotKey, { type: "Card", children: children });
}
function deliverMessages() {
    // Server stores a revision; retries may repeat a chat message after a crash,
    // but can never issue another paid Fragment request.
    return orders.reduce(function (promise, order) {
        return promise.then(function () {
            if (!alive || !order.pendingMessage) return;
            request.checkAccount();
            if (fpt.chat.send(order.chatId, order.message) !== true) return;
            if (/UNKNOWN|FAILED|REVIEW|WAITING_AUTH|WAITING_BALANCE/.test(order.state)) fpt.app.notify("AutoStars · @AntiDoxService", "Заказ #" + order.orderId + ": " + order.state);
            return request("ack", { orderId: order.orderId, chatId: order.chatId, revision: order.revision });
        });
    }, Promise.resolve());
}
function refresh(send) {
    return request("orders", {}).then(function (result) { if (!alive) return; orders = result.orders; settings.live = result.live; if (send) return deliverMessages(); });
}
function cycle() {
    var recoveryRevision = errorRevision;
    return Promise.resolve().then(function () {
        // A successful orders response alone does not prove that the native
        // profile recovered. Re-read it before clearing a local diagnostic.
        if (lastErrorCode === "LOCAL_TEMPORARY") request.checkProfile();
        return refresh(false);
    }).then(function () {
        if (!alive || !settings.enabled) return;
        var due = orders.filter(function (order) { return order.needsCheck; })[0];
        if (due) return checked(due.orderId, due.chatId, "deliver");
    }).then(function () { if (alive) return refresh(true); }).then(function () {
        if (alive && lastErrorCode === "LOCAL_TEMPORARY" && errorRevision === recoveryRevision) clearError();
    });
}
window[callback] = function (action) {
    if (!alive || !settings) return;
    enqueue(function () {
        if (action === "save") {
            var texts = {}; Object.keys(settings.texts).forEach(function (key) { texts[key] = get("text_" + key).replace(/\\n/g, "\n"); });
            var config = { enabled: get("enabled") === "true", currency: get("currency").trim(), showSender: get("sender") === "true", autoProducts: true, rules: [], texts: texts };
            return request("settings", { settings: config, fragmentJwt: get("jwt").trim().replace(/^JWT\s+/i, ""), acceptServerStorage: get("consent") === "true" }).then(function (result) {
                result.live = settings.live; settings = result;
                if (!settings.enabled) clearHints();
                clearError(); render(true); fpt.app.toast("AutoStars: настройки сохранены");
            });
        }
        if (typeof action === "string" && /^cancel:[A-Z0-9]{6,16}$/.test(action)) return request("cancel", { orderId: action.slice(7) }).then(function () { fpt.app.toast("Автовыдача заказа остановлена."); return refresh(true); });
        if (action === "refresh") return drainHints(true).then(cycle);
    });
};
function clearHints() {
    if (!Object.keys(hints).length) return;
    hints = {}; saveHints();
}
function drainHints(force){
    if(!alive||!settings)return Promise.resolve();
    if (!settings.enabled) { clearHints(); return Promise.resolve(); }
    pruneHints();
    return Object.keys(hints).slice(0,20).reduce(function(chain,id){return chain.then(function(){
        if(!alive||!settings.enabled)return;
        var hint=hints[id];if(!hint||(!force&&hint.nextAt>Date.now()))return;
        return checked(id,hint.chatId,"register").then(function(result){
            if(!alive)return;
            if (result && result.retryMs) { hint.nextAt = Date.now() + result.retryMs; return; }
            removeHint(id);
            if(result&&!result.ignored){clearError();return cycle();}
        }).catch(function(err){
            // A forged notification must not reserve another buyer's ID.
            if(/ORDER_(?:CHAT|OWNERSHIP)_MISMATCH|ORDER_BELONGS_TO_PREVIOUS_LICENSE/.test(String(err.code||err.message)))removeHint(id);
            else hint.nextAt = Date.now() + (err.code === "LOCAL_TEMPORARY" ? 15000 : 60000);
            error(err);
        });
    });},Promise.resolve());
}
function onOrder(order) {
    order=eventData(order);
    if(!alive||!order||(settings&&!settings.enabled))return;
    var id=orderId(order.orderId)||paymentId(order.text),chat=chatNode(order.chatId);
    if(!id){error(new Error("Не удалось распознать номер заказа в событии FP Tools. Ожидаем уведомление об оплате в чате."));render(false);return;}
    lastDetected=id;
    pruneHints();
    if(hints[id])return;
    if(Object.keys(hints).length>=hintLimit){error(new Error("Слишком много ожидающих уведомлений. Проверьте подключение к серверу."));render(false);return;}
    hints[id] = { chatId: chat, nextAt: 0, expiresAt: Date.now() + hintLifetime };
    saveHints();
    if(settings)enqueue(drainHints);
}
fpt.on("onNewOrder", onOrder);
fpt.on("onNewMessage", function (msg) {
    msg=eventData(msg);
    if (!alive || !msg || msg.isMe===true || msg.isMe==="true" || msg.isMe===1) return;
    var body = messageText(msg.text),chatId=chatNode(msg.chatId);
    // A notification is a hint only: server report validates the fresh FunPay
    // response, seller, buyer, chat, product and PAID state before spending.
    var payment=paymentId(msg.text);
    if(payment){onOrder({orderId:payment,chatId:chatId});return;}
    if(!settings||!chatId)return;
    var status = /^#fragment_status(?:\s+#?([A-Z0-9]{6,16}))?$/i.exec(body);
    if (status) {
        enqueue(function(){return refresh(false).then(function () {
            if (!alive) return;
            request.checkAccount();
            var found = orders.filter(function (o) { return o.chatId === chatId && (!status[1] || o.orderId === status[1].toUpperCase()); });
            if (found.length) fpt.chat.send(chatId, found[0].message);
        });}); return;
    }
    var match = /^(?:#([A-Z0-9]{6,16})\s+)?(@[A-Za-z][A-Za-z0-9_]{3,31})$/i.exec(body);
    if (!match) return;
    enqueue(function(){return refresh(false).then(function () {
        if (!alive) return;
        request.checkAccount();
        var waiting = orders.filter(function (o) { return o.chatId === chatId && o.state === "WAITING_USERNAME" && (!match[1] || o.orderId === match[1].toUpperCase()); });
        if (waiting.length > 1) { fpt.chat.send(chatId, "Укажите ID нужного заказа перед username: #IDЗАКАЗА @username"); return; }
        if (waiting.length === 1) return request("recipient", { orderId: waiting[0].orderId, chatId: chatId, username: match[2] }).then(function () { return refresh(true); });
    });});
});
var timer = setInterval(function () {
    if (!alive || running) return;
    if (!settings) { enqueue(loadSettings); return; }
    enqueue(function(){return drainHints().then(cycle);});
}, 15000);
function loadSettings() {
    return request("settings", {}).then(function (result) {
        if (!alive) return;
        if(result.automaticProducts!=="telegram-v1")throw new Error("Для автоматического определения товара обновите сервер AutoStars до 0.10.2 или новее.");
        settings = result; clearError(); return refresh(true);
    }).then(function () {
        if (alive){render(true);return drainHints();}
    }).catch(function (err) {
        error(err);
        if (!alive) return;
        if (settings) render(true);
        else fpt.ui.setSlot(slotKey, { type: "Card", children: [text("AutoStars · @AntiDoxService"), text("Не удалось загрузить настройки: " + lastError), text("Ключ сохранён. Подключение повторится автоматически.")] });
    });
}
enqueue(loadSettings);
return { stop: function () { alive = false; hints={};clearInterval(timer); delete window[callback]; } };

    }

    function localError(code, text) { var error = new Error(text); error.code = code; return error; }
    function temporary(error) {
        return /^(API_UNAVAILABLE|API_BUSY|RATE_LIMIT|BUSY|INTERNAL_ERROR|LOCAL_TEMPORARY|CHALLENGE_EXPIRED)$/.test(error && error.code || "");
    }
    function accessDenied(error) {
        return /^(?:LICENSE_|INVALID_LICENSE$|USER_BLOCKED$|NICKNAME_RESET_REQUIRED$|ACCOUNT_MISMATCH$|LOCAL_ACCOUNT_CHANGED$|INVALID_PROOF$|ALREADY_BOUND$)/.test(error && error.code || "");
    }
    function ensureEpoch(epoch) {
        if (epoch !== accessEpoch || !session) throw localError("STALE_SESSION", "Сессия изменилась. Повторите проверку ключа.");
    }
    function lockAccess(error) {
        accessEpoch++;
        retryActivation = false;
        pendingKey = "";
        session = null;
        try { stop(); } catch (ignored) {}
        try { fpt.ui.setState(prefix + "jwt", ""); } catch (ignored) {}
        var message = "Доступ не подтверждён: " + safeError(error) + ". Повторите проверку ключа.";
        notice(message, false);
        try { show(message); } catch (ignored) { notice(message, true); }
    }

    function safeError(error) {
        return String(error && error.message || error || "неизвестная ошибка")
            .replace(/\b(?:UBK|SES)-[A-Za-z0-9_-]+/g, "[ключ скрыт]")
            .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[данные скрыты]").slice(0, 300);
    }
    function notice(text, toast) {
        try { if (fpt.app && fpt.app.log) fpt.app.log("AutoStars 0.6.8: " + text); } catch (ignored) {}
        try { if (toast && fpt.app && fpt.app.toast) fpt.app.toast(text); } catch (ignored) {}
    }
    function progress(text) {
        activationStage = text;
        notice(text, false);
        show("Активация: " + text + "…");
    }
    function failed(error) {
        accessEpoch++;
        session = null;
        busy = false;
        try { stop(); } catch (ignored) {}
        retryActivation = temporary(error);
        var text = "Активация остановлена. Этап: " + activationStage + ". " + safeError(error);
        if (retryActivation) text += "\nВременный сбой. Проверка повторится автоматически в течение минуты; вводить ключ заново не нужно.";
        else pendingKey = "";
        notice(text, !retryActivation);
        try { show(text); } catch (ignored) { notice("Не удалось обновить карточку плагина. Перезапустите FP Tools без очистки данных.", true); }
    }
    function requireFeatures() {
        if (!window.crypto || !window.crypto.subtle) throw new Error("В среде FP Tools недоступен WebCrypto. Нужна поддержка WebCrypto в WebView приложения.");
        if (!window.indexedDB) throw new Error("В среде FP Tools недоступно хранилище IndexedDB.");
        if (typeof TextEncoder !== "function") throw new Error("В среде FP Tools недоступен TextEncoder. Обновите Android System WebView и FP Tools.");
    }
    function bounded(promise, message, lateResult) {
        return new Promise(function (resolve, reject) {
            var finished = false;
            var timer = setTimeout(function () { if (!finished) { finished = true; reject(localError("LOCAL_TEMPORARY", message)); } }, 45000);
            promise.then(function (value) {
                if (finished) { if (lateResult) lateResult(value); return; }
                finished = true; clearTimeout(timer); resolve(value);
            }, function (error) {
                if (finished) return;
                finished = true; clearTimeout(timer); reject(error);
            });
        });
    }

    function canonical(value) {
        if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
        if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ":" + canonical(value[key]); }).join(",") + "}";
        return JSON.stringify(value);
    }
    function base64url(bytes) {
        var text = "";
        new Uint8Array(bytes).forEach(function (value) { text += String.fromCharCode(value); });
        return btoa(text).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }
    function openIdentity() {
        requireFeatures();
        var blocked = false;
        return bounded(new Promise(function (resolve, reject) {
            var request = indexedDB.open(prefix + "identity", 1);
            request.onupgradeneeded = function () { request.result.createObjectStore("keys"); };
            request.onerror = function () { reject(localError("LOCAL_TEMPORARY", "Не удалось открыть хранилище установки.")); };
            request.onblocked = function () { blocked = true; reject(localError("LOCAL_TEMPORARY", "Хранилище установки занято.")); };
            request.onsuccess = function () { if (blocked) request.result.close(); else resolve(request.result); };
        }), "Хранилище установки не ответило за 45 секунд.", function (db) { db.close(); }).then(function (db) {
            return bounded(new Promise(function (resolve, reject) {
                var tx = db.transaction("keys", "readonly");
                var request = tx.objectStore("keys").get("identity");
                request.onsuccess = function () { resolve(request.result); };
                request.onerror = function () { reject(localError("LOCAL_TEMPORARY", "Не удалось прочитать привязку.")); };
                tx.onabort = tx.onerror = function () { reject(localError("LOCAL_TEMPORARY", "Ошибка чтения хранилища установки.")); };
            }), "Не удалось прочитать привязку за 45 секунд.").then(function (saved) {
                if (saved) return saved;
                return bounded(crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]), "WebCrypto не завершил создание ключа установки.").then(function (pair) {
                    return bounded(crypto.subtle.exportKey("jwk", pair.publicKey), "WebCrypto не вернул открытый ключ установки.").then(function (jwk) {
                        var value = {
                            installationId: base64url(crypto.getRandomValues(new Uint8Array(24))),
                            privateKey: pair.privateKey,
                            publicKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }
                        };
                        return bounded(new Promise(function (resolve, reject) {
                            var tx = db.transaction("keys", "readwrite");
                            tx.objectStore("keys").add(value, "identity");
                            tx.oncomplete = function () { resolve(value); };
                            tx.onerror = tx.onabort = function () { reject(localError("LOCAL_TEMPORARY", "Не удалось сохранить привязку.")); };
                        }), "Хранилище не подтвердило сохранение привязки. Перезапустите FP Tools без очистки данных.");
                    });
                });
            }).then(function (value) { db.close(); return value; }, function (error) { db.close(); throw error; });
        });
    }
    function api(path, input, token) {
        if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(API_BASE) || API_BASE.indexOf("example.com") !== -1) throw new Error("Автор должен указать адрес запущенного сервера в загрузчике.");
        var headers = { "Content-Type": "application/json", "Accept": "application/json" };
        if (token) headers.Authorization = "Bearer " + token;
        var response;
        try {
            response = fpt.network.post(API_BASE + path, JSON.stringify(input), JSON.stringify(headers));
            if (typeof response === "string") response = JSON.parse(response);
        } catch (error) { throw localError("API_UNAVAILABLE", "Не удалось подключиться к серверу лицензий по HTTPS."); }
        if (!response || Number(response.code) >= 500 || Number(response.code) === 408) throw localError("API_UNAVAILABLE", "Сервер лицензий временно недоступен.");
        if (Number(response.code) === 429) throw localError("API_BUSY", "Сервер занят. Повторим проверку позже.");
        var data;
        try { data = typeof response.body === "string" ? JSON.parse(response.body) : response.body; }
        catch (error) { throw localError("API_UNAVAILABLE", "Сервер вернул непонятный ответ."); }
        if (!response || Number(response.code) !== 200 || !data) {
            var code = data && typeof data.error === "string" ? data.error : "API_UNAVAILABLE";
            throw localError(code, code === "API_UNAVAILABLE" ? "Сервер активации недоступен." : code);
        }
        return data;
    }
    function sign(action, payload) {
        var challenge = api("/v1/challenge", {});
        var message = "underbek-license-v1\n" + action + "\n" + challenge.challengeId + "\n" + canonical(payload);
        return bounded(crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, identity.privateKey, new TextEncoder().encode(message)), "WebCrypto не завершил подпись запроса.")
            .then(function (bytes) { return { challengeId: challenge.challengeId, signature: base64url(bytes) }; });
    }
    function renew(epoch) {
        var profile = checkProfile();
        checkAccount();
        var licenseKey = fpt.storage.get(prefix + "license");
        if (!licenseKey) return Promise.reject(localError("INVALID_LICENSE", "Нет сохранённого ключа. Повторите активацию."));
        var payload = { licenseKey: licenseKey, installationId: identity.installationId, publicKey: identity.publicKey, funpayUserId: String(profile.id), funpayUsername: String(profile.username || "").trim().normalize("NFC") };
        return sign("activate", payload).then(function (proof) { ensureEpoch(epoch); checkAccount(); payload.challengeId = proof.challengeId; payload.signature = proof.signature; session = api("/v1/activate", payload); session.funpayUserId = String(profile.id); profileCheckedAt = Date.now(); });
    }
    function checkAccount() {
        var active = readAccount();
        if (!accountId || String(active.id) !== accountId) throw localError("LOCAL_ACCOUNT_CHANGED", "Сменился профиль FunPay. Перезапустите плагин и повторите проверку ключа.");
    }
    function readAccount() {
        var active;
        try { active = nativeObject(fpt.accounts.getActive()); } catch (ignored) {}
        if (!active || !active.id) throw localError("LOCAL_TEMPORARY", "Приложение пока не вернуло активный аккаунт FunPay.");
        return active;
    }
    function nativeObject(value) {
        // Native bridges may serialize their result. Do not cache identity or
        // substitute a previous account when the current response is missing.
        if (typeof value === "string" && value.length <= 100000) {
            try { value = JSON.parse(value); } catch (ignored) { return null; }
        }
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    }
    function readProfile() {
        var profile;
        try { profile = nativeObject(fpt.users.getProfile()); } catch (ignored) {}
        if (!profile || !/^[1-9]\d*$/.test(String(profile.id || "")) || !String(profile.username || "").trim()) throw localError("LOCAL_TEMPORARY", "Профиль FunPay временно недоступен.");
        return profile;
    }
    function checkProfile() {
        checkAccount();
        var profile = readProfile();
        checkAccount();
        if (!profile || !session || String(profile.id) !== session.funpayUserId) throw localError("LOCAL_ACCOUNT_CHANGED", "Не удалось подтвердить профиль FunPay.");
        if (String(profile.username || "").trim().normalize("NFC") !== session.funpayUsername) {
            var reason = "Ник FunPay изменился. Оплатите сброс привязки в Telegram-боте и вставьте новый ключ. Срок лицензии сохраняется.";
            throw localError("NICKNAME_RESET_REQUIRED", reason);
        }
        profileCheckedAt = Date.now();
        return profile;
    }
    function authenticated(action, data) {
        if (["status","settings","orders","prepare","report","recipient","cancel","ack","legacy-blocks"].indexOf(action)<0) return Promise.reject(new Error("Неизвестное действие плагина."));
        var epoch = accessEpoch;
        function attempt(retried) {
            var signedSession;
            return Promise.resolve().then(function () {
            ensureEpoch(epoch);
            checkAccount();
            if (Date.now() - profileCheckedAt > 60000) checkProfile();
            if (session.sessionExpiresAt - Date.now() < 300000) return renew(epoch);
        }).then(function () {
            ensureEpoch(epoch); signedSession = session;
            return bounded(crypto.subtle.digest("SHA-256", new TextEncoder().encode(signedSession.accessToken)), "WebCrypto не завершил проверку сессии.");
        }).then(function (bytes) {
            ensureEpoch(epoch);
            var hex = Array.prototype.map.call(new Uint8Array(bytes), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
            return sign(action, data === undefined ? { tokenHash: hex, funpayUsername: signedSession.funpayUsername } : { tokenHash: hex, funpayUsername: signedSession.funpayUsername, data: data });
        }).then(function (proof) {
            ensureEpoch(epoch);
            if (session !== signedSession) throw localError("STALE_SESSION", "Сессия изменилась.");
            if (data !== undefined) proof.data = data;
            proof.funpayUsername = signedSession.funpayUsername;
            checkAccount();
            return api("/v1/" + action, proof, signedSession.accessToken);
        }).catch(function (error) {
            // These errors are returned before an API action runs. Never replay an
            // ambiguous network failure of a purchase/report/settings request.
            if (!retried && epoch === accessEpoch && /^(SESSION_EXPIRED|UNAUTHORIZED|CHALLENGE_EXPIRED)$/.test(error.code || "")) {
                if (error.code === "CHALLENGE_EXPIRED") return attempt(true);
                return Promise.resolve().then(function () { return renew(epoch); }).then(function () { return attempt(true); });
            }
            throw error;
        });
        }
        authQueue = authQueue.catch(function () {}).then(function () { return attempt(false); }).catch(function (error) {
            if (epoch === accessEpoch && accessDenied(error)) lockAccess(error);
            throw error;
        });
        return authQueue;
    }
    authenticated.checkAccount = function () { try { checkAccount(); } catch (error) { if (accessDenied(error)) lockAccess(error); throw error; } };
    authenticated.checkProfile = function () { try { checkProfile(); } catch (error) { if (accessDenied(error)) lockAccess(error); throw error; } };
    function readLegacy() {
        var value = fpt.storage.get("orders_v1");
        var legacy = {}, oldSettings = {};
        try {
            legacy = value ? JSON.parse(value) : {};
            oldSettings = JSON.parse(fpt.storage.get("settings_v1") || "{}");
            if (!legacy || Array.isArray(legacy) || typeof legacy !== "object" || !oldSettings || Array.isArray(oldSettings) || typeof oldSettings !== "object") throw new Error();
        } catch (error) { throw new Error("Не удалось прочитать старый журнал или настройки AutoStars. Сохраните данные и обратитесь в поддержку."); }
        var ids = Object.keys(legacy).filter(function (key) { return legacy[key] && legacy[key].orderId === key; });
        return { orders: legacy, ids: ids, settings: oldSettings };
    }
    function legacyReady() {
        if (window[restartName]) throw new Error("Старая выдача отключена. Полностью закройте FP Tools и откройте заново без очистки данных, затем повторите активацию.");
        var old = readLegacy();
        if (old.settings.enabled === true) throw new Error("Сохранилась включённая старая выдача. Нажмите «Переход со старой версии» ниже, затем перезапустите FP Tools.");
        return old;
    }
    function protectLegacyOrders() {
        var old=legacyReady(),ids=old.ids,chain=Promise.resolve();
        for(var i=0;i<ids.length;i+=250)(function(batch){chain=chain.then(function(){return authenticated("legacy-blocks",{orderIds:batch});});})(ids.slice(i,i+250));
        return chain;
    }
    function show(text) {
        var hasLegacy = !!window[restartName];
        try { hasLegacy = hasLegacy || !!fpt.storage.get("settings_v1") || !!fpt.storage.get("orders_v1"); } catch (ignored) {}
        fpt.ui.setSlot(PLUGIN_SLOT_KEY, { type: "Card", children: [
            { type: "Text", text: "AutoStars · @AntiDoxService", bold: true, fontSize: 18.0 },
            { type: "Text", text: "AutoStars 0.6.8 · Telegram → @AntiDoxService", fontSize: 12.0 },
            { type: "Text", text: text || "Введите ключ лицензии. Первая активация привяжет его к этой установке.", fontSize: 14.0 },
            { type: "Text", text: "Купить ключ: " + BOT_URL + "\nОткройте бота в Telegram, выберите тариф и вставьте полученный ключ ниже.", fontSize: 12.0 },
            { type: "Input", stateKey: prefix + "key", label: "Лицензионный ключ (пусто — использовать сохранённый)", singleLine: true },
            { type: "Button", text: "Проверить ключ", onClick: "window." + activateName + "()" },
            hasLegacy ? { type: "Button", text: "Переход со старой версии", onClick: "window." + migrationName + "('preview')" } : { type: "Spacer", size: 0 },
            text ? { type: "Button", text: "Диагностика", onClick: "fpt.app.toast('Проверка AutoStars 0.6.8'); window." + diagnosticName + "()" } : { type: "Spacer", size: 0 },
            { type: "Text", text: "Для работы нужен интернет. Очистка данных приложения может потребовать переноса лицензии через @AntiDoxService.", fontSize: 12.0 },
            { type: "Text", text: "Копирование и распространение без разрешения @AntiDoxService запрещены.", fontSize: 12.0 }
        ] });
    }
    function stop() {
        if (runtime && typeof runtime.stop === "function") runtime.stop();
        runtime = null;
    }
    window[activateName] = function (automatic) {
        if (busy) { notice("Активация уже выполняется. Этап: " + activationStage, true); return; }
        busy = true;
        retryActivation = false;
        accessEpoch++;
        var epoch = accessEpoch;
        var licenseKey;
        try {
            activationStage = "чтение ключа";
            if (!automatic) notice("Кнопка активации нажата", true);
            stop();
            session = null;
            licenseKey = String((automatic ? pendingKey : fpt.ui.getState(prefix + "key")) || fpt.storage.get(prefix + "license") || "").trim();
            if (!/^UBK-[A-Za-z0-9_-]{43}$/.test(licenseKey)) throw new Error("Введите полный ключ UBK-… из бота.");
            pendingKey = licenseKey;
            activationStage = "проверка старой версии";
            legacyReady();
            activationStage = "проверка возможностей FP Tools";
            requireFeatures();
            progress("открываем хранилище установки");
        } catch (error) { failed(error); return; }
        Promise.resolve().then(function () {
            return openIdentity();
        }).then(function (value) {
            identity = value;
            progress("проверяем профиль FunPay");
            var active = readAccount();
            accountId = String(active.id);
            var profile = readProfile();
            checkAccount();
            var payload = { licenseKey: licenseKey, installationId: identity.installationId, publicKey: identity.publicKey, funpayUserId: String(profile.id), funpayUsername: String(profile.username || "").trim().normalize("NFC") };
            progress("подключаемся к серверу лицензий");
            return sign("activate", payload).then(function (proof) {
                checkAccount();
                payload.challengeId = proof.challengeId;
                payload.signature = proof.signature;
                session = api("/v1/activate", payload);
                session.funpayUserId = String(profile.id);
                profileCheckedAt = Date.now();
                fpt.storage.set(prefix + "license", licenseKey);
                fpt.ui.setState(prefix + "key", "");
                progress("подтверждаем доступ к настройкам");
                return protectLegacyOrders().then(function () { return authenticated("status"); });
            });
        }).then(function (license) {
            ensureEpoch(epoch);
            if (!license || license.active !== true || license.licenseId !== session.licenseId || license.funpayUserId !== session.funpayUserId || license.funpayUsername !== session.funpayUsername) throw new Error("Сервер не подтвердил доступ к этому профилю.");
            if (license.deliveryProtocol === "local-fragment-v1") throw new Error("На VPS ещё работает локальная схема 0.10.0. Установите сервер 0.10.2 для возврата серверной выдачи.");
            progress("открываем настройки Fragment");
            // All client code is already inside this file; network replies contain data, never executable code.
            runtime = startEmbedded(fpt, PLUGIN_SLOT_KEY, license, authenticated, prefix);
            pendingKey = "";
        }).catch(failed).then(function () { busy = false; });
    };
    window[migrationName] = function (action) {
        if (busy) { notice("Дождитесь завершения текущей активации.", true); return; }
        activationStage = "переход со старой версии";
        try {
            if (action === "back") { show(); return; }
            var old = readLegacy();
            if (action === "confirm") {
                if (fpt.ui.getState(prefix + "legacy_ack") !== "true") { notice("Сначала отметьте согласие с условиями перехода.", true); return; }
                // Keep the marker in the WebView global object: editing/re-evaluating the plugin is not a restart.
                window[restartName] = true;
                old.settings.enabled = false;
                fpt.storage.set("settings_v1", JSON.stringify(old.settings));
                if (readLegacy().settings.enabled !== false) throw new Error("Приложение не подтвердило сохранение настройки. Перезапустите его и повторите переход.");
                fpt.ui.setState(prefix + "legacy_ack", "false");
                accessEpoch++; session = null; retryActivation = false; pendingKey = ""; stop();
                show("Старая выдача отключена в настройках этого плагина. Журнал сохранён. Полностью закройте FP Tools и откройте заново без очистки данных. Затем нажмите «Проверить ключ». Старые заказы будут исключены из новой автовыдачи; незавершённые операции проверьте отдельно.");
                return;
            }
            if (window[restartName]) { show("Для завершения перехода полностью закройте FP Tools и откройте заново без очистки данных."); return; }
            var pending = old.ids.filter(function (id) { return !/^(COMPLETED|CANCELLED(?:_.*)?)$/.test(String(old.orders[id].state || "")); });
            var preview = "Старых записей: " + old.ids.length + ". Без отметки завершения или отмены: " + pending.length + ".\n" +
                pending.slice(0, 8).map(function (id) { return "#" + id + " · " + String(old.orders[id].state || "неизвестно"); }).join("\n");
            fpt.ui.setState(prefix + "legacy_ack", "false");
            fpt.ui.setSlot(PLUGIN_SLOT_KEY, { type: "Card", children: [
                { type: "Text", text: "Переход на AutoStars с лицензией", bold: true, fontSize: 18.0 },
                { type: "Text", text: preview, fontSize: 13.0 },
                { type: "Text", text: "Отключается старая выдача в этой записи плагина. Если старая версия есть отдельным плагином, выключите её тоже. После подтверждения требуется полный перезапуск FP Tools.", fontSize: 13.0 },
                { type: "Text", text: "Журнал, лицензионный ключ и привязка сохраняются. Все старые ID, включая ожидающие, будут исключены из новой автовыдачи. Уже отправленные операции Fragment этим действием не отменяются. Незавершённые заказы нужно проверить отдельно; JWT и правила новой версии настраиваются заново.", fontSize: 13.0 },
                { type: "Checkbox", text: "Понимаю: старые заказы не будут выданы новой версией, незавершённые проверю отдельно", stateKey: prefix + "legacy_ack" },
                { type: "Button", text: "Отключить старую выдачу", onClick: "window." + migrationName + "('confirm')" },
                { type: "Button", text: "Назад", onClick: "window." + migrationName + "('back')" }
            ] });
        } catch (error) { failed(error); }
    };
    window[diagnosticName] = function () {
        var report = "Проверка AutoStars 0.6.8. Кнопка и обработчик работают.\n";
        try {
            report += "WebCrypto: " + (window.crypto && window.crypto.subtle ? "есть" : "нет") + "\n";
            report += "IndexedDB: " + (window.indexedDB ? "есть" : "нет") + "\n";
            report += "TextEncoder: " + (typeof TextEncoder === "function" ? "есть" : "нет") + "\n";
            report += "Чтение поля ключа: " + (fpt.ui.getState(prefix + "key") ? "поле заполнено" : "поле пустое") + "\n";
            report += "Сохранённый ключ: " + (fpt.storage.get(prefix + "license") ? "есть" : "нет") + "\n";
            report += "Этап: " + activationStage + ". Занят: " + (busy ? "да" : "нет") + ".";
        } catch (error) { report += "Ошибка проверки: " + safeError(error); }
        notice(report, true);
        try { show(report); } catch (ignored) {}
    };
    setInterval(function () {
        if (!busy && !session && retryActivation) { window[activateName](true); return; }
        if (busy || !session || statusPending) return;
        statusPending = true;
        authenticated("status").catch(function (error) {
            notice("Проверка лицензии: " + safeError(error) + ". Следующая проверка выполнится автоматически.", false);
        }).then(function () { statusPending = false; });
    }, 60000);
    try {
        fpt.ui.setState(prefix + "key", "");
        show();
        if (fpt.storage.get(prefix + "license")) setTimeout(function () { window[activateName](true); }, 1000);
    } catch (error) { activationStage = "запуск загрузчика"; failed(error); }
}());
