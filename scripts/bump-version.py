#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
版本號自動遞增腳本

規則：每次執行 +0.01，例如 4.24 → 4.25 → ... → 4.99 → 5.00 → 5.01

【為什麼用整數運算】
如果直接用小數相加（4.24 + 0.01），電腦的浮點數會產生
4.250000000000001 這種誤差。所以改成先乘 100 變整數
（424 + 1 = 425），再除回來顯示成 4.25，保證永遠精準。

同步更新兩個檔案：
  - sw.js         的 CACHE_VERSION（決定手機會不會拿到新版）
  - manifest.json 的 version（保持一致，避免又出現三個版本號互相矛盾）
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW_FILE = os.path.join(ROOT, "sw.js")
MANIFEST_FILE = os.path.join(ROOT, "manifest.json")

# 比對 sw.js 裡的版本號那一行
SW_PATTERN = re.compile(r"(const\s+CACHE_VERSION\s*=\s*')([0-9]+\.[0-9]{2})(')")


def read_current_version():
    """從 sw.js 讀出目前版本號"""
    with open(SW_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    match = SW_PATTERN.search(content)
    if not match:
        print("錯誤：在 sw.js 找不到 CACHE_VERSION，格式應為 const CACHE_VERSION = '4.24';")
        sys.exit(1)

    return content, match.group(2)


def bump(version_str):
    """
    版本號 +0.01（用整數運算避免浮點誤差）

    '4.24' → 424 → 425 → '4.25'
    '4.99' → 499 → 500 → '5.00'
    """
    major, minor = version_str.split(".")
    total = int(major) * 100 + int(minor) + 1
    return "{}.{:02d}".format(total // 100, total % 100)


def update_sw(content, old_version, new_version):
    """改寫 sw.js 的版本號"""
    updated = SW_PATTERN.sub(
        lambda m: m.group(1) + new_version + m.group(3),
        content,
        count=1,
    )
    with open(SW_FILE, "w", encoding="utf-8") as f:
        f.write(updated)
    print("已更新 sw.js：{} → {}".format(old_version, new_version))


def update_manifest(new_version):
    """同步更新 manifest.json 的版本號"""
    if not os.path.exists(MANIFEST_FILE):
        print("略過 manifest.json（檔案不存在）")
        return

    try:
        with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        data["version"] = new_version

        with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
            f.write("\n")

        print("已同步 manifest.json 版本號為 {}".format(new_version))
    except (ValueError, OSError) as err:
        # manifest 更新失敗不應該中斷流程，sw.js 才是關鍵
        print("警告：manifest.json 更新失敗（不影響更新機制）：{}".format(err))


def main():
    content, current = read_current_version()
    new_version = bump(current)

    update_sw(content, current, new_version)
    update_manifest(new_version)

    # 讓 GitHub Actions 後續步驟可以取用新版本號
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as f:
            f.write("new_version={}\n".format(new_version))

    print("=== 版本號更新完成：{} ===".format(new_version))


if __name__ == "__main__":
    main()
