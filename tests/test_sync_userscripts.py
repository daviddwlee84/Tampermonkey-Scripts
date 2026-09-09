"""File safety, ZIP selection/import contents and USB routing; no device dependencies."""

import asyncio
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "sync_userscripts", Path(__file__).resolve().parents[1] / "scripts/sync-userscripts.py"
)
syncer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(syncer)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def sync(self, scripts, store, dry_run=False):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return asyncio.run(syncer.sync(scripts, store, dry_run))

    def test_flat_copy_unchanged_rerun_and_unrelated_files(self):
        target = self.root / "folder with spaces"
        target.mkdir()
        (target / "other.user.js").write_bytes(b"user's own script")
        content = "// 繁體中文\r\n".encode()
        store = syncer.FolderStore(target)
        self.sync([("one.user.js", content)], store)
        before = (target / "one.user.js").stat().st_mtime_ns
        self.sync([("one.user.js", content)], store)
        self.assertEqual((target / "one.user.js").read_bytes(), content)
        self.assertEqual((target / "one.user.js").stat().st_mtime_ns, before)
        self.assertEqual((target / "other.user.js").read_bytes(), b"user's own script")
        self.assertFalse((target / ".sync-backups").exists())

    def test_update_preserves_previous_copy(self):
        store = syncer.FolderStore(self.root)
        (self.root / "a.user.js").write_bytes(b"old")
        self.sync([("a.user.js", b"new")], store)
        self.assertEqual((self.root / "a.user.js").read_bytes(), b"new")
        backups = list(self.root.glob(".sync-backups/*/a.user.js.bak"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), b"old")

    def test_dry_run_does_not_create_destination(self):
        target = self.root / "absent"
        self.sync([("a.user.js", b"new")], syncer.FolderStore(target), True)
        self.assertFalse(target.exists())

    def test_dry_run_does_not_overwrite_or_back_up(self):
        (self.root / "a.user.js").write_bytes(b"old")
        self.sync([("a.user.js", b"new")], syncer.FolderStore(self.root), True)
        self.assertEqual((self.root / "a.user.js").read_bytes(), b"old")
        self.assertEqual(len(list(self.root.iterdir())), 1)

    def test_rejects_symlink_before_any_writes(self):
        target = self.root / "target"
        target.mkdir()
        outside = self.root / "outside"
        outside.write_bytes(b"private")
        (target / "z.user.js").symlink_to(outside)
        with self.assertRaises(ValueError):
            self.sync([("a.user.js", b"new"), ("z.user.js", b"new")], syncer.FolderStore(target))
        self.assertFalse((target / "a.user.js").exists())
        self.assertEqual(outside.read_bytes(), b"private")

    def test_partial_upload_never_replaces_original(self):
        class BrokenUpload(syncer.FolderStore):
            async def write(self, name, content):
                await super().write(name, content[:1])

        (self.root / "a.user.js").write_bytes(b"old")
        with self.assertRaisesRegex(OSError, "verification failed"):
            self.sync([("a.user.js", b"new")], BrokenUpload(self.root))
        self.assertEqual((self.root / "a.user.js").read_bytes(), b"old")

    def test_failed_final_rename_restores_original(self):
        class BrokenRename(syncer.FolderStore):
            async def rename(self, source, target):
                if source.endswith(".tmp"):
                    raise OSError("simulated transfer failure")
                await super().rename(source, target)

        (self.root / "a.user.js").write_bytes(b"old")
        with self.assertRaisesRegex(OSError, "simulated"):
            self.sync([("a.user.js", b"new")], BrokenRename(self.root))
        self.assertEqual((self.root / "a.user.js").read_bytes(), b"old")

    def test_destination_edit_during_upload_is_preserved(self):
        class ConcurrentEdit(syncer.FolderStore):
            async def write(self, name, content):
                await super().write(name, content)
                self.path("a.user.js").write_bytes(b"edited on iPad")

        (self.root / "a.user.js").write_bytes(b"old")
        with self.assertRaisesRegex(OSError, "changed during sync"):
            self.sync([("a.user.js", b"new")], ConcurrentEdit(self.root))
        self.assertEqual((self.root / "a.user.js").read_bytes(), b"edited on iPad")

    def test_source_discovery_excludes_template_and_preserves_requires(self):
        content = b"// ==UserScript==\n// @name Demo\n// @require https://example.com/lib.js\n// ==/UserScript==\n"
        for slug in ("_template", "z", "a"):
            folder = self.root / "userscripts" / slug
            folder.mkdir(parents=True)
            (folder / f"{slug}.user.js").write_bytes(content)
        self.assertEqual(syncer.collect_scripts(self.root), [("a.user.js", content), ("z.user.js", content)])
        self.assertEqual(syncer.collect_scripts(self.root, ["z"]), [("z.user.js", content)])
        with self.assertRaisesRegex(ValueError, "Unknown script"):
            syncer.collect_scripts(self.root, ["typo"])

    def test_source_symlink_is_rejected(self):
        folder = self.root / "userscripts" / "a"
        folder.mkdir(parents=True)
        (folder / "a.user.js").symlink_to(self.root / "outside")
        with self.assertRaisesRegex(ValueError, "symlink source"):
            syncer.collect_scripts(self.root)

    def test_usb_selection_excludes_network_and_requires_explicit_choice(self):
        device = lambda serial, kind: SimpleNamespace(serial=serial, connection_type=kind)
        usb = device("ipad", "USB")
        network = device("wifi", "Network")
        self.assertIs(syncer.select_usb_device([usb, network]), usb)
        with self.assertRaisesRegex(ValueError, "No matching USB"):
            syncer.select_usb_device([network])
        with self.assertRaisesRegex(ValueError, "Multiple USB"):
            syncer.select_usb_device([usb, device("phone", "USB")])
        self.assertIs(syncer.select_usb_device([usb, device("phone", "USB")], "ipad"), usb)
        with self.assertRaisesRegex(ValueError, "No matching USB"):
            syncer.select_usb_device([usb], "typo")

    def test_remote_path_rejects_traversal(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            syncer.parse_args(["--remote-folder", "../elsewhere"])


class FakeAfc:
    """Strict AFC fake: rename refuses to overwrite; errors other than missing propagate."""

    def __init__(self):
        self.files = {}
        self.dirs = {"/Documents"}
        self.operations = []

    async def stat(self, path):
        if path in self.dirs:
            return {"st_ifmt": "S_IFDIR"}
        if path in self.files:
            return {"st_ifmt": "S_IFREG"}
        raise FileNotFoundError(path)

    async def makedirs(self, path):
        self.operations.append(("mkdir", path))
        self.dirs.add(path)

    async def get_file_contents(self, path):
        return self.files[path]

    async def set_file_contents(self, path, content):
        self.operations.append(("write", path))
        self.files[path] = content

    async def rename(self, source, target):
        if target in self.files:
            raise FileExistsError(target)
        self.operations.append(("rename", source, target))
        self.files[target] = self.files.pop(source)


class DeviceStoreTests(unittest.TestCase):
    def test_remote_update_backup_and_no_pruning(self):
        service = FakeAfc()
        root = "/Documents/Tampermonkey-Scripts"
        service.dirs.add(root)
        service.files[f"{root}/a.user.js"] = b"old"
        service.files[f"{root}/other.user.js"] = b"unrelated"
        store = syncer.DeviceStore(service, "Tampermonkey-Scripts", FileNotFoundError)
        with contextlib.redirect_stdout(io.StringIO()):
            asyncio.run(syncer.sync([("a.user.js", b"new")], store))
        self.assertEqual(service.files[f"{root}/a.user.js"], b"new")
        self.assertEqual(service.files[f"{root}/other.user.js"], b"unrelated")
        self.assertEqual([v for k, v in service.files.items() if k.endswith(".bak")], [b"old"])
        self.assertTrue(all(path.startswith("/Documents/") for path in service.files))

    def test_remote_dry_run_and_connection_failure_write_nothing(self):
        service = FakeAfc()
        store = syncer.DeviceStore(service, "Tampermonkey-Scripts", FileNotFoundError)
        with contextlib.redirect_stdout(io.StringIO()):
            asyncio.run(syncer.sync([("a.user.js", b"new")], store, True))
        self.assertFalse(service.operations)

        async def disconnected(path):
            raise ConnectionError("cable unplugged")

        service.stat = disconnected
        with self.assertRaises(ConnectionError):
            asyncio.run(syncer.sync([("a.user.js", b"new")], store))
        self.assertFalse(service.operations)


class ZipTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.sources = syncer.collect_scripts(syncer.REPO_ROOT)

    def pack(self, scripts, target, dry_run=False):
        with contextlib.redirect_stdout(io.StringIO()):
            syncer.pack_zip(scripts, target, dry_run)

    def test_catalog_defaults_and_explicit_selection(self):
        select = lambda **kwargs: syncer.select_zip_scripts(syncer.REPO_ROOT, self.sources, **kwargs)
        defaults = {name for name, _ in select()}
        self.assertIn("page-reader-markdown.user.js", defaults)
        self.assertTrue(defaults.isdisjoint({"hello-userscript.user.js", "page-title-tag.user.js", "m365-copilot-export-markdown.user.js"}))
        self.assertEqual(select(include_all=True), self.sources)
        self.assertEqual({name for name, _ in select(categories=["examples"])}, {"hello-userscript.user.js", "page-title-tag.user.js"})
        both = {name for name, _ in select(categories=["examples", "experimental", "examples"])}
        self.assertEqual(both, {"hello-userscript.user.js", "page-title-tag.user.js", "m365-copilot-export-markdown.user.js"})
        self.assertEqual([name for name, _ in select(only=["page-title-tag"])], ["page-title-tag.user.js"])
        for kwargs in ({"categories": ["typo"]}, {"only": ["typo"]}):
            with self.assertRaisesRegex(ValueError, "Unknown"):
                select(**kwargs)

    def test_catalog_must_cover_each_script_exactly_once(self):
        (self.root / "scripts").mkdir()
        catalog = self.root / "scripts/catalog.json"
        valid = [{"id": "tools", "title": "工具", "description": "工具", "default": True, "scripts": ["a"]}]
        for slugs, error in [([], "Add scripts"), (["a", "a"], "duplicate"), (["unknown"], "Unknown")]:
            valid[0]["scripts"] = slugs
            catalog.write_text(json.dumps(valid))
            with self.assertRaisesRegex(ValueError, error):
                syncer.select_zip_scripts(self.root, [("a.user.js", b"source")])

    def test_zip_preserves_all_source_bytes_and_only_selected_files(self):
        target = self.root / "folder with spaces" / "bundle.zip"
        self.pack(self.sources, target)
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(archive.namelist(), [name for name, _ in self.sources])
            self.assertTrue(all("/" not in name and name.endswith(".user.js") for name in archive.namelist()))
            for name, content in self.sources:
                self.assertEqual(archive.read(name), content)
        first_bytes = target.read_bytes()
        self.pack(self.sources, target)
        self.assertEqual(target.read_bytes(), first_bytes)
        # 重選後不把舊 ZIP 裡的其他 entries 帶回。
        self.pack(self.sources[:1], target)
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(archive.namelist(), [self.sources[0][0]])

    def test_dry_run_never_creates_or_replaces_zip(self):
        target = self.root / "absent" / "bundle.zip"
        self.pack(self.sources, target, True)
        self.assertFalse(target.parent.exists())
        target = self.root / "bundle.zip"
        target.write_bytes(b"previous archive")
        self.pack(self.sources, target, True)
        self.assertEqual(target.read_bytes(), b"previous archive")
        self.assertEqual(list(self.root.iterdir()), [target])

    def test_zip_failure_preserves_previous_artifact(self):
        target = self.root / "bundle.zip"
        target.write_bytes(b"previous archive")
        with patch.object(zipfile.ZipFile, "writestr", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                self.pack(self.sources, target)
        self.assertEqual(target.read_bytes(), b"previous archive")
        self.assertEqual(list(self.root.iterdir()), [target])

    def test_zip_rejects_symlink_and_non_zip_output(self):
        original = self.root / "original.zip"
        original.write_bytes(b"keep")
        alias = self.root / "alias.zip"
        alias.symlink_to(original)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.pack(self.sources, alias)
        with self.assertRaisesRegex(ValueError, "end in .zip"):
            self.pack(self.sources, self.root / "source.user.js")
        self.assertEqual(original.read_bytes(), b"keep")

    def test_cli_rejects_conflicting_selection_and_usb_options(self):
        for options in (["--all"], ["--category", "examples"],
                        ["--zip", "x.zip", "--all", "--only", "page-title-tag"],
                        ["--zip", "x.zip", "--udid", "device"],
                        ["--zip", "x.zip", "--folder", "folder"]):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                syncer.parse_args(options)

    def test_zip_cli_needs_no_usb_dependency_and_preserves_old_zip_on_bad_selection(self):
        target = self.root / "My Bundle.zip"
        command = [sys.executable, "-S", str(syncer.REPO_ROOT / "scripts/sync-userscripts.py"), "--zip", str(target)]
        result = subprocess.run([*command, "--category", "examples"], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), {"hello-userscript.user.js", "page-title-tag.user.js"})
        before = target.read_bytes()
        result = subprocess.run([*command, "--only", "typo"], text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("iPad", result.stderr)
        self.assertEqual(target.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
