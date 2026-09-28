#!/bin/sh
# Generated release installer. Publish alongside manifest.json and the archives.
set -eu
umask 077

fail() { printf 'ADC: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Install Agent Device Cloud (macOS or glibc Linux; arm64/x64)
  curl -fsSL https://downloads.example.com/install.sh | sh -s -- \
    --url https://devices.example.com --code PAIRING_CODE

Options:
  --url ORIGIN          Control Plane origin
  --code CODE           One-time code from Devices → Pair device
  --download-url URL    Directory containing this release's archives
  --label NAME         Device name (otherwise prompted)
  --access MODE        none (set up later), selected, home, or full (trust this device)
  --root-path FOLDER   Optional folder for selected access
  --root-id ID         Folder identifier (default: root_workspace)
  --read-only          Advertise the folder as read-only
  --no-service         Pair only; run adc-node run yourself

Repeat the command to upgrade; existing identity and folders are preserved.
ADC_INSTALL_DIR, ADC_BIN_DIR, ADC_NODE_CONFIG override user-level paths.
USAGE
}

download_url=@ADC_DOWNLOAD_URL@
url='' code='' label='' root_path='' root_id='' access_mode=''
no_service=false read_only=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --no-service) no_service=true; shift ;;
    --read-only) read_only=true; shift ;;
    --url|--code|--download-url|--label|--root-path|--root-id|--access)
      [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 requires a value"
      case "$1" in
        --url) url=$2 ;; --code) code=$2 ;; --download-url) download_url=$2 ;;
        --label) label=$2 ;; --root-path) root_path=$2 ;; --root-id) root_id=$2 ;;
        --access) access_mode=$2 ;;
      esac
      shift 2 ;;
    *) fail "Unknown option: $1 (use --help)" ;;
  esac
done
if [ -z "$download_url" ]; then
  [ -n "$url" ] || fail "Use --url ORIGIN or --download-url URL."
  download_url="${url%/}/downloads/node"
fi
case "$download_url" in
  https://*) protocols='=https' ;;
  http://localhost:*|http://127.0.0.1:*|http://localhost/*|http://127.0.0.1/*|http://\[::1\]:*)
    protocols='=http,https' ;;
  *) fail "Download URL requires HTTPS (HTTP is allowed on loopback for local use)." ;;
esac
case "$download_url" in
  *@*|*\\*|*\?*|*\#*|*'
'*) fail "Download URL must not contain credentials, query parameters or fragments." ;;
esac
for dependency in curl tar; do
  command -v "$dependency" >/dev/null 2>&1 || fail "Install $dependency first."
done
case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) fail "Only macOS and Linux are supported." ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) fail "Unsupported CPU architecture." ;; esac
if [ "$os" = linux ] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
  fail "This release requires glibc Linux. Alpine/musl is not supported."
fi
case "$os-$arch" in
@ADC_ARCHIVES@
  *) fail "This release does not contain $os-$arch." ;;
esac

install_dir=${ADC_INSTALL_DIR:-"$HOME/.local/share/agent-device-cloud"}
bin_dir=${ADC_BIN_DIR:-"$HOME/.local/bin"}
config_path=${ADC_NODE_CONFIG:-"$HOME/.config/adc/node.json"}
for path in "$install_dir" "$bin_dir" "$config_path"; do
  case "$path" in /*) ;; *) fail "Installation paths must be absolute." ;; esac
  case "$path" in /|"$HOME"|*'
'*) fail "Refusing unsafe installation path." ;; esac
done
if [ -e "$install_dir" ] && [ ! -f "$install_dir/.adc-installation" ]; then
  fail "$install_dir exists but is not an ADC installation. Choose a new ADC_INSTALL_DIR."
fi
mkdir -p "$install_dir" "$bin_dir"
printf 'Agent Device Cloud\n' > "$install_dir/.adc-installation"
lock_dir="$install_dir/.install-lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  lock_pid=''
  if [ -f "$lock_dir/pid" ]; then lock_pid=$(cat "$lock_dir/pid" 2>/dev/null || true); fi
  case "$lock_pid" in
    ''|*[!0-9]*)
      rm -rf "$lock_dir"
      mkdir "$lock_dir" 2>/dev/null || fail "Could not recover the interrupted installation lock at $lock_dir."
      ;;
    *)
      if kill -0 "$lock_pid" 2>/dev/null; then
        fail "Another installation is active (PID $lock_pid)."
      fi
      rm -rf "$lock_dir"
      mkdir "$lock_dir" 2>/dev/null || fail "Could not recover the interrupted installation lock at $lock_dir."
      ;;
  esac
fi
printf '%s\n' "$$" > "$lock_dir/pid"
temporary=''
cleanup() {
  if [ -n "$temporary" ]; then rm -rf "$temporary"; fi
  rm -f "$lock_dir/pid"
  rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
temporary=$(mktemp -d "$install_dir/.download.XXXXXX")
for name in adc adc-node; do
  if [ -e "$bin_dir/$name" ] || [ -L "$bin_dir/$name" ]; then
    if ! grep -q '^# ADC managed launcher$' "$bin_dir/$name" 2>/dev/null; then
      fail "$bin_dir/$name already exists and is not managed by ADC."
    fi
  fi
done
printf 'Downloading Agent Device Cloud for %s-%s…\n' "$os" "$arch"
curl --fail --show-error --location --proto "$protocols" --proto-redir "$protocols" \
  --retry 3 --connect-timeout 15 --max-time 600 \
  "${download_url%/}/$archive" --output "$temporary/client.tar.gz"
if command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$temporary/client.tar.gz" | cut -d ' ' -f 1)
elif command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$temporary/client.tar.gz" | cut -d ' ' -f 1)
else
  fail "Install shasum or sha256sum first."
fi
[ "$actual" = "$checksum" ] || fail "Archive checksum mismatch. Existing release was preserved."
mkdir "$temporary/payload"
tar -xzf "$temporary/client.tar.gz" -C "$temporary/payload"
runtime="$temporary/payload/runtime/bin/node"
"$runtime" --version >/dev/null || fail "Bundled runtime cannot run on this operating system."

export ADC_INSTALL_DIR="$install_dir" ADC_BIN_DIR="$bin_dir" ADC_NODE_CONFIG="$config_path"
set -- setup
[ -z "$url" ] || set -- "$@" --url "$url"
[ -z "$code" ] || set -- "$@" --code "$code"
[ -z "$label" ] || set -- "$@" --label "$label"
[ -z "$root_path" ] || set -- "$@" --root-path "$root_path"
[ -z "$root_id" ] || set -- "$@" --root-id "$root_id"
[ -z "$access_mode" ] || set -- "$@" --access "$access_mode"
[ "$read_only" = false ] || set -- "$@" --read-only
# Validate/reuse identity before switching the active program.
if [ "$no_service" = false ]; then
  "$runtime" "$temporary/payload/lib/adc-node.mjs" "$@" --no-service >/dev/null
else
  "$runtime" "$temporary/payload/lib/adc-node.mjs" "$@" --no-service
fi

release_name=${archive%.tar.gz}
mkdir -p "$install_dir/releases"
if [ ! -d "$install_dir/releases/$release_name" ]; then
  mv "$temporary/payload" "$install_dir/releases/$release_name"
fi
runtime="$install_dir/releases/$release_name/runtime/bin/node"
previous_target=''
if [ -L "$install_dir/current" ]; then
  previous_target=$(readlink "$install_dir/current")
fi
ln -s "releases/$release_name" "$temporary/current"
"$runtime" --input-type=module -e 'import {renameSync} from "node:fs"; renameSync(process.argv[1], process.argv[2]);' \
  "$temporary/current" "$install_dir/current"

quote() { printf "'"; printf '%s' "$1" | sed "s/'/'\\\\''/g"; printf "'"; }
for name in adc adc-node; do
  {
    printf '#!/bin/sh\n# ADC managed launcher\n'
    printf 'export ADC_INSTALL_DIR='; quote "$install_dir"; printf '\n'
    printf 'export ADC_BIN_DIR='; quote "$bin_dir"; printf '\n'
    printf 'export ADC_UPDATE_URL='; quote "$download_url"; printf '\n'
    if [ -n "$url" ]; then
      printf 'export ADC_CONTROL_PLANE_URL='; quote "$url"; printf '\n'
    fi
    printf 'if [ -z "${ADC_NODE_CONFIG:-}" ]; then export ADC_NODE_CONFIG='
    quote "$config_path"; printf '; fi\n'
    if [ -n "${ADC_SERVICE_DIR:-}" ]; then
      printf 'export ADC_SERVICE_DIR='; quote "$ADC_SERVICE_DIR"; printf '\n'
    fi
    printf 'exec "$ADC_INSTALL_DIR/current/runtime/bin/node" "$ADC_INSTALL_DIR/current/lib/%s.mjs" "$@"\n' "$name"
  } > "$temporary/$name"
  chmod 755 "$temporary/$name"
  mv -f "$temporary/$name" "$bin_dir/$name"
done
if [ "$no_service" = false ]; then
  if ! "$bin_dir/adc-node" setup; then
    if [ -n "$previous_target" ]; then
      ln -s "$previous_target" "$temporary/previous"
      "$runtime" --input-type=module -e 'import {renameSync} from "node:fs"; renameSync(process.argv[1], process.argv[2]);' \
        "$temporary/previous" "$install_dir/current"
      "$bin_dir/adc-node" setup >/dev/null 2>&1 || true
      fail "Connector restart failed. The previous release was restored."
    fi
    fail "Connector service setup failed. The downloaded release remains installed."
  fi
fi
printf '\nInstalled: %s\n' "$bin_dir/adc-node"
case ":${PATH:-}:" in
  *":$bin_dir:"*) ;;
  *) printf 'Add this to your shell profile, then open a new terminal:\n  export PATH='
     quote "$bin_dir"; printf ':$PATH\n' ;;
esac
printf 'Status: '; quote "$bin_dir/adc-node"; printf ' status\n'
