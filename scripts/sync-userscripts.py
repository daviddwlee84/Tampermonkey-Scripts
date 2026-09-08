#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymobiledevice3==11.10.2"]
# ///
"""Copy repo userscripts, unchanged and flat, to a folder or an iPad over USB.

USB uses the app's supported Documents file sharing (House Arrest / AFC).
It cannot access a directory selected from a different iOS app or iCloud.
"""

import argparse
import asyncio
import re
import sys
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_ID = "com.userscripts.macos"  # Also the official iOS App Store bundle ID.
REMOTE_FOLDER = "Tampermonkey-Scripts"


def collect_scripts(root, only=()):
    scripts = {}
    for directory in sorted((root / "userscripts").iterdir()):
        if directory.name.startswith(("_", ".")) or not directory.is_dir():
            continue
        path = directory / f"{directory.name}.user.js"
        if directory.is_symlink() or path.is_symlink():
            raise ValueError(f"Refusing symlink source: {path}")
        content = path.read_bytes()
        text = content.decode("utf-8")
        block = re.search(r"// ==UserScript==\s*(.*?)// ==/UserScript==", text, re.S)
        if not block or not re.search(r"^//\s*@name\s+\S", block[1], re.M):
            raise ValueError(f"Missing userscript metadata: {path}")
        scripts[directory.name] = (path.name, content)
    unknown = set(only) - scripts.keys()
    if unknown:
        raise ValueError(f"Unknown script(s): {', '.join(sorted(unknown))}")
    selected = [value for slug, value in scripts.items() if not only or slug in only]
    if not selected:
        raise ValueError("No userscripts found.")
    return selected


class FolderStore:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()

    def path(self, relative):
        path = self.root / relative
        # Do not follow links while reading, backing up or replacing files.
        for component in (path, *path.parents):
            if component.is_symlink():
                raise ValueError(f"Refusing symlink destination: {component}")
        return path

    async def read(self, name):
        path = self.path(name)
        return path.read_bytes() if path.exists() else None

    async def write(self, name, content):
        path = self.path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    async def rename(self, source, target):
        destination = self.path(target)
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.path(source).rename(destination)


class DeviceStore:
    def __init__(self, service, folder, missing_error):
        self.service = service
        self.root = f"/Documents/{folder}"
        self.missing_error = missing_error

    async def ensure_directory(self, path):
        if path == "/":
            return
        await self.ensure_directory(path.rsplit("/", 1)[0] or "/")
        try:
            info = await self.service.stat(path)
        except self.missing_error:
            await self.service.makedirs(path)
        else:
            if info["st_ifmt"] != "S_IFDIR":
                raise ValueError(f"Not a regular directory: {path}")

    async def read(self, name):
        path = f"{self.root}/{name}"
        # Stat each parent as well, so a symlink cannot escape the chosen folder.
        parts = path.strip("/").split("/")
        for index in range(1, len(parts) + 1):
            current = "/" + "/".join(parts[:index])
            try:
                info = await self.service.stat(current)
            except self.missing_error:
                return None
            expected = "S_IFREG" if index == len(parts) else "S_IFDIR"
            if info["st_ifmt"] != expected:
                raise ValueError(f"Unexpected file type at {current}: {info['st_ifmt']}")
        return await self.service.get_file_contents(path)

    async def write(self, name, content):
        path = f"{self.root}/{name}"
        await self.ensure_directory(path.rsplit("/", 1)[0])
        await self.service.set_file_contents(path, content)

    async def rename(self, source, target):
        destination = f"{self.root}/{target}"
        await self.ensure_directory(destination.rsplit("/", 1)[0])
        await self.service.rename(f"{self.root}/{source}", destination)


async def sync(scripts, store, dry_run=False):
    # Read every target before writing anything, catching conflicts up front.
    plan = [(name, content, await store.read(name)) for name, content in scripts]
    run_id = uuid.uuid4().hex
    changed = 0
    for name, content, previous in plan:
        action = "unchanged" if content == previous else "add" if previous is None else "update"
        if dry_run:
            print(f"{action:9} {name}")
        if action == "unchanged":
            if not dry_run:
                print(f"synced    {name} (unchanged)")
            continue
        changed += 1
        if dry_run:
            continue
        # Verify a complete upload before moving any previous script aside.
        # .tmp files and backup subdirectories are not executable userscripts.
        temporary = f".{name}.{run_id}.tmp"
        backup = f".sync-backups/{run_id}/{name}.bak"
        await store.write(temporary, content)
        if await store.read(temporary) != content:
            raise OSError(f"Upload verification failed: {name}; original was not changed.")
        # Abort if the user changed a target after the initial comparison.
        if await store.read(name) != previous:
            raise OSError(f"Destination changed during sync: {name}; run again.")
        if previous is not None:
            await store.rename(name, backup)
        try:
            await store.rename(temporary, name)
        except Exception:
            if previous is not None:
                # On cable loss restoration can also fail; the backup remains.
                print(f"Previous copy: {store.root}/{backup}", file=sys.stderr)
                if await store.read(name) is None:
                    await store.rename(backup, name)
            raise
        print(f"synced    {name} ({'added' if previous is None else 'updated'})")
    prefix = "Would sync" if dry_run else "Synced"
    writes = f"{changed} to write" if dry_run else f"{changed} written"
    print(f"{prefix} {len(scripts)} file(s); {writes}, {len(scripts) - changed} unchanged. No pruning.")
    if changed and not dry_run:
        print("Open the Userscripts extension popup once, then reload the Safari page.")


def select_usb_device(devices, udid=None):
    devices = [device for device in devices if device.connection_type == "USB"]
    if udid:
        devices = [device for device in devices if device.serial == udid]
    if not devices:
        raise ValueError("No matching USB device. Connect and unlock the iPad; trust this Mac in Finder.")
    if len(devices) != 1:
        raise ValueError("Multiple USB devices. Use just ipad-devices, then --udid DEVICE_ID.")
    return devices[0]


async def usb(args, scripts):
    try:
        from pymobiledevice3.usbmux import list_devices
        from pymobiledevice3.lockdown import create_using_usbmux
        from pymobiledevice3.services.house_arrest import HouseArrestService
        from pymobiledevice3.exceptions import AfcFileNotFoundError
    except ImportError as error:
        raise ValueError("USB needs pymobiledevice3. Run just sync-ipad (uses uv).") from error

    devices = await list_devices()
    if args.list_devices:
        connected = [device for device in devices if device.connection_type == "USB"]
        if not connected:
            print("No USB iOS devices connected.")
        for device in connected:
            # Listing IDs does not initiate pairing or choose a device to write.
            print(device.serial)
        return

    device = select_usb_device(devices, args.udid)
    async with await create_using_usbmux(
        serial=device.serial, connection_type="USB", autopair=False
    ) as lockdown:
        if not (lockdown.product_type or "").startswith("iPad"):
            raise ValueError(f"Selected device is {lockdown.product_type}, not an iPad.")
        print(f"iPad: {lockdown.all_values.get('DeviceName', lockdown.product_type)}")
        print(f"Folder: On My iPad / Userscripts / {args.remote_folder}")
        async with await HouseArrestService.create(
            lockdown, BUNDLE_ID, documents_only=True
        ) as service:
            await sync(scripts, DeviceStore(service, args.remote_folder, AfcFileNotFoundError), args.dry_run)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--folder", help="Local/iCloud destination, instead of USB")
    mode.add_argument("--plan", action="store_true", help="List sources without accessing any destination")
    mode.add_argument("--list-devices", action="store_true", help="List USB device IDs without writing")
    parser.add_argument("--udid", help="Select one USB iPad (required when multiple devices are attached)")
    parser.add_argument("--remote-folder", default=REMOTE_FOLDER, help="Subfolder inside Userscripts Documents")
    parser.add_argument("--only", action="append", default=[], metavar="SLUG", help="Sync only this script; repeatable")
    parser.add_argument("--dry-run", action="store_true", help="Compare with destination without writing")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.remote_folder):
        parser.error("--remote-folder must be a single folder name, starting with a letter or digit")
    if args.udid and (args.folder or args.plan or args.list_devices):
        parser.error("--udid is only valid for USB sync")
    return args


def main():
    args = parse_args()
    try:
        scripts = [] if args.list_devices else collect_scripts(REPO_ROOT, args.only)
        if args.plan:
            for name, content in scripts:
                print(f"{name} ({len(content):,} bytes)")
            print(f"{len(scripts)} script(s); _template excluded; source bytes and @require unchanged.")
        elif args.folder:
            print(f"Folder: {Path(args.folder).expanduser().absolute()}")
            asyncio.run(sync(scripts, FolderStore(args.folder), args.dry_run))
        else:
            asyncio.run(usb(args, scripts))
    except KeyboardInterrupt:
        print("Interrupted. Completed files are kept; rerun to continue.", file=sys.stderr)
        return 130
    except Exception as error:
        print(f"Sync failed ({type(error).__name__}): {error}", file=sys.stderr)
        if not args.folder and not args.plan:
            print("Check cable, unlock/trust in Finder, and install/open Userscripts on the iPad.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
