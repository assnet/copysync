import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { NewListDialog } from './NewListDialog';
import type { ChatConversation } from '../types';

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
  makeConversation({ id: 'a', contact: { id: 'c1', name: 'Oficina Zé', phone: '5547999990001', initials: 'O', avatarColor: '#000' } }),
  makeConversation({ id: 'b', contact: { id: 'c2', name: 'Peças Norte', phone: '5547999990002', initials: 'P', avatarColor: '#000' } }),
  makeConversation({ id: 'g', isGroup: true, groupName: 'Mecânicos', contact: { id: 'c3', name: 'grupo', phone: '1203', initials: 'M', avatarColor: '#000' } }),
];

function render(mode?: 'light' | 'dark', existing: string[] = ['Auto peças']) {
  const onCreate = vi.fn();
  const onClose = vi.fn();
  renderWithTheme(
    <NewListDialog open onClose={onClose} conversations={conversas} existingLists={existing} onSubmit={onCreate} />,
    mode,
  );
  return { onCreate, onClose };
}

describe('NewListDialog', () => {
  it('abre com o foco no nome e o Criar desabilitado', () => {
    render('dark');

    expect(screen.getByRole('dialog', { name: 'Nova lista' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome da lista')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
  });

  it('lista as conversas com telefone e marca grupo', () => {
    render();

    const list = screen.getByRole('list', { name: 'Conversas' });
    expect(within(list).getByText('Oficina Zé')).toBeInTheDocument();
    expect(within(list).getByText('Mecânicos')).toBeInTheDocument();
    expect(within(list).getByText('Grupo')).toBeInTheDocument();
    expect(within(list).getAllByRole('checkbox')).toHaveLength(3);
  });

  it('recusa nome repetido sem diferenciar maiúsculas', async () => {
    render();

    await userEvent.type(screen.getByLabelText('Nome da lista'), 'auto PEÇAS');
    await userEvent.tab();

    expect(screen.getByText('Já existe uma lista com esse nome.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome da lista')).toHaveAttribute('aria-invalid', 'true');
  });

  it('recusa nome acima de 40 caracteres e nome só com espaços', async () => {
    render();
    const name = screen.getByLabelText('Nome da lista');

    await userEvent.type(name, 'x'.repeat(41));
    await userEvent.tab();
    expect(screen.getByText('Use até 40 caracteres.')).toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, '   ');
    await userEvent.tab();
    expect(screen.getByText('Informe um nome para a lista.')).toBeInTheDocument();
  });

  it('exige ao menos uma conversa: com nome válido e nada marcado, Criar segue desabilitado', async () => {
    render();

    await userEvent.type(screen.getByLabelText('Nome da lista'), 'Clientes');

    expect(screen.getByText('Nenhuma conversa selecionada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
  });

  it('filtra as conversas pela busca', async () => {
    render();

    await userEvent.type(screen.getByLabelText('Buscar conversa'), 'norte');

    const list = screen.getByRole('list', { name: 'Conversas' });
    expect(within(list).getByText('Peças Norte')).toBeInTheDocument();
    expect(within(list).queryByText('Oficina Zé')).not.toBeInTheDocument();
  });

  it('cria com o nome aparado e os ids marcados, depois fecha', async () => {
    const { onCreate, onClose } = render('dark');

    await userEvent.type(screen.getByLabelText('Nome da lista'), '  Clientes VIP ');
    await userEvent.click(screen.getByRole('checkbox', { name: /Oficina Zé/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Mecânicos/ }));
    expect(screen.getByText('2 conversas selecionadas')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Criar' }));

    expect(onCreate).toHaveBeenCalledWith('Clientes VIP', ['a', 'g']);
    expect(onClose).toHaveBeenCalled();
  });

  it('desmarcar tira a conversa da seleção', async () => {
    const { onCreate } = render();

    await userEvent.type(screen.getByLabelText('Nome da lista'), 'Clientes');
    const item = screen.getByRole('checkbox', { name: /Oficina Zé/ });
    await userEvent.click(item);
    expect(item).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(item);
    expect(item).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('Esc e Cancelar fecham sem criar', async () => {
    const { onCreate, onClose } = render();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('NewListDialog — modo edição', () => {
  function renderEdit(mode?: 'light' | 'dark') {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <NewListDialog
        open
        mode="edit"
        initialName="Auto peças"
        initialConversationIds={['a', 'g']}
        onClose={onClose}
        conversations={conversas}
        existingLists={['Auto peças', 'Clientes']}
        onSubmit={onSubmit}
      />,
      mode,
    );
    return { onSubmit, onClose };
  }

  it('abre com título Editar lista, nome preenchido e conversas marcadas', () => {
    renderEdit('dark');

    expect(screen.getByRole('dialog', { name: 'Editar lista' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome da lista')).toHaveValue('Auto peças');
    expect(screen.getByRole('checkbox', { name: /Oficina Zé/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Mecânicos/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Peças Norte/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('2 conversas selecionadas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  it('o próprio nome não conta como repetido, mas outra lista conta', async () => {
    renderEdit();
    const name = screen.getByLabelText('Nome da lista');

    await userEvent.tab();
    expect(screen.queryByText('Já existe uma lista com esse nome.')).not.toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, 'clientes');
    await userEvent.tab();
    expect(screen.getByText('Já existe uma lista com esse nome.')).toBeInTheDocument();
  });

  it('salvar envia o nome e o conjunto atual de ids, depois fecha', async () => {
    const { onSubmit, onClose } = renderEdit('dark');

    await userEvent.click(screen.getByRole('checkbox', { name: /Mecânicos/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Peças Norte/ }));
    const name = screen.getByLabelText('Nome da lista');
    await userEvent.clear(name);
    await userEvent.type(name, 'Peças');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(onSubmit).toHaveBeenCalledWith('Peças', ['a', 'b']);
    expect(onClose).toHaveBeenCalled();
  });

  it('sem nenhuma conversa marcada, Salvar desabilita', async () => {
    renderEdit();

    await userEvent.click(screen.getByRole('checkbox', { name: /Oficina Zé/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Mecânicos/ }));

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });
});
