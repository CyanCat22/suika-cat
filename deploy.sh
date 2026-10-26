#!/usr/bin/env bash
# 一键发布到 GitHub Pages（需要先 gh auth login 一次）
#   ./deploy.sh                       # 默认 CyanCat22/suika-cat
#   OWNER=xxx REPO=yyy ./deploy.sh     # 换成别的账号/仓库名
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$PATH"

OWNER="${OWNER:-CyanCat22}"
REPO="${REPO:-suika-cat}"
BRANCH="main"
URL="https://${OWNER}.github.io/${REPO}/"

if ! command -v gh >/dev/null 2>&1; then
  echo "✗ 找不到 gh（GitHub CLI）：brew install gh"; exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "✗ 还没登录 GitHub，先执行： gh auth login"; exit 1
fi

if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
  echo "→ 仓库已存在，推送最新提交"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/${OWNER}/${REPO}.git"
  git push -u origin "${BRANCH}"
else
  echo "→ 创建仓库 ${OWNER}/${REPO} 并推送"
  gh repo create "${OWNER}/${REPO}" --public --source . --remote origin --push \
    --description "合成大猫咪 · 竖屏 H5 猫咪合成小游戏（纯前端零依赖，为小红书录屏/分享设计）"
fi

echo "→ 开启 GitHub Pages"
echo '{"source":{"branch":"'"${BRANCH}"'","path":"/"}}' \
  | gh api -X POST "repos/${OWNER}/${REPO}/pages" --input - >/dev/null 2>&1 \
  || echo '{"source":{"branch":"'"${BRANCH}"'","path":"/"}}' \
     | gh api -X PUT "repos/${OWNER}/${REPO}/pages" --input - >/dev/null

for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${URL}" || true)
  echo "  第 ${i} 次探测：HTTP ${code}"
  if [ "${code}" = "200" ]; then
    echo "✓ 已上线：${URL}"
    exit 0
  fi
  sleep 10
done
echo "…Pages 还在构建，稍后打开：${URL}"
