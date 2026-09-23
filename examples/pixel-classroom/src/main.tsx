import React from 'react';
import { createRoot } from 'react-dom/client';
import { loadClassroomAssets } from './assets';
import ClassroomApp from './ClassroomApp';
import './classroom.css';

async function main() {
  await loadClassroomAssets();
  createRoot(document.getElementById('root')!).render(<ClassroomApp />);
}
main().catch(error => {
  console.error(error);
  const root = document.getElementById('root')!;
  root.replaceChildren();
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = '教室没有加载成功，请刷新重试。';
  root.append(message);
});
