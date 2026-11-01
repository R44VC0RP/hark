import ExpoModulesCore
import UIKit

/** One shortcut as JavaScript describes it. */
struct KeyCommandSpec: Record {
  @Field var id: String = ""
  /** A character ("r", "1", "[") or "left"/"right"/"up"/"down"/"escape". */
  @Field var input: String = ""
  /** Any of "command", "shift", "option", "control". */
  @Field var modifiers: [String] = []
  /** Shown in the overlay that appears while ⌘ is held. */
  @Field var title: String = ""
}

/**
 * Hardware keyboard shortcuts. The commands live on the root view
 * controller, so they work whatever has focus (a web page included) and
 * show in the shortcut overlay while ⌘ is held. Every responder implements
 * their action, so whichever one is first in the chain (a web page's content
 * view included) forwards it here as an event.
 */
public class HarkKeyCommandsModule: Module {
  fileprivate static weak var current: HarkKeyCommandsModule?
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?

  public func definition() -> ModuleDefinition {
    Name("HarkKeyCommands")
    Events("onKeyCommand")

    OnCreate {
      HarkKeyCommandsModule.current = self
    }

    Function("setCommands") { (specs: [KeyCommandSpec]) in
      DispatchQueue.main.async { self.install(specs, attempts: 10) }
    }
  }

  fileprivate func fire(_ command: UIKeyCommand) {
    guard let id = command.propertyList as? String else { return }
    sendEvent("onKeyCommand", ["id": id])
  }

  private func install(_ specs: [KeyCommandSpec], attempts: Int) {
    guard let root = Self.rootViewController() else {
      // The window may not exist yet at launch.
      if attempts > 0 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
          self.install(specs, attempts: attempts - 1)
        }
      }
      return
    }
    for command in installed { host?.removeKeyCommand(command) }
    installed = specs.map { spec in
      let command = UIKeyCommand(
        title: spec.title,
        action: #selector(UIResponder.harkKeyCommand(_:)),
        input: Self.input(spec.input),
        modifierFlags: Self.flags(spec.modifiers),
        propertyList: spec.id
      )
      // Ours win over the web view's own handling of the same keys.
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
    for command in installed { root.addKeyCommand(command) }
    host = root
  }

  private static func rootViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? scenes.first?.windows.first
    return window?.rootViewController
  }

  private static func input(_ value: String) -> String {
    switch value {
    case "left": return UIKeyCommand.inputLeftArrow
    case "right": return UIKeyCommand.inputRightArrow
    case "up": return UIKeyCommand.inputUpArrow
    case "down": return UIKeyCommand.inputDownArrow
    case "escape": return UIKeyCommand.inputEscape
    default: return value
    }
  }

  private static func flags(_ names: [String]) -> UIKeyModifierFlags {
    var flags: UIKeyModifierFlags = []
    for name in names {
      switch name {
      case "command": flags.insert(.command)
      case "shift": flags.insert(.shift)
      case "option": flags.insert(.alternate)
      case "control": flags.insert(.control)
      default: break
      }
    }
    return flags
  }
}

extension UIResponder {
  /** Handles every Hark key command, wherever the responder chain starts. */
  @objc func harkKeyCommand(_ sender: UIKeyCommand) {
    HarkKeyCommandsModule.current?.fire(sender)
  }
}
