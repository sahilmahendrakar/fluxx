import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyResolvedAppearanceToDocument,
  DEFAULT_APPEARANCE_PREFERENCE,
  type AppearancePreference,
  type ResolvedAppearance,
  resolveAppearance,
} from './appearance';

type AppearanceContextValue = {
  preference: AppearancePreference;
  resolved: ResolvedAppearance;
  setPreference: (next: AppearancePreference) => Promise<void>;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppearancePreference>(
    DEFAULT_APPEARANCE_PREFERENCE,
  );
  const [resolved, setResolved] = useState<ResolvedAppearance>(() =>
    resolveAppearance(DEFAULT_APPEARANCE_PREFERENCE),
  );

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.appearance.getPreference().then((stored) => {
      if (cancelled) return;
      setPreferenceState(stored);
      setResolved(resolveAppearance(stored));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyResolvedAppearanceToDocument(resolved);
  }, [resolved]);

  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(resolveAppearance('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback(async (next: AppearancePreference) => {
    const result = await window.electronAPI.appearance.setPreference(next);
    setPreferenceState(result.preference);
    setResolved(resolveAppearance(result.preference));
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error('useAppearance must be used within ThemeProvider');
  }
  return ctx;
}
