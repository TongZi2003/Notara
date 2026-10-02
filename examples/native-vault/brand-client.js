import { academyUrl } from './academy.js';

/** Brand icon follows the plugin lifecycle; no character or teaching state is changed. */
export function installBrandIcon(ctx) {
  ctx.effect(() => {
    const previous = [...document.head.querySelectorAll('link[rel~="icon"]')];
    previous.forEach(link => link.remove());
    const link = document.createElement('link');
    link.rel = 'icon'; link.type = 'image/svg+xml'; link.href = academyUrl('notara.svg'); document.head.append(link);
    return () => { link.remove(); previous.forEach(item => document.head.append(item)); };
  });
}
