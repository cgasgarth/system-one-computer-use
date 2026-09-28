import AppKit
import ApplicationServices

private struct PermissionResult: Encodable { let accessibility: Bool }

let arguments = CommandLine.arguments
if arguments.count == 2, arguments[1] == "permissions" {
    let result = PermissionResult(accessibility: AXIsProcessTrusted())
    try? FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(result))
} else if arguments.count == 4, arguments[1] == "watch", let mode = WindowWatchMode(rawValue: arguments[3]) {
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
} else if arguments.count == 4, arguments[1] == "document", let pid = Int32(arguments[2]), pid > 0 {
    do {
        let expected = try JSONDecoder().decode(FieldFrame.self, from: Data(arguments[3].utf8))
        let response = try WritableFields.document(pid: pid, expected: expected)
        try FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(response))
    } catch {
        let message: String
        if case NativeAccessError.message(let detail) = error { message = detail }
        else { message = "Could not inspect the native document URL." }
        try? FileHandle.standardError.write(contentsOf: Data(message.utf8))
        exit(1)
    }
} else if arguments.count == 3, arguments[1] == "menus", let pid = Int32(arguments[2]), pid > 0 {
    do {
        let response = try MenuItems.read(pid: pid)
        try FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(response))
    } catch {
        try? FileHandle.standardError.write(contentsOf: Data("Could not inspect native menus.".utf8))
        exit(1)
    }
} else if arguments.count == 4, arguments[1] == "menus", let pid = Int32(arguments[2]), pid > 0 {
    do {
        let response = try MenuItems.read(pid: pid, topLevel: arguments[3])
        try FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(response))
    } catch {
        let message: String
        if case NativeAccessError.message(let detail) = error { message = detail }
        else { message = "Could not inspect the selected native menu." }
        try? FileHandle.standardError.write(contentsOf: Data(message.utf8))
        exit(1)
    }
} else { exit(2) }
