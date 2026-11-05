import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// findBy*/waitFor: o padrão de 1 s é tempo de relógio, não de CPU. Com a suíte em paralelo
// (forks em 100% dos núcleos) a 1ª tela de um arquivo (sessões → config → capturadas, um
// commit de MUI por etapa) passou de 5 s e a busca expirava antes do dado chegar. O limite
// só pesa quando a asserção falha; a asserção continua a mesma.
configure({ asyncUtilTimeout: 10_000 });

// Desmonta a árvore React entre testes — sem isso, queries do Testing Library
// encontram nós de testes anteriores e o erro aparece longe da causa.
afterEach(() => {
  cleanup();
  // Rede de segurança: teste que liga relógio falso e falha antes de desligar não
  // contamina o próximo do mesmo arquivo.
  vi.useRealTimers();
});
