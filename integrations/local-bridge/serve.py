"""Serve one local model over a private, one-request-per-connection Unix socket."""

import argparse
import json
import os
import re
import select
import signal
import socket
import stat
import sys
from dataclasses import replace
from pathlib import Path
from threading import Event, Thread
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

MAX_FRAME_BYTES = 4_194_304
READY_LINE = "SYSTEM_ONE_MODEL_READY"
REVISION_PATTERN = re.compile(r"[0-9a-f]{40}\Z")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DecisionQuestion(StrictModel):
    type: Literal["choice"]
    instructions: str
    criteria: dict[str, str] = Field(min_length=1, max_length=255)


class DecisionBody(StrictModel):
    model: str
    state: str
    questions: dict[str, DecisionQuestion] = Field(min_length=1)


class TextMessage(StrictModel):
    role: Literal["system", "user"]
    content: str


class TextBody(StrictModel):
    model: str
    messages: list[TextMessage]
    max_tokens: int = Field(gt=0)
    temperature: float


class DecisionEnvelope(StrictModel):
    role: Literal["decision"]
    body: DecisionBody


class TextEnvelope(StrictModel):
    role: Literal["text"]
    body: TextBody


def read_frame(connection: socket.socket) -> dict:
    payload = bytearray()
    while len(payload) <= MAX_FRAME_BYTES:
        chunk = connection.recv(min(65536, MAX_FRAME_BYTES + 1 - len(payload)))
        if not chunk:
            raise ValueError("The model request ended before its newline.")
        payload.extend(chunk)
        if b"\n" in chunk:
            line, rest = bytes(payload).split(b"\n", 1)
            if rest:
                raise ValueError("One model request per connection is allowed.")
            return json.loads(line)
    raise ValueError("The model request exceeds 4 MiB.")


def disconnected(connection: socket.socket) -> bool:
    try:
        readable, _, _ = select.select([connection], [], [], 0)
        return bool(readable) and not connection.recv(1, socket.MSG_PEEK)
    except OSError:
        return True


def send_response(connection: socket.socket, body: dict) -> None:
    data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode() + b"\n"
    if len(data) > MAX_FRAME_BYTES:
        raise ValueError("The model response exceeds 4 MiB.")
    connection.sendall(data)


def answer_frame(connection: socket.socket, role: Literal["decision", "text"], answer) -> None:
    raw = read_frame(connection)
    envelope = (
        DecisionEnvelope.model_validate(raw)
        if role == "decision"
        else TextEnvelope.model_validate(raw)
    )
    # A request can remain buffered after its caller cancels while another
    # request is running. Do not start inference for that abandoned work.
    if disconnected(connection):
        return
    result = answer(envelope.body, connection)
    # Decision inference drains synchronously; its future is not cancelled.
    # This keeps the upstream worker usable for the next client.
    if not disconnected(connection):
        send_response(connection, {"ok": True, "body": result})


def watch_client_close(connection: socket.socket, cancelled: Event, active_context: list) -> None:
    try:
        connection.recv(1)
    except OSError:
        pass
    cancelled.set()
    if active_context:
        active_context[0].stop()


def load_kev(run: str):
    # ModelSlot downloaded the exact checkpoint and its declared base first.
    # A resident serving process must not require network access to warm.
    os.environ["HF_HUB_OFFLINE"] = "1"
    import torch
    from kev.checkpoint import Checkpoint, LoadOptions
    from kev.device import default_device
    from kev.serve import Server

    device = default_device()
    options = LoadOptions.from_env()
    if device == "mps" and options.attn is None:
        options = replace(options, attn="sdpa")
    if device != "cpu" and options.dtype is None:
        options = replace(options, dtype=torch.bfloat16)
    if device == "cuda" and options.cuda_graphs is None:
        options = replace(options, cuda_graphs=True)
    if device == "cuda" and options.fused is None:
        options = replace(options, fused=True)
    if options.backend is None:
        options = replace(options, backend="auto")
    checkpoint = Checkpoint(run)
    tokenizer, model = checkpoint.load(device, options)
    server = Server(checkpoint, tokenizer, model, device)

    def answer(body: DecisionBody, _connection: socket.socket) -> dict:
        from kev.api import SystemOneRequest

        request = SystemOneRequest.model_validate(body.model_dump())
        return server.answer(request)

    return answer, server.close


def load_clm(bits: int, encoder_revision: str, head_revision: str):
    import torch
    from clm.engine import Engine
    from clm_mlx.encoder import MLXEmbedder
    from huggingface_hub import hf_hub_download, snapshot_download

    torch.set_num_threads(1)
    encoder_path = snapshot_download(
        "Qwen/Qwen3-8B",
        revision=encoder_revision,
        allow_patterns=["*.safetensors", "*.json", "*.txt", "*.model"],
        max_workers=4,
        local_files_only=True,
    )
    head_path = hf_hub_download(
        "Contrastive-LM/CLM-v0.1-8B", "CLM_v0.1-8B.pt", revision=head_revision,
        local_files_only=True,
    )
    engine = Engine(
        embedder=MLXEmbedder(encoder_path, bits),
        checkpoint=head_path,
        device="cpu",
        action_cache="64MiB",
    )
    engine.heads["clm-latest"].ensure()

    def answer(body: DecisionBody, _connection: socket.socket) -> dict:
        return engine.answer(
            body.state,
            {key: question.model_dump() for key, question in body.questions.items()},
            model=body.model,
            temperature=1.0,
        )

    return answer, lambda: None


def julia_capacity_error(error: ValueError) -> ValueError:
    message = str(error)
    for upstream, prefix in (
        ("Option exceeds 48-token model contract", "capacity_option_tokens"),
        ("Question/options exceed lossless head budget", "capacity_question_tokens"),
        ("Game state exceeds lossless context budget", "capacity_state_tokens"),
    ):
        if upstream in message:
            return ValueError(f"{prefix}: {message}")
    return error


def answer_julia(engine, body: DecisionBody) -> dict:
    if body.model != "julia-latest":
        raise ValueError("The requested Julia model is not loaded.")
    criteria = body.questions["next_action"].criteria
    if not 2 <= len(criteria) <= 20:
        raise ValueError("capacity_choices: Julia requires 2 to 20 choices per question.")
    try:
        return engine.predict(
            state=body.state,
            questions={key: question.model_dump() for key, question in body.questions.items()},
        )
    except ValueError as error:
        raise julia_capacity_error(error) from error


def load_julia(revision: str):
    import torch
    from julia_runtime.checkpoint import resolved_snapshot

    snapshot = resolved_snapshot(revision, offline=True)
    sys.path.insert(0, str(snapshot))
    from julia import load_model

    torch.set_num_threads(4)
    engine = load_model(
        str(snapshot),
        device="cpu",
        max_length=8192,
        head_length=512,
        strict_encoding=True,
        marker_only_head=False,
        backend="torch",
    )

    def answer(body: DecisionBody, _connection: socket.socket) -> dict:
        return answer_julia(engine, body)

    return answer, lambda: None


def load_text(model_path: str):
    import mlx.core as mx
    from mlx_lm.models.cache import LRUPromptCache
    from mlx_lm.server import (
        CompletionRequest,
        GenerationArguments,
        LogitsProcessorArguments,
        ModelDescription,
        ModelProvider,
        ResponseGenerator,
        SamplingArguments,
    )

    if mx.metal.is_available():
        mx.set_wired_limit(mx.device_info()["max_recommended_working_set_size"])
    options = argparse.Namespace(
        model=model_path,
        adapter_path=None,
        draft_model=None,
        trust_remote_code=False,
        chat_template="",
        use_default_chat_template=False,
        pipeline=False,
        chat_template_args={"enable_thinking": False},
        prefill_step_size=2048,
        prompt_cache_size=10,
        prompt_cache_bytes=None,
        decode_concurrency=32,
        prompt_concurrency=8,
    )
    provider = ModelProvider(options)
    provider.load_default()
    generator = ResponseGenerator(provider, LRUPromptCache(options.prompt_cache_size))

    def answer(body: TextBody, connection: socket.socket) -> dict:
        if body.model != "default_model":
            raise ValueError("The requested text model is not loaded.")
        arguments = GenerationArguments(
            model=ModelDescription("default_model", "default_model", None),
            sampling=SamplingArguments(body.temperature, 1.0, 0, 0.0, 0.0, 0.0),
            logits=LogitsProcessorArguments(None, 0.0, 20, 0.0, 20, 0.0, 20),
            stop_words=[],
            max_tokens=body.max_tokens,
            num_draft_tokens=3,
            logprobs=False,
            top_logprobs=-1,
            seed=None,
            chat_template_kwargs=None,
        )
        request = CompletionRequest(
            "chat", "", [message.model_dump() for message in body.messages], None, None
        )
        cancelled = Event()
        active_context = []
        Thread(
            target=watch_client_close,
            args=(connection, cancelled, active_context),
            name="text-client-disconnect",
            daemon=True,
        ).start()
        context, stream = generator.generate(request, arguments)
        active_context.append(context)
        if cancelled.is_set():
            context.stop()
        text = []
        finish_reason = "stop"
        try:
            for token in stream:
                if cancelled.is_set():
                    context.stop()
                    return {"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]}
                if token.state == "normal":
                    text.append(token.text)
                if token.finish_reason is not None:
                    finish_reason = token.finish_reason
        finally:
            context.stop()
        return {"choices": [{"message": {"content": "".join(text)}, "finish_reason": finish_reason}]}

    return answer, generator.stop_and_join


def serve(socket_path: Path, role: Literal["decision", "text"], answer, close) -> None:
    directory = os.lstat(socket_path.parent)
    if (
        not stat.S_ISDIR(directory.st_mode)
        or directory.st_uid != os.getuid()
        or directory.st_mode & 0o077
    ):
        raise ValueError("The model socket directory must be private and owned by this user.")
    if socket_path.exists() or socket_path.is_symlink():
        raise ValueError("The model socket path is already in use.")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(socket_path))
    os.chmod(socket_path, 0o600)
    listener.listen(8)
    print(READY_LINE, file=sys.stderr, flush=True)
    try:
        while True:
            connection, _ = listener.accept()
            with connection:
                try:
                    answer_frame(connection, role, answer)
                except (ValueError, ValidationError, json.JSONDecodeError) as error:
                    if not disconnected(connection):
                        send_response(connection, {"ok": False, "error": str(error)[:500]})
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception as error:
                    if not disconnected(connection):
                        send_response(connection, {"ok": False, "error": str(error)[:500]})
    finally:
        listener.close()
        socket_path.unlink(missing_ok=True)
        close()


def required_revision(parser: argparse.ArgumentParser, value: str | None, flag: str) -> str:
    if value is None or REVISION_PATTERN.fullmatch(value) is None:
        parser.error(f"{flag} requires an exact 40-character checkpoint SHA")
    return value


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Local model Unix socket service")
    parser.add_argument("--provider", choices=("kev", "clm", "julia", "text"), required=True)
    parser.add_argument("--socket", type=Path, required=True)
    parser.add_argument("--run")
    parser.add_argument("--bits", type=int, choices=(0, 4, 8))
    parser.add_argument("--model-path")
    parser.add_argument("--encoder-revision")
    parser.add_argument("--head-revision")
    parser.add_argument("--revision")
    args = parser.parse_args(argv)
    if args.provider == "kev":
        if args.run is None:
            parser.error("Kev requires --run")
        answer, close = load_kev(args.run)
    elif args.provider == "clm":
        encoder = required_revision(parser, args.encoder_revision, "--encoder-revision")
        head = required_revision(parser, args.head_revision, "--head-revision")
        answer, close = load_clm(4 if args.bits is None else args.bits, encoder, head)
    elif args.provider == "julia":
        revision = required_revision(parser, args.revision, "--revision")
        answer, close = load_julia(revision)
    else:
        if args.model_path is None:
            parser.error("Text requires --model-path")
        answer, close = load_text(args.model_path)
    role = "text" if args.provider == "text" else "decision"
    serve(args.socket, role, answer, close)


if __name__ == "__main__":
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)

    def terminate(_signal, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, terminate)
    try:
        main()
    except KeyboardInterrupt:
        pass
