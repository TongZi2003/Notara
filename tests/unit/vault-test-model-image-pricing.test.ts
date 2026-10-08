import { describe, expect, it } from 'vitest';
import { offloadedImageText, type ImageBlock } from '@deepseek-ai/dsh-llm';
import {
  VAULT_SOLVER_MODEL, VAULT_SOLVER_PROVIDER, VAULT_TEST_IMAGE_TOKENS,
  VAULT_TEST_MODEL, VAULT_TEST_PROVIDER, vaultTestImageRequestPricing, vaultTestImageUsage,
} from '../../scripts/fixtures/vault-test-model.js';

const image = (attachmentId: string, offloaded = false): ImageBlock => ({
  type: 'image',
  attachment: { attachmentId: attachmentId as ImageBlock['attachment']['attachmentId'], mediaType: 'image/png', bytes: 12, width: 32, height: 24 },
  ...(offloaded ? { offloaded: true } : {}),
});

describe('Native Vault synthetic image pricing', () => {
  it('prices retained images at the same fixed nonzero rate reported by the mock stream', () => {
    const retained = image('synthetic-retained');
    const pricing = vaultTestImageRequestPricing(VAULT_TEST_PROVIDER, VAULT_TEST_MODEL)!;
    expect(pricing.priceImages([retained])).toEqual([{ visualTokens: VAULT_TEST_IMAGE_TOKENS, text: '' }]);
    expect(vaultTestImageUsage(VAULT_TEST_PROVIDER, VAULT_TEST_MODEL, [{ content: [retained] }]))
      .toBe(VAULT_TEST_IMAGE_TOKENS);
  });

  it('prices an offloaded image as its text placeholder with no visual tokens', () => {
    const omitted = image('synthetic-offloaded', true);
    const pricing = vaultTestImageRequestPricing(VAULT_SOLVER_PROVIDER, VAULT_SOLVER_MODEL)!;
    expect(pricing.priceImages([omitted])).toEqual([{ visualTokens: 0, text: offloadedImageText(omitted.attachment) }]);
    expect(vaultTestImageUsage(VAULT_SOLVER_PROVIDER, VAULT_SOLVER_MODEL, [{ content: [omitted] }])).toBe(0);
  });

  it('prices only exact routes that the synthetic adapter advertises', () => {
    expect(vaultTestImageRequestPricing(VAULT_TEST_PROVIDER, 'other-model')).toBeUndefined();
    expect(vaultTestImageRequestPricing('unregistered', VAULT_TEST_MODEL)).toBeUndefined();
  });
});
