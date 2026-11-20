import ExpoModulesCore
import UIKit
// The subclass header declares `ignore(_:for:)`.
import UIKit.UIGestureRecognizerSubclass

/**
 * Installs `MenuTouchGate` in every window. Nothing to call from
 * JavaScript: Expo creates the module at launch.
 *
 * Expo fixed the same bug upstream (`SystemMenuTouchGate` in
 * expo-modules-core, expo/expo#48463 and #49775, newer than our 57.0.10).
 * Delete this module when Hark upgrades to an Expo release that has it.
 */
public class HarkMenuGateModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HarkMenuGate")

    OnCreate {
      #if DEBUG
      // Without React Native's handler class the gate stays off and the
      // tap that closes a menu presses the view under it again. Say so in
      // development; release builds just skip the gate.
      if MenuTouchGate.surfaceTouchHandler == nil {
        assertionFailure(
          "HarkMenuGate: RCTSurfaceTouchHandler not found, so the menu tap gate is off. "
            + "Update the class name in HarkMenuGateModule.swift, or delete the module if Expo's "
            + "SystemMenuTouchGate now covers this."
        )
      }
      #endif
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
 * (DESIGN.md 3.12 rule 11).
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
 * When React Native ignores a touch: only when a view controller is
 * presented over the window and the touch lands outside it (not in its
 * container or its view). Then React Native never sees that touch. This
 * holds for *any* presented view controller, not just menus: one that stays
 * presented while invisible or transparent to touches (a dismissal that
 * failed, an overlay presented on purpose) makes React Native ignore every
 * tap outside it in that window until it goes away. So never leave an
 * invisible view controller presented. Content a presentation deliberately
 * leaves usable (an undimmed sheet detent, a popover's passthrough views)
 * and taps during a dismissal are left alone. With nothing presented the
 * gate changes nothing. It never takes part in a touch itself: it never
 * recognizes, cancels or delays anything.
 */
final class MenuTouchGate: UIGestureRecognizer, UIGestureRecognizerDelegate {
  /** React Native's touch handler, looked up by its public class name (no React headers in Swift). */
  static let surfaceTouchHandler: AnyClass? = NSClassFromString("RCTSurfaceTouchHandler")

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

  /**
   * UIKit asks this for every event, and on iOS 26 to 27 it asks every
   * recognizer before it delivers the event's touches to any of them. That
   * order is not documented, and `UIGestureRecognizerSubclass.h` reserves
   * `ignore(_:for:)` for a recognizer calling it on itself. So only a
   * handler that has not started (`.possible`) is told to ignore the touch:
   * React Native sets `.began` in its own `touchesBegan:`, and UIKit resets
   * it to `.possible` after each touch sequence. If a future iOS delivered
   * the touch to React Native first, the handler would already be `.began`,
   * the gate would leave it alone and the tap would go through as before,
   * instead of React Native holding a touch that never ends. The same holds
   * while another finger is down.
   */
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive event: UIEvent) -> Bool {
    for touch in event.allTouches ?? [] where touch.phase == .began {
      if let view = touch.view, Self.wentThroughPresentation(view) {
        Self.reactHandlers(above: view)
          .filter { $0.state == .possible }
          .forEach { $0.ignore(touch, for: event) }
      }
    }
    return true
  }

  /** The gate only looks: it never takes part in a touch… */
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    false
  }

  /** …or in a key press. */
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive press: UIPress) -> Bool {
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
