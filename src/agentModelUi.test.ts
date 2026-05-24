import { describe, expect, it } from 'vitest';
import {
  CODEX_MODEL_PRESETS,
  choicesForPicker,
  labelForModelId,
  mergedModelChoices,
  modelSummaryForTask,
} from './agentModelUi';

describe('agentModelUi codex presets', () => {
  it('includes built-in Codex presets', () => {
    expect(CODEX_MODEL_PRESETS.map((p) => p.id)).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'o4-mini']);
  });

  it('merges codex presets for picker choices', () => {
    const ids = mergedModelChoices('codex').map((p) => p.id);
    expect(ids).toContain('gpt-5.4');
    expect(ids).toContain('o4-mini');
  });

  it('labels empty codex model as Default', () => {
    expect(labelForModelId('codex', '')).toBe('Default');
    expect(labelForModelId('codex', 'gpt-5.4')).toBe('GPT 5.4');
  });

  it('includes legacy codex model ids in choicesForPicker', () => {
    const choices = choicesForPicker('codex', 'custom-model');
    expect(choices[0]).toEqual({ id: 'custom-model', label: 'custom-model' });
  });

  it('summarizes codex task model and YOLO', () => {
    expect(
      modelSummaryForTask({
        agent: 'codex',
        agentModel: 'gpt-5.4',
        agentYolo: true,
      }),
    ).toBe('Model: GPT 5.4 · YOLO');
    expect(
      modelSummaryForTask({
        agent: 'codex',
        agentModel: '',
        agentYolo: false,
      }),
    ).toBe('Model: Default');
  });
});
