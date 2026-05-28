import {
  applyResolvedAppearanceToDocument,
  readAppearanceBootstrapFromWindow,
  resolveAppearance,
} from './appearance';

/** Apply persisted appearance before React paints (import from renderer entry). */
export function applyAppearanceEarly(): void {
  const bootstrap = readAppearanceBootstrapFromWindow();
  const resolved = bootstrap?.resolved ?? resolveAppearance('dark');
  applyResolvedAppearanceToDocument(resolved);
}
