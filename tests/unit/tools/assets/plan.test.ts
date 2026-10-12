import { describe, expect, it } from 'vitest';
import { ASSET_PLAN, EXPECTED_TOTAL_USD, MODEL, buildImageInput, validateBudget } from '../../../../tools/assets/plan.ts';

describe('base prop generation plan', () => {
  it('fixes the model and limits the batch to three high-quality single images', () => {
    expect(MODEL).toBe('openai/gpt-image-2.5-flare');
    expect(ASSET_PLAN.map((item) => item.id)).toEqual(['spaceship', 'castle', 'kame-house']);
    for (const item of ASSET_PLAN) {
      const input = buildImageInput(item.id, item.id === 'kame-house' ? ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,Yg=='] : []);
      expect(input.quality).toBe('high');
      expect(input.number_of_images).toBe(1);
      expect(input.aspect_ratio).toBe('1:1');
      expect(input.output_format).toBe('png');
    }
    expect(EXPECTED_TOTAL_USD).toBeCloseTo(0.384);
  });

  it('rejects Kame generation without two actual attached images, not merely source URLs in a prompt', () => {
    expect(() => buildImageInput('kame-house', [])).toThrow(/two/);
    expect(() => buildImageInput('kame-house', ['https://source.example/article'])).toThrow();
    const refs = ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,Yg=='];
    expect(buildImageInput('kame-house', refs).input_images).toEqual(refs);
  });

  it('does not attach personal paths, user identifiers or references to original designs', () => {
    const input = buildImageInput('spaceship', []);
    expect(input).not.toHaveProperty('input_images');
    expect(input).not.toHaveProperty('user_id');
    expect(JSON.stringify(input)).not.toMatch(/Users|chuck|promise|token|API_KEY/);
  });

  it('refuses invalid or insufficient budgets rather than silently reducing quality or making partial batches', () => {
    for (const budget of [NaN, Infinity, -1, 0, 0.383, 4.01]) expect(() => validateBudget(budget)).toThrow();
    expect(() => validateBudget(0.384)).not.toThrow();
    expect(() => validateBudget(4)).not.toThrow();
  });
});
