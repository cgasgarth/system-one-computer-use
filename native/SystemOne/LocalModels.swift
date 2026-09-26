import AppKit

@MainActor
final class LocalModels {
    private var process: Process?
    private var input: FileHandle?
    private var buffer = Data()
    private var pending: (id: String, action: () -> Void)?
    private var startupRequest: String?
    private var warming = false
    private var lastWarm: TimeInterval = 0
    var onStatus: ((ModelEvent) -> Void)?
    var onError: ((String) -> Void)?

    func start() {
        guard process == nil else { return }
        do {
            guard let root = Bundle.main.object(forInfoDictionaryKey: "AppDataPath") as? String,
                  let bun = Bundle.main.object(forInfoDictionaryKey: "BunPath") as? String,
                  let resources = Bundle.main.resourceURL,
                  let executable = Bundle.main.executableURL else { throw CocoaError(.fileNoSuchFile) }
            let child = Process()
            child.executableURL = URL(fileURLWithPath: bun)
            child.arguments = [resources.appendingPathComponent("runtime/models/daemon.js").path]
            child.currentDirectoryURL = URL(fileURLWithPath: root)
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = Bundle.main.object(forInfoDictionaryKey: "ToolSearchPath") as? String
            environment["SYSTEM_ONE_INTEGRATIONS"] = resources.appendingPathComponent("integrations").path
            environment["SYSTEM_ONE_UV"] = executable.deletingLastPathComponent().appendingPathComponent("uv").path
            child.environment = environment
            let stdout = Pipe(), stdin = Pipe()
            child.standardOutput = stdout; child.standardInput = stdin
            let log = URL(fileURLWithPath: root).appendingPathComponent("model-host.log")
            if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
            let stderr = try FileHandle(forWritingTo: log)
            try stderr.seekToEnd()
            child.standardError = stderr
            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil }
                DispatchQueue.main.async { self?.receive(data) }
            }
            child.terminationHandler = { [weak self] child in
                DispatchQueue.main.async {
                    guard let self, self.process === child else { return }
                    self.process = nil
                    self.pending = nil
                    if child.terminationStatus != 0 { self.onError?("The model service stopped. Check model-host.log in Application Support.") }
                }
            }
            try child.run()
            process = child; input = stdin.fileHandleForWriting
            let id = UUID().uuidString; startupRequest = id
            try send(ModelCommand(operation: .prepare, requestId: id))
        } catch { onError?(error.localizedDescription) }
    }

    func warm(immediate: Bool = false) {
        let now = ProcessInfo.processInfo.systemUptime
        guard !warming, immediate || now - lastWarm >= 1 else { return }
        warming = true; lastWarm = now
        do { try send(ModelCommand(operation: .warm)) }
        catch { warming = false; onError?(error.localizedDescription) }
    }
    func configure(_ preferences: ModelPreferences) {
        do { try send(ModelCommand(operation: .configure, preferences: preferences)) }
        catch { onError?(error.localizedDescription) }
    }
    func prepare(_ completion: @escaping () -> Void) {
        let id = UUID().uuidString
        pending = (id, completion)
        do { try send(ModelCommand(operation: .prepare, requestId: id)) }
        catch { pending = nil; onError?(error.localizedDescription) }
    }
    func release() {
        pending = nil
        do { try send(ModelCommand(operation: .release)) }
        catch { onError?(error.localizedDescription) }
    }
    private func send(_ command: ModelCommand) throws {
        guard let input else { throw NSError(domain:"SystemOne.Models", code:1, userInfo:[NSLocalizedDescriptionKey:"Model service is not running."]) }
        var data = try JSONEncoder().encode(command); data.append(10)
        try input.write(contentsOf: data)
    }
    private func receive(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = Data(buffer.prefix(upTo: newline)); buffer.removeSubrange(...newline)
            do {
                let event = try JSONDecoder().decode(ModelEvent.self, from: line)
                switch event.event {
                case .warmed: warming = false
                case .status: onStatus?(event)
                case .error: warming = false; pending = nil; startupRequest = nil; try? send(ModelCommand(operation: .release)); onError?(event.message ?? "Model operation failed.")
                case .prepared:
                    guard let id = event.requestId else { onError?("Model readiness response is missing its request ID."); continue }
                    if id == startupRequest { startupRequest = nil; if pending == nil { release() }; continue }
                    if let request = pending, request.id == id { pending = nil; request.action() }
                    else if pending == nil { release() }
                }
            } catch { onError?("Could not read the model service response: \(error.localizedDescription)") }
        }
    }
    func stop() {
        pending = nil
        let child = process
        process = nil
        try? input?.close(); input = nil
        child?.terminate()
    }
}
