import Intents
import UserNotifications

/// Rewrites incoming Hark pushes into iOS communication notifications.
///
/// The server sends (via the Expo Push Service) a payload whose `data` object
/// carries `sourceName`, `avatarUrl`, `conversationId`, etc. On iOS, Expo
/// nests that object under `userInfo["body"]`; this extension also accepts the
/// same keys at the top level of `userInfo` for forwards compatibility.
final class NotificationService: UNNotificationServiceExtension {

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?

  private let completionLock = NSLock()
  private var didComplete = false

  /// Our own deadline, comfortably inside the ~30s system limit.
  private static let selfImposedTimeout: TimeInterval = 25

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let content =
      (request.content.mutableCopy() as? UNMutableNotificationContent)
      ?? UNMutableNotificationContent()
    self.bestAttemptContent = content

    // Timeout fallback: never hold the notification past our own deadline.
    DispatchQueue.global().asyncAfter(deadline: .now() + Self.selfImposedTimeout) { [weak self] in
      guard let self else { return }
      self.completeOnce(with: self.bestAttemptContent ?? content)
    }

    guard
      let data = Self.extractHarkData(from: request.content.userInfo),
      let sourceName = data["sourceName"] as? String,
      !sourceName.isEmpty
    else {
      // Not a Hark communication payload — deliver unchanged.
      completeOnce(with: content)
      return
    }

    let conversationId =
      (data["conversationId"] as? String)
      ?? (data["serviceId"] as? String)
      ?? "hark"
    let avatarUrl = (data["avatarUrl"] as? String).flatMap(URL.init(string:))

    downloadAvatar(avatarUrl) { [weak self] avatar in
      guard let self else { return }
      self.applyCommunicationStyle(
        to: content,
        sourceName: sourceName,
        conversationId: conversationId,
        avatar: avatar
      )
    }
  }

  override func serviceExtensionTimeWillExpire() {
    completeOnce(with: bestAttemptContent ?? UNMutableNotificationContent())
  }

  // MARK: - Payload parsing

  /// Expo delivers the push message's `data` dictionary at `userInfo["body"]`.
  /// Accepts that envelope first, a JSON string variant, then top-level keys.
  static func extractHarkData(from userInfo: [AnyHashable: Any]) -> [String: Any]? {
    if let body = userInfo["body"] as? [String: Any], body["sourceName"] != nil {
      return body
    }
    if let bodyString = userInfo["body"] as? String,
      let object = try? JSONSerialization.jsonObject(with: Data(bodyString.utf8)),
      let parsed = object as? [String: Any],
      parsed["sourceName"] != nil
    {
      return parsed
    }
    if userInfo["sourceName"] != nil {
      var result: [String: Any] = [:]
      for (key, value) in userInfo {
        if let key = key as? String {
          result[key] = value
        }
      }
      return result
    }
    return nil
  }

  // MARK: - Avatar

  /// Avatars are fetched over HTTPS only, without following redirects, and
  /// abandoned past 10 s of silence or 2 MB so the extension stays well
  /// inside its memory and time budget.
  private func downloadAvatar(_ url: URL?, completion: @escaping (INImage?) -> Void) {
    guard let url, url.scheme?.lowercased() == "https" else {
      completion(nil)
      return
    }
    AvatarDownload.start(url) { data in
      completion(data.map { INImage(imageData: $0) })
    }
  }

  // MARK: - Communication notification

  private func applyCommunicationStyle(
    to content: UNMutableNotificationContent,
    sourceName: String,
    conversationId: String,
    avatar: INImage?
  ) {
    let handle = INPersonHandle(value: "hark:\(conversationId)", type: .unknown)
    let sender = INPerson(
      personHandle: handle,
      nameComponents: nil,
      displayName: sourceName,
      image: avatar,
      contactIdentifier: nil,
      customIdentifier: "hark:\(conversationId)"
    )

    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: conversationId,
      serviceName: "Hark",
      sender: sender,
      attachments: nil
    )

    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate { [weak self] error in
      guard let self else { return }
      if error != nil {
        self.completeOnce(with: content)
        return
      }
      do {
        let updated = try content.updating(from: intent)
        // Intent styling can replace the category, which would remove Hark's actions.
        let actionable =
          (updated.mutableCopy() as? UNMutableNotificationContent)
          ?? content
        actionable.categoryIdentifier = content.categoryIdentifier
        self.completeOnce(with: actionable)
      } catch {
        self.completeOnce(with: content)
      }
    }
  }

  // MARK: - Completion

  /// Completes exactly once, no matter which path (success, error, timeout,
  /// or system expiration) gets here first.
  private func completeOnce(with content: UNNotificationContent) {
    completionLock.lock()
    guard !didComplete, let handler = contentHandler else {
      completionLock.unlock()
      return
    }
    didComplete = true
    completionLock.unlock()
    handler(content)
  }
}

/// One bounded avatar fetch. Calls `completion` exactly once: with the body on
/// a 2xx response within the size cap, otherwise with nil.
private final class AvatarDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  static let maxBytes = 2 * 1024 * 1024

  private let lock = NSLock()
  private var data = Data()
  private var completion: ((Data?) -> Void)?

  private init(completion: @escaping (Data?) -> Void) {
    self.completion = completion
  }

  static func start(_ url: URL, completion: @escaping (Data?) -> Void) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 10
    configuration.timeoutIntervalForResource = 15
    let download = AvatarDownload(completion: completion)
    let session = URLSession(configuration: configuration, delegate: download, delegateQueue: nil)
    session.dataTask(with: url).resume()
    // Releases the session (and this delegate) once the task finishes.
    session.finishTasksAndInvalidate()
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard
      let http = response as? HTTPURLResponse,
      (200..<300).contains(http.statusCode),
      http.expectedContentLength <= Int64(Self.maxBytes)
    else {
      completionHandler(.cancel)
      return
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
    lock.lock()
    data.append(chunk)
    let tooLarge = data.count > Self.maxBytes
    lock.unlock()
    if tooLarge { dataTask.cancel() }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let handler = completion
    completion = nil
    let succeeded =
      error == nil && !data.isEmpty && data.count <= Self.maxBytes
      && ((task.response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false)
    let result = succeeded ? data : nil
    lock.unlock()
    handler?(result)
  }
}
