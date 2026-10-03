import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Narrow presentation seams on the locked native bundles. Without Notara,
// native commands and usage keep their original behavior and permissions.
const patches = [
  {
    package: 'dsh-client-ui-settings-general',
    sha: '86ae7c4e519e58c93a216c7b800e1abae2c586092ef025196be1bce6f27a5f9f',
    pairs: [
      [
        'if (appeared && open) close();',
        'if (appeared && open && !document.body.hasAttribute("data-notara-ui")) close();',
      ],
      [
        'onboardingStep !== void 0 && renderSlot("settings.onboarding", {',
        'onboardingStep !== void 0 && (!open || !document.body.hasAttribute("data-notara-ui")) && renderSlot("settings.onboarding", {',
      ],
    ],
  },
  {
    package: 'dsh-client-ui-commands',
    sha: '797f7da86aba76760c01d7d2161a95610ef79424e6bf8a690cc9eda880823af6',
    pairs: [[
      'const visible = rows.filter((c) => req.position === "leading" || c.hint === void 0);',
      'const studentView = document.body.hasAttribute("data-notara-ui") && document.body.dataset.notaraDebug !== "true";\n\t\t\t\tconst visible = rows.filter((c) => (!studentView || !["feedback", "export"].includes(c.name)) && (req.position === "leading" || c.hint === void 0));',
    ]],
  },
  {
    package: 'dsh-client-ui-chat',
    sha: '09ae7bfefe7384249773d63c6d1fb8ae522e5d3a85b0e0428dfecfe2e8b827ca',
    pairs: [[
      'className: TurnUsagePanel_module_css_default.root,',
      'className: TurnUsagePanel_module_css_default.root,\n\t\t\t\t"data-turn-usage": true,',
    ]],
  },
] as const;
const sha = (source: string) => createHash('sha256').update(source).digest('hex');
for (const patch of patches) {
  const path = new URL(`../node_modules/@deepseek-ai/${patch.package}/lib/client.js`, import.meta.url);
  const source = readFileSync(path, 'utf8');
  let base = source;
  for (const [before, after] of [...patch.pairs].reverse()) base = base.replace(after, before);
  if (sha(base) !== patch.sha) throw new Error(`Unknown DSH student UI artifact: ${patch.package}`);
  let result = base;
  for (const [before, after] of patch.pairs) {
    if (result.split(before).length !== 2) throw new Error(`Student UI anchor changed: ${patch.package}`);
    result = result.replace(before, after);
  }
  if (result !== source) writeFileSync(path, result);
}
console.log('Verified DSH student settings, command and usage presentation');
