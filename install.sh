#!/bin/sh
set -eu

repository="hidenariTakeuchi/diff"
install_directory="${POCKET_DIFF_INSTALL_DIR:-$HOME/.local/bin}"

command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required to download this private release." >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) target_os="darwin" ;;
  Linux) target_os="linux" ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) target_arch="arm64" ;;
  x86_64|amd64) target_arch="amd64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

archive="pocket-diff_${target_os}_${target_arch}.tar.gz"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT INT TERM

echo "Downloading Pocket Diff for ${target_os}/${target_arch} ..."
gh release download --repo "$repository" --pattern "$archive" --pattern checksums.txt --dir "$temporary_directory"

(
  cd "$temporary_directory"
  if command -v sha256sum >/dev/null 2>&1; then
    grep "  ${archive}$" checksums.txt | sha256sum -c -
  else
    expected="$(grep "  ${archive}$" checksums.txt | awk '{print $1}')"
    actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
    [ "$expected" = "$actual" ] || { echo "Checksum verification failed" >&2; exit 1; }
  fi
  tar -xzf "$archive"
)

mkdir -p "$install_directory"
install -m 755 "$temporary_directory/pocket-diff_${target_os}_${target_arch}/pocket-diff" "$install_directory/pocket-diff"
echo "Installed: $install_directory/pocket-diff"

case ":$PATH:" in
  *":$install_directory:"*) ;;
  *) echo "Add $install_directory to PATH before using pocket-diff." ;;
esac

if [ "${POCKET_DIFF_NO_SETUP:-0}" = "1" ]; then
  echo "Run: $install_directory/pocket-diff setup"
elif [ -r /dev/tty ] && [ -w /dev/tty ]; then
  "$install_directory/pocket-diff" setup </dev/tty
else
  echo "Run: $install_directory/pocket-diff setup"
fi
