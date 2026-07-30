import tempfile
import unittest
import json
import zipfile
from pathlib import Path

import yaml

from routes import _chart_fingerprint, _resolve_feedpak


class FeedPakPathTests(unittest.TestCase):
    def test_only_feedpaks_inside_library_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            chart = root / "artist" / "song.feedpak"
            chart.parent.mkdir()
            chart.write_bytes(b"feedpak")
            self.assertEqual(_resolve_feedpak(root, "artist/song.feedpak"), chart.resolve())
            with self.assertRaises(ValueError):
                _resolve_feedpak(root, "../song.feedpak")
            with self.assertRaises(ValueError):
                _resolve_feedpak(root, "artist/song.sloppak")

    def test_score_upload_requires_player_confirmation(self):
        source = Path(__file__).with_name("screen.js").read_text(encoding="utf-8")
        self.assertNotIn("window.confirm", source)
        self.assertNotIn("window.alert", source)
        self.assertLess(source.index("await showResultDialog"), source.index("/submit"))
        self.assertLess(source.index("/submit"), source.index("await showUploadOutcome(body)"))
        self.assertIn("feedforge:score-declined", source)

    def test_ranked_run_is_preflighted_before_playback(self):
        source = Path(__file__).with_name("screen.js").read_text(encoding="utf-8")
        self.assertIn("holdAutoplay", source)
        self.assertIn("data-start-ranked", source)
        self.assertIn("settingsCompetitive(d.settings)", source)
        self.assertIn("Number(settings[key]) <= rankedSettings[key]", source)
        self.assertIn("Number(settings.detection_confidence_min) >= rankedSettings.detection_confidence_min", source)
        self.assertLess(source.index("/run/start"), source.index("on('song:play'"))

    def test_ranked_run_locks_player_controls(self):
        source = Path(__file__).with_name("screen.js").read_text(encoding="utf-8")
        self.assertIn("ff-ranked-lock", source)
        self.assertIn("body.ff-ranked-active #player-controls", source)
        self.assertIn("setRankedLock(true", source)

    def test_arrangement_is_selected_before_ranked_play(self):
        source = Path(__file__).with_name("screen.js").read_text(encoding="utf-8")
        handler = source[source.index("on('arrangement:changed'"):source.index("on('song:play'")]
        self.assertIn("songReady = false", handler)
        self.assertIn("mode === 'ranked'", handler)

    def test_chart_fingerprint_ignores_tones_but_rejects_note_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "song.feedpak"
            chart = {"name": "Lead", "notes": [{"time": 1.25, "fret": 7}], "tones": {"base": "Clean"}}

            def write(value):
                with zipfile.ZipFile(path, "w") as archive:
                    archive.writestr("manifest.yaml", yaml.safe_dump({"arrangements": [{"file": "arrangements/lead.json"}]}))
                    archive.writestr("arrangements/lead.json", json.dumps(value))

            write(chart)
            original = _chart_fingerprint(path, 0)
            write({**chart, "tones": {"base": "FeedTone", "changes": [{"t": 2.0}]}})
            self.assertEqual(_chart_fingerprint(path, 0), original)
            write({**chart, "notes": [{"time": 1.25, "fret": 0}]})
            self.assertNotEqual(_chart_fingerprint(path, 0), original)


if __name__ == "__main__":
    unittest.main()
