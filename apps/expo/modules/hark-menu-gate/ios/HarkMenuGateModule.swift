import ExpoModulesCore
import UIKit
// The subclass header declares `ignore(_:for:)`.
import UIKit.UIGestureRecognizerSubclass

/**
 * Installs `MenuTouchGate` in every window. Nothing to call from
 * JavaScript: Expo creates the module at launch.
 */
public class HarkMenuGateModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HarkMenuGate")

    OnCreate {
      DispatchQueue.main.async {
        for scene in UIApplication.shared.connectedScenes {
          for window in (scene as? UIWindowScene)?.windows ?? [] {
            MenuTouchGate.install(in: window)
          }
        }
        // Windows made later (a new iPad scene, the first window at launch).
        self.observer = NotificationCenter.default.addObserver(
          forName: UIWindow.didBecomeVisibleNotification, object: nil, queue: .main
        ) { note in
          if let window = note.object as? UIWindow { MenuTouchGate.install(in: window) }
        }
      }
    }

    OnDestroy {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
    }
  }
}

/**
 * Keeps the tap that closes a menu or popover away from React Native
 * (DESIGN.md 3.12).
 *
 * On iOS 26 a menu (bar button, SwiftUI `Menu`, context menu) or an iPad
 * popover is a presented view controller whose container lets touches
 * outside it through to the content underneath. UIKit closes the menu and
 * holds that touch back from the content's *views*: a window gesture
 * recognizer delays and then cancels their touches. React Native's
 * `RCTSurfaceTouchHandler` is not a view but a gesture recognizer on the
 * surface, and it sends `touchStart` and `touchEnd` to JavaScript from its
 * own touch callbacks, so the press still happens.
 *
 * Before UIKit delivers a new touch to any recognizer, this gate asks one
 * question with public API: is a view controller presented over the content
 * the touch landed on, without that content being part of the presentation?
 * Then the touch went through the presentation, and React Native's handlers
 * are told to ignore it. It never claims the touch itself (it never
 * recognizes, cancels or delays anything), and with nothing presented it does
 * nothing, so it cannot leave the screen blocked. Content a presentation
 * deliberately leaves usable (an undimmed sheet detent, a popover's
 * passthrough views) and taps during a dismissal are left alone.
 */
final class MenuTouchGate: UIGestureRecognizer, UIGestureRecognizerDelegate {
  /** React Native's touch handler, looked up by its public class name (no React headers in Swift). */
  private static let surfaceTouchHandler: AnyClass? = NSClassFromString("RCTSurfaceTouchHandler")

  static func install(in window: UIWindow) {
    guard surfaceTouchHandler != nil,
          !(window.gestureRecognizers ?? []).contains(where: { $0 is MenuTouchGate }) else { return }
    window.addGestureRecognizer(MenuTouchGate())
  }

  init() {
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
  override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }

  // MARK: - UIGestureRecognizerDelegate

  /** UIKit asks this for every event before it delivers the event's touches to any recognizer. */
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive event: UIEvent) -> Bool {
    for touch in event.allTouches ?? [] where touch.phase == .began {
      if let view = touch.view, Self.wentThroughPresentation(view) {
        Self.reactHandlers(above: view).forEach { $0.ignore(touch, for: event) }
      }
    }
    return true
  }

  /** The gate only looks: it never takes part in a touch. */
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    false
  }

  // MARK: - Deciding

  /**
   * Whether a view controller is presented over `view`'s window and `view`
   * is not part of it, so a touch on `view` went through the presentation.
   */
  static func wentThroughPresentation(_ view: UIView) -> Bool {
    guard let window = view.window else { return false }
    var top = window.rootViewController?.presentedViewController
    while let next = top?.presentedViewController { top = next }
    guard let top, !top.isBeingDismissed, top.viewIfLoaded?.window === window else { return false }
    let presentation = top.presentationController
    if let container = presentation?.containerView, view.isDescendant(of: container) { return false }
    if let content = top.viewIfLoaded, view.isDescendant(of: content) { return false }
    if let sheet = presentation as? UISheetPresentationController,
       sheet.largestUndimmedDetentIdentifier != nil { return false }
    if let popover = presentation as? UIPopoverPresentationController,
       (popover.passthroughViews ?? []).contains(where: { view.isDescendant(of: $0) }) { return false }
    return true
  }

  /** React Native's touch handlers on `view` and its superviews. */
  static func reactHandlers(above view: UIView) -> [UIGestureRecognizer] {
    guard let handlerClass = surfaceTouchHandler else { return [] }
    var handlers: [UIGestureRecognizer] = []
    var current: UIView? = view
    while let each = current {
      handlers += (each.gestureRecognizers ?? []).filter { $0.isKind(of: handlerClass) }
      current = each.superview
    }
    return handlers
  }
}
