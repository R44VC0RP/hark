import type { InboxInteractionDto } from "@hark/contracts";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { ANSWER_LABELS } from "../components/inbox/format";
import { ApiError, api } from "./api";
import {
  DEVICE_ID_KEY,
  flushInteractionResponses,
  leaveAnswerToQueue,
  onQueuedResponseDone,
  removeQueuedAnswer,
  saveAnswerBeforeSending,
  visitQueuedAnswers,
} from "./interactions";

/**
 * Hands a request from the Inbox to the Reply sheet (DESIGN.md 5.5) and
 * remembers which requests stopped waiting while the Inbox showed them
 * (answered here, answered elsewhere, expired, withdrawn), so they stay in
 * place with what happened instead of vanishing under a finger. In memory
 * only: a relaunch starts empty (the sheet then shows "Request Unavailable").
 */

export interface CachedInteraction {
  interaction: InboxInteractionDto;
  /** The project the Inbox matched it to, for the sheet's context line. */
  projectName: string | null;
}

export type RequestAnswer = "approve" | "deny" | "yes" | "no" | "reply";

/**
 * Why an answer waits in the retry queue: no response at all (no
 * connection), or none within `ANSWER_WAIT_MS` (a connection that hangs).
 */
export type QueueReason = "offline" | "slow";

/**
 * Why a request the Inbox shows stopped waiting: answered here, answered
 * here without a connection (the answer waits in the retry queue), answered
 * on another device (with History's word for the answer, "Approved", when
 * the server gave it), past its expiry, withdrawn by whoever asked, or gone
 * for a reason the app could not learn.
 */
export type RequestOutcome =
  | { kind: "answered"; answer: RequestAnswer }
  | { kind: "queued"; answer: RequestAnswer; reason: QueueReason }
  | { kind: "answeredElsewhere"; result: string }
  | { kind: "expired" }
  | { kind: "withdrawn" }
  | { kind: "gone" };

/** A request that stopped waiting while on screen, still shown in place in the Inbox. */
export interface SettledRequest {
  interaction: InboxInteractionDto;
  outcome: RequestOutcome;
}

const interactions = new Map<string, CachedInteraction>();
/** Answers given here that wait in the retry queue, until it sends or drops them. */
const queuedAnswers = new Map<
  string,
  { interaction: InboxInteractionDto; answer: RequestAnswer }
>();
const drafts = new Map<string, string>();
let handled: ReadonlySet<string> = new Set();
let settled: ReadonlyMap<string, SettledRequest> = new Map();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Called by the Inbox right before it opens the Reply sheet. */
export function rememberInteraction(
  interaction: InboxInteractionDto,
  projectName: string | null,
): void {
  interactions.set(interaction.id, { interaction, projectName });
}

export function cachedInteraction(id: string): CachedInteraction | null {
  return interactions.get(id) ?? null;
}

/**
 * Called once a response was sent (or queued) for this request. The Inbox
 * keeps the row where it is and shows the answer in place of its buttons
 * until `clearSettledRequests()`.
 */
export function markInteractionHandled(
  interaction: InboxInteractionDto,
  answer: RequestAnswer,
): void {
  const { id } = interaction;
  if (handled.has(id)) return;
  handled = new Set([...handled, id]);
  settled = new Map([...settled, [id, { interaction, outcome: { kind: "answered", answer } }]]);
  interactions.delete(id);
  drafts.delete(id);
  notify();
}

/**
 * Called when an answer given here got no response from the server and
 * waits in the retry queue: the row keeps its place and says it will be
 * sent; once the queue sends it (or the server refuses it) the row shows
 * what really happened (`onQueuedResponseDone` below).
 */
export function markInteractionQueued(
  interaction: InboxInteractionDto,
  answer: RequestAnswer,
  reason: QueueReason,
): void {
  const { id } = interaction;
  if (handled.has(id)) return;
  handled = new Set([...handled, id]);
  settled = new Map([
    ...settled,
    [id, { interaction, outcome: { kind: "queued", answer, reason } }],
  ]);
  queuedAnswers.set(id, { interaction, answer });
  interactions.delete(id);
  drafts.delete(id);
  notify();
}

/** A row still on screen takes its real outcome (a queued answer resolved). */
function resettle(request: SettledRequest): void {
  if (!settled.has(request.interaction.id)) return;
  settled = new Map([...settled, [request.interaction.id, request]]);
  notify();
}

/**
 * The server refused a queued answer (or the queue no longer has it): if
 * the request still waits, the answer didn't count and its buttons come
 * back; else the row says how it closed (answered here or on another
 * device, expired, withdrawn).
 */
async function settleRefused(
  interaction: InboxInteractionDto,
  mayHaveArrived: RequestAnswer,
): Promise<void> {
  const open = await api.listPendingInteractions().then(
    (result) => result.interactions,
    () => null,
  );
  if (open?.some((item) => item.id === interaction.id)) {
    handled = new Set([...handled].filter((id) => id !== interaction.id));
    settled = new Map([...settled].filter(([id]) => id !== interaction.id));
    notify();
    return;
  }
  const [closed] = await outcomesOf([interaction], Date.now());
  if (!closed) return;
  // An earlier attempt may have reached the server after all (one that
  // timed out, lost its response, or was out when the app was closed or
  // killed), and the queue's retry was then refused as already answered:
  // a request that closed with exactly this answer got this answer.
  const ours =
    closed.outcome.kind === "answeredElsewhere" &&
    closed.outcome.result === ANSWER_LABELS[mayHaveArrived];
  resettle(ours ? { interaction, outcome: { kind: "answered", answer: mayHaveArrived } } : closed);
}

/**
 * Answers whose first attempt got no response within `ANSWER_WAIT_MS`: the
 * request is still out and may yet arrive; resolves true if it did.
 */
const lateAttempts = new Map<string, Promise<boolean>>();

/** How long a refused retry waits for a late first attempt to finish. */
const LATE_ATTEMPT_WAIT_MS = 30_000;

/** A late first attempt arrived: the answer counted, so the queued retry isn't needed. */
function lateAttemptArrived(id: string): void {
  lateAttempts.delete(id);
  void removeQueuedAnswer(id).catch(() => {});
  const queued = queuedAnswers.get(id);
  if (!queued) return;
  queuedAnswers.delete(id);
  resettle({
    interaction: queued.interaction,
    outcome: { kind: "answered", answer: queued.answer },
  });
}

onQueuedResponseDone((id, delivered) => {
  const queued = queuedAnswers.get(id);
  if (!queued) return;
  queuedAnswers.delete(id);
  if (delivered) {
    lateAttempts.delete(id);
    resettle({
      interaction: queued.interaction,
      outcome: { kind: "answered", answer: queued.answer },
    });
    return;
  }
  // Refused (already answered, withdrawn, expired, changed). If the first
  // attempt is still out, it may be the answer the server already has.
  const late = lateAttempts.get(id);
  lateAttempts.delete(id);
  const arrived = late
    ? Promise.race([
        late,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LATE_ATTEMPT_WAIT_MS)),
      ])
    : Promise.resolve(false);
  void arrived.then((yes) =>
    yes
      ? resettle({
          interaction: queued.interaction,
          outcome: { kind: "answered", answer: queued.answer },
        })
      : settleRefused(queued.interaction, queued.answer),
  );
});

/**
 * Open requests that already have an answer waiting in the retry queue
 * (given in the app before it was closed or killed, or from a notification
 * without a connection): their rows say it will be sent instead of offering
 * the buttons again, and settle when the queue sends it (R4-02). And a row
 * that says its answer waits when the queue no longer has it (sent or
 * dropped without word reaching this row) takes the server's real outcome,
 * so no row stays on "Will send" for ever. Called with each list the Inbox
 * loads.
 */
export async function showQueuedAnswers(open: readonly InboxInteractionDto[]): Promise<void> {
  const byId = new Map(open.map((item) => [item.id, item]));
  let found = false;
  const orphans: { interaction: InboxInteractionDto; answer: RequestAnswer }[] = [];
  await visitQueuedAnswers((answers) => {
    const waiting = new Set(answers.map((item) => item.interactionId));
    for (const { interactionId, input } of answers) {
      const interaction = byId.get(interactionId);
      if (!interaction || handled.has(interactionId)) continue;
      markInteractionQueued(interaction, input.action, "slow");
      found = true;
    }
    for (const [id, queued] of queuedAnswers) {
      if (waiting.has(id)) continue;
      queuedAnswers.delete(id);
      orphans.push(queued);
    }
  });
  if (found) void flushInteractionResponses();
  for (const { interaction, answer } of orphans) void settleRefused(interaction, answer);
}

/**
 * Requests that left the server's open list while the Inbox showed them
 * (answered on another device, expired, withdrawn): they stay in place like
 * the ones answered here, with what happened.
 */
export function settleRequests(requests: readonly SettledRequest[]): void {
  const fresh = requests.filter(({ interaction }) => !settled.has(interaction.id));
  if (fresh.length === 0) return;
  settled = new Map([
    ...settled,
    ...fresh.map((request) => [request.interaction.id, request] as const),
  ]);
  notify();
}

/**
 * Takes the settled rows out of the Inbox. Only while nobody can tap them:
 * the Inbox is out of sight, or after a pull to refresh.
 */
export function clearSettledRequests(): void {
  // An answer still waiting in the retry queue stays, so the person can
  // see it hasn't been sent yet; it settles once the queue sends it or the
  // server refuses it, and goes with the next tidy after that.
  const waiting = new Map([...settled].filter(([, request]) => request.outcome.kind === "queued"));
  if (waiting.size === settled.size) return;
  settled = waiting;
  notify();
}

/**
 * A request that leaves the open list within this long of its expiry
 * expired (the server's clock decides, and the two clocks differ a little).
 */
const EXPIRY_SLACK_MS = 60_000;

/**
 * What happened to requests that left the server's open list: past their
 * expiry, answered (History's response feed has the answer, but not where
 * it was given), else withdrawn by whoever asked. Without the feed it
 * can't tell answered from withdrawn.
 */
export async function outcomesOf(
  vanished: readonly InboxInteractionDto[],
  now: number,
): Promise<SettledRequest[]> {
  const expired = (item: InboxInteractionDto) =>
    Date.parse(item.expiresAt) <= now + EXPIRY_SLACK_MS;
  let answers: Map<string, string | null> | null = new Map();
  if (vanished.some((item) => !expired(item))) {
    answers = await api.listActivityFeed("response", 0).then(
      (page) => new Map(page.items.map((entry) => [entry.id, entry.result])),
      () => null,
    );
  }
  return vanished.map((interaction): SettledRequest => {
    const result = answers?.get(`response:${interaction.id}`);
    if (result) return { interaction, outcome: { kind: "answeredElsewhere", result } };
    if (expired(interaction)) return { interaction, outcome: { kind: "expired" } };
    return { interaction, outcome: { kind: answers ? "withdrawn" : "gone" } };
  });
}

/**
 * How long an answer given in the app waits for the server before it goes
 * to the retry queue. The API answers in milliseconds and a slow but
 * working mobile link in a second or two; a connection that accepts the
 * request and never answers (common on a bad network) otherwise kept the
 * row on "Sending…" for over 86 s (R4). 10 s is several times a slow link's
 * worst case and still short enough that nobody keeps waiting on a spinner.
 */
export const ANSWER_WAIT_MS = 10_000;

/**
 * Sends an answer given in the app (the Inbox's buttons, the Reply sheet)
 * straight to the server: the person is looking at the request and should
 * learn at once whether the answer counted (R3-02). It is saved in the
 * retry queue that notification actions use first, as before the redesign,
 * so it survives the app being closed or killed while the request is out
 * (R4-02); the queue leaves it alone while this attempt is out. Resolves
 * "sent"; "taken" when the server says the request already closed (answered
 * on another device, withdrawn, expired: ask `outcomesOf` which); either
 * way, and when the server refuses it (thrown), it leaves the queue.
 * "offline" when no response came back at all (no connection) and "slow"
 * when none came within `ANSWER_WAIT_MS`: the saved answer is then the
 * queue's to send when the connection works. A slow first attempt may still
 * arrive; it can't count twice, because the server takes one answer per
 * request and refuses the other with a conflict, and the row ends up
 * showing whichever answer the server kept (`lateAttempts`,
 * `onQueuedResponseDone`).
 */
export async function sendAnswer(
  interaction: InboxInteractionDto,
  answer: { action: Exclude<RequestAnswer, "reply"> } | { action: "reply"; response: string },
): Promise<"sent" | "taken" | QueueReason> {
  const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!deviceId) throw new Error("This device isn’t registered with Hark.");
  const input = { ...answer, actionDigest: interaction.actionDigest };
  await saveAnswerBeforeSending(interaction.id, input);
  const attempt = api.respondToInteraction(interaction.id, { ...input, deviceId });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<"slow">((resolve) => {
    timer = setTimeout(() => resolve("slow"), ANSWER_WAIT_MS);
  });
  try {
    const first = await Promise.race([attempt.then(() => "sent" as const), wait]);
    if (first === "sent") {
      await removeQueuedAnswer(interaction.id).catch(() => {});
      return "sent";
    }
    lateAttempts.set(
      interaction.id,
      attempt.then(
        () => true,
        () => false,
      ),
    );
    attempt.then(
      () => lateAttemptArrived(interaction.id),
      () => {},
    );
    leaveAnswerToQueue(interaction.id);
    return "slow";
  } catch (error) {
    // No HTTP response (an ApiError always has one): keep the answer.
    if (!(error instanceof ApiError)) {
      leaveAnswerToQueue(interaction.id);
      return "offline";
    }
    // Any response settles it here; the queue must not send it again.
    await removeQueuedAnswer(interaction.id).catch(() => {});
    // 409 "already terminal" (the other 409 is a changed request, an error).
    const taken = error.status === 404 || (error.status === 409 && /terminal/i.test(error.message));
    if (taken) return "taken";
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why an answer wasn't sent, in words for an alert: a request that changed
 * since it appeared (a conflict that isn't "already answered") gets a plain
 * sentence instead of the server's "Interaction action digest mismatch".
 */
export function answerFailure(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409) {
    return new Error(
      "The request changed after it appeared, so your answer wasn’t sent. Check the new version and answer again.",
    );
  }
  return error;
}

/** An unsent reply, kept per request so closing the sheet never loses it. */
export function replyDraft(id: string): string {
  return drafts.get(id) ?? "";
}

export function saveReplyDraft(id: string, text: string): void {
  const had = drafts.has(id);
  if (text.trim()) drafts.set(id, text);
  else drafts.delete(id);
  // The Inbox row says when a draft waits (P2-07); only its presence matters.
  if (had !== drafts.has(id)) notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current sets, for callbacks that run outside a render (the Inbox's refresh). */
export function currentHandledIds(): ReadonlySet<string> {
  return handled;
}

export function currentSettledRequests(): ReadonlyMap<string, SettledRequest> {
  return settled;
}

/** IDs answered in this session; the Inbox leaves them out of the server's list. */
export function useHandledInteractionIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => handled);
}

/** Whether an unsent reply is saved for this request. */
export function useHasReplyDraft(id: string): boolean {
  return useSyncExternalStore(subscribe, () => drafts.has(id));
}

/** Requests that stopped waiting while on screen and still show in place, with what happened. */
export function useSettledRequests(): ReadonlyMap<string, SettledRequest> {
  return useSyncExternalStore(subscribe, () => settled);
}
