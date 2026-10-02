/* This page displays supplied artwork and biographies only. It has no session or model API. */
(() => {
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const asset = name => `${name}?v=20261003`;
  const status = document.getElementById('loading');
  fetch(asset('catalog.json')).then(response => {
    if (!response.ok) throw new Error('catalog_unavailable');
    return response.json();
  }).then(data => {
    const roster = document.getElementById('roster');
    const select = (character, index) => {
      for (const [position, button] of [...roster.children].entries()) button.setAttribute('aria-pressed', String(position === index));
      document.getElementById('name').textContent = character.name;
      document.getElementById('subject').textContent = character.subject;
      document.getElementById('metadata').textContent = [character.englishName, `${character.age} 岁`, character.address, character.nationality].filter(Boolean).join(' · ');
      document.getElementById('page-number').textContent = `${String(index + 1).padStart(2, '0')} / 09`;
      const art = document.getElementById('art');
      art.src = asset(`${character.id}-profile.webp`); art.alt = `${character.name}角色原画`;
      document.getElementById('art-link').href = art.src;
      const story = document.getElementById('story'); story.replaceChildren();
      for (const section of character.sections) {
        const block = node('section'); block.append(node('h3', section.title), node('p', section.text)); story.append(block);
      }
      document.getElementById('profile').setAttribute('aria-label', `${character.name}的角色档案`);
    };
    data.characters.forEach((character, index) => {
      const button = node('button'); button.type = 'button';
      const img = node('img'); img.src = asset(`${character.id}-profile.webp`); img.alt = ''; img.loading = 'lazy'; img.width = 1536; img.height = 1024;
      button.append(img, node('strong', character.name), node('small', character.subject));
      button.addEventListener('click', () => select(character, index)); roster.append(button);
    });
    for (const text of data.background.split(/\r?\n\s*\r?\n/)) document.getElementById('background').append(node('p', text));
    select(data.characters[0], 0);
    document.getElementById('gallery').hidden = false; status.hidden = true;
  }).catch(() => { status.textContent = '画册暂时没有加载成功，请刷新页面重试。'; status.setAttribute('role', 'alert'); });
})();
