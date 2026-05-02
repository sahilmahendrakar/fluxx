import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyThemeToDocument,
  readStoredTheme,
  writeStoredTheme,
  type ThemeMode,
} from './theme';

type FluxThemeContextValue = {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
};

const FluxThemeContext = createContext<FluxThemeContextValue | null>(null);

export function FluxThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());

  const setTheme = useCallback((mode: ThemeMode) => {
    writeStoredTheme(mode);
    applyThemeToDocument(mode);
    setThemeState(mode);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <FluxThemeContext.Provider value={value}>{children}</FluxThemeContext.Provider>
  );
}

export function useFluxTheme(): FluxThemeContextValue {
  const ctx = useContext(FluxThemeContext);
  if (!ctx) {
    throw new Error('useFluxTheme must be used within FluxThemeProvider');
  }
  return ctx;
}
