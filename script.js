const stationData = {
  ikebukuro: { label: "池袋", file: "./data/current/池袋_hotels_detail.json" },
  shinjuku: { label: "新宿", file: "./data/current/新宿_hotels_detail.json" },
  gotanda: { label: "五反田", file: "./data/current/五反田_hotels_detail.json" },
};
const stationKey = new URLSearchParams(window.location.search).get("station") || "ikebukuro";
const selectedStation = stationData[stationKey] || stationData.ikebukuro;

function formatUpdatedAt(timestamp) {
  if (!timestamp) return "";
  const date = typeof timestamp === "number" ? new Date(timestamp * 1000) : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}時点`;
}

function renderStationLinks(stations) {
  const container = document.getElementById("stationLinks");
  if (!container) return;
  container.innerHTML = stations.map(info => {
    const isCurrent = info.key === stationKey;
    return `<a class="station-link ${isCurrent ? "current" : ""}" href="?station=${encodeURIComponent(info.key)}" ${isCurrent ? "aria-current=\"page\"" : ""}>${info.label}</a>`;
  }).join("");
}

function updateStationDisplay(info) {
  const title = `ホテル料金比較　${info.label}`;
  document.getElementById("pageTitle").textContent = title;
  document.title = title;
  document.getElementById("dataUpdatedAt").textContent =
    formatUpdatedAt(info.updatedAt);
}

renderStationLinks(Object.entries(stationData).map(([key, info]) => ({ key, ...info })));
updateStationDisplay(selectedStation);

fetch("hotel_data_manifest.json", { cache: "no-store" })
  .then(res => {
    if (!res.ok) throw new Error(`マニフェストが存在しません (${res.status})`);
    return res.json();
  })
  .then(stations => {
    if (!Array.isArray(stations) || !stations.length) return;
    renderStationLinks(stations);
    const current = stations.find(info => info.key === stationKey) || stations[0];
    updateStationDisplay(current);
  })
  .catch(err => {
    console.warn("駅データ一覧を読み込めません:", err);
  });

// ---- サイドバー開閉 ----
(function () {
  const sidebar = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");

  function isMobile() {
    return window.innerWidth <= 640;
  }

  let open = !isMobile(); // デスクトップ: デフォルト展開 / モバイル: デフォルト折りたたみ

  function applyState() {
    if (isMobile()) {
      sidebar.classList.remove("collapsed");
      sidebar.classList.toggle("mobile-open", open);
      backdrop.classList.toggle("show", open);
      document.body.classList.remove("sidebar-collapsed");
    } else {
      sidebar.classList.remove("mobile-open");
      backdrop.classList.remove("show");
      sidebar.classList.toggle("collapsed", !open);
      document.body.classList.toggle("sidebar-collapsed", !open);
    }
  }

  toggleBtn.addEventListener("click", () => {
    open = !open;
    applyState();
  });

  backdrop.addEventListener("click", () => {
    open = false;
    applyState();
  });

  // モバイルではメニュー項目タップ後に自動で閉じる／対象セクションが折りたたまれていれば展開する
  sidebar.querySelectorAll("nav a").forEach(a => {
    a.addEventListener("click", (e) => {
      const targetId = a.getAttribute("href").slice(1);
      const targetEl = document.getElementById(targetId);
      if (targetEl && targetEl.tagName === "DETAILS" && !targetEl.open) {
        e.preventDefault();
        targetEl.open = true;
        requestAnimationFrame(() => {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      if (isMobile()) {
        open = false;
        applyState();
      }
    });
  });

  window.addEventListener("resize", applyState);

  applyState();
})();

fetch(selectedStation.file, { cache: "no-store" })
  .then(res => {
    if (!res.ok) {
      throw new Error(`JSONファイルが存在しません: ${selectedStation.file} (${res.status})`);
    }
    return res.json();
  })
  .then(payload => {
    const hotels = Array.isArray(payload) ? payload : payload.hotels;
    if (!Array.isArray(hotels)) {
      throw new Error("JSON のホテルデータ形式が不正です");
    }
    if (payload.metadata && payload.metadata.generatedAt) {
      document.getElementById("dataUpdatedAt").textContent =
        formatUpdatedAt(payload.metadata.generatedAt);
    }
    render(hotels);
  })
  .catch(err => {
    document.getElementById("content").textContent = "JSON読み込みエラー: " + err;
  });

// プラン種類判定
function detectPlanType(planName) {
  const name = planName.toLowerCase();

  if (name.includes("stay")) return "宿泊";
  if (name.includes("rest")) return "休憩";
  if (name.includes("flex") || name.includes("フレックス")) return "フリータイム";
if (name.includes("service time") || name.includes("srevice time") || planName.includes("サービスタイム"))
  return "フリータイム";

  if (planName.includes("宿泊")) return "宿泊";
  if (planName.includes("休憩")) return "休憩";
  if (planName.includes("フリー") || planName.includes("フレックスタイム")) return "フリータイム";
  if (planName.includes("ショート")) return "ショートタイム";

  return "その他";
}

// 種類一覧を JSON から抽出
function getPlanTypes(hotels) {
  const types = new Set();
  hotels.forEach(hotel => {
    hotel.prices.forEach(plan => {
      types.add(detectPlanType(plan.name));
    });
  });
  return Array.from(types);
}

// 料金抽出（最低料金・最高料金）
function parsePriceRange(priceStr) {
  // 「xxx均一」対応：両方同じ値にする
  if (priceStr.includes("均一")) {
    const num = parseInt(priceStr.replace(/[￥,均一]/g, ""));
    return [num, num];
  }

  // 通常の「￥5,900～￥15,070」など
  const nums = priceStr.replace(/[￥,]/g, "").split("～");
  if (nums.length === 1) {
    const v = parseInt(nums[0]);
    return [v, v];
  }
  return [parseInt(nums[0]), parseInt(nums[1])];
}


// 時間抽出（数値）
// 時間の数値結果を小数第2位までに丸める（1.5, 2.25 などを綺麗に保つ）
function roundHours(h) {
  return Math.round(h * 100) / 100;
}

function parseTimeToHours(timeZone) {
  // "最大X時間Y分" または "最大X時間"（Y分は任意）
  const maxMatch = timeZone.match(/最大\s*([0-9]+)\s*時間(?:\s*([0-9]+)\s*分)?/);
  if (maxMatch) {
    const h = parseInt(maxMatch[1]);
    const min = maxMatch[2] ? parseInt(maxMatch[2]) : 0;
    return roundHours(h + min / 60);
  }

  // "X時間Y分" または "X時間"（Y分は任意）
  const hourMatch = timeZone.match(/([0-9]+)\s*時間(?:\s*([0-9]+)\s*分)?/);
  if (hourMatch) {
    const h = parseInt(hourMatch[1]);
    const min = hourMatch[2] ? parseInt(hourMatch[2]) : 0;
    return roundHours(h + min / 60);
  }

  // 時間表記が無く「Y分」のみの場合
  const minOnlyMatch = timeZone.match(/^\s*([0-9]+)\s*分\s*$/);
  if (minOnlyMatch) {
    return roundHours(parseInt(minOnlyMatch[1]) / 60);
  }

  const rangeMatch = timeZone.match(/([0-9:]+)～(.+)/);
  if (rangeMatch) {
    const start = rangeMatch[1];
    const end = rangeMatch[2];

    const toMinutes = t => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + (m || 0);
    };

    let s = toMinutes(start);
    let e = toMinutes(end.replace("翌 ", ""));

    if (end.includes("翌")) e += 24 * 60;

    return roundHours((e - s) / 60);
  }

  return null;
}

// 曜日判定（完全版）
function detectWeekFlags(text) {

  // ============================
  // 0. ピンポイント例外処理（最優先）
  // ============================

  const raw = text.replace(/[【】]/g, "").trim();
  const rawCompact = raw.replace(/\s/g, "");

  // プラン名などの説明文が続く複合表記は、曜日条件部分を優先する
  if (/^金・土・日・祝前・祝(?:インペリアルスイート)?/.test(rawCompact)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"○", 土:"○", 日:"○", 祝:"○", 祝前:"○" };
  }
  if (/^月～金・祝前日（A・Bタイプは7時間）$/.test(rawCompact)) {
    return { 月:"○", 火:"○", 水:"○", 木:"○", 金:"○", 土:"", 日:"", 祝:"", 祝前:"○" };
  }
  if (/^金・土・日祝前日・祝日・連休中日$/.test(rawCompact)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"○", 土:"○", 日:"○", 祝:"○", 祝前:"○" };
  }
  if (/^金土日・祝日・祝日前$/.test(rawCompact)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"○", 土:"○", 日:"○", 祝:"○", 祝前:"○" };
  }

  // 括弧内の曜日条件を含む代表表記
  if (/^休日[（(]土[・･]特日[）)]$/.test(rawCompact)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"", 土:"○", 日:"○", 祝:"○", 祝前:"" };
  }
  if (/^平日[（(]金[・･]祝前[）)]$/.test(rawCompact)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"○", 土:"", 日:"", 祝:"", 祝前:"○" };
  }

  // 金 / 金曜 / 金曜日
  if (/^金$|^金曜$|^金曜日$/.test(raw)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"○", 土:"", 日:"", 祝:"", 祝前:"" };
  }

  // 土・祝前
  if (/^土.?祝前$/.test(raw)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"", 土:"○", 日:"", 祝:"", 祝前:"○" };
  }

  // 日・祝
  if (/^日.?祝$/.test(raw)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"", 土:"", 日:"○", 祝:"○", 祝前:"" };
  }

  // 土・特日 → 特日は祝扱い
  if (/^土.?特日$/.test(raw)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"", 土:"○", 日:"", 祝:"○", 祝前:"" };
  }

  // 金・祝前
  if (/^金.?祝前$/.test(raw)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"○", 土:"", 日:"", 祝:"", 祝前:"○" };
  }

  // 金・土・日・祝・祝前
  if (/^金.?土.?日.?祝.?祝前$/.test(raw)) {
    return { 月:"", 火:"", 水:"", 木:"", 金:"○", 土:"○", 日:"○", 祝:"○", 祝前:"○" };
  }


  // ============================
  // 1. クレンジング辞書（表記ゆれ吸収）
  // ============================
  const CLEANSE_MAP = {
    // 単独曜日（日本語）
    "月": "月", "火": "火", "水": "水", "木": "木",
    "金": "金", "土": "土", "日": "日",

    "月曜": "月", "月曜日": "月",
    "火曜": "火", "火曜日": "火",
    "水曜": "水", "水曜日": "水",
    "木曜": "木", "木曜日": "木",
    "金曜": "金", "金曜日": "金",
    "土曜": "土", "土曜日": "土",
    "日曜": "日", "日曜日": "日",

    // 英語 → 日本語
    "friday": "金",
    "sataday": "土",
    "saturday": "土",
    "sunday": "日",
    "week day": ["月","火","水","木","金"],
    "weekday": ["月","火","水","木","金"],
    "holidays": "祝",
    "before holidays": "祝前",

    // 特殊語
    "平日": ["月","火","水","木","金"],
    "週末": ["土","日","祝"],
    "休日": ["日","祝"],
    "特日": "祝",
    "祝前日": "祝前",
    "祝中": "祝",
    "全日": ["月","火","水","木","金","土","日","祝","祝前"],

    // 無視語
    "連休中日": null,
    "連休中": null,
    "特別日": "祝",
    "1部": null,
    "2部": null,
    "I部": null,
    "II部": null,
    "Aタイプ": null,
    "Bタイプ": null,
    "ランク": null,
  };


  // ============================
  // 2. クレンジング（辞書＋前処理）
  // ============================
  function cleanseWeekText(raw) {
    if (!raw) return [];

    let t = raw.toLowerCase();

    // 条件文削除
    t = t.split("※")[0];
    t = t.replace(/（チェックイン.*?）/g, "");
    t = t.replace(/\(チェックイン.*?\)/g, "");
    if (/[月火水木金土日祝]/.test(t)) t = t.replace(/\s/g, "");

    // 曜日・祝日の表記を先に正規化（例: 土曜日、祝前日、祝日）
    t = t.replace(/([月火水木金土日])曜日?/g, "$1");
    t = t.replace(/祝前日/g, "祝前");
    t = t.replace(/祝日/g, "祝");

    // 部制削除
    t = t.replace(/[0-9]+部|I部|II部/g, "");

    // 連休中は曜日フラグの対象外なので、除外条件ごと取り除く
    t = t.replace(/連休中を除く/g, "");

    // ランク条件削除
    t = t.replace(/Aランク|Bランク|Cランク|Dランク|Eランク/g, "");

    // 括弧削除
    t = t.replace(/[（）\(\)［］【】]/g, "");

    // 範囲の直後に付く除外条件を別トークンに分離
    t = t.replace(/([月火水木金土日])～([月火水木金土日])(?=祝前?除く)/g, "$1～$2・");

    // 全角中点統一
    t = t.replace(/･/g, "・");
    t = t.replace(/\s*([・\/／,])\s*/g, "$1");

    // 連結語分割
    t = t.replace(/土日祝/g, "土・日・祝");
    t = t.replace(/土日/g, "土・日");

    // 英語→日本語（辞書）
    Object.keys(CLEANSE_MAP).forEach(key => {
      const lowerKey = key.toLowerCase();
      if (t.includes(lowerKey)) {
        const v = CLEANSE_MAP[key];
        const rep = Array.isArray(v) ? v.join("・") : (v || "");
        t = t.replace(new RegExp(lowerKey, "g"), rep);
      }
    });

    // トークン化
    let tokens = t.split(/・|\/|／|,/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    return tokens;
  }


  // ============================
  // 3. 構造解析（意味抽出）
  // ============================
  function interpretWeekTokens(tokens) {
    const flags = {
      "月": "", "火": "", "水": "", "木": "", "金": "", "土": "", "日": "", "祝": "", "祝前": ""
    };

    const days = ["日","月","火","水","木","金","土"];

    let excludeHoliday = false;
    let excludeBeforeHoliday = false;

    tokens.forEach(token => {

      // 除く系
      if (token.includes("除く")) {
        if (token.includes("祝前")) excludeBeforeHoliday = true;
        if (token.includes("祝")) excludeHoliday = true;
        if (token.includes("特日")) excludeHoliday = true;
        return;
      }

      // 区間系
      const range = token.match(/([日月火水木金土])曜?～([日月火水木金土])曜?/);
      if (range) {
        const s = days.indexOf(range[1]);
        const e = days.indexOf(range[2]);
        if (s <= e) {
          for (let i = s; i <= e; i++) flags[days[i]] = "○";
        } else {
          for (let i = s; i < days.length; i++) flags[days[i]] = "○";
          for (let i = 0; i <= e; i++) flags[days[i]] = "○";
        }
        return;
      }

      // 複数系
      const parts = token.split(/・/);
      if (parts.length > 1) {
        parts.forEach(p => {
          if (CLEANSE_MAP[p]) {
            const v = CLEANSE_MAP[p];
            if (Array.isArray(v)) {
              v.forEach(d => flags[d] = "○");
            } else if (v) {
              flags[v] = "○";
            }
          } else if (days.includes(p)) {
            flags[p] = "○";
          }
        });
        return;
      }

      // 特殊語
      if (token === "平日") {
        ["月","火","水","木","金"].forEach(d => flags[d] = "○");
        return;
      }
      if (token === "週末") {
        ["土","日","祝"].forEach(d => flags[d] = "○");
        return;
      }
      if (token === "休日") {
        ["日","祝"].forEach(d => flags[d] = "○");
        return;
      }
      if (token === "特日") {
        flags["祝"] = "○";
        return;
      }
      if (token === "全日") {
        ["月","火","水","木","金","土","日","祝","祝前"].forEach(d => flags[d] = "○");
        return;
      }

      // 単独曜日
      if (days.includes(token)) {
        flags[token] = "○";
        return;
      }

      // 祝前
      if (token === "祝前") {
        flags["祝前"] = "○";
        return;
      }

      // 祝
      if (token === "祝" || token === "祝日") {
        flags["祝"] = "○";
        return;
      }
    });

    // 除く処理
    if (excludeHoliday) flags["祝"] = "";
    if (excludeBeforeHoliday) flags["祝前"] = "";

    return flags;
  }


  // ============================
  // 4. 最終判定（辞書＋構造解析のハイブリッド）
  // ============================
  const tokens = cleanseWeekText(text);
  const parsed = interpretWeekTokens(tokens);
  const result = {};
  ["月", "火", "水", "木", "金", "土", "日", "祝", "祝前"].forEach(day => {
    result[day] = parsed[day] || "";
  });
  return result;
}


function render(hotels) {
  const container = document.getElementById("content");
  container.innerHTML = "";

  // ---- ホテル基本情報カード（アクセス・設備・口コミ・在庫） ----
  const cardDetails = document.createElement("details");
  cardDetails.id = "section-hotels";
  cardDetails.className = "sticky-section";
  cardDetails.innerHTML = `<summary id="cardSummary">ホテル一覧（${hotels.length}件・クリックで展開）</summary>`;

  // フィルタツールバー
  const amenitySet = new Set();
  hotels.forEach(h => {
    const amenities = h.amenities || {};
    Object.values(amenities).forEach(items => items.forEach(a => amenitySet.add(a)));
  });
  const amenityOptions = Array.from(amenitySet).sort((a, b) => a.localeCompare(b, "ja"));

  const cardToolbar = document.createElement("div");
  cardToolbar.className = "hotel-card-toolbar sticky-toolbar";
  cardToolbar.innerHTML = `
    <div>
      <div style="color:var(--text-muted);margin-bottom:2px;">口コミ評価（以上）</div>
      <input id="cardMinReview" type="number" step="0.1" min="0" max="5" class="filter-range" placeholder="例: 4.0">
    </div>
    <div>
      <div style="color:var(--text-muted);margin-bottom:2px;">在庫</div>
      <label style="display:flex;align-items:center;gap:4px;">
        <input id="cardVacantOnly" type="checkbox"> 空室ありのみ
      </label>
    </div>
    <div>
      <div style="color:var(--text-muted);margin-bottom:2px;">設備（すべて満たす）</div>
      <select id="cardAmenityFilter" class="filter-wide" multiple size="1" style="min-width:180px;">
        ${amenityOptions.map(a => `<option value="${a}">${a}</option>`).join("")}
      </select>
    </div>
    <button id="cardClearBtn" class="clear-btn" type="button">条件クリア</button>
    <div id="cardResultCount" style="color:var(--text-muted);"></div>
  `;

  const cardGrid = document.createElement("div");
  cardGrid.className = "hotel-cards";

  function displayVacancyText(value) {
    if (value === "売切れ") return "満室";
    return typeof value === "string" ? value.replace(/^あと\s*/, "") : value;
  }

  function getVacancyTotal(vacancy) {
    const details = Array.isArray(vacancy.details) ? vacancy.details : [];
    return details.reduce((total, detail) => {
      const stockCount = Number(detail.stock_count);
      return total + (Number.isFinite(stockCount) ? stockCount : 0);
    }, 0);
  }

  function buildHotelCard(h) {
    const card = document.createElement("div");
    card.className = "hotel-card";

    // アクセス
    const access = h.access || {};
    let accessHtml = `<span class="no-data">情報なし</span>`;
    if (access.stations && access.stations.length) {
      accessHtml = access.stations.map(s => {
        if (s.station) {
          return s.walk_min ? `${s.station}（徒歩${s.walk_min}分）` : s.station;
        }
        return "";
      }).filter(Boolean).join("、");
    }
    if (accessHtml === "" ) accessHtml = `<span class="no-data">情報なし</span>`;
    const mapLink = access.map_url
      ? ` <a href="${access.map_url}" target="_blank">地図</a>`
      : "";

    // 口コミ
    const review = h.review || {};
    const reviewHtml = (review.score != null)
      ? `★ ${review.score}${review.count != null ? `（${review.count}件）` : ""}`
      : `<span class="no-data">未取得</span>`;

    // 在庫（reservePlans由来のリアルタイム空室情報）
    const vac = h.vacancy || {};
    let vacBadge = `<span class="badge na">情報なし</span>`;
    let vacDetailHtml = "";
    if (vac.details && vac.details.length) {
      if (vac.has_vacancy === true) {
        vacBadge = `<span class="badge vacant">空室あり（${getVacancyTotal(vac)}室）</span>`;
      } else if (vac.has_vacancy === false) {
        vacBadge = `<span class="badge full">満室</span>`;
      }
      // プランごとの空室内訳（上位3件まで表示）
      vacDetailHtml = `<div class="amenity-tags">` + vac.details.slice(0, 3).map(d => {
        const label = d.room_rank_name ? `${d.plan_name}/${d.room_rank_name}` : d.plan_name;
        return `<span class="amenity-tag">${label}: ${displayVacancyText(d.stock_text) ?? "—"}</span>`;
      }).join("") + `</div>`;
    }

    // アメニティ（カテゴリごとのdict）
    const amenities = h.amenities || {};
    const amenityKeys = Object.keys(amenities);
    const amenityHtml = amenityKeys.length
      ? amenityKeys.map(cat => `
          <div style="margin-top:4px;"><b style="font-size:11.5px;">${cat}</b>
            <div class="amenity-tags">${amenities[cat].map(a => `<span class="amenity-tag">${a}</span>`).join("")}</div>
          </div>`).join("")
      : `<div class="amenity-tags"><span class="no-data">情報なし</span></div>`;

    card.innerHTML = `
      <h3>${h.name || "(名称不明)"}</h3>
      <div class="row"><span>住所</span><span class="val">${h.address || "—"}</span></div>
      <div class="row"><span>アクセス</span><span class="val">${accessHtml}${mapLink}</span></div>
      <div class="row"><span>口コミ</span><span class="val">${reviewHtml}</span></div>
      <div class="row"><span>在庫</span><span class="val">${vacBadge}</span></div>
      ${vacDetailHtml}
      <div style="margin-top:6px;">設備</div>
      ${amenityHtml}
    `;
    return card;
  }

  function hotelAmenityFlatList(h) {
    const amenities = h.amenities || {};
    return Object.values(amenities).flat();
  }

  function drawCards() {
    const minReviewRaw = document.getElementById("cardMinReview").value;
    const minReview = minReviewRaw !== "" ? parseFloat(minReviewRaw) : null;
    const vacantOnly = document.getElementById("cardVacantOnly").checked;
    const selectedAmenities = Array.from(document.getElementById("cardAmenityFilter").selectedOptions).map(o => o.value);

    const filtered = hotels.filter(h => {
      if (minReview != null) {
        const score = h.review && h.review.score != null ? parseFloat(h.review.score) : null;
        if (score == null || isNaN(score) || score < minReview) return false;
      }
      if (vacantOnly) {
        if (!(h.vacancy && h.vacancy.has_vacancy === true)) return false;
      }
      if (selectedAmenities.length) {
        const flat = hotelAmenityFlatList(h);
        const hasAll = selectedAmenities.every(a => flat.includes(a));
        if (!hasAll) return false;
      }
      return true;
    });

    cardGrid.innerHTML = "";
    filtered.forEach(h => cardGrid.appendChild(buildHotelCard(h)));
    document.getElementById("cardResultCount").textContent =
      `${filtered.length} / ${hotels.length} 件表示中`;
  }

  cardDetails.appendChild(cardToolbar);
  cardDetails.appendChild(cardGrid);
  container.appendChild(cardDetails);

  drawCards();
  document.getElementById("cardMinReview").addEventListener("input", drawCards);
  document.getElementById("cardVacantOnly").addEventListener("change", drawCards);
  document.getElementById("cardAmenityFilter").addEventListener("change", drawCards);
  document.getElementById("cardClearBtn").addEventListener("click", () => {
    document.getElementById("cardMinReview").value = "";
    document.getElementById("cardVacantOnly").checked = false;
    Array.from(document.getElementById("cardAmenityFilter").options).forEach(o => o.selected = false);
    drawCards();
  });

  const planTypes = getPlanTypes(hotels);

  const priceDetails = document.createElement("details");
  priceDetails.id = "section-price";
  priceDetails.className = "sticky-section";
  priceDetails.open = true;
  priceDetails.innerHTML = `<summary>料金比較表</summary>`;
  container.appendChild(priceDetails);

  const clearBtnWrap = document.createElement("div");
  clearBtnWrap.className = "sticky-toolbar";
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "フィルタをクリア";
  clearBtn.className = "clear-btn";
  clearBtnWrap.appendChild(clearBtn);
  priceDetails.appendChild(clearBtnWrap);

  const priceScrollHint = document.createElement("div");
  priceScrollHint.className = "scroll-hint";
  priceScrollHint.textContent = "→ 横にスクロールすると全項目を確認できます";
  priceDetails.appendChild(priceScrollHint);

  const priceTable = document.createElement("table");
  priceTable.id = "priceTable";
  priceTable.innerHTML = `
    <thead>
      <tr>
        <th class="sortable" data-col="hotel">ホテル名 <span class="sort-arrow" data-arrow="hotel"></span><br>
          <input id="filterHotel" class="filter-wide" placeholder="部分一致検索">
        </th>
        <th class="vacancy-cell">空室情報<br>
          <label style="font-weight:normal;font-size:11px;">
            <input id="filterVacancyAvailable" type="checkbox"> 空室ありのみ
          </label>
        </th>
        <th class="sortable" data-col="plan">プラン名 <span class="sort-arrow" data-arrow="plan"></span><br>
          <input id="filterPlan" class="filter-half-wide" placeholder="部分一致検索">
        </th>
        <th class="sortable" data-col="type">種類 <span class="sort-arrow" data-arrow="type"></span><br>
          <select id="filterType" class="filter-type-select" multiple>
            ${planTypes.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </th>
        <th>料金（元情報）</th>
        <th class="sortable" data-col="minPrice">最低料金 <span class="sort-arrow" data-arrow="minPrice"></span><br>
          <input id="minPrice" type="number" class="filter-range" placeholder="min">
        </th>
        <th class="sortable" data-col="maxPrice">最高料金 <span class="sort-arrow" data-arrow="maxPrice"></span><br>
          <input id="maxPrice" type="number" class="filter-range" placeholder="max">
        </th>
        <th>時間条件（元情報）<br>
          <input id="filterTimeZone" class="filter-input" placeholder="部分一致検索">
        </th>
        <th class="sortable" data-col="hours">時間（数値） <span class="sort-arrow" data-arrow="hours"></span><br>
          <div class="filter-range-stack">
            <input id="minHours" type="number" class="filter-range-narrow" placeholder="min">
            <input id="maxHours" type="number" class="filter-range-narrow" placeholder="max">
          </div>
        </th>
        <th class="week-source">曜日（元情報）</th>
    <th class="filter-row">月<br><input type="checkbox" name="week" value="月"></th>
    <th class="filter-row">火<br><input type="checkbox" name="week" value="火"></th>
    <th class="filter-row">水<br><input type="checkbox" name="week" value="水"></th>
    <th class="filter-row">木<br><input type="checkbox" name="week" value="木"></th>
    <th class="filter-row">金<br><input type="checkbox" name="week" value="金"></th>
    <th class="filter-row">土<br><input type="checkbox" name="week" value="土"></th>
    <th class="filter-row">日<br><input type="checkbox" name="week" value="日"></th>
    <th class="filter-row">祝<br><input type="checkbox" name="week" value="祝"></th>
    <th class="filter-row">祝前<br><input type="checkbox" name="week" value="祝前"></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const priceScroll = document.createElement("div");
  priceScroll.className = "table-scroll";
  priceScroll.appendChild(priceTable);
  priceDetails.appendChild(priceScroll);
  addHorizontalScrollbar(priceDetails, priceScroll, priceTable);

  const priceBody = priceTable.querySelector("tbody");
  let sortState = { column: null, asc: true };
  const expandedPriceHotels = new Set();

  function formatVacancy(hotel) {
    const vacancy = hotel.vacancy || {};
    const details = Array.isArray(vacancy.details) ? vacancy.details : [];
    if (!details.length) {
      return `<span class="no-data">情報なし</span>`;
    }

    const status = vacancy.has_vacancy === true
      ? `空室あり（${getVacancyTotal(vacancy)}室）`
      : vacancy.has_vacancy === false ? "満室" : "取得済み";

    // 満室（stock_count が null）の部屋は表示しない
    const available = details.filter(d => d.stock_count !== null && d.stock_count !== undefined);
    if (!available.length) {
      return `<span class="vacancy-status">${status}</span>`;
    }

    // 大分類: plan_name → 中分類: plan_type → 小分類: room_rank_name（明細: 空室数）
    const planMap = new Map();
    available.forEach(d => {
      const planName = d.plan_name || "プラン名不明";
      const planType = d.plan_type || "種別不明";
      if (!planMap.has(planName)) planMap.set(planName, new Map());
      const typeMap = planMap.get(planName);
      if (!typeMap.has(planType)) typeMap.set(planType, []);
      typeMap.get(planType).push(d);
    });

    const planHtml = Array.from(planMap.entries()).map(([planName, typeMap]) => {
      const typeHtml = Array.from(typeMap.entries()).map(([planType, items]) => {
        const roomHtml = items.map(d => {
          const room = d.room_rank_name || "部屋ランク不明";
          return `<div class="vacancy-room">${room}: ${d.stock_count}室</div>`;
        }).join("");
        return `<div class="vacancy-type">${planType}${roomHtml}</div>`;
      }).join("");
      return `<div class="vacancy-plan">${planName}${typeHtml}</div>`;
    }).join("");

    return `<span class="vacancy-status">${status}</span><div class="vacancy-detail">${planHtml}</div>`;
  }

  function drawTable() {
    priceBody.innerHTML = "";

    const hotelFilter = document.getElementById("filterHotel").value.toLowerCase();
    const planFilter = document.getElementById("filterPlan").value.toLowerCase();
    const typeFilter = Array.from(document.getElementById("filterType").selectedOptions).map(o => o.value);
    const timeZoneFilter = document.getElementById("filterTimeZone").value.toLowerCase();
    const vacancyAvailableOnly = document.getElementById("filterVacancyAvailable").checked;

    const minPrice = parseInt(document.getElementById("minPrice").value) || 0;
    const maxPrice = parseInt(document.getElementById("maxPrice").value) || Infinity;

    const minHours = parseInt(document.getElementById("minHours").value) || 0;
    const maxHours = parseInt(document.getElementById("maxHours").value) || Infinity;

    const weekChecks = Array.from(document.querySelectorAll("input[name='week']:checked")).map(c => c.value);

    let rows = [];

    hotels.forEach(hotel => {
      hotel.prices.forEach(plan => {
        const planType = detectPlanType(plan.name);

        plan.priceInfo.forEach(info => {
          let flags = detectWeekFlags(info.week);

          // ○が1つも付いていない場合 → plan.name でも判定する
          if (!Object.values(flags).includes("○")) {
            flags = detectWeekFlags(plan.name);
          }

          info.timePrice.forEach(tp => {
            const [minP, maxP] = parsePriceRange(tp.price);
            const hours = parseTimeToHours(tp.timeZone);

            if (hotelFilter && !hotel.name.toLowerCase().includes(hotelFilter)) return;
            if (vacancyAvailableOnly && !(hotel.vacancy && hotel.vacancy.has_vacancy === true)) return;
            if (planFilter && !plan.name.toLowerCase().includes(planFilter)) return;
            if (typeFilter.length && !typeFilter.includes(planType)) return;
            if (timeZoneFilter && !tp.timeZone.toLowerCase().includes(timeZoneFilter)) return;

            if (minP < minPrice || maxP > maxPrice) return;
            if (hours !== null && (hours < minHours || hours > maxHours)) return;

            if (weekChecks.length) {
              let ok = false;
              weekChecks.forEach(w => {
                if (flags[w] === "○") ok = true;
              });
              if (!ok) return;
            }

            rows.push({
              hotel: hotel.name,
              vacancy: formatVacancy(hotel),
              plan: plan.name,
              type: planType,
              priceRaw: tp.price,
              minPrice: minP,
              maxPrice: maxP,
              timeZone: tp.timeZone,
              hours: hours,
              weekText: info.week,
              flags: flags
            });
          });
        });
      });
    });

    if (sortState.column) {
      rows.sort((a, b) => {
        let va = a[sortState.column];
        let vb = b[sortState.column];
        let cmp;
        if (typeof va === "string" || typeof vb === "string") {
          cmp = String(va ?? "").localeCompare(String(vb ?? ""), "ja");
        } else {
          va = va ?? -Infinity;
          vb = vb ?? -Infinity;
          cmp = va - vb;
        }
        return sortState.asc ? cmp : -cmp;
      });
    }

    // ヘッダーの並び替え矢印を更新
    priceTable.querySelectorAll(".sort-arrow").forEach(el => {
      const col = el.dataset.arrow;
      el.textContent = (sortState.column === col) ? (sortState.asc ? "▲" : "▼") : "";
    });

    const groupedRows = new Map();
    rows.forEach(row => {
      if (!groupedRows.has(row.hotel)) groupedRows.set(row.hotel, []);
      groupedRows.get(row.hotel).push(row);
    });

    groupedRows.forEach((hotelRows, hotelName) => {
      const first = hotelRows[0];
      const types = Array.from(new Set(hotelRows.map(row => row.type))).join(" / ");
      const minPrice = Math.min(...hotelRows.map(row => row.minPrice));
      const maxPrice = Math.max(...hotelRows.map(row => row.maxPrice));
      const groupRow = document.createElement("tr");
      groupRow.className = "group-row" + (expandedPriceHotels.has(hotelName) ? " expanded" : "");
      groupRow.dataset.hotel = hotelName;
      groupRow.innerHTML = `
        <td>${hotelName}</td>
        <td class="vacancy-cell">${first.vacancy}</td>
        <td>${types}</td>
        <td>明細 ${hotelRows.length} 件</td>
        <td>—</td>
        <td>${minPrice}</td>
        <td>${maxPrice}</td>
        <td colspan="12">ホテル単位で集約中</td>
      `;
      priceBody.appendChild(groupRow);

      hotelRows.forEach(r => {
      const tr = document.createElement("tr");
      tr.className = "detail-row";
      tr.dataset.hotel = hotelName;
      tr.hidden = !expandedPriceHotels.has(hotelName);
      tr.innerHTML = `
        <td>${r.hotel}</td>
        <td class="vacancy-cell">${r.vacancy}</td>
        <td>${r.plan}</td>
        <td>${r.type}</td>
        <td>${r.priceRaw}</td>
        <td>${r.minPrice}</td>
        <td>${r.maxPrice}</td>
        <td>${r.timeZone}</td>
        <td>${r.hours ?? ""}</td>
        <td class="week-source">${r.weekText}</td>
    <td>${r.flags["月"]}</td>
    <td>${r.flags["火"]}</td>
    <td>${r.flags["水"]}</td>
    <td>${r.flags["木"]}</td>
    <td>${r.flags["金"]}</td>
    <td>${r.flags["土"]}</td>
    <td>${r.flags["日"]}</td>
    <td>${r.flags["祝"]}</td>
    <td>${r.flags["祝前"]}</td>
      `;
      priceBody.appendChild(tr);
      });
    });

    // tbody の内容が変わり .vacancy-cell 等の列幅が変化しうるため、
    // 固定表示中のヘッダー幅も同期し直す
    requestAnimationFrame(() => {
      priceStickyHeader && priceStickyHeader.onScrollOrResize();
    });
  }

  drawTable();

  document.querySelectorAll("input,select").forEach(el => {
    el.oninput = drawTable;
    el.onchange = drawTable;
  });

  priceTable.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", (e) => {
      // ヘッダー内の input/select クリック時はソートを発火させない
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      const col = th.dataset.col;
      if (sortState.column === col) {
        sortState.asc = !sortState.asc;
      } else {
        sortState.column = col;
        sortState.asc = true;
      }
      drawTable();
    });
  });
  priceBody.addEventListener("click", event => {
    const groupRow = event.target.closest(".group-row");
    if (!groupRow) return;
    const hotelName = groupRow.dataset.hotel;
    if (expandedPriceHotels.has(hotelName)) expandedPriceHotels.delete(hotelName);
    else expandedPriceHotels.add(hotelName);
    drawTable();
  });

  clearBtn.onclick = () => {
    document.querySelectorAll("input").forEach(el => {
      if (el.type === "checkbox") el.checked = false;
      else el.value = "";
    });
    document.getElementById("filterType").selectedIndex = -1;
    sortState = { column: null, asc: true };
    drawTable();
  };

const roomDetails = document.createElement("details");
roomDetails.id = "section-rooms";
roomDetails.className = "sticky-section";
roomDetails.open = true;
roomDetails.innerHTML = `<summary>部屋比較表</summary>`;
container.appendChild(roomDetails);

const roomNote = document.createElement("div");
roomNote.className = "subtitle sticky-toolbar";
roomNote.textContent = "※「在庫参考値」は部屋の空室状況ではなく、キープ機能（仮予約）対応の可能性がある値（keep_flag・要検証）です。リアルタイムの空室状況は上のホテルカードの「在庫」を参照してください。";
roomDetails.appendChild(roomNote);

const roomScrollHint = document.createElement("div");
roomScrollHint.className = "scroll-hint";
roomScrollHint.textContent = "→ 横にスクロールすると全項目を確認できます";
roomDetails.appendChild(roomScrollHint);

// ---- 部屋データをフラット化 ----
const allRoomRows = [];
hotels.forEach(hotel => {
  hotel.rooms.forEach(room => {
    allRoomRows.push({
      hotelName: hotel.name ?? "",
      roomNo: room.room_no ?? null,
      roomName: room.room_name ?? "",
      typeName: room.type_name ?? "",
      rankId: room.rank_id ?? null,
      keepFlag: (room.keep_flag === undefined || room.keep_flag === null) ? null : room.keep_flag,
      image: room.image ?? "",
    });
  });
});

const keepValues = Array.from(new Set(allRoomRows.map(r => r.keepFlag)))
  .sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

const roomTable = document.createElement("table");
roomTable.className = "room-table";
roomTable.innerHTML = `
  <thead>
    <tr>
      <th class="sortable" data-col="hotelName">ホテル名 <span class="sort-arrow" data-arrow="hotelName"></span></th>
      <th class="sortable" data-col="roomNo">部屋番号 <span class="sort-arrow" data-arrow="roomNo"></span></th>
      <th class="sortable" data-col="roomName">部屋名 <span class="sort-arrow" data-arrow="roomName"></span></th>
      <th class="sortable" data-col="typeName">タイプ名 <span class="sort-arrow" data-arrow="typeName"></span></th>
      <th class="sortable" data-col="rankId">グレードID <span class="sort-arrow" data-arrow="rankId"></span></th>
      <th class="sortable" data-col="keepFlag">在庫参考値 <span class="sort-arrow" data-arrow="keepFlag"></span><br>
        <span style="font-weight:normal;font-size:10px;color:#888;">(keep_flag・要検証)</span><br>
        <select id="filterKeepValue" class="filter-range">
          <option value="">すべて</option>
          ${keepValues.map(v => `<option value="${v === null ? "" : v}">${v === null ? "不明" : v}</option>`).join("")}
        </select>
      </th>
      <th>画像</th>
    </tr>
  </thead>
  <tbody></tbody>
`;
const roomBody = roomTable.querySelector("tbody");

let roomSortState = { column: null, asc: true };
const expandedRoomHotels = new Set();

function drawRoomTable() {
  let rows = allRoomRows.filter(r => {
    if (document.getElementById("filterKeepValue").selectedIndex > 0) {
      const sel = document.getElementById("filterKeepValue").value;
      const rVal = r.keepFlag === null ? "" : String(r.keepFlag);
      if (sel !== rVal) return false;
    }
    return true;
  });

  if (roomSortState.column) {
    rows = rows.slice().sort((a, b) => {
      let va = a[roomSortState.column];
      let vb = b[roomSortState.column];
      let cmp;
      if (typeof va === "string" || typeof vb === "string") {
        cmp = String(va ?? "").localeCompare(String(vb ?? ""), "ja");
      } else {
        va = va ?? -Infinity;
        vb = vb ?? -Infinity;
        cmp = va - vb;
      }
      return roomSortState.asc ? cmp : -cmp;
    });
 
    requestAnimationFrame(() => {
      roomStickyHeader && roomStickyHeader.onScrollOrResize();
    });
  }

  roomTable.querySelectorAll("[data-arrow]").forEach(el => {
    const col = el.dataset.arrow;
    el.textContent = (roomSortState.column === col) ? (roomSortState.asc ? "▲" : "▼") : "";
  });

  roomBody.innerHTML = "";
  const groupedRows = new Map();
  rows.forEach(row => {
    if (!groupedRows.has(row.hotelName)) groupedRows.set(row.hotelName, []);
    groupedRows.get(row.hotelName).push(row);
  });

  groupedRows.forEach((hotelRows, hotelName) => {
    const groupRow = document.createElement("tr");
    groupRow.className = "group-row" + (expandedRoomHotels.has(hotelName) ? " expanded" : "");
    groupRow.dataset.hotel = hotelName;
    groupRow.innerHTML = `
      <td>${hotelName}</td>
      <td>明細 ${hotelRows.length} 件</td>
      <td colspan="5">ホテル単位で集約中</td>
    `;
    roomBody.appendChild(groupRow);

    hotelRows.forEach(r => {
    const tr = document.createElement("tr");
      tr.className = "detail-row";
      tr.dataset.hotel = hotelName;
      tr.hidden = !expandedRoomHotels.has(hotelName);
    const keepDisplay = r.keepFlag === null ? "—" : r.keepFlag;
    tr.innerHTML = `
      <td>${r.hotelName}</td>
      <td>${r.roomNo ?? "—"}</td>
      <td>${r.roomName}</td>
      <td>${r.typeName}</td>
      <td>${r.rankId ?? "—"}</td>
      <td>${keepDisplay}</td>
      <td>
        <a href="${r.image}" target="_blank">
          <img src="${r.image}" style="width:80px;height:auto;border-radius:4px;">
        </a>
      </td>
    `;
    roomBody.appendChild(tr);
  });
});
}

roomTable.querySelectorAll("th.sortable").forEach(th => {
  th.addEventListener("click", (e) => {
    if (e.target.tagName === "SELECT" || e.target.tagName === "OPTION") return;
    const col = th.dataset.col;
    if (roomSortState.column === col) {
      roomSortState.asc = !roomSortState.asc;
    } else {
      roomSortState.column = col;
      roomSortState.asc = true;
    }
    drawRoomTable();
  });
});
roomBody.addEventListener("click", event => {
  const groupRow = event.target.closest(".group-row");
  if (!groupRow) return;
  const hotelName = groupRow.dataset.hotel;
  if (expandedRoomHotels.has(hotelName)) expandedRoomHotels.delete(hotelName);
  else expandedRoomHotels.add(hotelName);
  drawRoomTable();
});

const roomScroll = document.createElement("div");
roomScroll.className = "table-scroll";
roomScroll.appendChild(roomTable);
roomDetails.appendChild(roomScroll);
addHorizontalScrollbar(roomDetails, roomScroll, roomTable);

drawRoomTable();
document.getElementById("filterKeepValue").addEventListener("change", drawRoomTable);

initPageTitleSticky();
const cardStickyHeader = initFakeStickyHeader(cardDetails);
const priceStickyHeader = initFakeStickyHeader(priceDetails);
const roomStickyHeader = initFakeStickyHeader(roomDetails);
}

function addHorizontalScrollbar(parent, tableScroll, table) {
  const headerRow = table.querySelector("thead tr:not([aria-hidden='true'])");
  const colCount = headerRow ? headerRow.children.length : 1;

  // 以前は position:absolute でヘッダーの上に「浮かせて」重ねる実装だったが、
  // 実際のレイアウトに高さが反映されないため、余白の確保やz-indexの調整を
  // 何度繰り返しても見出しとの重なり・隠れが解消しなかった。
  // 表の中の本物の <tr> として組み込めば、そもそも重なりようがなくなる。
  const scrollbarRow = document.createElement("tr");
  scrollbarRow.className = "scrollbar-row";
  scrollbarRow.setAttribute("aria-hidden", "true");
  const cell = document.createElement("td");
  cell.colSpan = colCount;
  const scrollbar = document.createElement("div");
  scrollbar.className = "horizontal-scrollbar";
  const inner = document.createElement("div");
  inner.className = "horizontal-scrollbar-inner";
  scrollbar.appendChild(inner);
  cell.appendChild(scrollbar);
  scrollbarRow.appendChild(cell);

  if (headerRow && headerRow.parentNode) {
    headerRow.parentNode.insertBefore(scrollbarRow, headerRow.nextSibling);
  }

  const updateWidth = () => {
    const visibleWidth = tableScroll.getBoundingClientRect().width;
    const tableWidth = Math.max(table.scrollWidth, table.getBoundingClientRect().width);
    scrollbar.style.width = visibleWidth + "px";
    inner.style.width = tableWidth + "px";
    const needsScroll = tableWidth > visibleWidth + 1;
    tableScroll.classList.toggle("has-horizontal-overflow", needsScroll);
    scrollbarRow.style.display = needsScroll ? "table-row" : "none";
  };

  let syncing = false;
  let scrollTicking = false;
  // .table-scroll 自体はもうスクロールしない（ページ全体が横スクロールする）ため、
  // カスタムバーをドラッグしたときはページ全体を横スクロールさせ、
  // 逆にページを横スクロールしたときはバーのつまみ位置を追従させる。
  scrollbar.addEventListener("scroll", () => {
    if (syncing) return;
    scrollbar._userScroll = true;
    scrollbar._pendingUserScroll = true;
    syncing = true;
    window.scrollTo(scrollbar.scrollLeft, window.scrollY);
    syncing = false;
  }, { passive: true });
  window.addEventListener("scroll", () => {
    if (syncing || scrollTicking) return;
    const fromScrollbar = scrollbar._pendingUserScroll;
    scrollbar._pendingUserScroll = false;
    if (!fromScrollbar) scrollbar._userScroll = false;
    scrollTicking = true;
    requestAnimationFrame(() => {
      if (!syncing) {
        syncing = true;
        scrollbar.scrollLeft = window.scrollX;
        syncing = false;
      }
      scrollTicking = false;
    });
  }, { passive: true });
  window.addEventListener("resize", updateWidth);
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(updateWidth);
    observer.observe(table);
  }
  scrollbar._updateWidth = updateWidth;
  tableScroll._horizontalScrollbar = scrollbar;
  updateWidth();

  return { scrollbarRow, scrollbar };
}

// ============================================================
// 「料金比較表」「部屋比較表」のタイトル・ツールバー・列見出しを
// スクロールに応じて position:fixed で固定表示する。
//
// CSSの position:sticky はブラウザ（特にモバイル）によって挙動が
// 不安定なことが分かったため、window のスクロール位置を見て
// JS側で直接 position を切り替える方式にしている。
//
// 各要素（summary / ツールバー / thead）の「本来の（固定されて
// いない）ドキュメント上の絶対Y座標」を最初に1回だけ測っておき
// （スペーサーで高さを保持するので、この値は固定状態が変わっても
// ずれない）、スクロール位置と比較して固定/解除を切り替える。
//
// 横スクロール時は1列目（ホテル名）を画面端に固定する。
// ============================================================
function initFakeStickyHeader(sec) {
  const summary = sec.querySelector(":scope > summary");
  const toolbar = sec.querySelector(":scope > .sticky-toolbar");
  const scrollHint = sec.querySelector(":scope > .scroll-hint");
  const table = sec.querySelector(".table-scroll table");
  const tableScroll = table ? table.closest(".table-scroll") : null;
  const thead = table ? table.querySelector("thead") : null;
  const headerRow = thead ? thead.querySelector("tr") : null;
  const ths = headerRow ? Array.from(headerRow.children) : [];
  const scrollbarRow = thead ? thead.querySelector("tr.scrollbar-row") : null;
  const scrollbarCell = scrollbarRow ? scrollbarRow.querySelector("td") : null;
  if (!summary && !headerRow) return;

  const isMobile = window.innerWidth <= 640 || window.matchMedia("(max-width: 640px)").matches;
  if (isMobile && headerRow && tableScroll) {
    if (!headerRow || !tableScroll) return;

    const mobileHeader = document.createElement("div");
    mobileHeader.className = "mobile-sticky-header";
    const mobileSummary = summary.cloneNode(true);
    mobileSummary.className = "mobile-sticky-summary";
    mobileSummary.removeAttribute("id");
    mobileSummary.addEventListener("click", () => summary.click());
    mobileHeader.appendChild(mobileSummary);

    if (toolbar) {
      const mobileToolbar = toolbar.cloneNode(true);
      mobileToolbar.classList.add("mobile-sticky-toolbar");
      mobileToolbar.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
      mobileToolbar.querySelectorAll("button").forEach(button => {
        const originalButton = toolbar.querySelector("button");
        if (originalButton) button.addEventListener("click", () => originalButton.click());
      });
      mobileHeader.appendChild(mobileToolbar);
    }
    if (scrollHint) {
      const mobileScrollHint = scrollHint.cloneNode(true);
      mobileScrollHint.className = "mobile-sticky-scroll-hint";
      mobileHeader.appendChild(mobileScrollHint);
    }

    const mobileTable = table.cloneNode(true);
    mobileTable.removeAttribute("id");
    const mobileBody = mobileTable.querySelector("tbody");
    if (mobileBody) mobileBody.remove();
    mobileTable.querySelectorAll(".horizontal-scrollbar").forEach(el => {
      el.closest("tr")?.remove();
    });
    mobileTable.querySelectorAll("input, select, button").forEach(control => {
      const originalId = control.id;
      const originalControl = originalId ? document.getElementById(originalId) : null;
      control.removeAttribute("id");
      if (!originalControl) return;
      if (control.type === "checkbox" || control.type === "radio") {
        control.checked = originalControl.checked;
      } else if (control.tagName === "SELECT") {
        Array.from(control.options).forEach((option, index) => {
          option.selected = Boolean(originalControl.options[index]?.selected);
        });
      } else {
        control.value = originalControl.value;
      }
      const syncControl = () => {
        if (control.type === "checkbox" || control.type === "radio") {
          originalControl.checked = control.checked;
        } else if (control.tagName === "SELECT") {
          Array.from(originalControl.options).forEach((option, index) => {
            option.selected = Boolean(control.options[index]?.selected);
          });
        } else {
          originalControl.value = control.value;
        }
        originalControl.dispatchEvent(new Event("input", { bubbles: true }));
        originalControl.dispatchEvent(new Event("change", { bubbles: true }));
      };
      control.addEventListener("input", syncControl);
      control.addEventListener("change", syncControl);
    });
    mobileTable.querySelectorAll("th.sortable").forEach((mobileTh, index) => {
      mobileTh.addEventListener("click", event => {
        if (event.target.matches("input, select, option")) return;
        ths[index]?.click();
      });
    });
    mobileHeader.appendChild(mobileTable);
    document.body.appendChild(mobileHeader);

    function syncMobileHeaderWidths() {
      const mobileHeaderCells = mobileTable.querySelectorAll("thead tr:first-child th");
      ths.forEach((originalTh, index) => {
        const mobileTh = mobileHeaderCells[index];
        if (!mobileTh) return;
        const width = originalTh.getBoundingClientRect().width;
        mobileTh.style.width = width + "px";
        mobileTh.style.minWidth = width + "px";
        mobileTh.style.maxWidth = width + "px";
      });
      mobileTable.style.width = table.getBoundingClientRect().width + "px";
    }

    function updateMobileHeaderNow() {
      if (sec.tagName === "DETAILS" && !sec.open) {
        mobileHeader.style.display = "none";
        return;
      }
      // 列幅はソート/フィルタ操作等で本体側が変化しうるため、毎回同期し直す
      // （安いDOM読み取りのみなので、rAFで1フレームに1回にまとめれば負荷は問題ない）
      syncMobileHeaderWidths();
      const scrollRect = tableScroll.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const sectionRect = sec.getBoundingClientRect();
      const headerHeight = headerRow.getBoundingClientRect().height;
      const visible = sectionRect.top <= 1 && sectionRect.bottom > headerHeight;
      mobileHeader.style.display = visible ? "block" : "none";
      if (!visible) return;
      const titleHeight = pageTitleStickyHeight;
      mobileHeader.style.top = titleHeight + "px";
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const stableLeft = scrollRect.left + scrollX;
      mobileHeader.style.left = stableLeft + "px";
      mobileHeader.style.width = Math.max(0, scrollRect.width) + "px";
      mobileTable.style.transform = `translateX(${tableRect.left - stableLeft}px)`;
      const mobileFirstHeader = mobileTable.querySelector("thead tr:first-child th");
      if (mobileFirstHeader) {
        mobileFirstHeader.style.transform = `translateX(${stableLeft - tableRect.left}px)`;
        mobileFirstHeader.style.position = "relative";
        mobileFirstHeader.style.zIndex = "10";
        mobileFirstHeader.style.background = "#f4f4f4";
      }
      mobileHeader.style.height = "auto";
    }

    // スクロールイベントは（特にモバイルのフリック操作中）非常に高頻度で発火するため、
    // rAFで1フレームに1回だけ実行するよう間引く。これが無いと、素早くスクロールした際に
    // ネイティブのスクロール描画にJS側の追従（transformの更新）が間に合わず、
    // ヘッダーと明細の横位置が一時的にずれて見える。
    let mobileTicking = false;
    function updateMobileHeader() {
      if (mobileTicking) return;
      mobileTicking = true;
      requestAnimationFrame(() => {
        updateMobileHeaderNow();
        mobileTicking = false;
      });
    }

    tableScroll.addEventListener("scroll", updateMobileHeader, { passive: true });
    window.addEventListener("scroll", updateMobileHeader, { passive: true });
    window.addEventListener("resize", updateMobileHeader);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("scroll", updateMobileHeader, { passive: true });
      window.visualViewport.addEventListener("resize", updateMobileHeader, { passive: true });
    }
    document.querySelectorAll("details").forEach(details => {
      details.addEventListener("toggle", updateMobileHeader);
    });
    if (typeof ResizeObserver !== "undefined") {
      const mobileRo = new ResizeObserver(updateMobileHeader);
      mobileRo.observe(table);
    }
    updateMobileHeaderNow();
    return { update: updateMobileHeaderNow, onScrollOrResize: updateMobileHeader };
  }

  // 高さ0のマーカー要素を「本来の位置」の目印として常に静的配置のまま残す。
  // summary/toolbar/theadRow 自体は fixed になったり戻ったりするが、
  // マーカーは絶対に動かないので、いつ読んでも正確な「自然な位置」が取れる。
  // （以前はこの位置を1回だけキャッシュしていたが、モバイルでアドレスバーの
  //   表示/非表示によるビューポートのリサイズが挟まると値がずれてしまい、
  //   スクロール方向によって固定が効いたり効かなかったりする不具合があった）
  function makeMarker(beforeEl) {
    const marker = document.createElement("div");
    marker.style.cssText = "height:0;margin:0;padding:0;border:0;overflow:hidden;";
    marker.setAttribute("aria-hidden", "true");
    beforeEl.parentNode.insertBefore(marker, beforeEl);
    return marker;
  }
  function makeSpacer(afterEl) {
    const spacer = document.createElement("div");
    spacer.className = "sticky-spacer";
    afterEl.parentNode.insertBefore(spacer, afterEl.nextSibling);
    return spacer;
  }

  const summaryMarker = summary ? makeMarker(summary) : null;
  const summarySpacer = summary ? makeSpacer(summary) : null;
  const toolbarMarker = toolbar ? makeMarker(toolbar) : null;
  const toolbarSpacer = toolbar ? makeSpacer(toolbar) : null;

  let theadMarkerRow = null;
  let spacerRow = null;
  if (headerRow) {
    theadMarkerRow = document.createElement("tr");
    theadMarkerRow.setAttribute("aria-hidden", "true");
    theadMarkerRow.style.cssText = "height:0;line-height:0;visibility:hidden;";
    const markerCell = document.createElement("td");
    markerCell.style.cssText = "height:0;padding:0;border:0;margin:0;";
    markerCell.colSpan = ths.length || 1;
    theadMarkerRow.appendChild(markerCell);
    headerRow.parentNode.insertBefore(theadMarkerRow, headerRow);

    spacerRow = headerRow.cloneNode(true);
    spacerRow.className = "sticky-spacer-row";
    spacerRow.style.display = "none";
    spacerRow.querySelectorAll("th, td").forEach((cell, index) => {
      const width = ths[index].getBoundingClientRect().width;
      cell.innerHTML = "";
      cell.style.width = width + "px";
      cell.style.minWidth = width + "px";
      cell.style.maxWidth = width + "px";
    });
    spacerRow.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
    headerRow.parentNode.insertBefore(spacerRow, headerRow.nextSibling);
  }

  // 横スクロールバー行(tr.scrollbar-row)も、見出しと同じ考え方で
  // マーカー(自然な位置の目印)とスペーサー(固定中の場所取り)を用意する。
  let scrollbarMarkerRow = null;
  let scrollbarSpacerRow = null;
  if (scrollbarRow) {
    scrollbarMarkerRow = document.createElement("tr");
    scrollbarMarkerRow.setAttribute("aria-hidden", "true");
    scrollbarMarkerRow.style.cssText = "height:0;line-height:0;visibility:hidden;";
    const scrollbarMarkerCell = document.createElement("td");
    scrollbarMarkerCell.style.cssText = "height:0;padding:0;border:0;margin:0;";
    scrollbarMarkerCell.colSpan = ths.length || 1;
    scrollbarMarkerRow.appendChild(scrollbarMarkerCell);
    scrollbarRow.parentNode.insertBefore(scrollbarMarkerRow, scrollbarRow);

    scrollbarSpacerRow = scrollbarRow.cloneNode(true);
    scrollbarSpacerRow.className = "sticky-spacer-row";
    scrollbarSpacerRow.style.display = "none";
    // 中身（複製されたスクロールバーdiv）は幅が同期されず紛らわしい
    // 見た目になるだけなので空にし、高さ確保専用の空セルにする。
    scrollbarSpacerRow.querySelectorAll("td").forEach(td => { td.innerHTML = ""; });
    scrollbarRow.parentNode.insertBefore(scrollbarSpacerRow, scrollbarRow.nextSibling);
  }

  const sizes = {}; // 各要素の高さ（offsetHeightはfixed状態でも正確に測れる）
  let widthPxCache = 0;

  function measureSizes() {
    /*
    if (summary) {
      sizes.summary = Math.ceil(summary.getBoundingClientRect().height);
    }
    if (toolbar) {
      // 固定時と同じ幅に一時的にしてから高さを測る
      const prevWidth = toolbar.style.width;
      const prevPosition = toolbar.style.position;
      toolbar.style.position = "fixed";
      toolbar.style.width = widthPxCache + "px"; // ← update() 内で計算済みの widthPx を使う
      sizes.toolbar = Math.ceil(toolbar.getBoundingClientRect().height);
      toolbar.style.position = prevPosition;
      toolbar.style.width = prevWidth;
    }
    */
   
    if (headerRow) {
      const wasFixed = ths.map(th => th.style.position === "fixed");
      const spacerWasShown = spacerRow && spacerRow.style.display !== "none";
      if (wasFixed.some(Boolean)) {
        ths.forEach(th => {
          th.style.position = "";
          th.style.top = "";
          th.style.left = "";
          th.style.width = "";
          th.style.height = "";
        });
      }
      if (spacerWasShown) {
        spacerRow.style.display = "none";
      }

      sizes.thead = Math.max(headerRow.offsetHeight, ...ths.map(th => th.getBoundingClientRect().height));
      ths.forEach(th => { th._fixedWidth = th.getBoundingClientRect().width; });

      const hotelNameTh = ths[0];
      const hotelNameTd = table.querySelector("tbody tr:not([aria-hidden]) td:first-child");
      if (hotelNameTh && hotelNameTd) {
        hotelNameTh._fixedWidth = Math.ceil(hotelNameTd.getBoundingClientRect().width);
      }

      // .vacancy-cell だけは中身の量で幅が動的に変わり、かつ th 自身は短い
      // ラベルしか持たないため、th 単体の measurement がテーブルの列共有幅と
      // 一瞬ズレることがある。実データを持つ td（常に表示されている group-row の
      // セル）から権威ある幅を直接借りることで、このズレを回避する。
      const vacancyTh = headerRow.querySelector("th.vacancy-cell");
      const vacancyTd = table.querySelector("tbody td.vacancy-cell");
      if (vacancyTh && vacancyTd) {
        vacancyTh._fixedWidth = vacancyTd.getBoundingClientRect().width;
      }

      if (spacerRow) {
        spacerRow.querySelectorAll("th, td").forEach((cell, index) => {
          const width = ths[index]._fixedWidth;
          cell.style.width = width + "px";
          cell.style.minWidth = width + "px";
          cell.style.maxWidth = width + "px";
        });
      }
    }
  }

  function unfixAll() {
    if (scrollbarCell) {
      scrollbarCell.style.position = "";
      scrollbarCell.style.top = "";
      scrollbarCell.style.left = "";
      scrollbarCell.style.width = "";
      scrollbarCell.style.height = "";
      if (scrollbarSpacerRow) scrollbarSpacerRow.style.display = "none";
    }
    if (summary) {
      summary.style.position = "";
      summary.style.top = "";
      summary.style.left = "";
      summary.style.width = "";
      summary.style.marginTop = "";
      summary.style.background = "";
      summary.style.zIndex = "";
      summarySpacer.style.display = "none";
    }
    if (toolbar) {
      toolbar.style.position = "";
      toolbar.style.top = "";
      toolbar.style.left = "";
      toolbar.style.width = "";
      toolbar.style.marginTop = "";
      toolbar.style.background = "";
      toolbar.style.zIndex = "";
      toolbarSpacer.style.display = "none";
    }
    if (headerRow) {
      ths.forEach(th => {
        th.style.position = "";
        th.style.top = "";
        th.style.left = "";
        th.style.width = "";
        th.style.height = "";
      });
      spacerRow.style.display = "none";
    }
  }

  function update() {
    if (window.innerWidth <= 640 && headerRow) {
      return;
    }

    // details が閉じている場合は何もしない
    if (sec.tagName === "DETAILS" && !sec.open) {
      unfixAll();
      return;
    }

    // タイトルブロックのsticky状態を先に最新化してから、その高さぶん
    // オフセットを下げる（同一フレーム内で古い値を参照しないようにする）
    updatePageTitleSticky();
        
    const scrollY = window.scrollY || window.pageYOffset;
    const sectionRect = sec.getBoundingClientRect();
    const tableRect = table ? table.getBoundingClientRect() : sectionRect;
    const leftPx = sectionRect.left;
    const widthPx = Math.ceil((table || sec).getBoundingClientRect().width) + 2;
    widthPxCache = widthPx; // ← measureSizes より前にセット

    measureSizes();

    // セクション全体（表の下端）を過ぎたら固定を解除する
    const totalStickyHeight = pageTitleStickyHeight + (sizes.summary || 0) + (sizes.toolbar || 0) + (sizes.thead || 0) + (sizes.scrollbarRow || 0);
    const sectionBottom = sec.getBoundingClientRect().bottom;
    if (sectionBottom <= totalStickyHeight) {
      unfixAll();
      return;
    }

    let offset = pageTitleStickyHeight;

    if (summary) {
      const naturalTop = summaryMarker.getBoundingClientRect().top + scrollY;
      const shouldStick = scrollY >= naturalTop - offset;
      if (shouldStick) {
        summary.style.position = "fixed";
        summary.style.top = offset + "px";
        summary.style.left = leftPx + "px";
        summary.style.width = widthPx + "px";
        summary.style.marginTop = "0";
        summary.style.background = "#fff";
        summary.style.zIndex = "50";

        // ← 適用後の実測値で spacer を作る（事前計算の sizes.summary は使わない）
        const summaryHeight = Math.ceil(summary.getBoundingClientRect().height);
        sizes.summary = summaryHeight;
        summarySpacer.style.display = "block";
        summarySpacer.style.height = summaryHeight + "px";
      } else {
        summary.style.position = "";
        summary.style.top = "";
        summary.style.left = "";
        summary.style.width = "";
        summary.style.marginTop = "";
        summary.style.background = "";
        summary.style.zIndex = "";
        sizes.summary = summary.offsetHeight;
        summarySpacer.style.display = "none";
      }
      offset += sizes.summary;
    }

    if (toolbar) {
      const naturalTop = toolbarMarker.getBoundingClientRect().top + scrollY;
      const shouldStick = scrollY >= naturalTop - offset;
      if (shouldStick) {
        toolbar.style.position = "fixed";
        toolbar.style.top = offset + "px";
        toolbar.style.left = leftPx + "px";
        toolbar.style.width = widthPx + "px";
        toolbar.style.marginTop = "0";
        toolbar.style.background = "#fff";
        toolbar.style.zIndex = "50";

        // ← こちらも適用後に実測
        const toolbarHeight = Math.ceil(toolbar.getBoundingClientRect().height);
        sizes.toolbar = toolbarHeight;
        toolbarSpacer.style.display = "block";
        toolbarSpacer.style.height = toolbarHeight + "px";
      } else {
        toolbar.style.position = "";
        toolbar.style.top = "";
        toolbar.style.left = "";
        toolbar.style.width = "";
        toolbar.style.background = "";
        toolbar.style.zIndex = "";
        sizes.toolbar = toolbar.offsetHeight;
        toolbarSpacer.style.display = "none";
      }
      offset += sizes.toolbar;
    }

    if (headerRow) {
      const naturalTop = theadMarkerRow.getBoundingClientRect().top + scrollY;
      const shouldStick = scrollY >= naturalTop - offset;
      if (shouldStick) {
        spacerRow.style.display = "table-row";
        let x = table.getBoundingClientRect().left;
        const pinFirstColumn = true;
        const stickyLeft = document.body.classList.contains("sidebar-collapsed") ? 48 : 220;
        const bodyPaddingLeft = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
        const frameDocumentLeft = stickyLeft + bodyPaddingLeft;
        const currentScrollX = window.scrollX || window.pageXOffset || 0;
        const hotelNameLeft = Math.max(stickyLeft, frameDocumentLeft - currentScrollX);
        const roomTableVisible = sec.id !== "section-rooms" ||
          (tableRect.right > stickyLeft && tableRect.left < window.innerWidth);
        ths.forEach((th, index) => {
          const w = th._fixedWidth || (th._fixedWidth = th.getBoundingClientRect().width);
          th.style.position = "fixed";
          th.style.top = offset + "px";
          th.style.left = Math.floor(index === 0 && pinFirstColumn ? hotelNameLeft : x) + "px";
          th.style.width = w + "px";
          th.style.height = sizes.thead + "px";
          th.style.zIndex = "40";
          th.style.background = "#f4f4f4";
            th.style.visibility = index === 0 && !roomTableVisible ? "hidden" : "visible";
          x += w;
        });
        if (pinFirstColumn && ths[0]) {
          const firstTh = ths[0];
          firstTh.style.left = Math.floor(hotelNameLeft) + "px";
          firstTh.style.zIndex = "100";
          firstTh.style.background = "#f4f4f4";
        }
      } else {
        ths.forEach(th => {
          th.style.position = "";
          th.style.top = "";
          th.style.left = "";
          th.style.width = "";
          th.style.height = "";
          th.style.zIndex = "";
          th.style.background = "";
          th.style.visibility = "";
        });
        spacerRow.style.display = "none";
      }
      offset += sizes.thead || 0;
    }

    // 横スクロールバー行: 「見えている表示領域の幅」に合わせて常に
    // position:fixed で描画する（stuck/unstuck を問わない）。
    const viewportRect = table ? table.getBoundingClientRect() : null;
    const tableInViewport = viewportRect && viewportRect.bottom > 0 &&
      viewportRect.top < window.innerHeight && viewportRect.right > 0 &&
      viewportRect.left < window.innerWidth;
    if (scrollbarRow && getComputedStyle(scrollbarRow).display !== "none" && tableInViewport) {
      const naturalTop = scrollbarMarkerRow.getBoundingClientRect().top + scrollY;
      const shouldStick = scrollY >= naturalTop - offset;
      const scrollRect = tableScroll.getBoundingClientRect();
      const rowHeight = sizes.scrollbarRow || 10;
      const topPx = shouldStick ? offset : (naturalTop - scrollY);

      // position:fixed の left は「今の横スクロール量」の影響を受けてしまうと、
      // ページを横スクロールするたびにバー自体が画面外へ流れていってしまう
      // （バーは"固定された枠"であるべきで、横スクロールで動いてよいのは
      //  枠の中の中身＝表そのものだけ）。scrollXを足し戻して、横スクロール量に
      // 依存しない「本来（scrollX=0のとき）の位置」を求めてから使う。
      const scrollXNow = window.scrollX || window.pageXOffset || 0;
      const stableLeft = scrollRect.left + scrollXNow;

      scrollbarCell.style.position = "fixed";
      scrollbarCell.style.top = topPx + "px";
      scrollbarCell.style.left = stableLeft + "px";   // ← ここが修正点
      scrollbarCell.style.width = scrollRect.width + "px";
      scrollbarCell.style.height = rowHeight + "px";
      scrollbarCell.style.zIndex = "40";
      scrollbarSpacerRow.style.display = "table-row";

      offset += rowHeight;
    } else if (scrollbarSpacerRow) {
      scrollbarCell.style.position = "";
      scrollbarCell.style.top = "";
      scrollbarCell.style.left = "";
      scrollbarCell.style.width = "";
      scrollbarCell.style.height = "";
      scrollbarSpacerRow.style.display = "none";
    }
  }

  let ticking = false;
  function onScrollOrResize() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  }

  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  if (tableScroll) {
    tableScroll.addEventListener("scroll", onScrollOrResize, { passive: true });
  }
  window.addEventListener("resize", onScrollOrResize);
  window.addEventListener("touchstart", onScrollOrResize, { passive: true });
  window.addEventListener("touchmove", onScrollOrResize, { passive: true });
  window.addEventListener("touchend", onScrollOrResize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.visualViewport.addEventListener("resize", onScrollOrResize, { passive: true });
  }
  document.querySelectorAll("details").forEach(details => {
    details.addEventListener("toggle", onScrollOrResize);
  });

  if (typeof ResizeObserver !== "undefined" && table) {
    const ro = new ResizeObserver(onScrollOrResize);
    ro.observe(table);
  }

  update();

  return { update, onScrollOrResize };
}

// タイトルブロック（h1〜駅リンク〜更新日時）を最上部に固定表示する。
// 各セクション（料金比較表・部屋比較表）のsticky処理は、この固定分の
// 高さぶんだけ自分たちの開始位置(offset)を下げる必要があるため、
// 現在の固定高さを他から参照できるよう共有しておく。
let pageTitleStickyHeight = 0;
let updatePageTitleSticky = () => {};

function initPageTitleSticky() {
  const wrapper = document.getElementById("pageTitleSticky");
  if (!wrapper) return;

  const marker = document.createElement("div");
  marker.style.cssText = "height:0;margin:0;padding:0;border:0;overflow:hidden;";
  marker.setAttribute("aria-hidden", "true");
  wrapper.parentNode.insertBefore(marker, wrapper);

  const spacer = document.createElement("div");
  spacer.className = "page-title-sticky-spacer";
  wrapper.parentNode.insertBefore(spacer, wrapper.nextSibling);

  function contentBounds() {
    const priceTable = document.getElementById("priceTable");
    if (priceTable) {
      const rect = priceTable.getBoundingClientRect();
      return { left: rect.left, width: Math.ceil(rect.width) + 2 };
    }
    const content = document.getElementById("content");
    const rect = (content || wrapper).getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  }

  function update() {
    const scrollY = window.scrollY || window.pageYOffset;
    const naturalTop = marker.getBoundingClientRect().top + scrollY;
    const shouldStick = scrollY >= naturalTop;

    if (window.innerWidth <= 640) {
      if (shouldStick) {
        const rect = wrapper.getBoundingClientRect();
        const scrollX = window.scrollX || window.pageXOffset || 0;
        const documentLeft = marker.getBoundingClientRect().left + scrollX;
        wrapper.style.position = "fixed";
        wrapper.style.top = "0px";
        wrapper.style.left = documentLeft + "px";
        wrapper.style.width = rect.width + "px";
        wrapper.style.background = "#fff";
        wrapper.style.zIndex = "400";
        spacer.style.display = "block";
        spacer.style.height = wrapper.offsetHeight + "px";
        pageTitleStickyHeight = wrapper.offsetHeight;
      } else {
        wrapper.style.position = "";
        wrapper.style.top = "";
        wrapper.style.left = "";
        wrapper.style.width = "";
        wrapper.style.background = "";
        wrapper.style.zIndex = "";
        spacer.style.display = "none";
        pageTitleStickyHeight = 0;
      }
      return;
    }

    if (shouldStick) {
      const { left, width } = contentBounds();
      wrapper.style.position = "fixed";
      wrapper.style.top = "0px";
      wrapper.style.left = left + "px";
      wrapper.style.width = width + "px";
      wrapper.style.background = "#fff";   // CSS側の定義漏れに依存しない
      wrapper.style.zIndex = "60";
      spacer.style.display = "block";
      spacer.style.height = wrapper.offsetHeight + "px";
      pageTitleStickyHeight = wrapper.offsetHeight;
    } else {
      wrapper.style.position = "";
      wrapper.style.top = "";
      wrapper.style.left = "";
      wrapper.style.width = "";
      wrapper.style.zIndex = "";
      spacer.style.display = "none";
      pageTitleStickyHeight = 0;
    }
  }

  let ticking = false;
  function onScrollOrResize() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  }

  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.visualViewport.addEventListener("resize", onScrollOrResize, { passive: true });
  }

  // 他コード（セクション側update、サイドバー開閉）から即座に最新状態を
  // 反映させたい場合のために、同期版も公開しておく
  updatePageTitleSticky = update;
  update();
}