// @name unique's sniper
// @author @AlliSighs
// @version 1.1
// @description Следит за разделами FunPay и сообщает о дешёвых лотах: раздел, ключевые слова, максимальная цена и минимальное количество.
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/unique_sniper_banner.png

(function () {
    var TAG = "[sniper]", NS_STORE = "", NS_UI = "snp_";

    // ---------------------------------------------------------------- общая часть: одинаково работает на Android и на компьютере
    var REAL = window.fpt;
    var DESKTOP = false;
    try { DESKTOP = REAL.app.platform === "desktop"; } catch (e) {}
    // На Android хранилище и значения полей общие для всех плагинов, поэтому свои ключи помечаем приставкой.
    var fpt = REAL;
    if (!DESKTOP) {
        fpt = Object.create(REAL);
        fpt.on = function (ev, fn) { return REAL.on(ev, fn); };
        fpt.storage = {
            get: function (k) { return REAL.storage.get(NS_STORE + k); },
            set: function (k, v) { return REAL.storage.set(NS_STORE + k, typeof v === "string" ? v : JSON.stringify(v)); },
        };
        fpt.ui = {
            setSlot: function (k, ui) { return REAL.ui.setSlot(k, ui); },
            removeSlot: function (k) { return REAL.ui.removeSlot(k); },
            getState: function (k) { return REAL.ui.getState(NS_UI + k); },
            setState: function (k, v) { return REAL.ui.setState(NS_UI + k, String(v)); },
        };
    }

    function log(m) { try { fpt.app.log(TAG + " " + m); } catch (e) {} }
    function now() { return Date.now() / 1000; }
    function load(key, def) {
        try {
            var raw = fpt.storage.get(key);
            if (raw === null || raw === undefined || raw === "") return def;
            var v = typeof raw === "string" ? JSON.parse(raw) : raw;
            return v === null || v === undefined ? def : v;
        } catch (e) { return def; }
    }
    function save(key, val) {
        try { fpt.storage.set(key, JSON.stringify(val)); } catch (e) { log("не сохранилось " + key + ": " + e); }
    }
    function num(v) {
        if (typeof v === "number") return isFinite(v) ? v : 0;
        var s = String(v === null || v === undefined ? "" : v).replace(/[^\d.,\-]/g, "");
        if (s.indexOf(",") >= 0 && s.indexOf(".") >= 0) s = s.replace(/,/g, ""); else s = s.replace(",", ".");
        var n = parseFloat(s);
        return isFinite(n) ? n : 0;
    }
    function int(v, def) { var n = parseInt(String(v).replace(/[^\d\-]/g, ""), 10); return isFinite(n) ? n : (def === undefined ? 0 : def); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function fill(tpl, vars) {
        return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) {
            return vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m;
        });
    }
    function norm(s) { return String(s || "").replace(/[​-‍]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }
    function two(n) { return (n < 10 ? "0" : "") + n; }
    function when(ts) {
        var d = new Date(ts * 1000);
        return two(d.getDate()) + "." + two(d.getMonth() + 1) + "." + d.getFullYear() + " " + two(d.getHours()) + ":" + two(d.getMinutes());
    }
    function lastErr() { try { var e = fpt.lastError && fpt.lastError(); return e ? " (" + e + ")" : ""; } catch (x) { return ""; } }

    // оповещения FunPay в чате (оплата, подтверждение, отзыв, возврат) это не слова покупателя
    var SYSTEM_RX = /оплатил заказ|подтвердил успешное выполнение|написал отзыв к заказу|изменил отзыв к заказу|удалил отзыв к заказу|вернул деньги покупателю|заказ #?[A-Z0-9]+ открыт повторно|has paid for order|confirmed that order|has given feedback|has edited their feedback|has refunded|сплатив замовлення|підтвердив успішне виконання|написав відгук|повернув гроші/i;
    function msgInfo(m) {
        m = m || {};
        var text = String(m.text || "");
        return {
            chatId: String(m.chatId || ""), text: text, mine: !!m.isMe,
            system: !!m.isSystem || SYSTEM_RX.test(text),
            name: String(m.username || m.chatName || ""),
            authorId: String(m.authorId || ""),
        };
    }

    // На Android в событии приходит только строка из списка чатов: длинное сообщение там обрезано. Полный текст берём из переписки.
    function fullMsg(m) {
        if (DESKTOP || !m.chatId) return m;
        var h = null;
        try { h = fpt.chat.getHistory(m.chatId); } catch (e) {}
        var last = h && h.length ? h[h.length - 1] : null;
        if (!last) return m;
        m.text = String(last.text || m.text);
        m.mine = !!last.isMe;
        m.system = SYSTEM_RX.test(m.text) || String(last.authorId || "") === "0" || !!last.badge;
        return m;
    }
    // Новый заказ. На Android приложение шлёт это событие только при включённых напоминаниях о заказах и повторяет его,
    // поэтому оплату ловим ещё и по сообщению FunPay, а каждый заказ разбираем один раз за запуск.
    var lookedOrders = {};
    function onOrder(fn) {
        function once(e) {
            if (!e || !e.orderId) return;
            var id = String(e.orderId).replace(/^#/, "");
            if (lookedOrders[id]) return;
            lookedOrders[id] = 1;
            e.orderId = id;
            fn(e);
        }
        fpt.on("onNewOrder", once);
        if (!DESKTOP) {
            fpt.on("onNewMessage", function (raw) {
                var text = String((raw && raw.text) || "");
                if (!/оплатил заказ|has paid for order|paid for order|сплатив замовлення/i.test(text)) return;
                var m = /#([A-Za-z0-9]{6,12})/.exec(text);
                if (m) once({ orderId: m[1], chatId: raw.chatId, buyerName: raw.username || "", text: text });
            });
        }
    }

    function sendTo(chatId, text) {
        if (!chatId || !text) return false;
        var ok = false;
        try { ok = fpt.chat.send(String(chatId), String(text)); } catch (e) { log("сообщение не ушло: " + e); return false; }
        if (ok === false) log("сообщение не ушло" + lastErr());
        return ok !== false;
    }
    function notify(title, text) {
        try { fpt.app.notify(String(title), String(text || "")); } catch (e) {}
        log(title + (text ? ": " + text : ""));
    }
    function refundOrder(orderId) {
        try { return fpt.orders.refund(String(orderId)) !== false; } catch (e) { return false; }
    }
    function lotActive(lotId, on) {
        try { return fpt.lots.toggle(String(lotId), !!on) !== false; } catch (e) { return false; }
    }

    // --- сеть. На Android есть только GET и POST, заголовки передаются строкой JSON, заголовков ответа нет, а свой Cookie приложение не пропускает.
    function hdr(headers) { return DESKTOP ? (headers || {}) : JSON.stringify(headers || {}); }
    var CAN_ANY_METHOD = DESKTOP || (function () { try { return typeof fpt.network.request === "function"; } catch (e) { return false; } })();
    function http(method, url, body, headers) {
        method = String(method || "GET").toUpperCase();
        var r = null;
        try {
            if (DESKTOP || (CAN_ANY_METHOD && method !== "GET" && method !== "POST")) {
                r = fpt.network.request(method, url, body === undefined ? null : body, hdr(headers));
            } else if (method === "GET") {
                r = fpt.network.get(url, hdr(headers));
            } else if (method === "POST") {
                r = fpt.network.post(url, body === undefined || body === null ? "" : body, hdr(headers));
            } else {
                return { code: 0, body: "", json: null, headers: {}, error: "Запрос " + method + " на Android пока недоступен" };
            }
        } catch (e) {
            return { code: 0, body: "", json: null, headers: {}, error: String(e) };
        }
        if (typeof r === "string") { try { r = JSON.parse(r); } catch (e2) { r = { code: 200, body: r }; } }
        r = r || {};
        var out = { code: Number(r.code) || 0, body: String(r.body === undefined || r.body === null ? "" : r.body), headers: r.headers || {}, error: r.error || "" };
        out.json = r.json !== undefined && r.json !== null ? r.json : null;
        if (out.json === null && out.body) { try { out.json = JSON.parse(out.body); } catch (e3) {} }
        return out;
    }
    function header(res, name) {
        var h = (res && res.headers) || {}, low = name.toLowerCase();
        for (var k in h) if (k.toLowerCase() === low) return h[k];
        return "";
    }
    function form(obj) {
        return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
    }
    function postJson(url, obj, headers) {
        var h = { "Content-Type": "application/json", "Accept": "application/json" };
        for (var k in (headers || {})) h[k] = headers[k];
        return http("POST", url, JSON.stringify(obj || {}), h);
    }
    function funpayGet(path) {
        var url = /^https?:/.test(path) ? path : "https://funpay.com/" + String(path).replace(/^\/+/, "");
        return http("GET", url, null, { "Accept": "text/html" });
    }

    // --- заказ в одном виде для обеих платформ
    function orderInfo(orderId, eventText) {
        var d = null;
        try { d = fpt.orders.getDetails(String(orderId)); } catch (e) {}
        if (!d) return null;
        var params = {};
        if (Array.isArray(d.params)) d.params.forEach(function (p) { if (p && p.name) params[p.name] = p.value; });
        else if (d.params && typeof d.params === "object") params = d.params;
        var title = String(d.lotName || d.shortDesc || "");
        var parts = [title], amount = 0;
        for (var k in params) {
            parts.push(String(params[k]));
            if (!amount && /количество|кол-во|quantity|кількість/i.test(k)) amount = int(params[k], 0);
        }
        if (!amount && eventText) { var q = /(\d+)\s*шт/.exec(String(eventText)); if (q) amount = int(q[1], 0); }
        var lotId = String(d.lotId || "");
        if (!lotId && d.lotUrl) { var lm = /[?&]id=(\d+)/.exec(String(d.lotUrl)); if (lm) lotId = lm[1]; }
        return {
            id: String(d.orderId || d.id || orderId).replace(/^#/, ""),
            title: title, text: parts.join("\n"), amount: amount > 0 ? amount : 1, price: num(d.price),
            game: String(d.game || d.gameTitle || ""), buyerName: String(d.buyerName || ""), buyerId: String(d.buyerId || ""),
            lotId: lotId, chatId: String(d.chatId || ""), status: String(d.status || ""),
            hasReview: !!d.hasReview, stars: int(d.reviewStars || d.reviewRating || 0, 0), iAmBuyer: !!(d.iAmBuyer || d.isBuyer),
        };
    }
    // оценка в отзыве: если приложение её не отдало, читаем со страницы заказа
    function reviewStars(orderId) {
        var o = orderInfo(orderId);
        if (o && o.stars > 0) return o.stars;
        if (o && !o.hasReview && DESKTOP) return 0;
        var r = funpayGet("orders/" + String(orderId).replace(/^#/, "") + "/");
        if (r.code !== 200) return 0;
        var at = r.body.indexOf("review-item");
        if (at < 0) return 0;
        var m = /class="rating(\d)"/.exec(r.body.slice(at, at + 4000));
        return m ? int(m[1], 0) : 0;
    }
    function lotField(fields, name) {
        var f = fields && fields.fields ? fields.fields : fields;
        if (!f || f[name] === undefined || f[name] === null) return "";
        var v = f[name];
        return typeof v === "object" ? String(v.value === undefined || v.value === null ? "" : v.value) : String(v);
    }
    function seenOrder(orderId) {
        var done = load("done_orders", []);
        if (done.indexOf(String(orderId)) >= 0) return true;
        done.push(String(orderId));
        if (done.length > 500) done = done.slice(done.length - 500);
        save("done_orders", done);
        return false;
    }

    // --- настройки на экране
    function T(text, o) { var t = { type: "Text", text: String(text) }; if (o) for (var k in o) t[k] = o[k]; return t; }
    function H(text) { return T(text, { bold: true, fontSize: 16 }); }
    function hint(text) { return T(text, { color: "#7A8699", fontSize: 12 }); }
    function Btn(text, onClick, flat, busy) {
        var b = { type: "Button", text: text, onClick: onClick };
        if (flat) b.style = "flat";
        if (busy) b.busyText = busy;
        return b;
    }
    function In(label, key, value, multi) {
        var v = value === null || value === undefined ? "" : String(value);
        if (!DESKTOP) v = v.replace(/\n/g, " ¶ ").replace(/"/g, "'").replace(/\\/g, "/");   // поле на Android не показывает переносы, кавычки и обратную черту
        fpt.ui.setState(key, v);
        return { type: "Input", label: label, stateKey: key, singleLine: !(multi && DESKTOP) };
    }
    function Sw(label, key, value, onChange) {
        fpt.ui.setState(key, value ? "true" : "false");
        var sw = { type: "Switch", stateKey: key };
        if (onChange) sw.onChange = onChange;
        if (DESKTOP) { sw.text = label; return sw; }
        return { type: "Row", children: [sw, T(label)] };
    }
    function gs(key) { var v = fpt.ui.getState(key); return v === null || v === undefined ? "" : String(v); }
    function gm(key) { var v = gs(key); return DESKTOP ? v : v.replace(/\s*¶\s*/g, "\n"); }   // многострочный текст
    function on(key) { return gs(key) === "true"; }
    function Row() { return { type: "Row", children: Array.prototype.slice.call(arguments) }; }
    function Card() { return { type: "Card", children: Array.prototype.slice.call(arguments) }; }
    var showRev = 0;
    function show(children) {
        var root = { type: "Column", children: children };
        if (!DESKTOP) {
            (function mark(n) {
                if (!n || typeof n !== "object") return;
                if (n.stateKey) n.stateKey = NS_UI + n.stateKey;
                (n.children || []).forEach(mark);
            })(root);
            // приложение перечитывает значения полей, только когда описание экрана изменилось
            root.children.push({ type: "Spacer", size: 0, rev: ++showRev });
        }
        fpt.ui.setSlot(PLUGIN_SLOT_KEY, root);
    }
    function toast(t) { try { fpt.app.toast(String(t)); } catch (e) {} }
    var NL_HINT = DESKTOP ? "" : "Перенос строки на телефоне обозначается знаком ¶";
    function tabs(list, current, fn) {
        var rows = [], row = [];
        list.forEach(function (t) {
            row.push(Btn((t[0] === current ? "• " : "") + t[1], fn + "('" + t[0] + "')", t[0] !== current));
            if (row.length === (DESKTOP ? 4 : 2)) { rows.push({ type: "Row", children: row }); row = []; }
        });
        if (row.length) rows.push({ type: "Row", children: row });
        return rows;
    }

    // ---------------------------------------------------------------- unique's sniper
    // Правило: { subcategory_id, category_type (0 лоты, 1 игровая валюта), keywords, max_price, min_amount }
    var CFG_KEY = "sniper_config_v1";
    var CACHE_KEY = "sniper_seen_v1";
    var MAX_SEEN = 2500;

    var C = load(CFG_KEY, null) || {};
    if (!Array.isArray(C.rules)) C.rules = [];
    if (typeof C.delay !== "number" || !(C.delay >= 1)) C.delay = 10;
    if (typeof C.enabled !== "boolean") C.enabled = true;
    if (typeof C.notify !== "boolean") C.notify = true;
    var seen = load(CACHE_KEY, []);
    if (!Array.isArray(seen)) seen = [];
    var found = load("sniper_found_v1", []);      // последние находки для экрана настроек
    var stat = { scans: 0, last: 0, error: "" };

    function saveCfg() { save(CFG_KEY, C); }
    function keywordsList(kw) {
        if (!kw || kw === "-") return [];
        return String(kw).split(",").map(function (k) { return k.trim().toLowerCase(); }).filter(function (k) { return k; });
    }
    function isMatch(lot, rule) {
        if (lot.price > rule.max_price) return false;
        if (rule.min_amount > 0) {
            var amt = lot.amount === null || lot.amount === undefined ? 1 : lot.amount;
            if (amt < rule.min_amount) return false;
        }
        var targets = keywordsList(rule.keywords);
        if (!targets.length) return true;
        var hay = [lot.description, lot.server, lot.side].filter(Boolean).join(" ").toLowerCase();
        for (var i = 0; i < targets.length; i++) if (hay.indexOf(targets[i]) >= 0) return true;
        return false;
    }

    // --- разбор витрины без DOM: на компьютере его нет, а регулярки работают везде
    function untag(s) {
        return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
            .replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    }
    function byClass(block, cls) {
        var m = new RegExp('class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>([\\s\\S]*?)</div>').exec(block);
        return m ? untag(m[1]) : "";
    }
    function attr(tag, name) {
        var m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag);
        return m ? m[1].replace(/&amp;/g, "&") : "";
    }
    function parseShowcase(html, isChips) {
        var out = [], rx = /<a\b([^>]*\bclass="[^"]*\btc-item\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g, m;
        while ((m = rx.exec(html))) {
            var tag = m[1], inner = m[2];
            var href = attr(tag, "href");
            if (!href) continue;
            var server = byClass(inner, "tc-server") || null;
            var side = byClass(inner, "tc-side") || null;
            var priceTag = /<div\b([^>]*\bclass="[^"]*\btc-price\b[^"]*"[^>]*)>/.exec(inner);
            var priceText = byClass(inner, "tc-price");
            var price = priceTag && attr(priceTag[1], "data-s") ? num(attr(priceTag[1], "data-s")) : num(priceText);
            var unit = /class="unit"[^>]*>\s*([^<\s]+)/.exec(inner);
            var amountText = byClass(inner, "tc-amount").replace(/[^0-9]/g, "");
            var desc = byClass(inner, "tc-desc-text");
            if (isChips) desc = [server, side].filter(Boolean).join(" | ") || "Валюта";
            var offer = attr(tag, "data-offer") || (/[?&]id=(\d+)/.exec(href) || [])[1];
            out.push({
                id: isChips ? href : (offer || href),
                server: server, side: isChips ? side : null,
                description: desc || "Без описания",
                amount: amountText ? parseInt(amountText, 10) : null,
                price: Math.round(price * 100) / 100, currency: unit ? unit[1] : "₽",
                seller: byClass(inner, "media-user-name") || "Неизвестно",
                link: /^https?:/.test(href) ? href : "https://funpay.com" + href,
            });
        }
        return out;
    }
    function fetchLots(subId, type) {
        var r = funpayGet((type === 1 ? "chips/" : "lots/") + subId + "/");
        if (r.code !== 200) {
            stat.error = "раздел " + subId + ": " + (r.code ? "FunPay ответил " + r.code : "нет связи" + (r.error ? " (" + r.error + ")" : ""));
            return null;
        }
        return parseShowcase(r.body, type === 1);
    }

    function report(lot, rule) {
        var amount = lot.amount === null || lot.amount === undefined ? "не указано" : String(lot.amount);
        if (C.notify) {
            try {
                fpt.app.notify("🎯 Найдено предложение",
                    lot.description + "\n💰 " + lot.price + " " + lot.currency + " · кол-во: " + amount + " · " + lot.seller + "\n" + lot.link);
            } catch (e) {}
            try { fpt.app.vibrate(300); } catch (e) {}
        }
        log("🎯 " + lot.description + " | " + lot.price + " " + lot.currency + " | кол-во: " + amount + " | " + lot.seller + " | " + lot.link);
        found.unshift({ t: now(), d: lot.description.slice(0, 120), p: lot.price, c: lot.currency, s: lot.seller, l: lot.link });
        if (found.length > 15) found.length = 15;
        save("sniper_found_v1", found);
    }

    // --- фоновый обход: разделы по очереди, между ними пауза
    var queue = [], nextAt = 0, busy = false;
    function groups() {
        var g = {}, order = [];
        C.rules.forEach(function (r) {
            var k = r.category_type + ":" + r.subcategory_id;
            if (!g[k]) { g[k] = { sub: r.subcategory_id, type: r.category_type, rules: [] }; order.push(k); }
            g[k].rules.push(r);
        });
        return order.map(function (k) { return g[k]; });
    }
    function tick() {
        if (busy || !C.enabled || !C.rules.length || Date.now() < nextAt) return;
        busy = true;
        try {
            if (!queue.length) queue = groups();
            var g = queue.shift();
            if (g) {
                var lots = fetchLots(g.sub, g.type);
                stat.scans++;
                stat.last = now();
                if (lots) {
                    stat.error = "";
                    var fresh = false;
                    lots.forEach(function (lot) {
                        var id = String(lot.id);
                        if (seen.indexOf(id) >= 0) return;
                        for (var i = 0; i < g.rules.length; i++) {
                            if (isMatch(lot, g.rules[i])) {
                                seen.push(id);
                                fresh = true;
                                report(lot, g.rules[i]);
                                break;
                            }
                        }
                    });
                    if (fresh) {
                        if (seen.length > MAX_SEEN) seen = seen.slice(seen.length - MAX_SEEN);
                        save(CACHE_KEY, seen);
                    }
                }
            }
        } catch (e) {
            log("ошибка обхода: " + e);
        } finally {
            nextAt = Date.now() + Math.max(1, C.delay) * 1000;
            busy = false;
        }
    }

    // --- настройки
    var view = "main";
    function render() {
        var kids = [H("unique's sniper")];
        if (view === "add") {
            kids.push(hint("ID раздела это число из адреса: funpay.com/lots/1234/ или funpay.com/chips/12/"));
            kids.push(Card(
                In("ID раздела", "f_sub", gs("f_sub")),
                Sw("Это игровая валюта (адрес с chips)", "f_chips", on("f_chips"), ""),
                In("Ключевые слова через запятую (пусто: любые)", "f_kw", gs("f_kw")),
                In("Максимальная цена", "f_price", gs("f_price")),
                In("Минимальное количество (0: не важно)", "f_amount", gs("f_amount") || "0")
            ));
            kids.push(Row(Btn("Сохранить правило", "window.snpAdd()"), Btn("Отмена", "window.snpView('main')", true)));
            return show(kids);
        }
        kids.push(Sw("Искать лоты", "s_on", C.enabled, "window.snpToggle()"));
        kids.push(Sw("Уведомлять о находках", "s_ntf", C.notify, "window.snpToggle()"));
        kids.push(Card(
            In("Пауза между разделами, секунд", "s_delay", C.delay),
            Btn("Сохранить паузу", "window.snpDelay()", true)
        ));
        if (stat.error) kids.push(T("Последняя ошибка: " + stat.error, { color: "#D9534F" }));
        kids.push(hint("Проверок с запуска: " + stat.scans + (stat.last ? ", последняя в " + when(stat.last).slice(11) : "")));
        kids.push({ type: "Divider" });
        kids.push(T("Правила (" + C.rules.length + ")", { bold: true }));
        if (!C.rules.length) kids.push(hint("Правил пока нет. Добавьте первое, и плагин начнёт следить за разделом."));
        C.rules.forEach(function (r, i) {
            kids.push(Card(
                T((r.category_type === 1 ? "Валюта" : "Лоты") + ", раздел " + r.subcategory_id, { bold: true }),
                T("Слова: " + (keywordsList(r.keywords).join(", ") || "любые") + " · цена до " + r.max_price + (r.min_amount > 0 ? " · от " + r.min_amount + " шт." : "")),
                Btn("Удалить", "window.snpDel(" + i + ")", true)
            ));
        });
        kids.push(Row(Btn("Добавить правило", "window.snpView('add')"), Btn("Забыть показанные", "window.snpForget()", true)));
        if (found.length) {
            kids.push({ type: "Divider" });
            kids.push(T("Последние находки", { bold: true }));
            found.slice(0, 8).forEach(function (f, i) {
                var row = [T(f.p + " " + f.c + " · " + f.s + " · " + f.d)];
                if (DESKTOP) row.push(Btn("Открыть", "window.snpOpen(" + i + ")", true));
                kids.push({ type: "Row", children: row });
            });
        }
        show(kids);
    }
    window.snpView = function (v) { view = v; render(); };
    window.snpToggle = function () { C.enabled = on("s_on"); C.notify = on("s_ntf"); saveCfg(); };
    window.snpDelay = function () {
        C.delay = clamp(int(gs("s_delay"), 10), 1, 3600);
        saveCfg();
        toast("Пауза: " + C.delay + " сек.");
        render();
    };
    window.snpAdd = function () {
        var sub = int(gs("f_sub"), 0), price = num(gs("f_price"));
        if (!(sub > 0)) return toast("Укажите ID раздела числом");
        if (!(price > 0)) return toast("Укажите максимальную цену");
        C.rules.push({
            subcategory_id: sub, category_type: on("f_chips") ? 1 : 0,
            keywords: gs("f_kw").trim() || "-", max_price: price, min_amount: Math.max(0, int(gs("f_amount"), 0)),
        });
        saveCfg();
        queue = [];
        ["f_sub", "f_kw", "f_price", "f_amount"].forEach(function (k) { fpt.ui.setState(k, ""); });
        fpt.ui.setState("f_chips", "false");
        view = "main";
        toast("Правило добавлено");
        render();
    };
    window.snpDel = function (i) {
        if (i >= 0 && i < C.rules.length) { C.rules.splice(i, 1); saveCfg(); queue = []; }
        render();
    };
    window.snpForget = function () { seen = []; save(CACHE_KEY, seen); toast("Список показанных лотов очищен"); };
    window.snpOpen = function (i) { if (found[i] && fpt.app.openUrl) fpt.app.openUrl(found[i].l); };

    setInterval(tick, 1000);
    render();
    log("запущен, правил: " + C.rules.length);
})();
