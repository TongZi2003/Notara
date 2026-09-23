import { readFileSync, writeFileSync } from 'node:fs';
import { patchSkillMenu } from './skill-menu-patch.ts';

// Keep presentation derived from the same manifest as the Host Skill provider.
// No catalog entries are added here: only remotely admitted skills get labels.
const manifest = JSON.parse(readFileSync(new URL('../resources/vault-teaching/manifest.json', import.meta.url), 'utf8'));
const titles = Object.fromEntries([...manifest.choices, ...manifest.skills].map(item => [`notara-${item.id}`, item.title]));
const more = [...manifest.choices, ...manifest.skills].filter(item => item.menu === 'more').map(item => `notara-${item.id}`);
const path = new URL('../node_modules/@deepseek-ai/dsh-client-ui-skill/lib/client.js', import.meta.url);
const original = readFileSync(path, 'utf8');
const patched = patchSkillMenu(original, titles, more);
if (patched !== original) writeFileSync(path, patched);
