#!/usr/bin/env bash
#
# setup-usb.sh — First-time USB LUKS + ext4 setup
#
# Usage: bash scripts/setup-usb.sh --device /dev/sdX [--keyfile PATH]
#                          [--mapper NAME] [--label LABEL] [--mount-point PATH]
#
# This is a MANUAL ONE-SHOT setup script. It formats the USB drive with LUKS
# and ext4. For ongoing operation, use mount-usb.sh / unmount-usb.sh.
#
# Exit codes:
#   0 — success (or --dry-run completed)
#   1 — configuration error, missing args, or operator refused
#   2 — device not present
#

set -euo pipefail

# shellcheck source=/dev/null
source "$(dirname "$0")/lib/common.sh"

# ── Defaults ────────────────────────────────────────────────────
DEVICE=""
KEYFILE="/root/athlos-usb.key"
MAPPER="athlos-backup-usb"
LABEL="athlos-backup-usb"
MOUNT_POINT="/mnt/athlos-backup-usb"
DRY_RUN=0

# ── Parse arguments ──────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: bash $(basename "$0") --device /dev/sdX [OPTIONS]

First-time USB LUKS + ext4 setup. DESTRUCTIVE — formats the device.

Required:
  --device /dev/sdX    Block device to format (e.g. /dev/sdb)

Options:
  --keyfile PATH       LUKS keyfile path (default: /root/athlos-usb.key)
  --mapper NAME        LUKS mapper name (default: athlos-backup-usb)
  --label LABEL        ext4 filesystem label (default: athlos-backup-usb)
  --mount-point PATH   Temporary mount point (default: /mnt/athlos-backup-usb)
  --dry-run            Print plan without formatting
  --help               Show this usage message

Examples:
  # Dry run to see what would happen:
  bash $(basename "$0") --device /dev/sdc --dry-run

  # Actual format (requires root):
  sudo bash $(basename "$0") --device /dev/sdc
  sudo bash $(basename "$0") --device /dev/sdc --keyfile /root/my-key.key

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE="$2"
      shift 2
      ;;
    --keyfile)
      KEYFILE="$2"
      shift 2
      ;;
    --mapper)
      MAPPER="$2"
      shift 2
      ;;
    --label)
      LABEL="$2"
      shift 2
      ;;
    --mount-point)
      MOUNT_POINT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# ── Guards ───────────────────────────────────────────────────────
if [[ -z "$DEVICE" ]]; then
  echo "ERROR: --device is required" >&2
  usage
  exit 1
fi

if [[ ! -b "$DEVICE" ]]; then
  log ERROR "device $DEVICE not found (not plugged in or not a block device)"
  exit 2
fi

require_root
require_cmd cryptsetup
require_cmd mkfs.ext4

# ── Dry run: print plan ──────────────────────────────────────────
print_plan() {
  cat <<EOF
DRY RUN — no changes made.

Would execute the following steps:

1. Generate LUKS keyfile at: $KEYFILE
   dd if=/dev/urandom of=$KEYFILE bs=1024 count=4
   chmod 0600 $KEYFILE
   chown root:root $KEYFILE

2. Format device $DEVICE as LUKS:
   cryptsetup luksFormat --batch-mode "$DEVICE"

3. Open LUKS partition:
   cryptsetup open --key-file "$KEYFILE" "$DEVICE" "$MAPPER"

4. Create ext4 filesystem:
   mkfs.ext4 -L "$LABEL" /dev/mapper/$MAPPER

5. Close LUKS:
   cryptsetup close $MAPPER

After setup, add to /etc/cron.d/athlos-backup:
  0 4 * * 0 root /run/media/vlongo/Archivos/Projectos/Athlos/scripts/backup-to-usb.sh

And to .env:
  USB_DEVICE=$DEVICE (or /dev/disk/by-label/$LABEL)
  USB_KEYFILE=$KEYFILE
  USB_MAPPER=$MAPPER
  USB_MOUNT_POINT=$MOUNT_POINT
  USB_RETENTION_DAYS=30
EOF
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  print_plan
  exit 0
fi

# ── Interactive confirmation (defense in depth) ───────────────────
echo ""
echo "WARNING: This will DESTROY all data on $DEVICE"
echo ""
echo "Type YES (uppercase) to confirm: "
read -r confirm
if [[ "$confirm" != "YES" ]]; then
  echo "Aborted — you did not type YES"
  exit 1
fi

# ── Generate keyfile ─────────────────────────────────────────────
echo ""
echo "[1/5] Generating LUKS keyfile at $KEYFILE"
if [[ ! -f "$KEYFILE" ]]; then
  dd if=/dev/urandom of="$KEYFILE" bs=1024 count=4
  chmod 0600 "$KEYFILE"
  chown root:root "$KEYFILE"
  echo "Keyfile created: $KEYFILE (mode 0600, root:root)"
else
  echo "Keyfile already exists at $KEYFILE — skipping generation"
fi

# ── LUKS format ─────────────────────────────────────────────────
echo ""
echo "[2/5] Formatting $DEVICE as LUKS (this destroys all data)"
cryptsetup luksFormat --batch-mode "$DEVICE"
echo "LUKS format complete"

# ── Open LUKS ───────────────────────────────────────────────────
echo ""
echo "[3/5] Opening LUKS partition as $MAPPER"
cryptsetup open --key-file "$KEYFILE" "$DEVICE" "$MAPPER"
echo "LUKS opened at /dev/mapper/$MAPPER"

# ── Create ext4 filesystem ──────────────────────────────────────
echo ""
echo "[4/5] Creating ext4 filesystem with label '$LABEL'"
mkfs.ext4 -L "$LABEL" "/dev/mapper/$MAPPER"
echo "ext4 filesystem created"

# ── Close LUKS ──────────────────────────────────────────────────
echo ""
echo "[5/5] Closing LUKS partition"
cryptsetup close "$MAPPER"
echo "LUKS closed"

echo ""
echo "============================================"
echo "USB setup complete!"
echo ""
echo "Next steps:"
echo "  1. Label the partition: sudo e2label /dev/mapper/$MAPPER $LABEL"
echo "     (or reboot and use /dev/disk/by-label/$LABEL for USB_DEVICE)"
echo "  2. Verify: cryptsetup open --key-file $KEYFILE $DEVICE $MAPPER"
echo "  3. Add cron entry for weekly backup (see print_plan output above)"
echo "  4. Add USB env vars to .env (see print_plan output above)"
echo "============================================"
