import AppKit

struct TaskInput: Encodable {
    let kind = "task"
    let task: String
    let mode: String
    let session: SessionSelection
    let submittedAt: Int64
}

struct TaskEvent: Decodable {
    enum Status: String, Decodable { case running, complete, blocked, error }
    let status: Status
    let message: String
    let decisions: Int?
    let modelActionsPerSecond: Double?
    let medianDecisionMs: Double?
    let sessionId: String?
}

@MainActor
final class TaskRunner {
    private var process: Process?
    private var buffer = Data()
    private var ended = false
    private var generation = UUID()
    private var input: FileHandle?
    private var retiring = Set<Process>()
    private var shutdownCompletion: (() -> Void)?
    var onEvent: ((TaskEvent) -> Void)?
    var onError: ((String) -> Void)?

    func start(_ request: TaskInput) throws {
        guard retiring.isEmpty else {
            throw NSError(domain: "SystemOne", code: 1, userInfo: [NSLocalizedDescriptionKey: "The previous task is still releasing computer control. Try again in a moment."])
        }
        if process != nil {
            ended = false
            try send(request)
            return
        }
        let current = UUID()
        generation = current
        guard let root = Bundle.main.object(forInfoDictionaryKey: "AppDataPath") as? String,
              let bun = Bundle.main.object(forInfoDictionaryKey: "BunPath") as? String,
              let resources = Bundle.main.resourceURL else {
            throw CocoaError(.fileNoSuchFile)
        }
        let child = Process()
        child.executableURL = URL(fileURLWithPath: bun)
        child.arguments = [resources.appendingPathComponent("runtime/worker.js").path]
        child.currentDirectoryURL = URL(fileURLWithPath: root)
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = Bundle.main.object(forInfoDictionaryKey: "ToolSearchPath") as? String
        child.environment = environment
        let output = Pipe()
        let stdin = Pipe()
        child.standardOutput = output
        child.standardInput = stdin
        child.standardError = FileHandle.nullDevice
        buffer.removeAll()
        ended = false
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil }
            DispatchQueue.main.async {
                guard self?.generation == current else { return }
                self?.receive(data)
            }
        }
        child.terminationHandler = { [weak self] child in
            DispatchQueue.main.async {
                guard let self else { return }
                self.retiring.remove(child)
                if self.retiring.isEmpty {
                    let completion = self.shutdownCompletion
                    self.shutdownCompletion = nil
                    completion?()
                }
                guard self.generation == current else { return }
                self.process = nil
                if !self.ended {
                    self.onError?("Task process stopped (\(child.terminationStatus)). Check the model services and .env configuration.")
                }
            }
        }
        try child.run()
        process = child
        input = stdin.fileHandleForWriting
        try send(request)
    }

    private func send<Value: Encodable>(_ request: Value) throws {
        var data = try JSONEncoder().encode(request)
        data.append(10)
        try input?.write(contentsOf: data)
    }

    private func receive(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer.prefix(upTo: newline)
            buffer.removeSubrange(...newline)
            do {
                let event = try JSONDecoder().decode(TaskEvent.self, from: line)
                ended = event.status != .running
                onEvent?(event)
            } catch {
                onError?("Invalid response from task process: \(error.localizedDescription)")
            }
        }
    }

    func cancel() {
        generation = UUID()
        ended = true
        if let child = process, child.isRunning {
            retiring.insert(child)
            child.terminate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
                if child.isRunning { kill(child.processIdentifier, SIGKILL) }
            }
        }
        process = nil
        try? input?.close()
        input = nil
    }

    func shutdown(completion: @escaping () -> Void) {
        cancel()
        if retiring.isEmpty { completion() }
        else { shutdownCompletion = completion }
    }
}
