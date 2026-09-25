import Foundation

@MainActor
final class HandyCommands {
    private var pending: [String] = []
    private var active: Process?
    var onError: ((String) -> Void)?

    func send(_ flag: String) {
        if flag == "--cancel" { pending.removeAll() }
        pending.append(flag)
        next()
    }

    private func next() {
        guard active == nil, !pending.isEmpty else { return }
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/Applications/Handy.app/Contents/MacOS/handy")
        child.arguments = [pending.removeFirst()]
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        child.terminationHandler = { [weak self] child in
            DispatchQueue.main.async {
                guard let self, self.active === child else { return }
                self.active = nil
                if child.terminationStatus != 0 {
                    self.pending.removeAll()
                    self.onError?("Handy could not accept the dictation command. Open Handy and check its status.")
                } else { self.next() }
            }
        }
        do { try child.run(); active = child }
        catch { pending.removeAll(); onError?("Could not start Handy: \(error.localizedDescription)") }
    }
}
