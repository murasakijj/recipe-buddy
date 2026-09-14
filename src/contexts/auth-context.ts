import { createContext } from "react";
import type { User } from "firebase/auth";

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  accessDenied: boolean;
  authError: boolean;
  /** signInWithPopup失敗時のメッセージ(ポップアップブロック等)。ユーザーが自分で閉じた場合は null。 */
  signInError: string | null;
  /** 401(トークン失効等)によりサインアウトさせたときに表示するメッセージ。 */
  sessionExpiredMessage: string | null;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  retryAuthorization: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);
