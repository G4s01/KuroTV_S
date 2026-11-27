#!/bin/sh
set -eu

DATA_DIR="${KUROSYNC_DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
UMASK="${UMASK:-022}"
READ_ONLY="${KUROSYNC_READ_ONLY:-false}"

case "$UMASK" in
  [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7])
    umask "$UMASK"
    ;;
  *)
    echo "[kurotv-s] ERRORE: Valore UMASK non valido '$UMASK' (atteso ottale a 3 o 4 cifre, es. 022, 002, 077)." >&2
    exit 1
    ;;
esac

# If started directly as non-root (e.g. Compose `user: "1000:1000"`), verify mount and exec
if [ "$(id -u)" -ne 0 ]; then
  if [ ! -d "$DATA_DIR" ]; then
    echo "[kurotv-s] ERRORE: La directory dati '$DATA_DIR' non esiste nel container." >&2
    exit 1
  fi
  if [ "$READ_ONLY" != "true" ] && [ ! -w "$DATA_DIR" ]; then
    echo "[kurotv-s] AVVISO: '$DATA_DIR' non è scrivibile dall'utente $(id -u):$(id -g)." >&2
  fi
  exec "$@"
fi

# If started as root (e.g. without Compose `user:`), ensure data directory ownership and drop privileges
if [ "$READ_ONLY" != "true" ] && [ ! -d "$DATA_DIR" ]; then
  mkdir -p "$DATA_DIR"
fi

if [ "$READ_ONLY" != "true" ] && [ -d "$DATA_DIR" ] && [ -w "$DATA_DIR" ]; then
  CURRENT_OWNER="$(stat -c '%u:%g' "$DATA_DIR" 2>/dev/null || echo '')"
  if [ "$CURRENT_OWNER" != "${PUID}:${PGID}" ]; then
    chown -R "${PUID}:${PGID}" "$DATA_DIR"
  fi
fi

exec su-exec "${PUID}:${PGID}" "$@"
