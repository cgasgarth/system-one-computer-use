"""Boundary tests for the local model socket, without loading model weights."""

import importlib.util
import json
import os
import socket
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from threading import Event, Thread
from unittest.mock import patch

from pydantic import ValidationError

MODULE = Path(__file__).with_name("serve.py")
SPEC = importlib.util.spec_from_file_location("local_bridge_serve", MODULE)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class FrameReader:
    def __init__(self, content: bytes):
        self.content = content

    def recv(self, limit: int) -> bytes:
        head, self.content = self.content[:limit], self.content[limit:]
        return head


class ActiveGeneration:
    def __init__(self):
        self.stopped = Event()

    def stop(self) -> None:
        self.stopped.set()


class JuliaEngine:
    def __init__(self):
        self.calls = []
        self.error = None

    def predict(self, **arguments):
        self.calls.append(arguments)
        if self.error is not None:
            raise self.error
        criteria = arguments["questions"]["next_action"]["criteria"]
        count = len(criteria)
        return {"answers": {"next_action": {
            "type": "choice", "choice": "A1",
            "probabilities": {key: 1 / count for key in criteria},
            "max_probability": 1 / count,
        }}}


class SocketBoundaryTests(unittest.TestCase):
    def test_selected_revisions_reach_the_exact_model_loader(self):
        encoder = "a" * 40
        head = "b" * 40
        julia = "c" * 40
        loaded = (lambda *_: {}, lambda: None)
        with patch.object(bridge, "load_clm", return_value=loaded) as clm, \
             patch.object(bridge, "load_julia", return_value=loaded) as julia_loader, \
             patch.object(bridge, "serve") as serve:
            bridge.main(["--provider", "clm", "--socket", "/tmp/clm.sock", "--bits", "8",
                         "--encoder-revision", encoder, "--head-revision", head])
            clm.assert_called_once_with(8, encoder, head)
            bridge.main(["--provider", "julia", "--socket", "/tmp/julia.sock",
                         "--revision", julia])
            julia_loader.assert_called_once_with(julia)
            self.assertEqual(serve.call_count, 2)

    def test_mutable_model_revision_fails_before_loading(self):
        with patch.object(bridge, "load_clm") as load:
            with redirect_stderr(StringIO()), self.assertRaises(SystemExit):
                bridge.main(["--provider", "clm", "--socket", "/tmp/clm.sock",
                             "--encoder-revision", "main", "--head-revision", "a" * 40])
            load.assert_not_called()

    def test_julia_keeps_exact_candidate_keys_and_probabilities(self):
        engine = JuliaEngine()
        body = bridge.DecisionBody.model_validate({
            "model": "julia-latest", "state": "Current screen",
            "questions": {"next_action": {"type": "choice", "instructions": "Choose one.",
                "criteria": {"A0": "First", "A1": "Second", "A2": "Third"}}},
        })
        result = bridge.answer_julia(engine, body)
        self.assertEqual(result["answers"]["next_action"]["choice"], "A1")
        self.assertEqual(list(result["answers"]["next_action"]["probabilities"]), ["A0", "A1", "A2"])
        self.assertEqual(engine.calls[0]["questions"]["next_action"]["criteria"],
                         {"A0": "First", "A1": "Second", "A2": "Third"})

    def test_julia_rejects_too_many_choices_without_inference(self):
        engine = JuliaEngine()
        body = bridge.DecisionBody.model_validate({
            "model": "julia-latest", "state": "Current screen",
            "questions": {"next_action": {"type": "choice", "instructions": "Choose one.",
                "criteria": {f"A{index}": str(index) for index in range(21)}}},
        })
        with self.assertRaisesRegex(ValueError, "capacity_choices:"):
            bridge.answer_julia(engine, body)
        self.assertEqual(engine.calls, [])

    def test_julia_labels_strict_encoding_capacity_errors(self):
        engine = JuliaEngine()
        body = bridge.DecisionBody.model_validate({
            "model": "julia-latest", "state": "Current screen",
            "questions": {"next_action": {"type": "choice", "instructions": "Choose one.",
                "criteria": {"A0": "First", "A1": "Second"}}},
        })
        for upstream, prefix in (
            ("Option exceeds 48-token model contract", "capacity_option_tokens:"),
            ("Question/options exceed lossless head budget", "capacity_question_tokens:"),
            ("Game state exceeds lossless context budget", "capacity_state_tokens:"),
        ):
            engine.error = ValueError(upstream)
            with self.assertRaisesRegex(ValueError, prefix):
                bridge.answer_julia(engine, body)

    def test_buffered_cancelled_request_is_discarded_before_inference(self):
        request = {"role": "text", "body": {
            "model": "default_model", "messages": [{"role": "user", "content": "Hello"}],
            "max_tokens": 8, "temperature": 0,
        }}
        server, client = socket.socketpair()
        client.sendall(json.dumps(request).encode() + b"\n")
        client.close()
        called = []
        with server:
            bridge.answer_frame(server, "text", lambda *_: called.append(True))
        self.assertEqual(called, [])

    def test_cancelled_active_decision_drains_and_next_request_succeeds(self):
        request = {"role": "decision", "body": {
            "model": "test", "state": "Open the requested item.", "questions": {
                "next_action": {"type": "choice", "instructions": "Choose", "criteria": {"A0": "Open"}}
            },
        }}
        response = {"answers": {"next_action": {"choice": "A0", "probabilities": {"A0": 1}}}}
        started, release, finished = Event(), Event(), Event()

        def slow_answer(*_):
            started.set()
            self.assertTrue(release.wait(1))
            return response

        server, client = socket.socketpair()
        client.sendall(json.dumps(request).encode() + b"\n")

        def run():
            with server:
                bridge.answer_frame(server, "decision", slow_answer)
            finished.set()

        worker = Thread(target=run, daemon=True)
        worker.start()
        self.assertTrue(started.wait(1))
        client.close()
        release.set()
        self.assertTrue(finished.wait(1))
        server, client = socket.socketpair()
        with server, client:
            client.sendall(json.dumps(request).encode() + b"\n")
            bridge.answer_frame(server, "decision", lambda *_: response)
            self.assertEqual(json.loads(client.recv(1024))["body"], response)

    def test_decision_request_and_response_use_one_framed_message(self):
        request = {
            "role": "decision",
            "body": {
                "model": "kev-latest",
                "state": "The user asks to open Notes.",
                "questions": {
                    "next_action": {
                        "type": "choice",
                        "instructions": "Choose one action.",
                        "criteria": {"A0": "Open Notes", "A1": "Open Calendar"},
                    }
                },
            },
        }
        left, right = socket.socketpair()
        with left, right:
            right.sendall(json.dumps(request).encode() + b"\n")
            parsed = bridge.DecisionEnvelope.model_validate(bridge.read_frame(left))
            self.assertEqual(parsed.body.questions["next_action"].criteria["A0"], "Open Notes")
            bridge.send_response(left, {"ok": True, "body": {"answers": {}}})
            self.assertEqual(json.loads(right.recv(1024)), {"ok": True, "body": {"answers": {}}})

    def test_external_request_rejects_wrong_role_and_unknown_fields(self):
        body = {
            "model": "default_model",
            "messages": [{"role": "user", "content": "Hello"}],
            "max_tokens": 8,
            "temperature": 0,
        }
        with self.assertRaises(ValidationError):
            bridge.DecisionEnvelope.model_validate({"role": "text", "body": body})
        with self.assertRaises(ValidationError):
            bridge.TextEnvelope.model_validate({"role": "text", "body": {**body, "extra": 1}})

    def test_client_close_stops_active_text_generation(self):
        server, client = socket.socketpair()
        active = ActiveGeneration()
        cancelled = Event()
        watcher = Thread(
            target=bridge.watch_client_close,
            args=(server, cancelled, [active]),
            daemon=True,
        )
        watcher.start()
        client.close()
        self.assertTrue(cancelled.wait(1))
        self.assertTrue(active.stopped.is_set())
        server.close()

    def test_frame_limit_and_second_request_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "exceeds 4 MiB"):
            bridge.read_frame(FrameReader(b"x" * (bridge.MAX_FRAME_BYTES + 2)))
        with self.assertRaisesRegex(ValueError, "One model request"):
            bridge.read_frame(FrameReader(b"{}\n{}\n"))

    def test_socket_refuses_a_public_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            os.chmod(temporary, 0o755)
            with self.assertRaisesRegex(ValueError, "private and owned"):
                bridge.serve(Path(temporary) / "model.sock", "text", lambda *_: {}, lambda: None)


if __name__ == "__main__":
    unittest.main()
