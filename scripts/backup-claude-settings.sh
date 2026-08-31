#!/usr/bin/env bash
# Claude Code 설정 이전용 백업 스크립트
#
# 새 컴퓨터로 옮길 것만 골라 담는다.
# 자격증명(.credentials.json)·세션 기록·캐시·플러그인은 제외한다
#  - 자격증명: 새 PC에서 /login으로 재발급받는 것이 안전하다(토큰 복사 금지)
#  - 세션/캐시/플러그인(약 59MB): 새 PC에서 자동 재생성된다

set -euo pipefail

SRC="$HOME/.claude"

# 바탕화면 위치 자동 탐지
#  OneDrive로 바탕화면을 동기화하는 PC는 ~/Desktop이 아예 없고 ~/OneDrive/Desktop이 진짜다.
#  이걸 구분하지 않으면 눈에 안 보이는 새 폴더에 백업이 만들어진다.
if [ -d "$HOME/Desktop" ]; then
  DEFAULT_DEST="$HOME/Desktop/claude-settings-backup"
elif [ -d "$HOME/OneDrive/Desktop" ]; then
  DEFAULT_DEST="$HOME/OneDrive/Desktop/claude-settings-backup"
else
  DEFAULT_DEST="$HOME/claude-settings-backup"
fi

DEST="${1:-$DEFAULT_DEST}"

echo "백업 대상: $SRC"
echo "저장 위치: $DEST"
echo "----------------------------------------"

mkdir -p "$DEST"

# [1] 전역 설정 파일 (개별 파일)
#     CLAUDE.md=전역 지침 / settings.json=권한·모델·상태줄 / keybindings.json=단축키
for f in CLAUDE.md settings.json keybindings.json statusline-command.sh; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$DEST/"
    echo "  [파일] $f"
  fi
done

# [2] 전역 서브에이전트·출력 스타일 (폴더 통째로)
for d in agents output-styles; do
  if [ -d "$SRC/$d" ]; then
    mkdir -p "$DEST/$d"
    cp -r "$SRC/$d/." "$DEST/$d/"
    echo "  [폴더] $d/ ($(ls "$SRC/$d" | wc -l)개)"
  fi
done

# [3] 프로젝트별 메모리 — 가장 중요한 자산
#     대화 기록(.jsonl)은 빼고 memory 폴더만 담는다(44MB → 320KB)
if [ -d "$SRC/projects" ]; then
  for projdir in "$SRC/projects"/*/; do
    proj="$(basename "$projdir")"
    if [ -d "$projdir/memory" ]; then
      mkdir -p "$DEST/projects/$proj/memory"
      cp -r "$projdir/memory/." "$DEST/projects/$proj/memory/"
      echo "  [메모리] $proj ($(ls "$projdir/memory" | wc -l)개 파일)"
    fi
  done
fi

# [4] 프로젝트 안의 gitignore된 설정 파일
#     클론해도 안 따라오지만 시크릿은 아닌 것들만 담는다.
#     .env.local(API 키)·.auth/(세션 쿠키)는 의도적으로 제외한다
PROJ_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$DEST/project-local"

for item in .mcp.json AGENTS.md .codex .agents; do
  if [ -e "$PROJ_ROOT/$item" ]; then
    cp -r "$PROJ_ROOT/$item" "$DEST/project-local/"
    echo "  [프로젝트] $item"
  fi
done

echo "----------------------------------------"
echo "완료. 총 용량: $(du -sh "$DEST" | cut -f1)"
echo ""
echo "⚠️  이 백업에 포함되지 않은 것 (직접 챙길 것):"
echo "    - .env.local        API 키 6개. USB나 비밀번호 관리자로 별도 이동"
echo "    - ~/.claude/.credentials.json  로그인 토큰. 새 PC에서 /login 재실행"
echo "    - mcp-shrimp-task-manager/     저장소 밖 서드파티 도구(WorkSpace 폴더)"
echo ""
echo "이 폴더를 USB·클라우드로 새 컴퓨터에 옮기고,"
echo "docs/SETUP_NEW_MACHINE.md 의 복원 절차를 따르세요."
