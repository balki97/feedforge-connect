import tempfile
import unittest
import json
import zipfile
import io
import os
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pathlib import Path

import yaml

from routes import _chart_fingerprint, _resolve_feedpak, setup


class FeedPakPathTests(unittest.TestCase):
    def test_only_feedpaks_inside_library_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            chart = root / "artist" / "song.feedpak"
            chart.parent.mkdir()
            chart.write_bytes(b"feedpak")
            self.assertEqual(_resolve_feedpak(root, "artist/song.feedpak"), chart.resolve())
            with self.assertRaisesRegex(ValueError, "outside the FeedBack library"):
                _resolve_feedpak(root, "../song.feedpak")
            with self.assertRaisesRegex(ValueError, "loaded from \\.sloppak, not a FeedPak"):
                _resolve_feedpak(root, "artist/song.sloppak")
            with self.assertRaisesRegex(ValueError, "did not report which song file"):
                _resolve_feedpak(root, "")
            with self.assertRaisesRegex(ValueError, "cannot find 'missing.feedpak'"):
                _resolve_feedpak(root, "artist/missing.feedpak")

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
        self.assertIn("window.noteDetect?.enable?.()", source)
        self.assertIn("Note Detection could not start", source)
        self.assertIn("applyNoteDetectSettings(rankedSettings)", source)
        self.assertIn("settingsEqual(d?.settings, rankedSettings)", source)
        self.assertIn("restoreRankedSettings(finished)", source)
        self.assertIn("settings: finished.settings || {}", source)
        self.assertLess(source.index("/run/start"), source.index("on('song:play'"))

    def test_missing_note_detection_has_an_install_path(self):
        source = Path(__file__).with_name("screen.js").read_text(encoding="utf-8")
        self.assertIn("if (!d?.plugin_version)", source)
        self.assertIn("https://github.com/got-feedback/feedBack-plugin-notedetect.git", source)
        self.assertIn("plugins.install(noteDetectUrl)", source)
        self.assertIn("restart FeedBack", source)
        self.assertIn(".ff-ranked-error button[hidden]{display:none}", source)

    def test_ranked_run_locks_competitive_controls_only(self):
        source = Path(__file__).with_name("screen.js").read_text(encoding="utf-8")
        self.assertIn("body.ff-ranked-active #player-controls", source)
        self.assertIn('body.ff-ranked-active #v3-railzone [data-rail="advanced"]', source)
        self.assertNotIn("body.ff-ranked-active #v3-railzone{", source)
        self.assertNotIn("lock.className = 'ff-ranked-lock'", source)
        self.assertIn("target?.matches('input,select,textarea,button')", source)
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


class ConnectionTests(unittest.TestCase):
    def test_internal_server_url_is_never_opened_and_pending_connection_resumes(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"FEEDFORGE_HUB_URL": "https://feedforge.org"}):
            app = FastAPI()
            setup(app, {"config_dir": directory})
            client = TestClient(app)
            remote = {"ok": True, "deviceCode": "private-device-code", "userCode": "ABCD-1234", "expiresIn": 600, "interval": 5,
                      "verificationUri": "http://0.0.0.0:3000/connect/feedback", "verificationUriComplete": "https://untrusted.example/?code=ABCD-1234"}
            with patch("routes.urllib.request.urlopen", return_value=io.BytesIO(json.dumps(remote).encode())):
                begun = client.post("/api/plugins/feedforge_connect/begin")
            self.assertEqual(begun.status_code, 200)
            result = begun.json()
            self.assertNotIn("deviceCode", result)
            self.assertEqual(result["verificationUriComplete"], "https://feedforge.org/connect/feedback?code=ABCD-1234")
            pending = client.get("/api/plugins/feedforge_connect/status").json()["pending"]
            self.assertEqual(pending["userCode"], "ABCD-1234")
            self.assertNotIn("deviceCode", pending)
            self.assertGreater(pending["expiresIn"], 590)
            from routes import HubError
            with patch("routes.urllib.request.urlopen", side_effect=HubError(428, {"error": "authorization_pending"})):
                self.assertEqual(client.post("/api/plugins/feedforge_connect/poll").status_code, 428)
            with patch("routes.urllib.request.urlopen", return_value=io.BytesIO(b'{"accessToken":"test-token"}')):
                self.assertTrue(client.post("/api/plugins/feedforge_connect/poll").json()["connected"])
            status = client.get("/api/plugins/feedforge_connect/status").json()
            self.assertTrue(status["connected"])
            self.assertIsNone(status["pending"])
            self.assertNotIn("test-token", json.dumps(status))
            with patch("routes.urllib.request.urlopen", return_value=io.BytesIO(b'{"ok":true}')):
                client.post("/api/plugins/feedforge_connect/disconnect")
            self.assertFalse(client.get("/api/plugins/feedforge_connect/status").json()["connected"])


if __name__ == "__main__":
    unittest.main()
