// @name XD Dumper
// @author @AlliSighs
// @version 2.2.2
// @description Автодемпер цен: следит за витриной раздела и держит ваш лот чуть дешевле конкурентов в заданных пределах. Фильтры, закреплённые предложения, лента действий.
// @banner https://raw.githubusercontent.com/XaviersDev/FunPayTools-Site/refs/heads/main/catalog/plugins_assets/xddumper_banner.png

(function () {
    var TAG = "[XD Dumper]", NS_STORE = "xd_", NS_UI = "xd_";

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

    // ---------------------------------------------------------------- XD Dumper (только FunPay Tools для компьютера)
    // Следит за витриной раздела и держит цену лота чуть ниже конкурентов, в заданных пределах.
    var SUB_TYPE = { any: [], individual: ["individual", "индивидуальн"], duo: ["duo", "дуо"], family: ["family", "семья", "семейн"], student: ["student", "студент"] };
    var SUB_TYPE_NAMES = ["any", "individual", "duo", "family", "student"];
    var SUB_PERIOD = { any: [], "1": ["1 мес", "1 month", "1month", "one month"], "3": ["3 мес", "3 month", "3month", "three month"], "6": ["6 мес", "6 month", "6month", "six month"], "12": ["12 мес", "12 month", "12month", "год", "year", "annual"] };
    var SUB_PERIOD_NAMES = ["any", "1", "3", "6", "12"];
    var LOT_DEFAULTS = {
        enabled: false, name: "", keywords: "", subType: "any", subPeriod: "any",
        mode: "standard", pinnedPos: 1,
        min: 1, max: 99999, step: 5, divider: 1, netPrice: false, markupPct: 0, foreign: false,
        ratingMin: 5, ignoreNoRating: false, positionMax: 999, ignoreFriends: false, onlyCompetitors: false, onlineOnly: false,
        interval: 15, autoRaise: true, aggressive: false, fastCheck: false, fastTop: 3, priority: false,
        filters: {},
    };
    var G = load("global", null) || {};
    (function () {
        var d = { on: true, currency: "₽", friends: [], competitors: [], competitorsOff: [], rate: 1, rateSource: "manual", cbAsset: "USDT", cbToken: "", rateAt: 0 };
        for (var k in d) if (G[k] === undefined) G[k] = d[k];
    })();
    var L = load("lots", {});           // лот → настройки
    var errors = load("errors", {});    // лот → незаполненные поля
    var feed = [];                      // лента последних действий

    function saveG() { save("global", G); }
    function saveL() { save("lots", L); }
    function cfg(id) {
        var c = L[id] || (L[id] = {});
        for (var k in LOT_DEFAULTS) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(LOT_DEFAULTS[k]));
        return c;
    }
    function push(ev) {
        ev.ts = now();
        feed.unshift(ev);
        if (feed.length > 60) feed.length = 60;
    }

    // --- витрина раздела
    function untag(s) {
        return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
            .replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    }
    function parseShowcase(html) {
        var lots = [], rx = /<a\b([^>]*\bclass="([^"]*\btc-item\b[^"]*)"[^>]*)>([\s\S]*?)<\/a>/g, m;
        while ((m = rx.exec(html))) {
            var tag = m[1], cls = m[2], inner = m[3];
            var href = (/\bhref="([^"]*)"/.exec(tag) || [])[1] || "";
            var id = (/[?&](?:amp;)?id=(\d+)/.exec(href) || [])[1];
            var ps = /class="[^"]*\btc-price\b[^"]*"[^>]*\bdata-s="([^"]+)"/.exec(inner) || /\bdata-s="([^"]+)"[^>]*class="[^"]*\btc-price\b/.exec(inner);
            if (!id || !ps) continue;
            var attrs = {}, ax = /\bdata-([a-z0-9\-]+)="([^"]*)"/g, a;
            while ((a = ax.exec(tag))) attrs[a[1]] = a[2];
            var desc = /class="[^"]*\btc-desc-text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(inner);
            var user = /class="[^"]*\bmedia-user-name\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(inner);
            var starsBlock = /class="[^"]*\brating-stars\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(inner);
            var fattrs = {};
            for (var k in attrs) if (k.indexOf("f-") === 0) fattrs[k] = attrs[k];
            lots.push({
                id: id, price: num(ps[1]), desc: desc ? untag(desc[1]) : "", user: user ? untag(user[1]) : "",
                online: attrs.online === "1", stars: starsBlock ? (starsBlock[1].match(/class="fas\b/g) || []).length : null,
                attrs: fattrs, promo: /\boffer-promo\b/.test(cls),
            });
        }
        var unit = (/class="unit"[^>]*>\s*([^<\s]+)\s*</.exec(html) || [])[1] || "";
        return { lots: lots, unit: unit, at: now() };
    }
    var pause = {};    // раздел → до какого времени не трогать (FunPay попросил не частить)
    function fetchNode(node) {
        var r = funpayGet("lots/" + node + "/");
        if (r.code !== 200) {
            pause[node] = now() + (r.code === 429 ? 60 : 20);
            if (r.code === 429) log("FunPay просит не частить, раздел " + node + " подождёт минуту");
            return null;
        }
        return parseShowcase(r.body);
    }

    // --- комиссия раздела: сколько платит покупатель за 1 единицу цены продавца
    var commissions = {};
    function commission(node) {
        var c = commissions[node];
        if (c && now() - c[1] < 3600) return c[0];
        var r = fpt.funpay.request("POST", "lots/calc", { nodeId: node, price: 100000 });
        var methods = r && r.json && r.json.methods;
        if (methods && methods.length) {
            var best = 0;
            methods.forEach(function (x) { if (x.unit === G.currency) { var p = num(x.price); if (p > 0 && (!best || p < best)) best = p; } });
            if (best) { commissions[node] = [best / 100000, now()]; return best / 100000; }
        }
        return c ? c[0] : 0;   // без комиссии цену не трогаем, чтобы не продать в убыток
    }

    // --- курс для цен в другой валюте
    function refreshRate() {
        if (G.rateSource === "manual" || now() - num(G.rateAt) < 300) return;
        G.rateAt = now();
        if (G.rateSource === "cryptobot") {
            if (!G.cbToken) return;
            var r = http("GET", "https://pay.crypt.bot/api/getExchangeRates", null, { "Crypto-Pay-API-Token": G.cbToken });
            var iso = { "₽": "RUB", "$": "USD", "€": "EUR" }[G.currency] || "RUB";
            if (r.code === 200 && r.json && r.json.ok) {
                (r.json.result || []).forEach(function (x) {
                    if (String(x.source).toUpperCase() === String(G.cbAsset).toUpperCase() && String(x.target).toUpperCase() === iso) G.rate = num(x.rate) || G.rate;
                });
            } else log("курс CryptoBot не получен: " + (r.code === 401 ? "токен не подошёл" : "ответ " + r.code));
        } else {
            var p = funpayGet("account/balance");
            var box = /class="[^"]*\bwithdraw-box\b[^"]*"[^>]*\bdata-data="([^"]*)"/.exec(p.body) || /\bdata-data="([^"]*)"[^>]*class="[^"]*\bwithdraw-box\b/.exec(p.body);
            if (box) {
                try {
                    var data = JSON.parse(box[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#0?39;/g, "'"));
                    ((((data.currencies || {}).rub || {}).channels) || []).forEach(function (ch) {
                        var m = ch.extCurrency === "usdt_trc" && /курс\s*([\d.]+)/.exec(String(ch.feeInfo || ""));
                        if (m) G.rate = num(m[1]) || G.rate;
                    });
                } catch (e) {}
            }
        }
        saveG();
    }

    // --- отбор конкурентов и расчёт цены
    function hasWord(desc, keywords) {
        if (!keywords) return true;
        var d = desc.toLowerCase();
        return String(keywords).replace(/\n/g, "|").split("|").some(function (k) { k = k.trim().toLowerCase(); return k && d.indexOf(k) >= 0; });
    }
    function subOk(desc, c) {
        var d = desc.toLowerCase();
        if (c.subType !== "any" && !(SUB_TYPE[c.subType] || []).some(function (k) { return d.indexOf(k) >= 0; })) return false;
        if (c.subPeriod !== "any" && !(SUB_PERIOD[c.subPeriod] || []).some(function (k) { return d.indexOf(k) >= 0; })) return false;
        return true;
    }
    function filtersOk(attrs, c) {
        for (var fid in c.filters) {
            var vals = c.filters[fid];
            if (!vals || !vals.length) continue;
            var v = String(attrs[fid.indexOf("f-") === 0 ? fid : "f-" + fid] || "").toLowerCase();
            if (!vals.some(function (x) { return String(x).toLowerCase() === v; })) return false;
        }
        return true;
    }
    function activeCompetitors() { return G.competitors.filter(function (n) { return G.competitorsOff.indexOf(n) < 0; }); }
    function pick(page, c, ownIds, me) {
        var out = [], pinned = [], friends = G.friends.map(function (f) { return f.trim().toLowerCase(); }), rivals = activeCompetitors();
        function common(l) {
            if (l.user === me) return false;
            if (!hasWord(l.desc, c.keywords) || !subOk(l.desc, c) || !filtersOk(l.attrs, c)) return false;
            if (c.ignoreFriends && friends.indexOf(l.user.trim().toLowerCase()) >= 0) return false;
            if (c.onlyCompetitors && rivals.indexOf(l.user) < 0) return false;
            if (c.onlineOnly && !l.online) return false;
            return true;
        }
        for (var i = 0; i < page.lots.length; i++) {
            var l = page.lots[i];
            if (i + 1 > c.positionMax) break;
            if (ownIds[l.id] || !common(l)) continue;
            if (!(l.price >= c.min && l.price <= c.max + c.step)) continue;
            if (l.stars === null) { if (c.ignoreNoRating) continue; } else if (l.stars < c.ratingMin) continue;
            out.push({ user: l.user, price: l.price, stars: l.stars, online: l.online, id: l.id, pos: i + 1 });
        }
        if (c.mode === "pinned") {
            var seen = {};
            page.lots.forEach(function (l2) {
                if (!l2.promo || !common(l2)) return;
                var key = l2.user + ":" + l2.price.toFixed(2);
                if (seen[key]) return;
                seen[key] = 1;
                pinned.push({ user: l2.user, price: l2.price, id: l2.id });
            });
            pinned.sort(function (a, b) { return a.price - b.price; });
        }
        return { list: out, pinned: pinned };
    }
    // точная цена оффера со страницы покупки: витрина иногда показывает её с округлением
    var realCache = {};
    function realPrice(id, showcase) {
        var hit = realCache[id];
        if (hit && Math.abs(hit[0] - showcase) < 0.005 && now() - hit[2] < 300) return hit[1];
        var r = funpayGet("lots/offer?id=" + id);
        if (r.code !== 200) return null;
        var cy = { "₽": "rub", "$": "usd", "€": "eur" }[G.currency] || "rub", best = null;
        var rx = /<option\b[^>]*>/g, m;
        while ((m = rx.exec(r.body))) {
            if ((/\bdata-cy="([^"]*)"/.exec(m[0]) || [])[1] !== cy) continue;
            var f = ((/\bdata-factors="([^"]*)"/.exec(m[0]) || [])[1] || "").split(",").map(num);
            if (f.length >= 2 && f[0] && f[1]) { var p = Math.round(f[0] * f[1] * 100) / 100; if (best === null || p < best) best = p; }
        }
        if (best !== null) realCache[id] = [showcase, best, now()];
        return best;
    }
    function target(c, list, pinned, current, comm) {
        var rate = c.foreign ? Math.max(0.0001, num(G.rate)) : 1;
        var k = c.netPrice && comm > 0 ? rate * comm : rate;
        var lo = c.min * k, hi = c.max * k;
        if (!list.length) return { price: current, action: "hold" };
        var markup = 1 + Math.max(-99, num(c.markupPct)) / 100, raw;
        if (c.mode === "pinned" && pinned.length) {
            raw = pinned[clamp(int(c.pinnedPos, 1), 1, pinned.length) - 1].price * markup - 0.01;
        } else {
            var min = list[0].price;
            list.forEach(function (x) { if (x.price < min) min = x.price; });
            raw = min * markup - c.step;
        }
        function cut(v) { return c.divider > 1 ? v - (v % c.divider) : v; }
        var t = Math.max(1, Math.max(lo, Math.min(hi, cut(raw))));
        if (t < current - 0.01) return { price: t, action: "lower" };
        if (t > current + 0.01) {
            if (!c.autoRaise) return { price: t, action: "hold" };
            if (!(current < lo - 0.01)) {
                var diff = t - current;
                if (diff > 100 && (current > 0 ? diff / current * 100 : 100) > 10) {   // вверх идём шагами, а не одним прыжком
                    t = Math.max(lo, Math.min(t, cut(current + Math.max(100, current * 0.10))));
                }
            }
            return { price: t, action: "raise" };
        }
        return { price: t, action: "hold" };
    }

    // --- основной круг
    var myLots = [], myAt = 0, lastCheck = {}, ownPrice = {}, lastHold = {}, busy = false, me = "", stat = { checks: 0, saves: 0 };
    function refreshMine() {
        if (myLots.length && now() - myAt < 60) return true;
        var list = null;
        try { list = fpt.lots.getMy(); } catch (e) {}
        if (!list || (!list.length && fpt.lastError && fpt.lastError())) return myLots.length > 0;
        myLots = list.filter(function (l) { return /^\d+$/.test(String(l.id)); });
        myAt = now();
        if (!me) { try { me = (fpt.accounts.getActive() || {}).username || ""; } catch (e) {} }
        return true;
    }
    function setPrice(id, c, buyerPrice, comm, node) {
        var sell = Math.max(1, Math.max(1, buyerPrice) / comm);
        var f = fpt.lots.getFields(id);
        if (!f) { log("лот " + id + " не открылся" + lastErr()); return false; }
        var cur = num(lotField(f, "price"));
        if (Math.abs(sell - cur) < 0.01) return false;
        var text = (Math.round(sell * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
        if (fpt.lots.save(id, { price: text })) {
            log("лот " + id + ": " + cur.toFixed(2) + " → " + text + " (покупатель видит " + buyerPrice.toFixed(2) + ")");
            return true;
        }
        var err = String(fpt.lastError() || "");
        if (/Заполните|Fill in|Заповніть/i.test(err)) {
            c.enabled = false;
            saveL();
            errors[id] = { fields: err.slice(0, 300), node: node };
            save("errors", errors);
            push({ id: id, name: c.name || id, action: "field_error", error: err.slice(0, 200) });
            notify("XD Dumper: лот " + id + " отключён", "FunPay требует заполнить поля лота: " + err.slice(0, 200) + ". Заполните лот на сайте и снова включите его в плагине.");
        } else {
            log("лот " + id + ": цена не сохранилась: " + err);
        }
        return false;
    }
    function processLot(lot, c, page, comm, ownIds) {
        var tries = c.aggressive ? 3 : 1;
        for (var attempt = 0; attempt < tries; attempt++) {
            var sel = pick(page, c, ownIds, me);
            if (c.fastCheck && sel.list.length) {
                sel.list.forEach(function (x) { x.price = Math.round(x.price * 100) / 100; });
                sel.list.sort(function (a, b) { return a.price - b.price; });
                var top = clamp(int(c.fastTop, 3), 1, Math.min(5, sel.list.length));
                for (var i = 0; i < top; i++) { var rp = realPrice(sel.list[i].id, sel.list[i].price); if (rp !== null) sel.list[i].price = rp; }
            }
            var mine = null;
            page.lots.forEach(function (l) { if (l.id === lot.id) mine = l; });
            var recent = ownPrice[lot.id], current;
            if (recent && now() - recent[1] < 90) {
                current = recent[0];
                if (mine && Math.abs(Math.round(mine.price * 100) / 100 - recent[0]) < 0.02) delete ownPrice[lot.id];
            } else if (mine) current = Math.round(mine.price * 100) / 100;
            else current = num(lot.price) || 0;
            var list = sel.list.length ? sel.list : sel.pinned;
            var res = target(c, list, sel.pinned, current, comm);
            var min = 0;
            list.forEach(function (x) { if (!min || x.price < min) min = x.price; });
            var ev = { id: lot.id, name: c.name || lot.title || lot.id, action: res.action, from: current, to: Math.round(res.price * 100) / 100, n: sel.list.length, min: min,
                top: sel.list.slice().sort(function (a, b) { return a.price - b.price; }).slice(0, 3) };
            if (res.action !== "hold" || now() - (lastHold[lot.id] || 0) >= 60) { push(ev); lastHold[lot.id] = now(); }
            if (res.action === "hold") return;
            if (!setPrice(lot.id, c, res.price, comm, lot.node)) return;
            stat.saves++;
            ownPrice[lot.id] = [Math.round(res.price * 100) / 100, now()];
            if (!(c.aggressive && attempt < tries - 1)) return;
            var fresh = fetchNode(lot.node);
            if (!fresh) return;
            page = fresh;
        }
    }
    function tick() {
        if (busy || !G.on) return;
        busy = true;
        try {
            if (!refreshMine()) return;
            refreshRate();
            var t = now(), byNode = {}, ownIds = {};
            myLots.forEach(function (l) { ownIds[l.id] = 1; });
            myLots.forEach(function (l) {
                var c = L[l.id];
                if (!c || !c.enabled) return;
                if ((pause[l.node] || 0) > t) return;
                if ((lastCheck[l.id] || 0) + Math.max(5, int(c.interval, 15)) > t) return;
                (byNode[l.node] = byNode[l.node] || []).push(l);
            });
            var nodes = Object.keys(byNode).sort(function (a, b) {
                var pa = byNode[a].some(function (l) { return L[l.id].priority; }), pb = byNode[b].some(function (l) { return L[l.id].priority; });
                return (pb ? 1 : 0) - (pa ? 1 : 0);
            });
            for (var i = 0; i < nodes.length && i < 2; i++) {      // не больше двух разделов за секунду
                var node = nodes[i], due = byNode[node];
                var page = fetchNode(node);
                due.forEach(function (l) { lastCheck[l.id] = now(); });
                if (!page) continue;
                stat.checks++;
                if (page.unit && page.unit !== G.currency) { log("раздел " + node + " показан в " + page.unit + ", а в плагине выбрана валюта " + G.currency + ": пропускаю"); continue; }
                var comm = commission(node);
                if (!comm) { log("комиссия раздела " + node + " не получена, цены не трогаю"); continue; }
                due.forEach(function (l) {
                    try { processLot(l, cfg(l.id), page, comm, ownIds); }
                    catch (e) { log("лот " + l.id + ": " + e); push({ id: l.id, name: L[l.id].name || l.id, action: "error", error: String(e) }); }
                });
            }
        } catch (e) {
            log("ошибка круга: " + e);
        } finally {
            busy = false;
        }
    }

    // --- фильтры раздела (кнопки и списки над витриной)
    function loadFilters(node) {
        var r = funpayGet("lots/" + node + "/");
        if (r.code !== 200) return null;
        var out = [], rx = /<div\b[^>]*class="[^"]*\blot-field\b[^"]*"[^>]*\bdata-id="([^"]+)"[^>]*>/g, m, marks = [];
        while ((m = rx.exec(r.body))) marks.push([m[1], m.index]);
        marks.forEach(function (mk, i) {
            var block = r.body.slice(mk[1], i + 1 < marks.length ? marks[i + 1][1] : mk[1] + 6000), opts = [], o;
            var bx = /<button\b[^>]*\bvalue="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g, ox = /<option\b[^>]*\bvalue="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g;
            while ((o = bx.exec(block))) if (o[1]) opts.push([o[1], untag(o[2])]);
            while ((o = ox.exec(block))) if (o[1]) opts.push([o[1], untag(o[2])]);
            var label = /<label[^>]*>([\s\S]*?)<\/label>/.exec(block);
            if (opts.length) out.push({ id: mk[0], label: label ? untag(label[1]) : mk[0], options: opts });
        });
        return out;
    }

    // --- настройки
    var view = "main", edit = "", filterCache = {};
    var ACTIONS = { lower: "снизил", raise: "поднял", hold: "держу", error: "ошибка", field_error: "лот отключён" };
    function yes(v) { return v ? "да" : "нет"; }
    function render() {
        var kids = [H("XD Dumper")];
        if (view === "lot" && edit) return renderLot(kids);
        kids = kids.concat(tabs([["main", "Лоты"], ["feed", "Лента"], ["users", "Друзья и конкуренты"], ["set", "Настройки"]], view, "window.xdView"));
        if (view === "main") {
            kids.push(Sw("Демпер работает", "g_on", G.on, "window.xdOn()"));
            refreshMine();
            var nodes = {}, order = [];
            myLots.forEach(function (l) { if (!nodes[l.node]) { nodes[l.node] = { name: l.category, lots: [] }; order.push(l.node); } nodes[l.node].lots.push(l); });
            if (!myLots.length) kids.push(hint("Активных лотов не видно. Плагин работает с лотами, которые сейчас в продаже (игровая валюта не поддерживается)."));
            order.forEach(function (node) {
                var card = [T(nodes[node].name + " (раздел " + node + ")", { bold: true })];
                nodes[node].lots.forEach(function (l) {
                    var c = L[l.id];
                    card.push(Row(
                        T((c && c.enabled ? "🟢 " : errors[l.id] ? "⚠️ " : "⚪ ") + String(l.title).slice(0, 60) + " · " + l.price),
                        Btn("Настроить", "window.xdEdit('" + l.id + "')", true)
                    ));
                });
                kids.push({ type: "Card", children: card });
            });
            kids.push(hint("Проверок витрины с запуска: " + stat.checks + " · смен цены: " + stat.saves + ". Валюта: " + G.currency));
            kids.push(Btn("Обновить список лотов", "window.xdReload()", true, "Обновляю..."));
        } else if (view === "feed") {
            if (!feed.length) kids.push(hint("Пока пусто. Включите демпер хотя бы у одного лота."));
            feed.slice(0, 25).forEach(function (e) {
                var line = when(e.ts).slice(11) + " · " + String(e.name).slice(0, 40) + " · " + (ACTIONS[e.action] || e.action);
                if (e.error) line += ": " + e.error;
                else line += e.action === "hold" ? " " + num(e.from).toFixed(2) : " " + num(e.from).toFixed(2) + " → " + num(e.to).toFixed(2);
                if (e.n !== undefined) line += " · конкурентов " + e.n + (e.min ? ", минимум " + num(e.min).toFixed(2) : "");
                kids.push(T(line, e.action === "lower" ? { color: "#D9534F" } : e.action === "raise" ? { color: "#2E9E5B" } : {}));
                if (e.top && e.top.length && e.action !== "hold") kids.push(hint(e.top.map(function (x) { return x.user + " " + num(x.price).toFixed(2); }).join(" · ")));
            });
            kids.push(Btn("Обновить", "window.xdView('feed')", true));
        } else if (view === "users") {
            kids.push(Card(
                T("Друзья", { bold: true }),
                hint("Их цены не учитываются у лотов, где включено \"Не трогать друзей\"."),
                In("Ники через запятую", "u_friends", G.friends.join(", ")),
                T("Конкуренты", { bold: true }),
                hint("У лотов с \"Только выбранные конкуренты\" плагин смотрит только на этих продавцов."),
                In("Ники через запятую", "u_rivals", G.competitors.join(", ")),
                In("Из них временно не учитывать", "u_off", G.competitorsOff.join(", ")),
                Btn("Сохранить", "window.xdUsers()")
            ));
        } else {
            fpt.ui.setState("s_cur", String(Math.max(0, ["₽", "$", "€"].indexOf(G.currency))));
            fpt.ui.setState("s_src", String(Math.max(0, ["manual", "cryptobot", "funpay"].indexOf(G.rateSource))));
            kids.push(Card(
                { type: "Select", label: "Валюта аккаунта на FunPay", options: ["₽ рубли", "$ доллары", "€ евро"], stateKey: "s_cur" },
                hint("Демпер работает с лотами в этой валюте. Она должна совпадать с валютой, в которой FunPay показывает вам цены.")
            ));
            kids.push(Card(
                T("Курс для пределов цены в другой валюте", { bold: true }),
                hint("Нужен только лотам, где включено \"Пределы заданы в валюте закупки\": тогда минимум и максимум умножаются на курс."),
                { type: "Select", label: "Откуда брать курс", options: ["Ввожу сам", "CryptoBot", "Курс вывода USDT на FunPay"], stateKey: "s_src" },
                In("Курс сейчас", "s_rate", G.rate),
                In("Монета CryptoBot", "s_asset", G.cbAsset),
                In("Токен CryptoBot (Crypto Pay API)", "s_token", G.cbToken),
                Btn("Сохранить", "window.xdSet()")
            ));
            kids.push(hint("Проверять витрину чаще, чем раз в 5 секунд, плагин не будет: FunPay за это временно ограничивает запросы."));
        }
        kids.push(hint("Автор плагина: @AlliSighs"));
        show(kids);
    }
    function renderLot(kids) {
        var c = cfg(edit), lot = null;
        myLots.forEach(function (l) { if (l.id === edit) lot = l; });
        kids.push(T((lot ? lot.title : "Лот") + " (" + edit + ")", { bold: true }));
        if (errors[edit]) kids.push(T("FunPay не сохраняет этот лот, пока не заполнены поля: " + errors[edit].fields, { color: "#D9534F" }));
        fpt.ui.setState("e_mode", c.mode === "pinned" ? "1" : "0");
        fpt.ui.setState("e_st", String(Math.max(0, SUB_TYPE_NAMES.indexOf(c.subType))));
        fpt.ui.setState("e_sp", String(Math.max(0, SUB_PERIOD_NAMES.indexOf(c.subPeriod))));
        kids.push(Card(
            Sw("Вести цену этого лота", "e_on", c.enabled, ""),
            In("Название для ленты", "e_name", c.name || (lot ? String(lot.title).slice(0, 50) : "")),
            { type: "Select", label: "Как ставить цену", options: ["Ниже самого дешёвого конкурента", "Под закреплённым предложением"], stateKey: "e_mode" },
            In("Под каким по счёту закреплённым (для второго способа)", "e_pin", c.pinnedPos)
        ));
        kids.push(Card(
            T("Цена", { bold: true }),
            In("Минимальная цена", "e_min", c.min),
            In("Максимальная цена", "e_max", c.max),
            In("На сколько быть дешевле конкурента", "e_step", c.step),
            In("Округлять вниз до кратного (1: не округлять)", "e_div", c.divider),
            In("Поправка к цене конкурента, % (0: без поправки)", "e_markup", c.markupPct),
            Sw("Минимум и максимум это то, что получаю я, без комиссии FunPay", "e_net", c.netPrice, ""),
            Sw("Пределы заданы в валюте закупки (умножать на курс)", "e_foreign", c.foreign, ""),
            Sw("Поднимать цену, когда конкуренты подорожали", "e_raise", c.autoRaise, "")
        ));
        kids.push(Card(
            T("Кого считать конкурентом", { bold: true }),
            In("Слова в описании (через | , хватит любого; пусто: все лоты)", "e_kw", c.keywords),
            { type: "Select", label: "Тип подписки в описании", options: ["Любой", "Individual", "Duo", "Family", "Student"], stateKey: "e_st" },
            { type: "Select", label: "Срок подписки в описании", options: ["Любой", "1 месяц", "3 месяца", "6 месяцев", "12 месяцев"], stateKey: "e_sp" },
            In("Рейтинг продавца не ниже, звёзд", "e_rating", c.ratingMin),
            Sw("Не учитывать продавцов без рейтинга", "e_norating", c.ignoreNoRating, ""),
            In("Смотреть только первые столько строк витрины", "e_pos", c.positionMax),
            Sw("Только продавцы в сети", "e_online", c.onlineOnly, ""),
            Sw("Не трогать друзей", "e_friends", c.ignoreFriends, ""),
            Sw("Только выбранные конкуренты", "e_only", c.onlyCompetitors, "")
        ));
        var fl = filterCache[lot ? lot.node : ""];
        var fcard = [T("Фильтры раздела", { bold: true })];
        var chosen = Object.keys(c.filters).filter(function (k) { return c.filters[k] && c.filters[k].length; });
        fcard.push(hint(chosen.length ? "Выбрано: " + chosen.map(function (k) { return k + " = " + c.filters[k].join("/"); }).join("; ") : "Не выбраны: конкурентами считаются лоты с любыми параметрами."));
        if (fl) {
            fl.forEach(function (f, fi) {
                fcard.push(T(f.label));
                var row = [];
                f.options.slice(0, 12).forEach(function (o, oi) {
                    var sel = (c.filters[f.id] || []).indexOf(o[0]) >= 0;
                    row.push(Btn((sel ? "✓ " : "") + o[1], "window.xdFilter(" + fi + "," + oi + ")", !sel));
                    if (row.length === 4) { fcard.push({ type: "Row", children: row }); row = []; }
                });
                if (row.length) fcard.push({ type: "Row", children: row });
            });
            if (!fl.length) fcard.push(hint("У этого раздела нет фильтров."));
        } else if (lot) {
            fcard.push(Btn("Загрузить фильтры раздела", "window.xdFilters()", true, "Загружаю..."));
        }
        kids.push({ type: "Card", children: fcard });
        kids.push(Card(
            T("Скорость", { bold: true }),
            In("Проверять раз в столько секунд (от 5)", "e_int", c.interval),
            Sw("Ключевой лот: проверять первым", "e_prio", c.priority, ""),
            Sw("После смены цены сразу перепроверить (до трёх раз)", "e_aggr", c.aggressive, ""),
            Sw("Сверять точную цену самых дешёвых со страницы оффера", "e_fast", c.fastCheck, ""),
            In("Сколько самых дешёвых сверять (1-5)", "e_fasttop", c.fastTop)
        ));
        kids.push(Row(Btn("Сохранить", "window.xdSave()"), Btn("Назад", "window.xdBack()", true), Btn("Сбросить настройки лота", "window.xdReset()", true)));
        show(kids);
    }
    function names(text) { return String(text || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean); }
    window.xdView = function (v) { view = v; render(); };
    window.xdOn = function () { G.on = on("g_on"); saveG(); };
    window.xdReload = function () { myAt = 0; refreshMine(); render(); };
    window.xdEdit = function (id) { edit = id; view = "lot"; render(); };
    window.xdBack = function () { view = "main"; edit = ""; render(); };
    window.xdReset = function () { delete L[edit]; delete errors[edit]; saveL(); save("errors", errors); render(); };
    window.xdSave = function () {
        var c = cfg(edit);
        c.enabled = on("e_on");
        c.name = gs("e_name").trim();
        c.mode = gs("e_mode") === "1" ? "pinned" : "standard";
        c.pinnedPos = Math.max(1, int(gs("e_pin"), 1));
        c.min = Math.max(0, num(gs("e_min"))); c.max = Math.max(c.min, num(gs("e_max")));
        c.step = Math.max(0, num(gs("e_step"))); c.divider = Math.max(1, num(gs("e_div")) || 1); c.markupPct = num(gs("e_markup"));
        c.netPrice = on("e_net"); c.foreign = on("e_foreign"); c.autoRaise = on("e_raise");
        c.keywords = gs("e_kw").trim();
        c.subType = SUB_TYPE_NAMES[int(gs("e_st"), 0)] || "any";
        c.subPeriod = SUB_PERIOD_NAMES[int(gs("e_sp"), 0)] || "any";
        c.ratingMin = clamp(int(gs("e_rating"), 5), 0, 5); c.ignoreNoRating = on("e_norating");
        c.positionMax = Math.max(1, int(gs("e_pos"), 999));
        c.onlineOnly = on("e_online"); c.ignoreFriends = on("e_friends"); c.onlyCompetitors = on("e_only");
        c.interval = Math.max(5, int(gs("e_int"), 15)); c.priority = on("e_prio"); c.aggressive = on("e_aggr");
        c.fastCheck = on("e_fast"); c.fastTop = clamp(int(gs("e_fasttop"), 3), 1, 5);
        if (c.enabled && errors[edit]) { delete errors[edit]; save("errors", errors); }
        saveL();
        delete lastCheck[edit];
        toast(c.enabled ? "Сохранено, лот в работе" : "Сохранено, лот выключен");
        render();
    };
    window.xdFilters = function () {
        var lot = null;
        myLots.forEach(function (l) { if (l.id === edit) lot = l; });
        if (!lot) return render();
        var f = loadFilters(lot.node);
        if (f) filterCache[lot.node] = f; else toast("Раздел не открылся");
        render();
    };
    window.xdFilter = function (fi, oi) {
        var lot = null;
        myLots.forEach(function (l) { if (l.id === edit) lot = l; });
        var f = lot && filterCache[lot.node] && filterCache[lot.node][fi];
        if (!f || !f.options[oi]) return;
        var c = cfg(edit), list = c.filters[f.id] || [], v = f.options[oi][0], at = list.indexOf(v);
        if (at >= 0) list.splice(at, 1); else list.push(v);
        if (list.length) c.filters[f.id] = list; else delete c.filters[f.id];
        saveL();
        render();
    };
    window.xdUsers = function () {
        G.friends = names(gs("u_friends")); G.competitors = names(gs("u_rivals")); G.competitorsOff = names(gs("u_off"));
        saveG();
        toast("Сохранено");
    };
    window.xdSet = function () {
        G.currency = ["₽", "$", "€"][int(gs("s_cur"), 0)] || "₽";
        G.rateSource = ["manual", "cryptobot", "funpay"][int(gs("s_src"), 0)] || "manual";
        G.rate = Math.max(0.0001, num(gs("s_rate")) || 1);
        G.cbAsset = gs("s_asset").trim().toUpperCase() || "USDT";
        G.cbToken = gs("s_token").trim();
        G.rateAt = 0;
        commissions = {};
        saveG();
        refreshRate();
        toast("Сохранено. Курс: " + G.rate);
        render();
    };

    if (!DESKTOP) {
        show([H("XD Dumper"), T("Этот плагин только для FunPay Tools на компьютере. В приложении для Android демпер уже встроен: откройте его в меню приложения.")]);
    } else {
        setInterval(tick, 1000);
        render();
        log("запущен, настроено лотов: " + Object.keys(L).length);
    }
})();
