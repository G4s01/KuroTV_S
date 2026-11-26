#!/usr/bin/env bash
# ==============================================================================
# KuroTV_S — Verified Git Release & GitHub Push Script
# ==============================================================================
# Runs validation checks (typecheck, build, test), stages changes, commits,
# and pushes to GitHub (origin). Optionally deploys to Cloudflare Workers.
# ==============================================================================

set -euo pipefail

# ── ANSI Colors ──────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[1;33m'
  CYAN=$'\033[0;36m'
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  NC=$'\033[0m'
else
  RED=""
  GREEN=""
  YELLOW=""
  CYAN=""
  BOLD=""
  DIM=""
  NC=""
fi

# ── Project Root Resolution ──────────────────────────────────────────────────
CALL_DIR="$(pwd)"
SRC_PATH="${BASH_SOURCE[0]:-}"
while [ -L "${SRC_PATH}" ] && [[ "${SRC_PATH}" != /dev/fd/* ]]; do
  DIR="$(cd -P "$(dirname "${SRC_PATH}")" 2>/dev/null && pwd || echo "${CALL_DIR}")"
  TARGET="$(readlink "${SRC_PATH}" 2>/dev/null || echo "")"
  [ -z "${TARGET}" ] && break
  [[ "${TARGET}" != /* ]] && TARGET="${DIR}/${TARGET}"
  SRC_PATH="${TARGET}"
done
SCRIPT_DIR="$(cd -P "$(dirname "${SRC_PATH}")" 2>/dev/null && pwd || echo "${CALL_DIR}")"

if [ -f "${SCRIPT_DIR}/package.json" ] && [ -f "${SCRIPT_DIR}/wrangler.jsonc" ]; then
  ROOT_DIR="${SCRIPT_DIR}"
elif [ -f "${CALL_DIR}/package.json" ] && [ -f "${CALL_DIR}/wrangler.jsonc" ]; then
  ROOT_DIR="${CALL_DIR}"
else
  echo -e "${RED}Errore:${NC} Impossibile individuare la root del progetto KuroTV_S." >&2
  exit 1
fi
cd "${ROOT_DIR}"

# ── Defaults & CLI Args ──────────────────────────────────────────────────────
COMMIT_MESSAGE=""
SKIP_CHECKS=false
DO_PUSH=true
DO_DEPLOY=false
DRY_RUN=false
AUTO_YES=false

usage() {
  cat <<EOF
${BOLD}Uso:${NC} ./release.sh [opzioni]

${BOLD}Opzioni:${NC}
  -m, --message <msg>   Messaggio di commit (se omesso viene richiesto interattivamente)
  --skip-checks         Salta typecheck, build e test
  --no-push             Crea il commit locale senza eseguire git push verso GitHub
  --deploy              Esegue 'npm run deploy' dopo il push (migrazioni D1 remote + deploy Worker)
  --dry-run             Esegue eventuali verifiche e mostra cosa verrebbe committato/pushato senza modificare git
  -y, --yes             Salta i prompt di conferma interattivi
  -h, --help            Mostra questo aiuto
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      if [[ $# -lt 2 ]]; then
        echo -e "${RED}Errore:${NC} --message richiede un argomento." >&2
        exit 1
      fi
      COMMIT_MESSAGE="$2"
      shift 2
      ;;
    --skip-checks)
      SKIP_CHECKS=true
      shift
      ;;
    --no-push)
      DO_PUSH=false
      shift
      ;;
    --deploy)
      DO_DEPLOY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -y|--yes)
      AUTO_YES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo -e "${RED}Opzione sconosciuta:${NC} $1" >&2
      usage
      exit 1
      ;;
  esac
done

log_step() {
  echo -e "\n${CYAN}▸${NC} ${BOLD}$1${NC}"
}

log_ok() {
  echo -e "${GREEN}✔${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_err() {
  echo -e "${RED}✖${NC} $1" >&2
}

confirm_or_exit() {
  local prompt="$1"
  if [[ "${AUTO_YES}" == "true" ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    log_err "Input non interattivo: passa -y/--yes e -m/--message per procedere senza prompt."
    exit 1
  fi
  read -r -p "${prompt} [y/N] " reply
  case "${reply}" in
    [yY]|[yY][eE][sS]|[sS]) return 0 ;;
    *)
      log_warn "Operazione annullata dall'utente."
      exit 0
      ;;
  esac
}

# ── Pre-flight Git Checks ────────────────────────────────────────────────────
log_step "Verifica repository Git"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log_err "La directory corrente non è un repository Git."
  exit 1
fi

BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
if [[ -z "${BRANCH}" ]]; then
  log_err "HEAD scollegato (detached HEAD). Posizionati su un branch prima di rilasciare."
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  log_err "Remote 'origin' non configurato."
  exit 1
fi

ORIGIN_URL="$(git remote get-url origin)"
echo -e "  Branch: ${BOLD}${BRANCH}${NC}"
echo -e "  Remote: ${DIM}${ORIGIN_URL}${NC}"

STATUS_OUTPUT="$(git status --porcelain)"
AHEAD_COUNT=0
if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
  AHEAD_COUNT="$(git rev-list --count "@{u}..HEAD")"
fi

if [[ -z "${STATUS_OUTPUT}" ]]; then
  if [[ "${AHEAD_COUNT}" -gt 0 ]] && [[ "${DO_PUSH}" == "true" ]]; then
    log_warn "Working tree pulito, ma ci sono ${AHEAD_COUNT} commit locali non ancora pushati su origin/${BRANCH}."
    if [[ "${DRY_RUN}" == "true" ]]; then
      log_ok "[dry-run] Verrebbe eseguito: git push origin ${BRANCH}"
      exit 0
    fi
    confirm_or_exit "Vuoi eseguire il push dei ${AHEAD_COUNT} commit su origin/${BRANCH}?"
    git push origin "${BRANCH}"
    log_ok "Push completato verso ${ORIGIN_URL} (${BRANCH})."
    if [[ "${DO_DEPLOY}" == "true" ]]; then
      log_step "Deploy Cloudflare Worker + Migrazioni D1 remote"
      npm run deploy
      log_ok "Deploy completato."
    fi
    exit 0
  fi
  log_ok "Working tree pulito, nessuna modifica da committare."
  exit 0
fi

# ── Quality & Verification Checks ────────────────────────────────────────────
if [[ "${SKIP_CHECKS}" == "false" ]]; then
  log_step "Esecuzione verifiche pre-commit (typecheck, build, test)"
  npm run typecheck
  npm run build
  npm test
  log_ok "Tutte le verifiche pre-commit sono state superate."
else
  log_warn "Verifiche pre-commit saltate (--skip-checks)."
fi

# Re-check status in case build touched anything tracked
STATUS_OUTPUT="$(git status --porcelain)"

log_step "Riepilogo file modificati/nuovi"
git status --short

if [[ "${DRY_RUN}" == "true" ]]; then
  echo ""
  log_ok "[dry-run] Nessuna modifica effettuata a Git."
  echo -e "  Verrebbe eseguito: ${DIM}git add -A && git commit -m \"${COMMIT_MESSAGE:-<messaggio>}\"${NC}"
  if [[ "${DO_PUSH}" == "true" ]]; then
    echo -e "  Verrebbe eseguito: ${DIM}git push origin ${BRANCH}${NC}"
  fi
  if [[ "${DO_DEPLOY}" == "true" ]]; then
    echo -e "  Verrebbe eseguito: ${DIM}npm run deploy${NC}"
  fi
  exit 0
fi

# ── Commit Message Resolution ────────────────────────────────────────────────
if [[ -z "${COMMIT_MESSAGE}" ]]; then
  if [[ ! -t 0 ]]; then
    log_err "Messaggio di commit mancante. Passa -m \"<messaggio>\" in modalità non interattiva."
    exit 1
  fi
  echo ""
  read -r -p "Messaggio di commit: " COMMIT_MESSAGE
fi

COMMIT_MESSAGE="$(echo "${COMMIT_MESSAGE}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [[ -z "${COMMIT_MESSAGE}" ]]; then
  log_err "Il messaggio di commit non può essere vuoto."
  exit 1
fi

# ── Stage, Review & Commit ───────────────────────────────────────────────────
log_step "Staging delle modifiche"
git add -A

if git diff --cached --quiet; then
  log_warn "Nessuna modifica staged dopo 'git add -A'."
  exit 0
fi

git diff --cached --stat
echo -e "\n  Messaggio: ${BOLD}${COMMIT_MESSAGE}${NC}"

confirm_or_exit "Confermi commit$( [[ "${DO_PUSH}" == "true" ]] && echo " e push su origin/${BRANCH}" )?"

log_step "Creazione commit"
git commit -m "${COMMIT_MESSAGE}"
COMMIT_SHA="$(git rev-parse --short HEAD)"
log_ok "Commit ${BOLD}${COMMIT_SHA}${NC} creato su ${BRANCH}."

# ── Push to GitHub ───────────────────────────────────────────────────────────
if [[ "${DO_PUSH}" == "true" ]]; then
  log_step "Push verso GitHub (origin/${BRANCH})"
  if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
    git push origin "${BRANCH}"
  else
    git push -u origin "${BRANCH}"
  fi
  log_ok "Push completato verso ${ORIGIN_URL} (${BRANCH})."
else
  log_warn "Push saltato (--no-push). Esegui manualmente: git push origin ${BRANCH}"
fi

# ── Optional Cloudflare Deploy ───────────────────────────────────────────────
if [[ "${DO_DEPLOY}" == "true" ]]; then
  log_step "Deploy Cloudflare Worker + Migrazioni D1 remote"
  npm run deploy
  log_ok "Deploy completato."
fi

echo -e "\n${GREEN}${BOLD}Release completata!${NC} (${COMMIT_SHA} -> ${BRANCH})"
