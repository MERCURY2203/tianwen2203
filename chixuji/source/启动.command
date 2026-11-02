#!/bin/bash
# 小手机启动脚本（Mac）。关闭这个窗口 = 停止运行
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  没有找到 Node.js。请先安装 Node.js（https://nodejs.org 的 LTS 版本），然后重新双击本文件。"
  read -p "  按回车关闭…"
  exit 1
fi
node --no-warnings=ExperimentalWarning server/launch.mjs
