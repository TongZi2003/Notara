const toggle = document.querySelector('.nav-toggle');
const nav = document.getElementById('site-nav');
if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

const demo = document.querySelector('[data-demo]');
if (demo) playDemo(demo);

function playDemo(root) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps = [...root.querySelectorAll('[data-step]')];
  const body = root.querySelector('[data-demo-body]');
  const typing = root.querySelector('[data-demo-typing]');
  const replay = root.querySelector('[data-demo-replay]');
  if (reduce || !steps.length) return;

  let timer = 0;
  let index = 0;
  const later = (ms, fn) => { timer = window.setTimeout(fn, ms); };
  const follow = () => body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });

  const next = () => {
    if (index >= steps.length) { replay.hidden = false; return; }
    const step = steps[index++];
    const reveal = () => {
      typing.hidden = true;
      step.classList.add('is-in');
      follow();
      later(Number(step.dataset.wait) || 2500, next);
    };
    if (step.hasAttribute('data-typing')) {
      typing.hidden = false;
      follow();
      later(900, reveal);
    } else reveal();
  };

  const start = () => {
    window.clearTimeout(timer);
    steps.forEach(step => step.classList.remove('is-in'));
    typing.hidden = true;
    replay.hidden = true;
    index = 0;
    body.scrollTop = 0;
    later(500, next);
  };

  replay.addEventListener('click', start);
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    start();
  }, { threshold: .35 });
  observer.observe(root);
}
