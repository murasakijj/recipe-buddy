import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  isWakeLockSupported,
  wakeLockStatusReducer,
  type WakeLockStatus,
} from "../lib/wakeLock";

interface UseWakeLockResult {
  status: WakeLockStatus;
  /** released/failed のときにタップで再取得するための関数。 */
  reacquire: () => void;
}

/**
 * 料理モード中の画面消灯抑止(FR-07)。
 * active な間、Screen Wake Lock を取得し続けようとする。
 * タブが非表示→表示に戻ったときや、OSによる自動解放後は
 * visibilitychange / release イベントを起点に状態を更新する。
 *
 * 取得経路(マウント時・visibilitychange・手動reacquire)を単一の acquire() に
 * 集約し、多重取得によるsentinelリークを防ぐ(requestingRef + sentinelRef で
 * 「取得中」「既に保持中」ならリクエストをスキップする)。
 */
export function useWakeLock(active: boolean): UseWakeLockResult {
  const supported = isWakeLockSupported();
  const [status, dispatch] = useReducer(
    wakeLockStatusReducer,
    supported ? "pending" : "unsupported",
  );
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  // 取得リクエストが進行中かどうか(二重取得防止)。
  const requestingRef = useRef(false);
  // 現在のsentinelに付けた release リスナーを外すための関数。
  const detachReleaseListenerRef = useRef<(() => void) | null>(null);
  // 世代カウンタ(reducerのstatus遷移とは独立)。マウント解除・active切り替えの
  // たびにインクリメントし、その時点で進行中だった acquire() が後から解決しても
  // 「もう要らない結果」と分かるようにする(取得中にunmountされてsentinelが
  // 誰にも解放されないまま残り続ける = リークを防ぐ)。
  const generationRef = useRef(0);

  const releaseCurrent = useCallback(() => {
    detachReleaseListenerRef.current?.();
    detachReleaseListenerRef.current = null;
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel) {
      sentinel.release().catch(() => {});
    }
  }, []);

  const attach = useCallback((sentinel: WakeLockSentinel) => {
    sentinelRef.current = sentinel;
    dispatch({ type: "acquired" });
    const handleRelease = () => {
      detachReleaseListenerRef.current = null;
      if (sentinelRef.current === sentinel) {
        sentinelRef.current = null;
      }
      dispatch({ type: "released" });
    };
    // { once: true } なら明示的な removeEventListener 無しでも自動的に外れるが、
    // コンポーネント側から能動的に releaseCurrent() したときにも確実に外せるよう
    // detach関数を保持しておく(L-1: リスナーの取り残し防止)。
    sentinel.addEventListener("release", handleRelease, { once: true });
    detachReleaseListenerRef.current = () =>
      sentinel.removeEventListener("release", handleRelease);
  }, []);

  // 唯一のロック取得経路。取得中(requestingRef)または既に保持中(sentinelRef)なら
  // 何もしない。取得完了までの間に別経路で既に確保されていた場合は、新しく取れた
  // 方を破棄して既存を優先する(万一の競合に対する保険)。
  const acquire = useCallback(async () => {
    if (!supported) {
      dispatch({ type: "unsupported" });
      return;
    }
    if (requestingRef.current || sentinelRef.current) return;
    requestingRef.current = true;
    const gen = generationRef.current;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      // 取得中に世代が進んでいたら(アンマウント/active切り替え)、この結果は
      // もう要らないのでそのまま解放する。既に他経路で保持中の場合も同様。
      if (gen !== generationRef.current || sentinelRef.current) {
        void sentinel.release().catch(() => {});
        return;
      }
      attach(sentinel);
    } catch {
      dispatch({ type: "failed" });
    } finally {
      requestingRef.current = false;
    }
  }, [supported, attach]);

  // active になったときの自動取得。
  // effect本体の直下で acquire() を呼ぶと(内部でdispatchする関数を直接呼ぶ形になり)
  // react-hooks/set-state-in-effect に抵触するため、queueMicrotask を挟んで
  // 「後から呼ばれるコールバック」にする(StrictModeの二重実行時は cancelled で無視)。
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void acquire();
    });
    return () => {
      cancelled = true;
      generationRef.current += 1;
      releaseCurrent();
    };
  }, [active, acquire, releaseCurrent]);

  // タブが再表示されたとき、ロックが外れていれば再取得する。
  // handleVisibilityChange はイベントリスナーとして登録されるだけで、
  // effect本体から直接呼ばれるわけではないので上と同じ問題は起きない。
  useEffect(() => {
    if (!active) return;

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void acquire();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [active, acquire]);

  const reacquire = useCallback(() => {
    void acquire();
  }, [acquire]);

  return { status, reacquire };
}
