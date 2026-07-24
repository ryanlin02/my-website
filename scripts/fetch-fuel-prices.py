#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自動抓取台灣中油與台塑石油最新公告油價腳本
功能：
1. 從公開油價資料庫/網站抓取最新 92, 95, 98 無鉛汽油與超級柴油單價。
2. 更新專案根目錄下的 data/fuel-prices.json 檔案。
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

# 台灣時區 UTC+8
TAIWAN_TZ = timezone(timedelta(hours=8))

# 定義檔案路徑
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_FILE = os.path.join(PROJECT_ROOT, "data", "fuel-prices.json")

def load_existing_data():
    """載入現有的 JSON 檔案，作為 fallback 備用資料"""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"無法讀取既有 JSON 檔: {e}")
    return {
        "updatedAt": datetime.now(TAIWAN_TZ).isoformat(),
        "updatedDateStr": datetime.now(TAIWAN_TZ).strftime("%Y/%m/%d %H:%M"),
        "prices": {
            "cpc": {
                "name": "台灣中油",
                "diesel": 31.0,
                "unleaded92": 29.8,
                "unleaded95": 31.3,
                "unleaded98": 33.3
            },
            "formosa": {
                "name": "台塑石油",
                "diesel": 30.8,
                "unleaded92": 29.8,
                "unleaded95": 31.3,
                "unleaded98": 33.3
            }
        }
    }

def fetch_gas_prices():
    """抓取最新油價"""
    url = "https://gas.goodlife.tw/"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    )
    
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"網絡請求失敗: {e}")
        return None

    def parse_block(block_name):
        pattern = r'<h2>' + block_name + r'</h2>\s*<ul>(.*?)</ul>'
        match = re.search(pattern, html, re.DOTALL)
        if not match:
            return None
        ul_content = match.group(1)
        items = re.findall(r'<h3>([^:<]+)[^<]*:</h3>\s*([\d\.]+)', ul_content)
        parsed = {}
        for name, price in items:
            name = name.strip()
            val = float(price)
            if '92' in name:
                parsed['unleaded92'] = val
            elif '95' in name:
                parsed['unleaded95'] = val
            elif '98' in name:
                parsed['unleaded98'] = val
            elif '柴' in name:
                parsed['diesel'] = val
        return parsed if len(parsed) >= 3 else None

    cpc_prices = parse_block("今日中油油價")
    formosa_prices = parse_block("今日台塑油價")

    if not cpc_prices or not formosa_prices:
        print("解析油價資料失敗或資料不完整")
        return None

    return {
        "cpc": cpc_prices,
        "formosa": formosa_prices
    }

def main():
    print("=== 開始抓取本週油價資料 ===")
    existing_data = load_existing_data()
    fetched = fetch_gas_prices()

    now = datetime.now(TAIWAN_TZ)
    date_str = now.strftime("%Y/%m/%d %H:%M")
    iso_str = now.isoformat()

    if fetched:
        print(f"成功擷取中油油價: {fetched['cpc']}")
        print(f"成功擷取台塑油價: {fetched['formosa']}")
        
        # 更新內部結構
        existing_data["updatedAt"] = iso_str
        existing_data["updatedDateStr"] = date_str
        
        for key in ["diesel", "unleaded92", "unleaded95", "unleaded98"]:
            if key in fetched["cpc"]:
                existing_data["prices"]["cpc"][key] = fetched["cpc"][key]
            if key in fetched["formosa"]:
                existing_data["prices"]["formosa"][key] = fetched["formosa"][key]
    else:
        print("將使用既有資料保持系統穩定")

    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)

    print(f"成功寫入 {DATA_FILE}")
    print("=== 完成 ===")

if __name__ == "__main__":
    main()
