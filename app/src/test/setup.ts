import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Desmonta a árvore React entre testes — sem isso, queries do Testing Library
// encontram nós de testes anteriores e o erro aparece longe da causa.
afterEach(() => {
  cleanup();
});
