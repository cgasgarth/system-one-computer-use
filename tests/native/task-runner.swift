import AppKit

@main
@MainActor
struct TaskRunnerTests {
    static func started(_ runner: TaskRunner) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            runner.onEvent = { _ in
                runner.onEvent = nil
                continuation.resume()
            }
            runner.onError = { message in
                continuation.resume(throwing: NSError(domain: "Test", code: 1, userInfo: [NSLocalizedDescriptionKey: message]))
            }
            do {
                try runner.start(TaskInput(task: "Fixture", mode: "desktop", session: SessionSelection(mode: .auto), submittedAt: 1))
            } catch { continuation.resume(throwing: error) }
        }
    }

    static func main() async throws {
        guard let root = Bundle.main.object(forInfoDictionaryKey: "AppDataPath") as? String else {
            throw CocoaError(.fileNoSuchFile)
        }
        let marker = URL(fileURLWithPath: root).appendingPathComponent("cleanup-complete")
        let runner = TaskRunner()
        for manuallyStopped in [true, false] {
            try? FileManager.default.removeItem(at: marker)
            try await started(runner)
            if manuallyStopped {
                runner.cancel()
                var rejected = false
                do { try runner.start(TaskInput(task: "Overlap", mode: "desktop", session: SessionSelection(mode: .auto), submittedAt: 2)) }
                catch { rejected = true }
                precondition(rejected, "A new task must wait for the old controls to stop")
            }
            await withCheckedContinuation { continuation in
                runner.shutdown { continuation.resume() }
            }
            precondition(FileManager.default.fileExists(atPath: marker.path), "Shutdown returned before the worker released its controls")
        }
        print("Task runner: Stop and quit await worker cleanup; follow-up starts after teardown.")
    }
}
