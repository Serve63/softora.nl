"""CLI path selections cannot escape the existing shadow inventory."""
import tempfile
import unittest
from pathlib import Path

from shadow_paths import source_directory, shadow_file


class ShadowPathTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = Path(self.scratch.name).resolve()
        self.folder = self.root / "data" / "shadow" / "fixture"
        self.folder.mkdir(parents=True)

    def tearDown(self):
        self.scratch.cleanup()

    def test_existing_shadow_directory_and_json_filename_are_allowed(self):
        self.assertEqual(self.folder, source_directory(str(self.folder), self.root))
        self.assertEqual(self.folder / "new.json", shadow_file(str(self.folder / "new.json"), self.root))

    def test_parent_traversal_and_outside_directory_are_refused(self):
        for raw in (str(self.root / "outside.json"), str(self.folder) + "/../escape.json", str(self.folder / "nested" / "x.json")):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                shadow_file(raw, self.root)
        with self.assertRaises(ValueError):
            source_directory(str(self.root), self.root)

    def test_symlink_directory_and_file_are_refused(self):
        alias = self.folder.parent / "alias"
        alias.symlink_to(self.folder, target_is_directory=True)
        with self.assertRaises(ValueError):
            source_directory(str(alias), self.root)
        filename = self.folder / "alias.json"
        filename.symlink_to(self.root / "outside.json")
        with self.assertRaises(ValueError):
            shadow_file(str(filename), self.root)

    def test_non_json_and_empty_filenames_are_refused(self):
        for suffix in ("", ".", "..", "worker.py", "data.sqlite"):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                shadow_file(str(self.folder) + "/" + suffix, self.root)


if __name__ == "__main__":
    unittest.main()
