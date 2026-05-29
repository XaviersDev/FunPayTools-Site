// @name AutoSMM
// @author @exfador
// @version 2.5-android
// @description Авто-накрутка: принимает заказ, берёт ссылку у покупателя и отправляет в SMM-сервис (twiboost/neversmm и др.). Возврат при ошибке, подсчёт прибыли, команды "чек"/"рефилл". Без скрытых запросов.
// @banner https://funpay.tools/default-banner.jpeg

/*
 * Порт AutoSMM на FunPay Tools (Android JS). По исходникам приложения:
 *
 *  onNewOrder(orderData) => { orderId, chatId, buyerName }   (без описания/кол-ва!)
 *
 *  fpt.orders.getDetails(id) => {
 *      id, status, gameTitle, shortDesc, price, buyerName, buyerAvatar,
 *      canRefund, canConfirm, hasReview, ..., params: {label: value}, lotId, buyerId
 *  }
 *   ВАЖНО: поля description НЕТ — есть shortDesc (только КРАТКОЕ описание).
 *          поля amount НЕТ — количество лежит в params по ключу "Количество".
 *          ПОДРОБНОЕ описание лота в getDetails НЕ приходит.
 *
 *  fpt.lots.getFields(lotId) => { fields: {name:{value:...}}, csrfToken, ... }
 *          здесь лежат ВСЕ поля лота, включая подробное описание -> отсюда берём маркеры,
 *          если в кратком описании их нет.
 *
 *  Маркеры в описании лота: smm:on  api:<сервис>  id:<id услуги>  am:<кол-во на 1 шт>
 *  Итоговое количество = am * (количество в заказе).
 */

(function () {
    "use strict";

    var SKEY_CFG = "autosmm_config";
    var SKEY_PENDING = "autosmm_pending";
    var SKEY_ORDERS = "autosmm_orders";
    var SKEY_RUN = "autosmm_running";
    var SKEY_DEBUG = "autosmm_debug";

    var STATUS_POLL_MS = 60000;

    function log(m) { try { fpt.app.log("[AutoSMM] " + m); } catch (e) {} }
    function dbg(m) { if (fpt.storage.get(SKEY_DEBUG) === "true") log("DBG " + m); }

    function readJson(key, def) {
        try { var raw = fpt.storage.get(key); return raw ? JSON.parse(raw) : def; } catch (e) { return def; }
    }
    function writeJson(key, obj) {
        try { fpt.storage.set(key, JSON.stringify(obj)); } catch (e) { log("save err " + key + ": " + e); }
    }

    var DEFAULT_LINKS = [
        "vk.com", "t.me", "instagram.com", "tiktok.com", "youtube.com",
        "youtu.be", "twitch.tv", "vt.tiktok.com", "vm.tiktok.com", "twitter.com", "x.com"
    ];

    var DEFAULT_MESSAGES = {
        new_order: "Спасибо за заказ! Накрутка начнётся автоматически.\nУслуга: {desc}\nКоличество: {qty}\n\nЧтобы запустить, отправьте ссылку в формате https://...\nБез корректной ссылки выполнение невозможно.",
        invalid_link: "Неверный формат ссылки. Отправьте ссылку вида http:// или https:// на поддерживаемую площадку (VK, Telegram, Instagram, TikTok, YouTube и т.д.).",
        confirmed: "Заказ принят в работу!\nID в сервисе: {smmId}\nСсылка: {link}\nНакрутка выполняется.",
        already: "Этот заказ уже обработан."
    };

    function Config() {
        var c = readJson(SKEY_CFG, null) || {};
        if (!Array.isArray(c.services)) c.services = [];
        if (!Array.isArray(c.links)) c.links = DEFAULT_LINKS.slice();
        if (!c.messages) c.messages = {};
        for (var k in DEFAULT_MESSAGES) if (!c.messages[k]) c.messages[k] = DEFAULT_MESSAGES[k];
        if (!c.settings) c.settings = { notify: true, refund_on_error: true };
        return c;
    }
    function saveConfig(c) { writeJson(SKEY_CFG, c); }

    function isRunning() { return fpt.storage.get(SKEY_RUN) === "true"; }
    function setRunning(v) { fpt.storage.set(SKEY_RUN, v ? "true" : "false"); }

    function extractLink(text) {
        if (!text) return null;
        var m = text.match(/(https?:\/\/\S+)/);
        if (m) return m[1];
        var t = text.match(/((?:https?:\/\/)?t\.me\/\S+)/i);
        if (t) return t[1];
        return null;
    }
    function isValidLink(link) {
        if (!link) return false;
        var links = Config().links, low = link.toLowerCase();
        for (var i = 0; i < links.length; i++) if (low.indexOf(links[i].toLowerCase()) !== -1) return true;
        return false;
    }

    function collectStrings(obj, acc, depth) {
        if (depth > 6 || obj == null) return;
        if (typeof obj === "string") { acc.push(obj); return; }
        if (typeof obj === "number") { acc.push(String(obj)); return; }
        if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) collectStrings(obj[i], acc, depth + 1); return; }
        if (typeof obj === "object") { for (var k in obj) if (obj.hasOwnProperty(k)) collectStrings(obj[k], acc, depth + 1); }
    }

    // количество из params заказа: ищем ключ про количество
    function qtyFromParams(params) {
        if (!params || typeof params !== "object") return null;
        var keys = Object.keys(params);
        for (var i = 0; i < keys.length; i++) {
            var kl = keys[i].toLowerCase();
            if (kl.indexOf("количество") !== -1 || kl.indexOf("кол-во") !== -1 ||
                kl.indexOf("quantity") !== -1 || kl === "amount" || kl.indexOf("кількість") !== -1) {
                var n = parseInt(String(params[keys[i]]).replace(/[^0-9]/g, ""), 10);
                if (!isNaN(n) && n >= 1) return n;
            }
        }
        return null;
    }

    function priceFromDetails(details) {
        if (!details) return 0;
        var raw = details.price || "";
        var n = parseFloat(String(raw).replace(/[^0-9.,]/g, "").replace(",", "."));
        return isNaN(n) ? 0 : n;
    }

    function parseSmmMarkers(text) {
        if (!text) return null;
        if (!/\bsmm\s*:\s*on\b/i.test(text)) return null;
        var mId = text.match(/\bid\s*:\s*(\d+)/i);
        var mApi = text.match(/\bname\s*:\s*(\w+)/i) || text.match(/\bapi\s*:\s*(\w+)/i);
        var mAm = text.match(/\bam\s*:\s*(\d+)/i);
        if (!mId) { log("маркер id: не найден"); return null; }
        if (!mApi) { log("маркер api:/name: не найден"); return null; }
        if (!mAm) { log("маркер am: не найден"); return null; }
        return { serviceId: parseInt(mId[1], 10), apiName: mApi[1].trim(), perUnit: parseInt(mAm[1], 10) };
    }

    function findService(name) {
        var svcs = Config().services;
        for (var i = 0; i < svcs.length; i++) if ((svcs[i].name || "").toLowerCase() === name.toLowerCase()) return svcs[i];
        return null;
    }

    function fmt(tpl, vars) {
        return tpl.replace(/\{(\w+)\}/g, function (_, k) { return (vars[k] !== undefined) ? vars[k] : "{" + k + "}"; });
    }

    // ================= НОВЫЙ ЗАКАЗ =================
    function onNewOrder(orderData) {
        if (!isRunning()) { dbg("заказ пришёл, но плагин выключен"); return; }
        try {
            var orderId = orderData.orderId, chatId = orderData.chatId || "", buyerName = orderData.buyerName || "";
            dbg("onNewOrder raw: " + JSON.stringify(orderData));

            var details = null;
            try { details = fpt.orders.getDetails(orderId); } catch (e) { log("getDetails err: " + e); }
            dbg("getDetails raw: " + JSON.stringify(details));

            // === 1) ищем маркеры в кратком описании + params ===
            var markerSources = [];
            var lotId = null;
            if (details) {
                if (details.shortDesc) markerSources.push(details.shortDesc);
                if (details.params) { var ps = []; collectStrings(details.params, ps, 0); markerSources.push(ps.join("\n")); }
                if (details.gameTitle) markerSources.push(details.gameTitle);
                lotId = details.lotId || null;
            }
            var markers = parseSmmMarkers(markerSources.join("\n"));
            var foundIn = markers ? "краткое описание/params" : "";

            // === 2) подробное описание лота через getFields(lotId) ===
            if (!markers && lotId) {
                try {
                    var fields = fpt.lots.getFields(lotId);
                    dbg("getFields raw keys: " + (fields ? JSON.stringify(Object.keys(fields)) : "null"));
                    var fs = []; collectStrings(fields, fs, 0);
                    markers = parseSmmMarkers(fs.join("\n"));
                    if (markers) foundIn = "подробное описание лота (getFields)";
                } catch (e) { log("getFields err: " + e); }
            }

            // === 3) запасной путь: история чата ===
            if (!markers && chatId) {
                try {
                    var hist = fpt.chat.getHistory(chatId);
                    var hs = []; collectStrings(hist, hs, 0);
                    markers = parseSmmMarkers(hs.join("\n"));
                    if (markers) foundIn = "история чата";
                } catch (e) { log("getHistory err: " + e); }
            }

            if (!markers) {
                log("заказ " + orderId + ": SMM-маркеры не найдены. Укажите smm:on/api:/id:/am: в КРАТКОМ описании лота (подробное приложение может не видеть). Включите Debug для деталей.");
                return;
            }
            dbg("маркеры найдены в: " + foundIn);

            // количество
            var qty = details ? qtyFromParams(details.params) : null;
            if (!qty || qty < 1) { qty = 1; log("кол-во в заказе не определено, беру 1"); }

            var svc = findService(markers.apiName);
            if (!svc || !svc.url || !svc.token) {
                log("сервис '" + markers.apiName + "' не настроен в плагине (проверьте имя сервиса в настройках)");
                if (chatId) fpt.chat.send(chatId, "Заказ требует ручной обработки. Продавец свяжется с вами.");
                return;
            }

            var totalQty = markers.perUnit * qty;
            var price = priceFromDetails(details);
            var desc = (details && details.shortDesc) ? details.shortDesc : (details && details.gameTitle) ? details.gameTitle : "услуга";

            var buyerId = chatId;
            try { if (chatId) buyerId = fpt.chat.resolveUserId(chatId) || chatId; } catch (e) {}

            var pending = readJson(SKEY_PENDING, {});
            pending[buyerId] = {
                orderId: orderId, serviceId: markers.serviceId, totalQty: totalQty,
                apiUrl: svc.url, apiToken: svc.token, chatId: chatId,
                username: buyerName, price: price, desc: desc
            };
            writeJson(SKEY_PENDING, pending);

            var cfg = Config();
            if (chatId) fpt.chat.send(chatId, fmt(cfg.messages.new_order, { desc: desc, qty: totalQty }));
            if (cfg.settings.notify) fpt.app.notify("Новый SMM заказ", buyerName + " - кол-во " + totalQty + " - ждёт ссылку");
            log("SMM заказ " + orderId + " принят, qty=" + totalQty + ", ждёт ссылку");
        } catch (e) {
            log("onNewOrder fatal: " + e);
        }
    }

    // ================= СООБЩЕНИЕ ПОКУПАТЕЛЯ =================
    function onNewMessage(msg) {
        try {
            if (msg.isMe) return;
            var text = msg.text || "", chatId = msg.chatId || "";
            if (!text) return;

            var low = text.toLowerCase();
            if (low.indexOf("чек ") === 0) { checkOrderCommand(chatId, text.split(" ").slice(1).join(" ").trim().replace(/^#/, "")); return; }
            if (low.indexOf("рефилл ") === 0) { refillCommand(chatId, text.split(" ").slice(1).join(" ").trim().replace(/^#/, "")); return; }

            if (!isRunning()) return;
            var link = extractLink(text);
            if (!link) return;

            var buyerId = chatId;
            try { buyerId = fpt.chat.resolveUserId(chatId) || chatId; } catch (e) {}
            var pending = readJson(SKEY_PENDING, {});
            var data = pending[buyerId];
            if (!data) { for (var k in pending) if (pending.hasOwnProperty(k) && pending[k].chatId === chatId) { data = pending[k]; buyerId = k; break; } }
            if (!data) { dbg("ссылка есть, но нет ожидающего заказа для " + chatId); return; }

            var orders = readJson(SKEY_ORDERS, []);
            for (var i = 0; i < orders.length; i++) if (orders[i].orderId === data.orderId) { fpt.chat.send(chatId, Config().messages.already); return; }

            if (!isValidLink(link)) { fpt.chat.send(chatId, Config().messages.invalid_link); return; }

            delete pending[buyerId];
            writeJson(SKEY_PENDING, pending);
            processOrderWithLink(data, link);
        } catch (e) {
            log("onNewMessage fatal: " + e);
        }
    }

    // ================= SMM API =================
    function smmGet(apiUrl, params) {
        var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
        var url = apiUrl + (apiUrl.indexOf("?") === -1 ? "?" : "&") + qs;
        var res = fpt.network.get(url, "{}");
        if (!res) { log("network вернул null"); return null; }
        if (res.code && res.code !== 200) { log("SMM http " + res.code); return null; }
        try { return JSON.parse(res.body || "null"); } catch (e) { log("SMM не-JSON ответ: " + (res.body || "").slice(0, 200)); return null; }
    }

    function processOrderWithLink(data, link) {
        var orderId = data.orderId, chatId = data.chatId, cfg = Config();
        var addResp = smmGet(data.apiUrl, { action: "add", service: data.serviceId, link: link, quantity: data.totalQty, key: data.apiToken });
        if (!addResp) { doRefund(orderId, chatId, "нет связи с SMM API"); return; }
        if (addResp.error) { doRefund(orderId, chatId, "API: " + addResp.error); return; }
        if (!addResp.order) { doRefund(orderId, chatId, "API не вернул ID"); return; }

        var smmId = addResp.order, charge = 0;
        var st = smmGet(data.apiUrl, { action: "status", order: smmId, key: data.apiToken });
        if (st && st.charge !== undefined) charge = parseFloat(st.charge) || 0;
        var profit = data.price - charge;

        var orders = readJson(SKEY_ORDERS, []);
        orders.push({ orderId: orderId, smmId: smmId, url: data.apiUrl, token: data.apiToken, profit: profit, qty: data.totalQty, link: link, status: "Pending", chatId: chatId });
        writeJson(SKEY_ORDERS, orders);

        fpt.chat.send(chatId, fmt(cfg.messages.confirmed, { smmId: smmId, link: link }));
        if (cfg.settings.notify) fpt.app.notify("Заказ создан #" + smmId, data.username + " - профит " + profit.toFixed(2) + "р");
        log("SMM заказ создан: " + smmId + " (fp " + orderId + ")");
    }

    function doRefund(orderId, chatId, reason) {
        var cfg = Config();
        log("refund " + orderId + ": " + reason);
        if (cfg.settings.refund_on_error) { try { fpt.orders.refund(orderId); } catch (e) { log("refund err: " + e); } }
        if (chatId) { try { fpt.chat.send(chatId, "Не удалось выполнить заказ (" + reason + "). Средства возвращены."); } catch (e) {} }
        if (cfg.settings.notify) fpt.app.notify("Ошибка заказа " + orderId, reason);
    }

    // ================= КОМАНДЫ =================
    function findRec(idStr) {
        var orders = readJson(SKEY_ORDERS, []);
        for (var i = 0; i < orders.length; i++) if (String(orders[i].smmId) === idStr || String(orders[i].orderId) === idStr) return orders[i];
        return null;
    }
    function checkOrderCommand(chatId, idStr) {
        var rec = findRec(idStr);
        if (!rec) { fpt.chat.send(chatId, "Заказ " + idStr + " не найден."); return; }
        var st = smmGet(rec.url, { action: "status", order: rec.smmId, key: rec.token });
        if (!st) { fpt.chat.send(chatId, "Не удалось получить статус, попробуйте позже."); return; }
        fpt.chat.send(chatId, "Статус заказа #" + rec.smmId + ":\nСостояние: " + (st.status || "неизвестно") + "\nОсталось: " + (st.remains !== undefined ? st.remains : "-"));
    }
    function refillCommand(chatId, idStr) {
        var rec = findRec(idStr);
        if (!rec) { fpt.chat.send(chatId, "Заказ " + idStr + " не найден."); return; }
        var rf = smmGet(rec.url, { action: "refill", order: rec.smmId, key: rec.token });
        fpt.chat.send(chatId, (rf && (rf.refill || rf.order)) ? "Рефилл по заказу #" + rec.smmId + " запрошен." : "Рефилл недоступен для этого заказа.");
    }

    // ================= ФОН =================
    function pollStatuses() {
        if (!isRunning()) return;
        var orders = readJson(SKEY_ORDERS, []), changed = false;
        for (var i = 0; i < orders.length; i++) {
            var o = orders[i];
            if (o.status === "Completed" || o.status === "Canceled") continue;
            var st = smmGet(o.url, { action: "status", order: o.smmId, key: o.token });
            if (!st || !st.status) continue;
            if (st.status !== o.status) {
                o.status = st.status; changed = true;
                if (st.status === "Completed" && o.chatId) { try { fpt.chat.send(o.chatId, "Заказ #" + o.smmId + " выполнен. Спасибо за покупку!"); } catch (e) {} }
            }
        }
        if (changed) writeJson(SKEY_ORDERS, orders);
    }

    // ================= UI =================
    window.smm = {
        toggleRun: function () { setRunning(!isRunning()); renderUI(); },
        toggleNotify: function () { var c = Config(); c.settings.notify = !c.settings.notify; saveConfig(c); renderUI(); },
        toggleRefund: function () { var c = Config(); c.settings.refund_on_error = !c.settings.refund_on_error; saveConfig(c); renderUI(); },
        toggleDebug: function () { fpt.storage.set(SKEY_DEBUG, fpt.storage.get(SKEY_DEBUG) === "true" ? "false" : "true"); renderUI(); },
        addService: function () {
            var name = (fpt.ui.getState("smm_svc_name") || "").trim();
            var url = (fpt.ui.getState("smm_svc_url") || "").trim();
            var token = (fpt.ui.getState("smm_svc_token") || "").trim();
            if (!name || !url || !token) { fpt.app.toast("Заполните имя, URL и ключ"); return; }
            var c = Config(), found = false;
            for (var i = 0; i < c.services.length; i++) if (c.services[i].name.toLowerCase() === name.toLowerCase()) { c.services[i] = { name: name, url: url, token: token }; found = true; break; }
            if (!found) c.services.push({ name: name, url: url, token: token });
            saveConfig(c);
            fpt.app.toast("Сервис '" + name + "' сохранён");
            fpt.ui.setState("smm_svc_name", ""); fpt.ui.setState("smm_svc_url", ""); fpt.ui.setState("smm_svc_token", "");
            renderUI();
        },
        delService: function (idx) { var c = Config(); if (idx >= 0 && idx < c.services.length) { c.services.splice(idx, 1); saveConfig(c); } renderUI(); },
        checkBalance: function (idx) {
            var s = Config().services[idx]; if (!s) return;
            var b = smmGet(s.url, { action: "balance", key: s.token });
            fpt.app.toast((b && b.balance !== undefined) ? ("Баланс " + s.name + ": " + b.balance + " " + (b.currency || "")) : ("Не удалось получить баланс " + s.name));
        }
    };

    function renderUI() {
        var c = Config(), run = isRunning(), debug = fpt.storage.get(SKEY_DEBUG) === "true";
        var children = [];
        children.push({ type: "Text", text: "AutoSMM", bold: true, fontSize: 18.0 });
        children.push({ type: "Text", text: run ? "Статус: ВКЛЮЧЕН" : "Статус: ВЫКЛЮЧЕН", color: run ? "#22c55e" : "#ef4444", bold: true });
        children.push({ type: "Button", text: run ? "Выключить" : "Включить", onClick: "window.smm.toggleRun()" });
        children.push({ type: "Divider" });
        children.push({ type: "Row", children: [{ type: "Text", text: "Уведомления: " + (c.settings.notify ? "вкл" : "выкл") }, { type: "Button", text: "сменить", onClick: "window.smm.toggleNotify()" }] });
        children.push({ type: "Row", children: [{ type: "Text", text: "Возврат при ошибке: " + (c.settings.refund_on_error ? "вкл" : "выкл") }, { type: "Button", text: "сменить", onClick: "window.smm.toggleRefund()" }] });
        children.push({ type: "Row", children: [{ type: "Text", text: "Debug-лог: " + (debug ? "вкл" : "выкл") }, { type: "Button", text: "сменить", onClick: "window.smm.toggleDebug()" }] });
        children.push({ type: "Divider" });
        children.push({ type: "Text", text: "SMM-сервисы (" + c.services.length + ")", bold: true, fontSize: 15.0 });
        if (c.services.length === 0) {
            children.push({ type: "Text", text: "Пока нет сервисов. Добавьте ниже.", color: "#999999" });
        } else {
            for (var i = 0; i < c.services.length; i++) {
                var s = c.services[i];
                children.push({ type: "Card", children: [
                    { type: "Text", text: s.name, bold: true },
                    { type: "Text", text: s.url, fontSize: 11.0, color: "#999999" },
                    { type: "Row", children: [
                        { type: "Button", text: "Баланс", onClick: "window.smm.checkBalance(" + i + ")" },
                        { type: "Button", text: "Удалить", onClick: "window.smm.delService(" + i + ")" }
                    ] }
                ] });
            }
        }
        children.push({ type: "Spacer", size: 8 });
        children.push({ type: "Text", text: "Добавить / обновить сервис", bold: true, fontSize: 14.0 });
        children.push({ type: "Input", label: "Имя сервиса (например twiboost)", stateKey: "smm_svc_name", singleLine: true });
        children.push({ type: "Input", label: "API URL (https://twiboost.com/api/v2)", stateKey: "smm_svc_url", singleLine: true });
        children.push({ type: "Input", label: "API ключ", stateKey: "smm_svc_token", singleLine: true });
        children.push({ type: "Button", text: "Сохранить сервис", onClick: "window.smm.addService()" });
        children.push({ type: "Divider" });
        children.push({ type: "Text", text: "Маркеры в описании лота:", fontSize: 12.0, color: "#999999" });
        children.push({ type: "Text", text: "smm:on   api:имя_сервиса   id:ID_услуги   am:кол-во_на_1шт", fontSize: 11.0, color: "#999999" });
        children.push({ type: "Text", text: "Совет: дублируйте маркеры в КРАТКОЕ описание — так надёжнее.", fontSize: 11.0, color: "#999999" });
        fpt.ui.setSlot(PLUGIN_SLOT_KEY, { type: "Column", children: children });
    }

    function init() {
        if (!fpt.storage.get(SKEY_CFG)) saveConfig(Config());
        if (fpt.storage.get(SKEY_RUN) === "") setRunning(false);
        fpt.on("onNewOrder", onNewOrder);
        fpt.on("onNewMessage", onNewMessage);
        setInterval(pollStatuses, STATUS_POLL_MS);
        renderUI();
        log("инициализирован, сервисов: " + Config().services.length + ", running=" + isRunning());
    }

    init();
})();
