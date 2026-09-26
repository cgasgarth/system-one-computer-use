import AppKit

let arguments = CommandLine.arguments
if arguments.count == 4, arguments[1] == "watch", let mode = WindowWatchMode(rawValue: arguments[3]) {
    let watcher = WindowEvents(name: arguments[2], mode: mode)
    watcher.start()
    if !watcher.isFinished { CFRunLoopRun() }
    withExtendedLifetime(watcher) {}
} else if arguments.count == 4, arguments[1] == "fields", let pid = Int32(arguments[2]) {
    do {
        let expected = try JSONDecoder().decode(FieldFrame.self, from: Data(arguments[3].utf8))
        let response = try WritableFields.read(pid: pid, expected: expected)
        try FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(response))
    } catch {
        let message: String
        if case NativeAccessError.message(let detail) = error { message = detail }
        else { message = "Could not inspect native text field capabilities." }
        try? FileHandle.standardError.write(contentsOf: Data(message.utf8))
        exit(1)
    }
} else { exit(2) }
