"""Boundary tests for the local model socket, without loading model weights."""

import importlib.util
import json
import os
import socket
import tempfile
import unittest
from pathlib import Path
from threading import Event, Thread

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


class SocketBoundaryTests(unittest.TestCase):
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
