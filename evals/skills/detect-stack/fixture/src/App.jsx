import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';

export function Counter() {
  const [count, setCount] = useState(0);
  return createElement('button', { onClick: () => setCount(count + 1) }, `Clicked ${count}`);
}

createRoot(globalThis.document.body).render(createElement(Counter));
