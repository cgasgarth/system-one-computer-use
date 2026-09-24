import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private enum Phase { case ready, recording, transcribing, running }
    private let content = TaskMenu()
    private let settings = SettingsMenu()
    private let popover = NSPopover()
    private let runner = TaskRunner()
    private let models = LocalModels()
    private let shortcut = VoiceShortcut()
    private var phase = Phase.ready
    private var statusItem: NSStatusItem?
    private var transcriptionTimer: Timer?
    private var handy: Process?
    private var initialized = false

    func start() {
        guard !initialized else { return }
        initialized = true
        NSApp.setActivationPolicy(.accessory)
        configureEditingCommands()
        popover.contentViewController = content
        popover.contentSize = TaskMenu.size
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self
        content.loadViewIfNeeded()
        content.onSizeChange = { [weak self] size in
            guard let self, self.popover.contentViewController === self.content else { return }
            self.popover.contentSize = size
        }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "cursorarrow.rays", accessibilityDescription: "System One Computer Use")
        item.button?.toolTip = "System One Computer Use"
        item.button?.target = self
        item.button?.action = #selector(toggleMenu)
        statusItem = item
        content.run.target = self
        content.run.action = #selector(runTask)
        content.voice.target = self
        content.voice.action = #selector(toggleVoice)
        content.cancel.target = self
        content.cancel.action = #selector(cancelTask)
        content.settings.target = self
        content.settings.action = #selector(showSettings)
        settings.loadViewIfNeeded()
        settings.onSizeChange = { [weak self] size in
            guard let self, self.popover.contentViewController === self.settings else { return }
            self.popover.contentSize = size
        }
        settings.onModelsChange = { [weak self] preferences in self?.runner.cancel(); self?.models.configure(preferences) }
        settings.back.target = self
        settings.back.action = #selector(showTasks)
        settings.save.target = self
        settings.save.action = #selector(saveSettings)
        settings.shortcut.target = self
        settings.shortcut.action = #selector(recordShortcut)
        settings.quit.target = self
        settings.quit.action = #selector(quit)
        content.mode.selectItem(at: UserDefaults.standard.integer(forKey: "targetMode"))
        content.editor.onPaste = { [weak self] in self?.transcriptArrived() }
        runner.onEvent = { [weak self] in self?.taskEvent($0) }
        runner.onError = { [weak self] in self?.fail($0) }
        shortcut.onPress = { [weak self] in self?.toggleVoice() }
        shortcut.onChange = { [weak self] label in
            self?.settings.shortcut.title = label
            self?.content.voice.toolTip = "Dictate with Handy: \(label)"
        }
        shortcut.onError = { [weak self] in self?.settings.status.stringValue = $0 }
        models.onStatus = { [weak self] event in
            guard let self else { return }
            self.settings.updateModels(event)
            if let loading = event.models?.first(where: { $0.state == .downloading || $0.state == .loading }) {
                self.content.setStatus(loading.message, color: .secondaryLabelColor)
            } else if self.phase == .ready, let decision = event.models?.first(where: { $0.role == .decision }) {
                self.content.setStatus(decision.message, color: decision.state == .error ? .systemOrange : .secondaryLabelColor)
            }
        }
        models.onError = { [weak self] message in
            self?.settings.status.stringValue = message
            self?.settings.status.textColor = .systemOrange
            self?.fail(message)
        }
        models.start()
        shortcut.start()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showMenu(); return true }

    @objc private func toggleMenu() {
        if popover.isShown { popover.performClose(nil) } else { showMenu() }
    }

    private func configureEditingCommands() {
        let menu = NSMenu()
        let edit = NSMenu(title: "Edit")
        for (title, action, key) in [
            ("Cut", #selector(NSText.cut(_:)), "x"),
            ("Copy", #selector(NSText.copy(_:)), "c"),
            ("Paste", #selector(NSText.paste(_:)), "v"),
            ("Select All", #selector(NSText.selectAll(_:)), "a"),
        ] { edit.addItem(withTitle: title, action: action, keyEquivalent: key) }
        let item = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        item.submenu = edit
        menu.addItem(item)
        NSApp.mainMenu = menu
    }

    private func showMenu() {
        guard let button = statusItem?.button else { return }
        NSApp.activate(ignoringOtherApps: true)
        if !popover.isShown { popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY) }
        popover.contentViewController?.view.window?.makeKey()
        content.focus()
    }

    @objc private func recordShortcut() { shortcut.record() }

    @objc private func showSettings() {
        cancelVoice()
        settings.load()
        popover.contentViewController = settings
        popover.contentSize = settings.preferredContentSize
    }

    @objc private func showTasks() {
        shortcut.stopRecording()
        popover.contentViewController = content
        popover.contentSize = content.preferredContentSize
        content.focus()
    }

    @objc private func saveSettings() {
        settings.persist()
        if phase != .running { runner.cancel() }
        content.mode.selectItem(at: settings.mode.indexOfSelectedItem)
    }

    @objc func toggleVoice() {
        guard phase != .running, phase != .transcribing else { showMenu(); return }
        showTasks()
        showMenu()
        content.cancel.isEnabled = true
        content.cancel.isHidden = false
        if phase == .recording {
            phase = .transcribing
            content.status.stringValue = "Handy is transcribing. The task will run when the text arrives."
            content.voice.title = "Transcribing…"
            invokeHandy("--toggle-transcription")
            let timer = Timer(timeInterval: 60, target: self,
                selector: #selector(transcriptionTimedOut), userInfo: nil, repeats: false)
            transcriptionTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        } else {
            content.editor.string = ""
            content.editor.needsDisplay = true
            phase = .recording
            content.voice.title = "Stop and run"
            content.status.stringValue = "Listening with Handy. Press \(shortcut.value.label) again to stop and run."
            invokeHandy("--toggle-transcription")
        }
    }

    private func invokeHandy(_ flag: String) {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/Applications/Handy.app/Contents/MacOS/handy")
        child.arguments = [flag]
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        do { try child.run(); handy = child }
        catch { fail("Could not start Handy: \(error.localizedDescription)") }
    }

    private func transcriptArrived() {
        guard phase == .transcribing else { return }
        transcriptionTimer?.invalidate()
        phase = .ready
        runTask()
    }

    @objc private func transcriptionTimedOut() {
        invokeHandy("--cancel")
        fail("No transcript arrived. Check Handy’s microphone/model settings, or type a task here.")
    }

    @objc private func runTask() {
        guard phase == .ready else { return }
        let task = content.editor.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !task.isEmpty else { content.status.stringValue = "Enter a task first."; return }
        phase = .running
        content.run.isEnabled = false
        content.voice.isEnabled = false
        content.setLocked(true)
        content.cancel.isEnabled = true
        content.cancel.isHidden = false
        content.setStatus("Planning task…", color: .secondaryLabelColor)
        content.latency.stringValue = "—"
        content.rate.stringValue = "—"
        let mode = ["auto", "browser", "desktop"][content.mode.indexOfSelectedItem]
        models.prepare { [weak self] in
            guard let self, self.phase == .running else { return }
            do { try self.runner.start(task: task, mode: mode) }
            catch { self.fail(error.localizedDescription) }
        }
    }

    private func taskEvent(_ event: TaskEvent) {
        content.setStatus(event.message, color: .secondaryLabelColor)
        if let milliseconds = event.medianDecisionMs { content.latency.stringValue = String(format: "%.1f", milliseconds) }
        if let rate = event.modelActionsPerSecond { content.rate.stringValue = String(format: "%.2f", rate) }
        statusItem?.button?.toolTip = event.message
        if event.status == .running { return }
        models.release()
        ready()
        if event.status == .complete {
            content.setStatus("Completed · \(event.decisions ?? 0) decisions", color: .systemGreen)
        } else {
            content.setStatus(event.message, color: .systemOrange)
        }
    }

    private func ready() {
        phase = .ready
        content.run.isEnabled = true
        content.voice.isEnabled = true
        content.voice.title = "Dictate"
        content.setLocked(false)
        content.cancel.isEnabled = false
        content.cancel.isHidden = true
    }

    private func fail(_ message: String) {
        transcriptionTimer?.invalidate()
        ready()
        content.setStatus(message, color: .systemOrange)
    }

    private func cancelVoice() {
        if phase == .recording || phase == .transcribing { invokeHandy("--cancel"); ready() }
        transcriptionTimer?.invalidate()
    }

    @objc private func cancelTask() {
        cancelVoice()
        runner.cancel()
        models.release()
        ready()
        content.setStatus("Stopped", color: .secondaryLabelColor)
    }

    func popoverDidClose(_ notification: Notification) {
        shortcut.stopRecording()
        cancelVoice()
    }

    func popoverDidShow(_ notification: Notification) {
        NSApp.activate(ignoringOtherApps: true)
        popover.contentViewController?.view.window?.makeKey()
        if popover.contentViewController === content { content.focus() }
    }

    @objc private func quit() { cancelTask(); NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { cancelTask(); models.stop(); shortcut.stop() }
}
