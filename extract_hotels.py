import argparse
import requests
from bs4 import BeautifulSoup
import json
import re
from pathlib import Path
from datetime import datetime
from time import sleep
from typing import List, Tuple

# -------------------------
# 設定
# -------------------------
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)

STATION_CONFIGS = {
    "ikebukuro": {
        "label": "池袋",
        "pref_id": 13,
        "route_id": "2106512000068000",
        "station_id": "1311601700100028",
    },
    "shinjuku": {
        "label": "新宿",
        "pref_id": 13,
        "route_id": "2106512000068000",
        "station_id": "1310404600300000",
    },
    "gotanda": {
        "label": "五反田",
        "pref_id": 13,
        "route_id": "2106512000068000",
        "station_id": "1310901700100026",
    },
}

DATA_DIR = Path("data")
CURRENT_DATA_DIR = DATA_DIR / "current"
ARCHIVE_DATA_DIR = DATA_DIR / "archive"
ARCHIVE_DETAIL_PATTERN = re.compile(
    r"^(?P<label>.+)_hotels_detail_(?P<date>\d{8})_(?P<time>\d{6})\.json$"
)

# -------------------------
# ユーティリティ
# -------------------------
def fetch_nextdata_from_url(url: str, timeout: int = 10) -> Tuple[dict, str]:
    """
    URL を取得して __NEXT_DATA__ をパースする。
    戻り値: (data_dict or None, error_message or None)
    """
    try:
        r = SESSION.get(url, timeout=timeout)
    except Exception as e:
        return None, f"request_error:{e}"
    if r.status_code != 200:
        return None, f"status_{r.status_code}"
    soup = BeautifulSoup(r.text, "html.parser")
    script_tag = soup.find("script", id="__NEXT_DATA__")
    if not script_tag:
        return None, "__NEXT_DATA__ missing"
    try:
        data = json.loads(script_tag.string)
    except Exception as e:
        return None, f"json_load_error:{e}"
    return data, None

def extract_hotels_from_pageData(pageData: dict) -> Tuple[List[dict], str]:
    """
    pageData からホテル配列を取り出す。候補キーを順に試す。
    戻り値: (hotel_list, used_key_name)
    """
    if not isinstance(pageData, dict):
        return [], None

    # 候補キー（必要に応じて追加）
    candidates = [
        ("basicHotels", lambda pd: pd.get("basicHotels")),
        ("hotels", lambda pd: pd.get("hotels")),
        ("searchHotels", lambda pd: pd.get("searchHotels")),
        ("searchResult.hotels", lambda pd: (pd.get("searchResult") or {}).get("hotels")),
        ("resultHotels", lambda pd: pd.get("resultHotels")),
    ]
    for name, fn in candidates:
        try:
            arr = fn(pageData)
            if arr:
                return arr, name
        except Exception:
            continue
    return [], None

def get_first_present(d: dict, candidate_keys: List[str]):
    """
    dict から、候補キーを順に試して最初に「値が存在する（None/空でない）」ものを返す。
    見つからなければ None。
    ネストしたキーは "a.b.c" のようにドット区切りで指定可能。
    """
    if not isinstance(d, dict):
        return None
    for key in candidate_keys:
        cur = d
        ok = True
        for part in key.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                ok = False
                break
        if ok and cur not in (None, "", [], {}):
            return cur
    return None


def build_hotel_urls_from_entries(entries: List[dict]) -> List[str]:
    urls = []
    for h in entries:
        hid = h.get("id") or h.get("hotelId") or (h.get("hotelBasicInfo") or {}).get("hotelId")
        if hid:
            urls.append(f"https://happyhotel.jp/hotels/{hid}")
    return urls

# -------------------------
# A: kodawari/list のページ送り取得
# -------------------------
def get_list_pages_kodawari(pref_id: int, route_id: str, station_id: str, max_pages: int = 50, sleep_sec: float = 1.0) -> List[dict]:
    entries = []
    page = 1
    while page <= max_pages:
        url = (
            "https://happyhotel.jp/search/kodawari/list"
            f"?pref_id={pref_id}&route_id={route_id}&station_id={station_id}&page={page}"
        )
        print(f"[一覧取得] {url}")
        data, err = fetch_nextdata_from_url(url)
        if err:
            print("  → ページ取得エラー:", err)
            break
        pageData = data.get("props", {}).get("pageProps", {}).get("pageData", {})
        hotels, used_key = extract_hotels_from_pageData(pageData)
        print("  → 使用キー:", used_key, "取得件数:", len(hotels))
        if not hotels:
            # 1ページ目で空なら終了
            if page == 1:
                print("  → この list ページは一覧を返していないか、別エンドポイントを使っている可能性があります")
            break
        entries.extend(hotels)
        page += 1
        sleep(sleep_sec)
    return entries

# -------------------------
# A: freeword のページ送り取得（必要なら使う）
# -------------------------
def get_hotels_by_freeword_paged(word: str, max_pages: int = 50, sleep_sec: float = 1.0) -> List[dict]:
    entries = []
    for page in range(1, max_pages + 1):
        url = f"https://happyhotel.jp/search/freeword?freeword={word}&page={page}"
        print(f"[freeword一覧] {url}")
        data, err = fetch_nextdata_from_url(url)
        if err:
            print("  → ページ取得エラー:", err)
            break
        pageData = data.get("props", {}).get("pageProps", {}).get("pageData", {})
        hotels, used_key = extract_hotels_from_pageData(pageData)
        print("  → 使用キー:", used_key, "取得件数:", len(hotels))
        if not hotels:
            print("  → ホテルが存在しないページに到達 → 終了")
            break
        entries.extend(hotels)
        sleep(sleep_sec)
    return entries

# -------------------------
# B: ホテル詳細ページの料金取得（堅牢版）
# -------------------------
def extract_room_info(pageData):
    rooms = []

    hotelRoom = pageData.get("hotelRoom") or {}

    # ① roomSummary（簡易情報）
    summary = hotelRoom.get("roomSummary") or []
    summary_map = {s["room_no"]: s for s in summary}

    # ② roomDetail（詳細情報）
    detail_blocks = hotelRoom.get("roomDetail") or []

    for block in detail_blocks:
        type_name = block.get("name")  # 例: "モデレート(禁煙)"
        rank_id = block.get("rank_id")
        details = block.get("detail") or []

        for r in details:
            room_no = r.get("room_no")

            # summary の情報をマージ
            summary_info = summary_map.get(room_no, {})

            rooms.append({
                "room_no": room_no,
                "room_name": r.get("name"),  # 例: "201"
                "type_name": type_name,      # 例: "モデレート(禁煙)"
                "rank_id": rank_id,
                "image": r.get("image") or summary_info.get("image"),
                "keep_flag": (
                    r["keep_flag"] if "keep_flag" in r
                    else summary_info.get("keep_flag")
                ),
            })

    return rooms


def extract_access_info(basic: dict) -> dict:
    """
    駅距離・地図情報を抽出する。
    実データ確認済み:
      - basic["nearest"]["station"] 例: "池袋駅から徒歩2分"
      - basic["map"]["lat"] / ["lon"]  ※ lng ではなく lon、値は文字列
      - basic["access"] は自由記述の長文（フォールバック用）
    """
    nearest = basic.get("nearest") or {}
    station_raw = nearest.get("station")  # 例: "池袋駅から徒歩2分"

    station_name, walk_min = None, None
    if station_raw:
        m = re.search(r"(.+?駅)(?:から)?(?:徒歩)?\s*(\d+)\s*分", station_raw)
        if m:
            station_name, walk_min = m.group(1), int(m.group(2))
        else:
            station_name = station_raw  # パターン外なら生文字列をそのまま使う

    map_info = basic.get("map") or {}
    lat = map_info.get("lat")
    lon = map_info.get("lon")

    map_url = None
    if lat and lon:
        map_url = f"https://www.google.com/maps?q={lat},{lon}"

    return {
        "stations": [{"station": station_name, "walk_min": walk_min}] if station_name else [],
        "latitude": lat,
        "longitude": lon,
        "map_url": map_url,
        "raw_access_text": basic.get("access"),  # 参考: 徒歩ルートの詳細説明文
    }


def extract_amenities(basic: dict, pageData: dict) -> dict:
    """
    設備・アメニティ情報を抽出する。
    実データ確認済み: basic["hotelEquipByKind"] は
      [{"name": "◆バス", "message": "ジェットバス/ブロアバス(一部), 露天風呂(一部), ..."}]
    という「カテゴリ名 + カンマ/スラッシュ区切りの説明文」の形。
    カテゴリごとに { カテゴリ名: [項目, ...] } の辞書にして返す。
    """
    groups = basic.get("hotelEquipByKind") or []
    result = {}
    for g in groups:
        if not isinstance(g, dict):
            continue
        category = (g.get("name") or "").lstrip("◆").strip()
        message = g.get("message") or ""
        if not category:
            continue
        # "／" "/" "、" "," で分割し、前後の空白・改行を除去
        items = [
            s.strip()
            for s in re.split(r"[、,／/\n]", message)
            if s.strip()
        ]
        if items:
            result[category] = items
    return result


def extract_review_info(basic: dict, pageData: dict) -> dict:
    """
    口コミ・評価スコアを抽出する。
    実データ確認済み: basic["kuchikomiAvgStr"]（文字列, 例 "4.5"）、
    basic["kuchikomiAllCount"]（件数, int）
    """
    score = basic.get("kuchikomiAvgStr")
    count = basic.get("kuchikomiAllCount")
    return {"score": score, "count": count}


def parse_stock_count(stock_text: str):
    """
    "あと3室" -> 3 / "満室" -> 0 / それ以外は None(不明) を返す。
    """
    if not stock_text:
        return None
    if "満室" in stock_text or "空きなし" in stock_text:
        return 0
    m = re.search(r"あと\s*(\d+)\s*室", stock_text)
    if m:
        return int(m.group(1))
    return None


def extract_vacancy_from_reserve_plans(pageData: dict) -> dict:
    """
    リアルタイム空室情報を抽出する。
    実データ確認済み: pageData["reservePlans"] は各プランの配列で、
      plan["stockText"] 例: "あと3室"
      plan["roomRanks"][i]["stockText"] 例: "あと1室"
    hotelRoom.roomSummary の keep_flag は「キープ機能対応可否」であり
    空室状況そのものではない可能性が高いため、こちらを優先して使う。
    """
    plans = pageData.get("reservePlans") or []
    details = []
    for plan in plans:
        if not isinstance(plan, dict):
            continue
        plan_name = plan.get("name")
        plan_type = plan.get("type")
        plan_stock_text = plan.get("stockText")
        plan_stock_count = parse_stock_count(plan_stock_text)

        room_ranks = plan.get("roomRanks") or []
        for rr in room_ranks:
            details.append({
                "plan_name": plan_name,
                "plan_type": plan_type,
                "room_rank_name": rr.get("name"),
                "stock_text": rr.get("stockText") or plan_stock_text,
                "stock_count": parse_stock_count(rr.get("stockText")) if rr.get("stockText") else plan_stock_count,
                "charge_text": rr.get("chargeText"),
            })
        if not room_ranks:
            details.append({
                "plan_name": plan_name,
                "plan_type": plan_type,
                "room_rank_name": None,
                "stock_text": plan_stock_text,
                "stock_count": plan_stock_count,
                "charge_text": plan.get("charges"),
            })

    counts = [d["stock_count"] for d in details if d["stock_count"] is not None]
    return {
        "details": details,
        "max_stock": max(counts) if counts else None,
        "has_vacancy": (max(counts) > 0) if counts else None,
    }


def get_hotel_detail(hotel_url):
    try:
        r = requests.get(hotel_url, headers=HEADERS, timeout=10)
        r.raise_for_status()
    except Exception as e:
        return {
            "id": None, "name": None, "address": None,
            "prices": [], "rooms": [],
            "access": {}, "amenities": {}, "review": {}, "vacancy": {},
            "error": f"request_error:{e}",
        }

    soup = BeautifulSoup(r.text, "html.parser")

    script_tag = soup.find("script", id="__NEXT_DATA__")
    if not script_tag:
        return {
            "id": None, "name": None, "address": None,
            "prices": [], "rooms": [],
            "access": {}, "amenities": {}, "review": {}, "vacancy": {},
            "error": "__NEXT_DATA__ missing",
        }

    try:
        data = json.loads(script_tag.string)
    except Exception as e:
        return {
            "id": None, "name": None, "address": None,
            "prices": [], "rooms": [],
            "access": {}, "amenities": {}, "review": {}, "vacancy": {},
            "error": f"json_load_error:{e}",
        }
    pageData = data.get("props", {}).get("pageProps", {}).get("pageData", {})

    basic = pageData.get("hotelBasicInfo") or {}
    prices = basic.get("hotelPricesKind", [])

    rooms = extract_room_info(pageData)

    access = extract_access_info(basic)
    amenities = extract_amenities(basic, pageData)
    review = extract_review_info(basic, pageData)
    vacancy = extract_vacancy_from_reserve_plans(pageData)

    return {
        "id": basic.get("hotelId"),
        "name": basic.get("hotelName"),
        "address": basic.get("address"),
        "prices": prices,
        "rooms": rooms,
        "access": access,
        "amenities": amenities,
        "review": review,
        "vacancy": vacancy,
    }

# -------------------------
# A → B 統合処理（一覧をページ送りで回して詳細を取得）
# -------------------------
def scrape_all_hotels_kodawari(pref_id: int, route_id: str, station_id: str, label: str, sleep_sec: float = 1.0):
    entries = get_list_pages_kodawari(pref_id, route_id, station_id, sleep_sec=sleep_sec)
    hotel_urls = build_hotel_urls_from_entries(entries)
    print(f"{label} の一覧で見つかったホテル数 (entries):", len(entries))
    print(f"{label} のホテルURL数:", len(hotel_urls))

    results = []
    failures = []

    for i, url in enumerate(hotel_urls, 1):
        print(f"[{i}/{len(hotel_urls)}] 取得中: {url}")
        detail = get_hotel_detail(url)
        if detail.get("error"):
            print("  → 失敗:", detail["error"])
            failures.append(detail)
            # placeholder を入れて件数を揃える
            results.append({
                "url": url,
                "id": detail.get("id"),
                "name": detail.get("name"),
                "address": detail.get("address"),
                "prices": detail.get("prices", []),
                "rooms": detail.get("rooms", []),
                "error": detail.get("error")
            })
        else:
            results.append(detail)
        sleep(sleep_sec)

    # 最新ファイルと履歴ファイルを保存
    generated_now = datetime.now().astimezone()
    generated_at = generated_now.isoformat(timespec="minutes")
    detail_payload = {
        "metadata": {
            "generatedAt": generated_at,
        },
        "hotels": results,
    }
    CURRENT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DATA_DIR.mkdir(parents=True, exist_ok=True)

    detail_filename = f"{label}_hotels_detail.json"
    failure_filename = f"{label}_hotels_failures.json"
    archive_timestamp = generated_now.strftime("%Y%m%d_%H%M%S")
    archive_detail_path = ARCHIVE_DATA_DIR / f"{label}_hotels_detail_{archive_timestamp}.json"
    archive_failure_path = ARCHIVE_DATA_DIR / f"{label}_hotels_failures_{archive_timestamp}.json"
    detail_path = CURRENT_DATA_DIR / detail_filename
    failure_path = CURRENT_DATA_DIR / failure_filename

    with open(detail_path, "w", encoding="utf-8") as f:
        json.dump(detail_payload, f, ensure_ascii=False, indent=2)
    with open(archive_detail_path, "w", encoding="utf-8") as f:
        json.dump(detail_payload, f, ensure_ascii=False, indent=2)
    if failures:
        with open(failure_path, "w", encoding="utf-8") as f:
            json.dump(failures, f, ensure_ascii=False, indent=2)
        with open(archive_failure_path, "w", encoding="utf-8") as f:
            json.dump(failures, f, ensure_ascii=False, indent=2)
    elif failure_path.exists():
        failure_path.unlink()

    append_vacancy_history(label, generated_at, results)
    cleanup_archive_detail_files()
    generate_station_manifest()

    print(f"保存完了: {CURRENT_DATA_DIR / detail_filename}")
    print(f"失敗件数: {len(failures)} (詳細は {label}_hotels_failures.json)")


def cleanup_archive_detail_files(now: datetime = None) -> None:
    """アーカイブの詳細 JSON を駅・日付・時間帯ごとの保持ルールで整理する。"""
    if now is None:
        now = datetime.now().astimezone().replace(tzinfo=None)
    else:
        now = now.replace(tzinfo=None)

    candidates = {}
    skipped = 0
    for path in ARCHIVE_DATA_DIR.glob("*_hotels_detail_*.json"):
        match = ARCHIVE_DETAIL_PATTERN.match(path.name)
        if not match:
            skipped += 1
            continue
        try:
            captured_at = datetime.strptime(
                f"{match.group('date')}_{match.group('time')}", "%Y%m%d_%H%M%S"
            )
        except ValueError:
            skipped += 1
            continue

        age_days = (now.date() - captured_at.date()).days
        if age_days < 0 or age_days <= 2:
            continue
        if age_days <= 7:
            allowed_hours = {0, 9, 12, 15, 18, 21}
        elif age_days <= 30:
            allowed_hours = {0, 12, 18}
        else:
            path.unlink()
            continue

        if captured_at.hour not in allowed_hours:
            path.unlink()
            continue

        slot = (match.group("label"), captured_at.date(), captured_at.hour)
        candidates.setdefault(slot, []).append((captured_at, path))

    removed = 0
    for paths in candidates.values():
        for _, path in sorted(paths, reverse=True)[1:]:
            path.unlink()
            removed += 1

    print(f"アーカイブ掃除完了: 削除{removed}件、判定対象外{skipped}件")


def _build_vacancy_snapshot_hotels(hotels: list) -> list:
    """
    ホテル一覧(detail JSON の "hotels" 相当)から、空室状況だけを
    抜き出した軽量なサマリーのリストを作る。
    append_vacancy_history（毎回の追記）と
    migrate_vacancy_history_from_archive（過去分の一括移行）の両方で使う。
    """
    snapshot_hotels = []
    for hotel in hotels:
        vacancy = hotel.get("vacancy") or {}
        details = vacancy.get("details") or []
        # 満室(stock_countがNone)の部屋は推移を見るうえでノイズになるだけなので除外する
        available = [d for d in details if d.get("stock_count") is not None]
        snapshot_hotels.append({
            "name": hotel.get("name"),
            "hasVacancy": vacancy.get("has_vacancy"),
            "maxStock": vacancy.get("max_stock"),
            "totalStock": sum(d.get("stock_count") or 0 for d in available),
            "plans": [
                {
                    "planName": d.get("plan_name"),
                    "planType": d.get("plan_type"),
                    "roomRankName": d.get("room_rank_name"),
                    "stockCount": d.get("stock_count"),
                }
                for d in available
            ],
        })
    return snapshot_hotels


def append_vacancy_history(label: str, generated_at: str, hotels: list) -> None:
    """
    空室状況（stock_count）だけを抜き出した軽量な履歴を追記する。
    フルの detail JSON は毎回のスナップショットが数百KB〜MB単位になり得るが、
    「動きのある空室状況の推移だけ見たい」という用途には情報過多なため、
    別ファイルに必要最小限のサマリーだけを積み重ねていく。

    形式: data/archive/{label}_vacancy_history.json
    [
      {
        "generatedAt": "2026-08-26T10:00",
        "hotels": [
          {
            "name": "...",
            "hasVacancy": true,
            "maxStock": 3,
            "totalStock": 5,
            "plans": [
              {"planName": "...", "planType": "休憩", "roomRankName": "...", "stockCount": 1}
            ]
          }
        ]
      },
      ...
    ]
    """
    ARCHIVE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    history_path = ARCHIVE_DATA_DIR / f"{label}_vacancy_history.json"

    if history_path.exists():
        with history_path.open(encoding="utf-8-sig") as f:
            try:
                history = json.load(f)
            except json.JSONDecodeError:
                history = []
    else:
        history = []

    snapshot_hotels = _build_vacancy_snapshot_hotels(hotels)

    history.append({
        "generatedAt": generated_at,
        "hotels": snapshot_hotels,
    })

    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"空室履歴を追記: {history_path}（累計{len(history)}件のスナップショット）")


def migrate_vacancy_history_from_archive(label: str) -> None:
    """
    既に data/archive/ に溜まっている過去の
    {label}_hotels_detail_{timestamp}.json 群から、
    vacancy_history.json を作り直す（移行用）。

    vacancy_history.json の仕組みを追加する前からスクレイピングを
    続けていた場合、それ以前の分の推移が空白になってしまうため、
    既存のアーカイブファイルを読み直して遡って埋める。

    既存の vacancy_history.json があれば上書きする
    （アーカイブに残っている全期間で作り直すため）。
    """
    pattern = f"{label}_hotels_detail_*.json"
    paths = sorted(ARCHIVE_DATA_DIR.glob(pattern))
    if not paths:
        print(f"{label}: 移行対象のアーカイブファイルが見つかりません（{ARCHIVE_DATA_DIR / pattern}）")
        return

    history = []
    skipped = 0
    for path in paths:
        with path.open(encoding="utf-8-sig") as f:
            try:
                payload = json.load(f)
            except json.JSONDecodeError:
                print(f"  スキップ（JSON解析エラー）: {path.name}")
                skipped += 1
                continue

        hotels = payload.get("hotels") if isinstance(payload, dict) else payload
        if not isinstance(hotels, list):
            print(f"  スキップ（hotels配列が見つからない）: {path.name}")
            skipped += 1
            continue

        metadata = payload.get("metadata", {}) if isinstance(payload, dict) else {}
        generated_at = metadata.get("generatedAt")
        if not generated_at:
            # 古い形式のファイルには metadata が無いことがあるため、
            # ファイル名末尾のタイムスタンプ（例: ..._detail_20260826_100236.json）
            # から復元する。それも無理なら、ファイル自体の更新日時を使う。
            m = re.search(r"_(\d{8}_\d{6})\.json$", path.name)
            if m:
                generated_at = datetime.strptime(m.group(1), "%Y%m%d_%H%M%S").isoformat(timespec="minutes")
            else:
                generated_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="minutes")

        history.append({
            "generatedAt": generated_at,
            "hotels": _build_vacancy_snapshot_hotels(hotels),
        })
        print(f"  取り込み: {path.name} -> {generated_at}")

    history_path = ARCHIVE_DATA_DIR / f"{label}_vacancy_history.json"
    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(
        f"{label}: アーカイブ{len(paths)}件中{len(history)}件を取り込み"
        f"（スキップ{skipped}件） -> {history_path}"
    )


def generate_station_manifest() -> None:
    """詳細 JSON の一覧と JSON 内の生成日時を HTML 用に保存する。"""
    label_by_key = {key: config["label"] for key, config in STATION_CONFIGS.items()}
    stations = []
    for path in sorted(CURRENT_DATA_DIR.glob("*_hotels_detail.json")):
        label = path.name.removesuffix("_hotels_detail.json")
        key = next((k for k, value in label_by_key.items() if value == label), label)
        with path.open(encoding="utf-8-sig") as f:
            payload = json.load(f)
        metadata = payload.get("metadata", {}) if isinstance(payload, dict) else {}
        history_path = ARCHIVE_DATA_DIR / f"{label}_vacancy_history.json"
        stations.append({
            "key": key,
            "label": label,
            "file": path.as_posix(),
            "updatedAt": metadata.get("generatedAt"),
            "vacancyHistoryFile": history_path.as_posix() if history_path.exists() else None,
        })

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(DATA_DIR / "hotel_data_manifest.json", "w", encoding="utf-8") as f:
        json.dump(stations, f, ensure_ascii=False, indent=2)
    print("マニフェスト更新: hotel_data_manifest.json")

# -------------------------
# 実行（池袋の例）
# -------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HappyHotelの駅周辺ホテルを取得します")
    parser.add_argument(
        "--station",
        choices=list(STATION_CONFIGS) + ["all"],
        default="ikebukuro",
        help="取得対象の駅（既定値: ikebukuro）。'all' を指定すると全駅を順番に処理する",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=1.0,
        help="リクエスト間隔（秒、既定値: 1.0）",
    )
    parser.add_argument(
        "--station-sleep",
        type=float,
        default=5.0,
        help="--station all のとき、駅と駅の間に空ける間隔（秒、既定値: 5.0）",
    )
    parser.add_argument(
        "--migrate-vacancy-history",
        action="store_true",
        help=(
            "スクレイピングを実行せず、既に data/archive/ にある過去の detail JSON から "
            "vacancy_history.json を作り直す（--station で対象駅を指定、既定はall扱いで全駅）"
        ),
    )
    parser.add_argument(
        "--cleanup-archive",
        action="store_true",
        help="スクレイピングを実行せず、data/archive/ の詳細 JSON を保持ルールで掃除する",
    )
    args = parser.parse_args()

    if args.cleanup_archive:
        cleanup_archive_detail_files()
    elif args.migrate_vacancy_history:
        targets = (
            list(STATION_CONFIGS.values())
            if args.station == "all"
            else [STATION_CONFIGS[args.station]]
        )
        for station in targets:
            print(f"\n===== {station['label']} の空室履歴を移行 =====")
            migrate_vacancy_history_from_archive(station["label"])
        generate_station_manifest()
    elif args.station == "all":
        station_items = list(STATION_CONFIGS.items())
        for i, (key, station) in enumerate(station_items, 1):
            print(f"\n===== [{i}/{len(station_items)}] {station['label']} の取得を開始 =====")
            scrape_all_hotels_kodawari(
                pref_id=station["pref_id"],
                route_id=station["route_id"],
                station_id=station["station_id"],
                label=station["label"],
                sleep_sec=args.sleep,
            )
            # 最後の駅の後は待たない
            if i < len(station_items):
                sleep(args.station_sleep)
        print(f"\n===== 全{len(station_items)}駅の取得が完了しました =====")
    else:
        station = STATION_CONFIGS[args.station]
        scrape_all_hotels_kodawari(
            pref_id=station["pref_id"],
            route_id=station["route_id"],
            station_id=station["station_id"],
            label=station["label"],
            sleep_sec=args.sleep,
        )
