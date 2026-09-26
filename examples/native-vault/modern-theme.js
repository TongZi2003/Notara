import css from './modern-theme.css';
import notebookCss from './notebook-theme.css';
import { themeTokens } from './theme-tokens.js';

export { MODERN_TOKENS } from './theme-tokens.js';

/**
 * All changes are owned by this plugin; unloading restores the native theme.
 * The minimal layout is always the base. 手帐 swaps the token layer and adds a
 * decoration stylesheet scoped to `data-notara-style=notebook`, live, without
 * a reload.
 */
export function installModernTheme(ctx, appearance) {
  const style = () => appearance?.getSnapshot().style ?? 'minimal';
  ctx.effect(()=>{
    // Re-overriding the same source replaces the layer in place, so switching
    // never flashes the native palette in between.
    let dispose=ctx.theme.overrideTokens('@notara/vault-native',themeTokens(style()));
    const stop=appearance?.subscribe(()=>{dispose=ctx.theme.overrideTokens('@notara/vault-native',themeTokens(style()));});
    return ()=>{stop?.();dispose();};
  });
  ctx.effect(()=>{
    const previous=document.body.getAttribute('data-notara-ui');
    document.body.setAttribute('data-notara-ui','modern');
    const sheet=document.createElement('style'); sheet.dataset.notaraTheme='modern';sheet.textContent=css;document.head.append(sheet);
    let paper=null;
    const sync=()=>{
      const notebook=style()==='notebook';
      if(notebook&&!paper){paper=document.createElement('style');paper.dataset.notaraTheme='notebook';paper.textContent=notebookCss;document.head.append(paper);}
      if(!notebook&&paper){paper.remove();paper=null;}
      if(notebook)document.body.setAttribute('data-notara-style','notebook');else document.body.removeAttribute('data-notara-style');
    };
    sync();const stop=appearance?.subscribe(sync);
    const timingHint=event=>{const button=event.target.closest?.('.Q51KRG_trigger');if(button)button.title=button.querySelector('.Q51KRG_label')?.textContent??'';};
    document.addEventListener('pointerover',timingHint);document.addEventListener('focusin',timingHint);
    return ()=>{stop?.();document.removeEventListener('pointerover',timingHint);document.removeEventListener('focusin',timingHint);sheet.remove();paper?.remove();document.body.removeAttribute('data-notara-style');if(previous===null)document.body.removeAttribute('data-notara-ui');else document.body.setAttribute('data-notara-ui',previous);};
  });
}
