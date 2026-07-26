#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
建立「統一編號 → 營業人名稱」離線索引

【為什麼要這樣做】
政府的統編查詢 API 沒有回傳 CORS 標頭，瀏覽器會擋掉跨網域請求，
純靜態網站（GitHub Pages）無論怎麼寫都呼叫不到。
解法是把資料「事先」下載好、切成小檔放進本專案，
使用者輸入統編時只載入對應的那一個小檔，在手機端本地比對。

好處：
  1. 完全不需要後端伺服器，零費用
  2. 查詢是本地比對，比呼叫 API 還快（沒有網路來回）
  3. 查過的分片會被 Service Worker 快取，收訊差也能用

資料來源：財政部財政資訊中心「全國營業(稅籍)登記資料集」
  https://data.gov.tw/dataset/9400
  授權：政府資料開放授權條款-第1版（免費、可再利用）
  內容：僅涵蓋「營業中」的營業人，含公司、行號、獨資合夥，
        比經濟部的公司登記資料涵蓋更廣（行號也開得了發票）。

輸出：
  data/taxid/meta.json      索引後設資料（更新時間、筆數、分片規則）
  data/taxid/<前3碼>.json   分片檔，內容為 { "後5碼": "營業人名稱" }

用法：
  python3 scripts/build-taxid-index.py            # 正式下載並建置
  python3 scripts/build-taxid-index.py --self-test  # 用內建假資料驗證邏輯
"""

import csv
import io
import json
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone

TAIWAN_TZ = timezone(timedelta(hours=8))

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUT_DIR = os.path.join(PROJECT_ROOT, "data", "taxid")

# 財政部提供 zip 與 csv 兩種，優先抓 zip（體積小很多、下載快）
ZIP_URL = "https://eip.fia.gov.tw/data/BGMOPEN1.zip"
CSV_URL = "https://eip.fia.gov.tw/data/BGMOPEN1.csv"

# 分片規則：用統編前 3 碼當檔名，剩下 5 碼當 key。
# 為什麼是 3？1000 個分片、每片約 1600 筆、壓縮後約 10KB，
# 手機在 4G 下幾乎是瞬間載入。切太少檔案會太大，切太多則檔案數量難管理。
PREFIX_LEN = 3

# 低於這個筆數視為來源資料異常（例如對方回傳錯誤頁面），
# 直接中止並保留舊資料，避免把好好的索引覆蓋成垃圾。
MIN_EXPECTED_ROWS = 500_000

# CSV 欄位名稱可能因為來源微調而變動，這裡列出可接受的別名
TAXID_FIELDS = ("統一編號", "統編")
NAME_FIELDS = ("營業人名稱", "營業人名稱 ", "公司名稱", "名稱")


def log(msg):
    print(msg, flush=True)


def download_source():
    """下載原始資料，回傳解碼後的 CSV 文字內容"""
    try:
        log(f"下載壓縮檔：{ZIP_URL}")
        raw = urllib.request.urlopen(ZIP_URL, timeout=600).read()
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            member = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
            log(f"解壓縮：{member}")
            data = zf.read(member)
    except Exception as e:
        log(f"壓縮檔下載失敗（{e}），改抓未壓縮 CSV：{CSV_URL}")
        data = urllib.request.urlopen(CSV_URL, timeout=900).read()

    log(f"原始資料大小：{len(data) / 1024 / 1024:.1f} MB")
    return decode(data)


def decode(data):
    """財政部資料通常是 UTF-8（可能含 BOM），少數情況會是 Big5"""
    for enc in ("utf-8-sig", "utf-8", "cp950", "big5"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    # 全部失敗就用 UTF-8 忽略壞字元，總比整個掛掉好
    return data.decode("utf-8", errors="ignore")


def pick_column(fieldnames, candidates):
    """在 CSV 標頭中找出想要的欄位（容忍前後空白）"""
    normalized = {(f or "").strip(): f for f in fieldnames}
    for c in candidates:
        if c in normalized:
            return normalized[c]
    return None


def parse(text):
    """把 CSV 文字轉成 { 統編: 名稱 } 字典"""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise SystemExit("錯誤：CSV 沒有標頭列，來源資料可能有問題")

    col_id = pick_column(reader.fieldnames, TAXID_FIELDS)
    col_name = pick_column(reader.fieldnames, NAME_FIELDS)
    if not col_id or not col_name:
        raise SystemExit(
            f"錯誤：找不到統編或名稱欄位。實際標頭為：{reader.fieldnames}"
        )
    log(f"使用欄位：統編={col_id!r}　名稱={col_name!r}")

    table = {}
    skipped = 0
    for row in reader:
        tid = (row.get(col_id) or "").strip()
        name = (row.get(col_name) or "").strip()
        # 統編一律 8 碼純數字；名稱空白的略過（極少數殘缺資料）
        if len(tid) != 8 or not tid.isdigit() or not name:
            skipped += 1
            continue
        # 同一統編若出現多列，保留第一筆即可（後續多為分支或行業別重複列）
        table.setdefault(tid, name)

    log(f"解析完成：有效 {len(table):,} 筆，略過 {skipped:,} 筆")
    return table


def write_shards(table, out_dir=None):
    """依統編前 3 碼切檔寫出"""
    out_dir = out_dir or OUT_DIR
    shards = {}
    for tid, name in table.items():
        shards.setdefault(tid[:PREFIX_LEN], {})[tid[PREFIX_LEN:]] = name

    # 整個資料夾重建，避免上次產出的孤兒檔案留著誤導查詢
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    total_bytes = 0
    for prefix, mapping in shards.items():
        path = os.path.join(out_dir, f"{prefix}.json")
        # separators 去掉多餘空白，ensure_ascii=False 讓中文直接存原字
        # （UTF-8 中文 3 bytes，比 \uXXXX 的 6 bytes 省一半）
        blob = json.dumps(mapping, ensure_ascii=False, separators=(",", ":"))
        with open(path, "w", encoding="utf-8") as f:
            f.write(blob)
        total_bytes += len(blob.encode("utf-8"))

    now = datetime.now(TAIWAN_TZ)
    meta = {
        "updatedAt": now.isoformat(),
        "updatedDateStr": now.strftime("%Y/%m/%d"),
        "count": len(table),
        "shards": len(shards),
        "prefixLen": PREFIX_LEN,
        "source": "財政部財政資訊中心 - 全國營業(稅籍)登記資料集",
        "sourceUrl": "https://data.gov.tw/dataset/9400",
        "license": "政府資料開放授權條款-第1版",
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    log(
        f"寫出 {len(shards)} 個分片，合計 {total_bytes / 1024 / 1024:.1f} MB"
        f"（平均每片 {total_bytes / max(len(shards), 1) / 1024:.0f} KB，"
        f"經 GitHub Pages gzip 後實際傳輸約為此的 1/3）"
    )
    return meta


def self_test():
    """不連網，用假資料驗證解析與分片邏輯是否正確"""
    log("=== 自我測試（不連網）===")
    sample = (
        "﻿營業地址,統一編號,總機構統一編號,營業人名稱,資本額,設立日期,組織別名稱\n"
        "桃園市桃園區興華路21巷1號,16003518,,宏達國際電子股份有限公司,10000000000,0860515,股份有限公司\n"
        "台北市信義區,04595257,,台灣積體電路製造股份有限公司,1000,0700221,股份有限公司\n"
        '高雄市,12345675,,"大順運輸行, 第一分店",500,1000101,獨資\n'
        "台中市,123,,統編太短應被略過,1,1,獨資\n"
        "台南市,16003518,,重複統編應只留第一筆,1,1,獨資\n"
        "新竹市,53212539,,,1,1,獨資\n"
    )
    table = parse(sample)
    assert table["16003518"] == "宏達國際電子股份有限公司", "重複統編應保留第一筆"
    assert table["04595257"] == "台灣積體電路製造股份有限公司", "前導 0 的統編要保住"
    assert table["12345675"] == "大順運輸行, 第一分店", "名稱含逗號要正確處理"
    assert "123" not in table, "非 8 碼統編應被略過"
    assert "53212539" not in table, "名稱空白應被略過"
    assert len(table) == 3, f"預期 3 筆，實得 {len(table)}"

    # 寫進系統暫存目錄，絕對不碰 data/taxid/，避免假資料汙染正式索引
    tmp = tempfile.mkdtemp(prefix="taxid-selftest-")
    try:
        write_shards(table, out_dir=os.path.join(tmp, "taxid"))
        base = os.path.join(tmp, "taxid")
        with open(os.path.join(base, "160.json"), encoding="utf-8") as f:
            assert json.load(f)["03518"] == "宏達國際電子股份有限公司", "分片切法錯誤"
        with open(os.path.join(base, "045.json"), encoding="utf-8") as f:
            assert json.load(f)["95257"] == "台灣積體電路製造股份有限公司"
        with open(os.path.join(base, "meta.json"), encoding="utf-8") as f:
            assert json.load(f)["prefixLen"] == PREFIX_LEN
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    log("✅ 全部通過，解析與分片邏輯正確")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return

    text = download_source()
    table = parse(text)

    if len(table) < MIN_EXPECTED_ROWS:
        raise SystemExit(
            f"錯誤：只解析到 {len(table):,} 筆，遠低於預期的 {MIN_EXPECTED_ROWS:,} 筆。\n"
            "來源資料可能異常，本次不覆蓋既有索引。"
        )

    meta = write_shards(table)
    log(f"✅ 完成，共 {meta['count']:,} 筆，資料日期 {meta['updatedDateStr']}")


if __name__ == "__main__":
    main()
