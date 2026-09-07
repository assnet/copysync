/**
 * Barreiras de interface contra cópia e inspeção casual.
 *
 * IMPORTANTE — alcance real desta proteção:
 *
 * Nenhum código que roda no navegador consegue impedir de fato a cópia de conteúdo
 * ou a abertura das ferramentas de desenvolvedor. Elas podem ser abertas pelo menu
 * do navegador, por um atalho remapeado, antes de a página carregar, ou o conteúdo
 * pode ser lido pela aba de rede, por extensões, por leitores de tela ou por uma
 * simples captura de tela. Tudo o que chega ao navegador está, por definição, na
 * máquina de quem acessa.
 *
 * O que este módulo entrega é atrito: desencoraja a cópia acidental ou casual e
 * sinaliza que o conteúdo é restrito. Não é uma fronteira de segurança, e nenhuma
 * decisão de proteção de dados deve se apoiar nele — o que não pode vazar não deve
 * ser enviado ao cliente, que é a razão de a lista de membros ser paginada no
 * servidor com cursor assinado.
 */

export interface UiGuardOptions {
  /** Bloqueia cópia, recorte e seleção fora de campos de entrada. */
  blockCopy?: boolean;
  /** Bloqueia os atalhos de ferramentas de desenvolvedor e de código-fonte. */
  blockDevTools?: boolean;
  /** Bloqueia o menu de contexto do navegador. */
  blockContextMenu?: boolean;
}

const DEFAULTS: Required<UiGuardOptions> = {
  blockCopy: true,
  blockDevTools: true,
  blockContextMenu: true,
};

/** Campos de entrada seguem funcionando: digitar, colar e copiar o que se escreve. */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/** Atalhos de ferramentas de desenvolvedor no Windows/Linux e no macOS. */
function isDevToolsShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();

  if (e.key === 'F12') return true;

  // Windows/Linux: Ctrl+Shift+I/J/C (inspetor, console, seletor)
  if (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(key)) return true;

  // macOS: Cmd+Option+I/J/C
  if (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(key)) return true;

  // Código-fonte: Ctrl+U / Cmd+Option+U
  if ((e.ctrlKey || e.metaKey) && key === 'u') return true;

  // Salvar a página
  if ((e.ctrlKey || e.metaKey) && key === 's') return true;

  return false;
}

/**
 * Instala as barreiras e devolve a função que as remove.
 *
 * Feito com listeners próprios, sem dependência de framework, para poder ser usado
 * de qualquer lugar do painel.
 */
export function installUiGuards(options: UiGuardOptions = {}): () => void {
  // Resolvido campo a campo: espalhar `options` sobrescreveria os padrões com
  // `undefined` quando quem chama repassa uma opção não informada.
  const config: Required<UiGuardOptions> = {
    blockCopy: options.blockCopy ?? DEFAULTS.blockCopy,
    blockDevTools: options.blockDevTools ?? DEFAULTS.blockDevTools,
    blockContextMenu: options.blockContextMenu ?? DEFAULTS.blockContextMenu,
  };
  const cleanups: Array<() => void> = [];

  const on = <K extends keyof DocumentEventMap>(
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
  ) => {
    document.addEventListener(type, handler, { capture: true });
    cleanups.push(() => document.removeEventListener(type, handler, { capture: true }));
  };

  if (config.blockCopy) {
    const blockClipboard = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
    };
    on('copy', blockClipboard);
    on('cut', blockClipboard);

    // A seleção some fora dos campos; o CSS complementa o listener, porque impede
    // o arrasto de seleção em vez de apenas anular a cópia.
    const style = document.createElement('style');
    // `data-app` é o marcador de estilo próprio do painel: sem ele o DomGuardian
    // trata a injeção como vinda de extensão e remove o elemento do <head>.
    style.setAttribute('data-app', 'ui-guards');
    style.textContent = `
      body { -webkit-user-select: none; user-select: none; }
      input, textarea, [contenteditable="true"] { -webkit-user-select: text; user-select: text; }
    `;
    document.head.appendChild(style);
    cleanups.push(() => style.remove());
  }

  if (config.blockContextMenu) {
    on('contextmenu', (e) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
    });
  }

  if (config.blockDevTools) {
    on('keydown', (e) => {
      if (isDevToolsShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  return () => cleanups.forEach((fn) => fn());
}
