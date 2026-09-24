import AppKit

struct TaskInput: Encodable {
    let task: String
    let mode: String
}

struct TaskEvent: Decodable {
    enum Status: String, Decodable { case running, complete, error }
    let status: Status
    let message: String
    let decisions: Int?
    let modelActionsPerSecond: Double?
    let medianDecisionMs: Double?
}

@MainActor
final class TaskRunner {
    private var process: Process?
    private var buffer = Data()
    private var ended = false
    private var generation = UUID()
    private var input: FileHandle?
    var onEvent: ((TaskEvent) -> Void)?
    var onError: ((String) -> Void)?

    func start(task: String, mode: String) throws {
        if process != nil {
            ended = false
            try send(task: task, mode: mode)
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
                guard let self, self.generation == current else { return }
                self.process = nil
                if !self.ended {
                    self.onError?("Task process stopped (\(child.terminationStatus)). Check the model services and .env configuration.")
                }
            }
        }
        try child.run()
        process = child
        input = stdin.fileHandleForWriting
        try send(task: task, mode: mode)
    }

    private func send(task: String, mode: String) throws {
        var data = try JSONEncoder().encode(TaskInput(task: task, mode: mode))
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
        process?.terminate()
        process = nil
        try? input?.close()
        input = nil
    }
}
