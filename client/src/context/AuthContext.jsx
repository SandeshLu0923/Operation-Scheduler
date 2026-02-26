import { createContext, useContext, useMemo, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("ot_token"));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("ot_user");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      localStorage.removeItem("ot_user");
      return null;
    }
  });

  const value = useMemo(
    () => ({
      token,
      user,
      login: (payload) => {
        localStorage.setItem("ot_token", payload.token);
        localStorage.setItem("ot_user", JSON.stringify(payload.user));
        setToken(payload.token);
        setUser(payload.user);
      },
      logout: () => {
        localStorage.removeItem("ot_token");
        localStorage.removeItem("ot_user");
        setToken(null);
        setUser(null);
      }
    }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
