// @name AutoSMM
// @author @exfador
// @version 2.1-beta
// @description Авто-накрутка: принимает заказ, берёт ссылку у покупателя и отправляет её в SMM-сервис (twiboost/neversmm и др.). Возврат при ошибке, подсчёт чистой прибыли, команды "чек" и "рефилл".
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/autosmm_banner.png

/*
 * Чистый порт AutoSMM с FunPay Cardinal (Python) на FunPay Tools (Android JS).
 * Без подключения к чужим БД, без отпечатков машины, без скрытых запросов —
 * все сетевые вызовы идут ТОЛЬКО на SMM-сервисы, чьи api_url/api_key задаёт сам пользователь.
 *
 * Соответствие API (Cardinal -> FunPay Tools, по DAI.md):
 *   BIND_TO_NEW_ORDER / NewOrderEvent     ->  fpt.on("onNewOrder", ...)
 *   BIND_TO_NEW_MESSAGE / NewMessageEvent ->  fpt.on("onNewMessage", ...)
 *   c.account.get_order(id)               ->  fpt.orders.getDetails(id)
 *   c.send_message(chat_id, text)         ->  fpt.chat.send(chatId, text)
 *   c.account.refund / refund_order       ->  fpt.orders.refund(id)
 *   requests.get(smm api)                 ->  fpt.network.get(url, headers)
 *   sqlite + json config                  ->  fpt.storage (JSON)
 *   telegram bot menu                     ->  fpt.ui.setSlot(PLUGIN_SLOT_KEY, ui)
 *   фоновая проверка статусов             ->  setInterval
 *
 * Маркеры в описании лота (как в оригинале):
 *   smm:on            — пометка SMM-лота
 *   id:<service_id>   — ID услуги в SMM-сервисе
 *   api:<name> или name:<name> — имя настроенного сервиса
 *   am:<per_unit>     — количество на 1 единицу заказа; итог = am * order.amount
 */

(function () {
    "use strict";

    var SKEY_CFG = "autosmm_config";       // { services:[{name,url,token}], links:[...], settings:{...} }
    var SKEY_PENDING = "autosmm_pending";   // { "<buyerId>": {orderData} } — ждут ссылку
    var SKEY_ORDERS = "autosmm_orders";     // [{orderId, smmId, url, token, profit, qty, link, status, chatId}]
    var SKEY_RUN = "autosmm_running";       // "true"/"false"

    var STATUS_POLL_MS = 60000;             // проверка статусов раз в минуту

    function log(m) { try { fpt.app.log("[AutoSMM] " + m); } catch (e) {} }

    // ----- storage helpers -----
    function readJson(key, def) {
        try { var raw = fpt.storage.get(key); return raw ? JSON.parse(raw) : def; }
        catch (e) { return def; }
    }
    function writeJson(key, obj) {
        try { fpt.storage.set(key, JSON.stringify(obj)); } catch (e) { log("save err " + key + ": " + e); }
    }

    var DEFAULT_LINKS = [
        "vk.com", "t.me", "instagram.com", "tiktok.com", "youtube.com",
        "youtu.be", "twitch.tv", "vt.tiktok.com", "vm.tiktok.com",
        "www.youtu.be", "www.youtube.com", "twitter.com", "x.com"
    ];

    var DEFAULT_MESSAGES = {
        new_order: "❤️ Спасибо за заказ! Накрутка начнётся автоматически.\n🛍️ Услуга: {desc}\n🔢 Количество: {qty}\n\n📌 Чтобы запустить, отправьте ссылку в формате https://...\n❗ Без корректной ссылки выполнение невозможно.",
        invalid_link: "❌ Неверный формат ссылки. Отправьте ссылку вида http:// или https:// на поддерживаемую площадку (VK, Telegram, Instagram, TikTok, YouTube и т.д.).",
        confirmed: "✅ Заказ принят в работу!\nID в сервисе: {smmId}\nСсылка: {link}\nНакрутка выполняется.",
        already: "⚠️ Этот заказ уже обработан."
    };

    function Config() {
        var c = readJson(SKEY_CFG, null);
        if (!c) c = {};
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

    // =========================================================================
    //  Валидация ссылки (аналог SMMUtils.is_valid_link)
    // =========================================================================
    function extractLink(text) {
        if (!text) return null;
        var m = text.match(/(https?:\/\/\S+)/);
        if (m) return m[1];
        var t = text.match(/((?:https?:\/\/)?t\.me\/\S+)/);
        if (t) return t[1];
        return null;
    }
    function isValidLink(link) {
        if (!link) return false;
        var links = Config().links;
        var low = link.toLowerCase();
        for (var i = 0; i < links.length; i++) {
            if (low.indexOf(links[i].toLowerCase()) !== -1) return true;
        }
        return false;
    }

    // =========================================================================
    //  Парсинг описания лота (аналог _handle_smm_order regex'ов)
    // =========================================================================
    function parseSmmMarkers(desc) {
        if (!desc) return null;
        if (!/\bsmm\s*:\s*on\b/i.test(desc)) return null;

        var mId = desc.match(/\bid\s*:\s*(\d+)/i);
        if (!mId) { log("нет id: в описании"); return null; }
        var serviceId = parseInt(mId[1], 10);

        var mApi = desc.match(/\bname\s*:\s*(\w+)/i) || desc.match(/\bapi\s*:\s*(\w+)/i);
        if (!mApi) { log("нет api:/name: в описании"); return null; }
        var apiName = mApi[1].trim();

        var mAm = desc.match(/\bam\s*:\s*(\d+)/i);
        if (!mAm) { log("нет am: в описании"); return null; }
        var perUnit = parseInt(mAm[1], 10);

        return { serviceId: serviceId, apiName: apiName, perUnit: perUnit };
    }

    function findService(name) {
        var svcs = Config().services;
        for (var i = 0; i < svcs.length; i++) {
            if ((svcs[i].name || "").toLowerCase() === name.toLowerCase()) return svcs[i];
        }
        return null;
    }

    function fmt(tpl, vars) {
        return tpl.replace(/\{(\w+)\}/g, function (_, k) { return (vars[k] !== undefined) ? vars[k] : "{" + k + "}"; });
    }

    // =========================================================================
    //  Обработка нового заказа (аналог new_order_handler -> _handle_smm_order)
    // =========================================================================
    function onNewOrder(orderData) {
        if (!isRunning()) return;
        try {
            var orderId = orderData.orderId;
            var details = fpt.orders.getDetails(orderId);
            if (!details) { log("нет деталей заказа " + orderId); return; }

            // поля деталей по DAI: описание/кол-во/цена/покупатель — достаём с запасными именами
            var desc = details.description || details.title || details.fullDescription || "";
            var amount = parseInt(details.amount || details.quantity || details.count || 1, 10) || 1;
            var price = parseFloat(details.price || details.sum || details.total || 0) || 0;
            var chatId = orderData.chatId || details.chatId || "";
            var buyerName = orderData.buyerName || details.buyerName || "";
            var buyerId = String(details.buyerId || orderData.buyerName || chatId);

            var markers = parseSmmMarkers(desc);
            if (!markers) { log("заказ " + orderId + " не SMM, пропуск"); return; }

            var svc = findService(markers.apiName);
            if (!svc || !svc.url || !svc.token) {
                log("не найден сервис: " + markers.apiName);
                return;
            }

            var totalQty = markers.perUnit * amount;

            var pending = readJson(SKEY_PENDING, {});
            pending[buyerId] = {
                orderId: orderId,
                serviceId: markers.serviceId,
                totalQty: totalQty,
                apiUrl: svc.url,
                apiToken: svc.token,
                chatId: chatId,
                username: buyerName,
                price: price,
                desc: desc
            };
            writeJson(SKEY_PENDING, pending);

            var cfg = Config();
            fpt.chat.send(chatId, fmt(cfg.messages.new_order, { desc: desc, qty: totalQty }));

            if (cfg.settings.notify) {
                fpt.app.notify("🆕 Новый SMM заказ", buyerName + " · " + desc + " · кол-во " + totalQty + " · ждёт ссылку");
            }
            log("SMM заказ " + orderId + " ждёт ссылку, qty=" + totalQty);
        } catch (e) {
            log("onNewOrder err: " + e);
        }
    }

    // =========================================================================
    //  Обработка сообщения покупателя (аналог message_handler)
    // =========================================================================
    function onNewMessage(msg) {
        try {
            if (msg.isMe) return;
            var text = msg.text || "";
            var chatId = msg.chatId || "";
            if (!text) return;

            // команды покупателя/продавца
            var low = text.toLowerCase();
            if (low.indexOf("чек ") === 0) {
                checkOrderCommand(chatId, text.split(" ").slice(1).join(" ").trim().replace(/^#/, ""));
                return;
            }
            if (low.indexOf("рефилл ") === 0) {
                refillCommand(chatId, text.split(" ").slice(1).join(" ").trim().replace(/^#/, ""));
                return;
            }

            if (!isRunning()) return;

            var link = extractLink(text);
            if (!link) return;

            // ищем ожидающий заказ этого покупателя. Ключ — buyerId; резолвим из chatId.
            var buyerId = "";
            try { buyerId = fpt.chat.resolveUserId(chatId); } catch (e) {}
            var pending = readJson(SKEY_PENDING, {});

            var data = pending[buyerId];
            if (!data) {
                // запасной путь: ищем по chatId среди ожидающих
                for (var k in pending) {
                    if (pending.hasOwnProperty(k) && pending[k].chatId === chatId) { data = pending[k]; buyerId = k; break; }
                }
            }
            if (!data) { log("нет ожидающего заказа для chat " + chatId); return; }

            var orders = readJson(SKEY_ORDERS, []);
            for (var i = 0; i < orders.length; i++) {
                if (orders[i].orderId === data.orderId) {
                    fpt.chat.send(chatId, Config().messages.already);
                    return;
                }
            }

            if (!isValidLink(link)) {
                fpt.chat.send(chatId, Config().messages.invalid_link);
                return;
            }

            // снимаем из pending и запускаем
            delete pending[buyerId];
            writeJson(SKEY_PENDING, pending);
            processOrderWithLink(data, link);
        } catch (e) {
            log("onNewMessage err: " + e);
        }
    }

    // =========================================================================
    //  Создание заказа в SMM-сервисе (аналог _process_order_with_link)
    // =========================================================================
    function smmGet(apiUrl, params) {
        var qs = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
        }).join("&");
        var url = apiUrl + (apiUrl.indexOf("?") === -1 ? "?" : "&") + qs;
        var res = fpt.network.get(url, {});
        if (!res || res.error) return null;
        if (res.code && res.code !== 200) { log("SMM http " + res.code); return null; }
        try { return JSON.parse(res.body || "null"); } catch (e) { log("SMM bad json: " + (res.body || "").slice(0, 200)); return null; }
    }

    function processOrderWithLink(data, link) {
        var orderId = data.orderId;
        var chatId = data.chatId;
        var cfg = Config();

        var addResp = smmGet(data.apiUrl, {
            action: "add",
            service: data.serviceId,
            link: link,
            quantity: data.totalQty,
            key: data.apiToken
        });

        if (!addResp) { doRefund(orderId, chatId, "Ошибка соединения с SMM API"); return; }
        if (addResp.error) { doRefund(orderId, chatId, "API: " + addResp.error); return; }
        if (!addResp.order) { doRefund(orderId, chatId, "API не вернул ID заказа"); return; }

        var smmId = addResp.order;

        // статус -> charge для подсчёта чистой прибыли
        var charge = 0;
        var st = smmGet(data.apiUrl, { action: "status", order: smmId, key: data.apiToken });
        if (st && st.charge !== undefined) { charge = parseFloat(st.charge) || 0; }
        var profit = (data.price - charge);

        // сохраняем заказ
        var orders = readJson(SKEY_ORDERS, []);
        orders.push({
            orderId: orderId, smmId: smmId, url: data.apiUrl, token: data.apiToken,
            profit: profit, qty: data.totalQty, link: link, status: "Pending", chatId: chatId
        });
        writeJson(SKEY_ORDERS, orders);

        fpt.chat.send(chatId, fmt(cfg.messages.confirmed, { smmId: smmId, link: link }));

        if (cfg.settings.notify) {
            fpt.app.notify("✅ Заказ создан #" + smmId,
                data.username + " · " + data.price + "₽ · потрачено " + charge + " · профит " + profit.toFixed(2) + "₽");
        }
        log("SMM заказ создан: " + smmId + " (fp " + orderId + ")");
    }

    function doRefund(orderId, chatId, reason) {
        var cfg = Config();
        log("refund " + orderId + ": " + reason);
        if (cfg.settings.refund_on_error) {
            try { fpt.orders.refund(orderId); } catch (e) { log("refund err: " + e); }
        }
        if (chatId) {
            try { fpt.chat.send(chatId, "❌ Не удалось выполнить заказ (" + reason + "). Средства возвращены."); } catch (e) {}
        }
        if (cfg.settings.notify) {
            fpt.app.notify("❌ Ошибка заказа " + orderId, reason);
        }
    }

    // =========================================================================
    //  Команды покупателя: чек / рефилл (аналог check_order_command / refill)
    // =========================================================================
    function checkOrderCommand(chatId, idStr) {
        var orders = readJson(SKEY_ORDERS, []);
        var rec = null;
        for (var i = 0; i < orders.length; i++) {
            if (String(orders[i].smmId) === idStr || String(orders[i].orderId) === idStr) { rec = orders[i]; break; }
        }
        if (!rec) { fpt.chat.send(chatId, "❌ Заказ " + idStr + " не найден."); return; }

        var st = smmGet(rec.url, { action: "status", order: rec.smmId, key: rec.token });
        if (!st) { fpt.chat.send(chatId, "⚠️ Не удалось получить статус, попробуйте позже."); return; }

        var status = st.status || "неизвестно";
        var remains = (st.remains !== undefined) ? st.remains : "-";
        fpt.chat.send(chatId, "📊 Статус заказа #" + rec.smmId + ":\nСостояние: " + status + "\nОсталось: " + remains);
    }

    function refillCommand(chatId, idStr) {
        var orders = readJson(SKEY_ORDERS, []);
        var rec = null;
        for (var i = 0; i < orders.length; i++) {
            if (String(orders[i].smmId) === idStr || String(orders[i].orderId) === idStr) { rec = orders[i]; break; }
        }
        if (!rec) { fpt.chat.send(chatId, "❌ Заказ " + idStr + " не найден."); return; }

        var rf = smmGet(rec.url, { action: "refill", order: rec.smmId, key: rec.token });
        if (rf && (rf.refill || rf.order)) {
            fpt.chat.send(chatId, "♻️ Рефилл по заказу #" + rec.smmId + " запрошен.");
        } else {
            fpt.chat.send(chatId, "⚠️ Рефилл недоступен для этого заказа или сервиса.");
        }
    }

    // =========================================================================
    //  Фоновая проверка статусов (аналог check_order_status / потока)
    // =========================================================================
    function pollStatuses() {
        if (!isRunning()) return;
        var orders = readJson(SKEY_ORDERS, []);
        var changed = false;
        for (var i = 0; i < orders.length; i++) {
            var o = orders[i];
            if (o.status === "Completed" || o.status === "Canceled") continue;
            var st = smmGet(o.url, { action: "status", order: o.smmId, key: o.token });
            if (!st || !st.status) continue;
            if (st.status !== o.status) {
                o.status = st.status;
                changed = true;
                if (st.status === "Completed" && o.chatId) {
                    try { fpt.chat.send(o.chatId, "✅ Заказ #" + o.smmId + " выполнен. Спасибо за покупку!"); } catch (e) {}
                }
            }
        }
        if (changed) writeJson(SKEY_ORDERS, orders);
    }

    // =========================================================================
    //  UI  (меню сервисов + старт/стоп) — Server-Driven UI по DAI.md
    //  Все колбэки на window.*, Input только singleLine, после setState — re-render.
    // =========================================================================
    window.smm = {
        toggleRun: function () { setRunning(!isRunning()); renderUI(); },

        addService: function () {
            var name = (fpt.ui.getState("smm_svc_name") || "").trim();
            var url = (fpt.ui.getState("smm_svc_url") || "").trim();
            var token = (fpt.ui.getState("smm_svc_token") || "").trim();
            if (!name || !url || !token) { fpt.app.toast("Заполните имя, URL и ключ"); return; }
            var c = Config();
            // если сервис с таким именем есть — обновляем
            var found = false;
            for (var i = 0; i < c.services.length; i++) {
                if (c.services[i].name.toLowerCase() === name.toLowerCase()) {
                    c.services[i] = { name: name, url: url, token: token }; found = true; break;
                }
            }
            if (!found) c.services.push({ name: name, url: url, token: token });
            saveConfig(c);
            fpt.app.toast("Сервис '" + name + "' сохранён");
            fpt.ui.setState("smm_svc_name", "");
            fpt.ui.setState("smm_svc_url", "");
            fpt.ui.setState("smm_svc_token", "");
            renderUI();
        },

        delService: function (idx) {
            var c = Config();
            if (idx >= 0 && idx < c.services.length) { c.services.splice(idx, 1); saveConfig(c); }
            renderUI();
        },

        checkBalance: function (idx) {
            var c = Config();
            var s = c.services[idx];
            if (!s) return;
            var b = smmGet(s.url, { action: "balance", key: s.token });
            if (b && b.balance !== undefined) {
                fpt.app.toast("Баланс " + s.name + ": " + b.balance + " " + (b.currency || ""));
            } else {
                fpt.app.toast("Не удалось получить баланс " + s.name);
            }
        },

        toggleNotify: function () {
            var c = Config(); c.settings.notify = !c.settings.notify; saveConfig(c); renderUI();
        },
        toggleRefund: function () {
            var c = Config(); c.settings.refund_on_error = !c.settings.refund_on_error; saveConfig(c); renderUI();
        }
    };

    function renderUI() {
        var c = Config();
        var children = [];

        children.push({ type: "Text", text: "⚡ AutoSMM", bold: true, fontSize: 18.0 });
        children.push({ type: "Text", text: isRunning() ? "Статус: ✅ ВКЛЮЧЕН" : "Статус: 🔴 ВЫКЛЮЧЕН",
                        color: isRunning() ? "#22c55e" : "#ef4444", bold: true });
        children.push({ type: "Button", text: isRunning() ? "⏹ Выключить" : "▶ Включить", onClick: "window.smm.toggleRun()" });
        children.push({ type: "Divider" });

        // настройки
        children.push({ type: "Row", children: [
            { type: "Checkbox", text: "Уведомления", stateKey: "smm_set_notify", onChange: "window.smm.toggleNotify()" }
        ]});
        children.push({ type: "Row", children: [
            { type: "Checkbox", text: "Возврат при ошибке", stateKey: "smm_set_refund", onChange: "window.smm.toggleRefund()" }
        ]});
        fpt.ui.setState("smm_set_notify", c.settings.notify ? "true" : "false");
        fpt.ui.setState("smm_set_refund", c.settings.refund_on_error ? "true" : "false");

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
                        { type: "Button", text: "💰 Баланс", onClick: "window.smm.checkBalance(" + i + ")" },
                        { type: "Button", text: "🗑 Удалить", onClick: "window.smm.delService(" + i + ")" }
                    ]}
                ]});
            }
        }

        children.push({ type: "Spacer", size: 8 });
        children.push({ type: "Text", text: "➕ Добавить / обновить сервис", bold: true, fontSize: 14.0 });
        children.push({ type: "Input", label: "Имя сервиса (например twiboost)", stateKey: "smm_svc_name", singleLine: true });
        children.push({ type: "Input", label: "API URL (https://twiboost.com/api/v2)", stateKey: "smm_svc_url", singleLine: true });
        children.push({ type: "Input", label: "API ключ", stateKey: "smm_svc_token", singleLine: true });
        children.push({ type: "Button", text: "💾 Сохранить сервис", onClick: "window.smm.addService()" });

        children.push({ type: "Divider" });
        children.push({ type: "Text", text: "В описании SMM-лота укажите маркеры:", fontSize: 12.0, color: "#999999" });
        children.push({ type: "Text", text: "smm:on  id:<id услуги>  api:<имя сервиса>  am:<кол-во на 1 шт>", fontSize: 11.0, color: "#999999" });

        fpt.ui.setSlot(PLUGIN_SLOT_KEY, { type: "Column", children: children });
    }

    // =========================================================================
    //  init
    // =========================================================================
    function init() {
        // дефолтный конфиг при первом запуске
        if (!fpt.storage.get(SKEY_CFG)) saveConfig(Config());
        if (fpt.storage.get(SKEY_RUN) === "") setRunning(false);

        fpt.on("onNewOrder", onNewOrder);
        fpt.on("onNewMessage", onNewMessage);
        setInterval(pollStatuses, STATUS_POLL_MS);

        renderUI();
        log("инициализирован, сервисов: " + Config().services.length);
    }

    init();
})();
