import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ConversationSidebar } from './ConversationSidebar';
import type { ChatConversation, ConversationFilter } from '../types';

function makeConversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'conv-1',
    contact: { id: 'c1', name: 'Geovana Silvestre', phone: '554499881234', initials: 'GS', avatarColor: '#7c3aed' },
    session: { id: 'sess-1', name: 'Sessão 1', phone: '554774003804' },
    status: 'open',
    unreadCount: 0,
    lastMessage: 'Tudo certo por aqui',
    lastMessageAt: new Date().toISOString(),
    tags: [],
    assignedTo: null,
    notes: '',
    queue: null,
    ...overrides,
  } as ChatConversation;
}

const conversas = [
  makeConversation({ id: 'fav', favorite: true, contact: { id: 'c1', name: 'Ana Marcada', phone: '1', initials: 'F', avatarColor: '#000' } }),
  makeConversation({ id: 'comum', favorite: false, contact: { id: 'c2', name: 'Comum', phone: '2', initials: 'C', avatarColor: '#000' } }),
  makeConversation({ id: 'sem-flag', contact: { id: 'c3', name: 'Sem flag', phone: '3', initials: 'S', avatarColor: '#000' } }),
];

function render(
  filter: ConversationFilter,
  onFilterChange = vi.fn(),
  mode?: 'light' | 'dark',
  extra: {
    conversations?: ChatConversation[];
    lists?: Array<{ name: string; count: number }>;
    onCreateList?: (name: string, ids: string[]) => void;
    onUpdateList?: (oldName: string, newName: string, ids: string[]) => void;
    onDeleteList?: (name: string) => void;
  } = {},
) {
  renderWithTheme(
    <ConversationSidebar
      conversations={extra.conversations ?? conversas}
      selectedId={null}
      onSelect={vi.fn()}
      sessions={[]}
      selectedSessionId={null}
      onSessionChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      filter={filter}
      onFilterChange={onFilterChange}
      lists={extra.lists}
      onCreateList={extra.onCreateList}
      onUpdateList={extra.onUpdateList}
      onDeleteList={extra.onDeleteList}
    />,
    mode,
  );
  return onFilterChange;
}

describe('ConversationSidebar — filtro Favoritas', () => {
  it('oferece o chip Favoritas com a contagem de conversas favoritas', async () => {
    const onFilterChange = render('all');

    await userEvent.click(screen.getByText('Favoritas 1'));

    expect(onFilterChange).toHaveBeenCalledWith('favorite');
  });

  it('com o filtro ativo, lista só as favoritas', () => {
    render('favorite', vi.fn(), 'dark');

    expect(screen.getByText('Ana Marcada')).toBeInTheDocument();
    expect(screen.queryByText('Comum')).not.toBeInTheDocument();
    expect(screen.queryByText('Sem flag')).not.toBeInTheDocument();
  });

  it('o filtro Todos continua mostrando todas', () => {
    render('all');

    expect(screen.getByText('Ana Marcada')).toBeInTheDocument();
    expect(screen.getByText('Comum')).toBeInTheDocument();
    expect(screen.getByText('Sem flag')).toBeInTheDocument();
  });
});

const comListas = [
  makeConversation({ id: 'p1', lists: ['Auto peças'], contact: { id: 'c1', name: 'Oficina Zé', phone: '1', initials: 'O', avatarColor: '#000' } }),
  makeConversation({ id: 'p2', lists: ['Auto peças', 'Clientes'], contact: { id: 'c2', name: 'Peças Norte', phone: '2', initials: 'P', avatarColor: '#000' } }),
  makeConversation({ id: 'p3', contact: { id: 'c3', name: 'Sem lista', phone: '3', initials: 'S', avatarColor: '#000' } }),
];

describe('ConversationSidebar — chip de listas', () => {
  it('sem onCreateList o chip não aparece', () => {
    render('all');
    expect(screen.queryByRole('button', { name: 'Listas' })).not.toBeInTheDocument();
  });

  it('o ▾ abre um menu com as listas em ordem alfabética, contagem e "Nova lista"', async () => {
    render('all', vi.fn(), 'dark', { conversations: comListas, onCreateList: vi.fn() });

    const chip = screen.getByRole('button', { name: 'Listas' });
    expect(chip).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(chip);

    const items = screen.getAllByRole('menuitem');
    expect(items.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual([
      'Auto peças, 2 conversas',
      'Clientes, 1 conversa',
      'Nova lista',
    ]);
  });

  it('escolher uma lista ativa o filtro list:<nome>', async () => {
    const onFilterChange = render('all', vi.fn(), undefined, { conversations: comListas, onCreateList: vi.fn() });

    await userEvent.click(screen.getByRole('button', { name: 'Listas' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Clientes, 1 conversa' }));

    expect(onFilterChange).toHaveBeenCalledWith('list:Clientes');
  });

  it('com o filtro de lista ativo, mostra só as conversas da lista e o chip com o nome', () => {
    render('list:Auto peças', vi.fn(), 'dark', { conversations: comListas, onCreateList: vi.fn() });

    expect(screen.getByText('Oficina Zé')).toBeInTheDocument();
    expect(screen.getByText('Peças Norte')).toBeInTheDocument();
    expect(screen.queryByText('Sem lista')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listas' })).toHaveTextContent('Auto peças 2');
  });

  it('"Nova lista" abre o diálogo de criação', async () => {
    render('all', vi.fn(), undefined, { conversations: comListas, onCreateList: vi.fn() });

    await userEvent.click(screen.getByRole('button', { name: 'Listas' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Nova lista' }));

    expect(screen.getByRole('dialog', { name: 'Nova lista' })).toBeInTheDocument();
  });

  it('com o catálogo, o menu mostra a contagem do servidor e inclui lista vazia', async () => {
    const lists = [{ name: 'Zeta', count: 0 }, { name: 'Auto peças', count: 7 }];
    render('all', vi.fn(), 'dark', { conversations: comListas, lists, onCreateList: vi.fn() });

    await userEvent.click(screen.getByRole('button', { name: 'Listas' }));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual([
      'Auto peças, 7 conversas',
      'Zeta, 0 conversas',
      'Nova lista',
    ]);
  });

  it('com o catálogo, o chip da lista ativa usa a contagem do servidor', () => {
    const lists = [{ name: 'Auto peças', count: 7 }];
    render('list:Auto peças', vi.fn(), undefined, { conversations: comListas, lists, onCreateList: vi.fn() });

    expect(screen.getByRole('button', { name: 'Listas' })).toHaveTextContent('Auto peças 7');
  });

  it('sem nenhuma lista, o menu avisa e ainda oferece criar', async () => {
    render('all', vi.fn(), undefined, { onCreateList: vi.fn() });

    await userEvent.click(screen.getByRole('button', { name: 'Listas' }));

    expect(screen.getByText('Nenhuma lista ainda')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Nova lista' })).toBeInTheDocument();
  });
});

describe('ConversationSidebar — editar e excluir lista', () => {
  const manage = () => ({ onCreateList: vi.fn(), onUpdateList: vi.fn(), onDeleteList: vi.fn() });

  it('sem onUpdateList/onDeleteList, os itens não têm ⋮', async () => {
    render('all', vi.fn(), undefined, { conversations: comListas, onCreateList: vi.fn() });

    await userEvent.click(screen.getByRole('button', { name: 'Listas' }));

    expect(screen.queryByRole('button', { name: 'Ações da lista Auto peças' })).not.toBeInTheDocument();
  });

  it('o ⋮ de um item abre Editar lista e Excluir lista', async () => {
    render('all', vi.fn(), 'dark', { conversations: comListas, ...manage() });

    await userEvent.click(screen.getByRole('button', { name: 'Listas' }));
    const actions = screen.getByRole('button', { name: 'Ações da lista Auto peças' });
    expect(actions).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(actions);

    expect(screen.getByRole('menuitem', { name: 'Editar lista' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Excluir lista' })).toBeInTheDocument();
  });

  it('Editar lista abre o diálogo com nome e conversas da lista e salva pelo onUpdateList', async () => {
    const handlers = manage();
    render('all', vi.fn(), 'dark', { conversations: comListas, ...handlers });

    await userEvent.click(screen.getByRole('button', { name: 'Listas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ações da lista Auto peças' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar lista' }));

    const dialog = screen.getByRole('dialog', { name: 'Editar lista' });
    expect(within(dialog).getByLabelText('Nome da lista')).toHaveValue('Auto peças');
    expect(within(dialog).getByRole('checkbox', { name: /Oficina Zé/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('checkbox', { name: /Peças Norte/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('checkbox', { name: /Sem lista/ })).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Peças Norte/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(handlers.onUpdateList).toHaveBeenCalledWith('Auto peças', 'Auto peças', ['p1']);
    expect(handlers.onCreateList).not.toHaveBeenCalled();
  });

  async function openDeleteConfirm() {
    await userEvent.click(screen.getByRole('button', { name: 'Listas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ações da lista Auto peças' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excluir lista' }));
    return screen.getByRole('dialog', { name: 'Excluir lista?' });
  }

  it('Excluir lista pede confirmação com a contagem; Cancelar não exclui', async () => {
    const handlers = manage();
    render('all', vi.fn(), 'dark', { conversations: comListas, ...handlers });

    const dialog = await openDeleteConfirm();
    expect(within(dialog).getByText('A lista Auto peças será removida de 2 conversas. As conversas continuam no painel.')).toBeInTheDocument();
    expect(handlers.onDeleteList).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(handlers.onDeleteList).not.toHaveBeenCalled();
  });

  it('confirmar a exclusão chama onDeleteList com o nome', async () => {
    const handlers = manage();
    render('all', vi.fn(), undefined, { conversations: comListas, ...handlers });

    const dialog = await openDeleteConfirm();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect(handlers.onDeleteList).toHaveBeenCalledWith('Auto peças');
  });

  it('com a lista ativa, um ⋮ ao lado do chip abre as mesmas ações', async () => {
    render('list:Clientes', vi.fn(), 'dark', { conversations: comListas, ...manage() });

    await userEvent.click(screen.getByRole('button', { name: 'Ações da lista Clientes' }));

    expect(screen.getByRole('menuitem', { name: 'Editar lista' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Excluir lista' })).toBeInTheDocument();
  });
});
