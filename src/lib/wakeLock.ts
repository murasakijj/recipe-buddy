/**
 * Screen Wake Lock API 周りの DOM に依存しないロジック。
 * 実際の navigator.wakeLock 呼び出しは src/hooks/useWakeLock.ts が行う。
 */

export type WakeLockStatus =
  "pending" | "unsupported" | "active" | "released" | "failed";

/** この環境で Wake Lock API が使えるかどうか。 */
export function isWakeLockSupported(): boolean {
  try {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  } catch {
    return false;
  }
}

export type WakeLockEvent =
  | { type: "acquired" }
  | { type: "released" }
  | { type: "failed" }
  | { type: "unsupported" };

/**
 * status 遷移を表す純粋な reducer。DOM に依存しないため単体テストしやすい。
 * 一度 "unsupported" になったら(この環境ではAPI自体が無いので)以後も "unsupported" のまま。
 */
export function wakeLockStatusReducer(
  status: WakeLockStatus,
  event: WakeLockEvent,
): WakeLockStatus {
  if (status === "unsupported" && event.type !== "unsupported") {
    return status;
  }
  switch (event.type) {
    case "acquired":
      return "active";
    case "released":
      return "released";
    case "failed":
      return "failed";
    case "unsupported":
      return "unsupported";
    default:
      return status;
  }
}
