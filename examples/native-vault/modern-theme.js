import css from './modern-theme.css';

const pairs = {
  '--dsw-alias-bg-base':['#ffffff','#15181d'],
  '--dsw-alias-bg-layer-1':['#ffffff','#1d2128'],
  '--dsw-alias-bg-layer-2':['#f4f5f6','#242a33'],
  '--dsw-alias-bg-layer-3':['#eceef0','#2a323e'],
  '--dsw-alias-bg-module-platform':['#f4f5f6','#242a33'],
  '--dsw-specific-sidebar-fill':['#ffffff','#1b1f25'],
  '--dsw-specific-input-major':['#ffffff','#1d2128'],
  '--dsw-specific-selector':['#f4f5f6','#242a33'],
  '--dsw-alias-interactive-bg-hover':['#eceef0','#2a323e'],
  '--dsw-alias-interactive-bg-hover-solid':['#eceef0','#2a323e'],
  '--dsw-alias-interactive-bg-active':['#f0f1f3','#333e4c'],
  '--dsw-alias-border-l1':['#e8ecf0','#2b323d'],
  '--dsw-alias-border-l2':['#d8dee6','#3b4553'],
  '--dsw-alias-border-l3':['#c7cdd4','#525c69'],
  '--dsw-alias-border-l4':['#b8c0ca','#66707e'],
  '--dsw-alias-label-primary':['#20252c','#edf0f4'],
  '--dsw-alias-label-secondary':['#525c69','#bac3cf'],
  '--dsw-alias-label-tertiary':['#697482','#a1aab7'],
  '--dsw-alias-label-caption':['#76808c','#939eac'],
  '--dsw-alias-label-link':['#59626e','#b5becb'],
  '--dsw-alias-link':['#59626e','#b5becb'],
  '--dsw-alias-brand-primary':['#59626e','#b5becb'],
  '--dsw-alias-state-business-primary':['#59626e','#b5becb'],
  '--dsw-alias-button-info-fill':['#f0f1f3','#333e4c'],
  '--dsw-alias-button-info-hover':['#e5e7ea','#424d5c'],
  '--dsh-composer-primary-color':['#343c46','#edf0f4'],
};
const font = '"Helvetica Neue",Helvetica,"Hiragino Sans GB","PingFang SC","Noto Sans SC","Microsoft YaHei UI",Arial,sans-serif';
export const MODERN_TOKENS = Object.fromEntries([...Object.entries(pairs).map(([name,[light,dark]])=>[name,{light,dark}]), ['--dsw-font-family',{light:font,dark:font}]]);

/** All changes are owned by this plugin; unloading restores the native theme. */
export function installModernTheme(ctx) {
  ctx.effect(()=>ctx.theme.overrideTokens('@notara/vault-native',MODERN_TOKENS));
  ctx.effect(()=>{
    const previous=document.body.getAttribute('data-notara-ui');
    document.body.setAttribute('data-notara-ui','modern');
    const style=document.createElement('style'); style.dataset.notaraTheme='modern';style.textContent=css;document.head.append(style);
    const timingHint=event=>{const button=event.target.closest?.('.Q51KRG_trigger');if(button)button.title=button.querySelector('.Q51KRG_label')?.textContent??'';};
    document.addEventListener('pointerover',timingHint);document.addEventListener('focusin',timingHint);
    return ()=>{document.removeEventListener('pointerover',timingHint);document.removeEventListener('focusin',timingHint);style.remove();if(previous===null)document.body.removeAttribute('data-notara-ui');else document.body.setAttribute('data-notara-ui',previous);};
  });
}
