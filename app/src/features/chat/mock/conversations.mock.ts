import type { ChatConversation, ChatMessage } from '../types';

// ── Helpers de tempo ──────────────────────────────────────────────────────────
const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const hoursAgo   = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const daysAgo    = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

// ── Conversas ─────────────────────────────────────────────────────────────────

export const MOCK_CONVERSATIONS: ChatConversation[] = [
  {
    id: 'conv-1',
    contact: { id: 'c1', name: 'Geovana Silvestre', phone: '554499881234', initials: 'GS', avatarColor: '#7c3aed' },
    session: { id: 'sess-1', name: 'Adriel 2', phone: '554774003804' },
    status: 'bot',
    unreadCount: 3,
    lastMessage: 'Opção inválida. Por favor, escolha uma das opções do menu.',
    lastMessageAt: minutesAgo(3),
    tags: ['comercial'],
    assignedTo: null,
    notes: '',
    queue: 'Atendimento Geral',
  },
  {
    id: 'conv-2',
    contact: { id: 'c2', name: 'Rubem Lima', phone: '554788990011', initials: 'RL', avatarColor: '#4f70e0' },
    session: { id: 'sess-1', name: 'Adriel 2', phone: '554774003804' },
    status: 'open',
    unreadCount: 0,
    lastMessage: 'Obrigado pelo atendimento! Ficou muito bom.',
    lastMessageAt: minutesAgo(15),
    tags: ['suporte', 'resolvido'],
    assignedTo: 'Adriel',
    notes: 'Cliente recorrente. Prefere contato via WhatsApp.',
    queue: 'Suporte Técnico',
  },
  {
    id: 'conv-3',
    contact: { id: 'c3', name: 'Carlos Mendonça', phone: '5511987654321', initials: 'CM', avatarColor: '#0ea5e9' },
    session: { id: 'sess-1', name: 'Adriel 2', phone: '554774003804' },
    status: 'waiting',
    unreadCount: 1,
    lastMessage: 'Oi, quero saber sobre os planos disponíveis.',
    lastMessageAt: minutesAgo(40),
    tags: ['vendas'],
    assignedTo: null,
    notes: '',
    queue: 'Vendas',
  },
  {
    id: 'conv-4',
    contact: { id: 'c4', name: 'Fernanda Rocha', phone: '5521976543210', initials: 'FR', avatarColor: '#10b981' },
    session: { id: 'sess-1', name: 'Adriel 2', phone: '554774003804' },
    status: 'closed',
    unreadCount: 0,
    lastMessage: 'Atendimento encerrado.',
    lastMessageAt: hoursAgo(2),
    tags: ['financeiro', 'encerrado'],
    assignedTo: 'Ana Paula',
    notes: 'Solicitou nota fiscal. Enviada por e-mail.',
    queue: null,
  },
  {
    id: 'conv-5',
    contact: { id: 'c5', name: 'João Augusto Ferreira', phone: '5531944445555', initials: 'JA', avatarColor: '#f59e0b' },
    session: { id: 'sess-1', name: 'Adriel 2', phone: '554774003804' },
    status: 'open',
    unreadCount: 5,
    lastMessage: 'URGENTE: o sistema está fora do ar desde ontem!',
    lastMessageAt: minutesAgo(8),
    tags: ['urgente', 'suporte'],
    assignedTo: null,
    notes: 'Cliente enterprise. Prioridade máxima.',
    queue: 'Suporte Técnico',
  },
  {
    id: 'conv-6',
    contact: { id: 'c6', name: 'Mariam El-Haddad', phone: '5541988776655', initials: 'ME', avatarColor: '#8b5cf6' },
    session: { id: 'sess-1', name: 'Adriel 2', phone: '554774003804' },
    status: 'bot',
    unreadCount: 0,
    lastMessage: 'Olá! Sou o assistente virtual da WaioPrime. Como posso ajudar?',
    lastMessageAt: hoursAgo(1),
    tags: ['bot', 'novo'],
    assignedTo: null,
    notes: '',
    queue: 'Atendimento Geral',
  },
];

// ── Mensagens por conversa ────────────────────────────────────────────────────

export const MOCK_MESSAGES: Record<string, ChatMessage[]> = {
  'conv-1': [
    { id: 'm1-1', conversationId: 'conv-1', type: 'event', direction: 'in', body: 'Conversa iniciada via bot', timestamp: daysAgo(1), status: 'read', isEvent: true },
    { id: 'm1-2', conversationId: 'conv-1', type: 'text', direction: 'in', body: 'Olá! Gostaria de saber mais sobre os planos.', timestamp: daysAgo(1), status: 'read' },
    { id: 'm1-3', conversationId: 'conv-1', type: 'text', direction: 'out', body: '👋 Olá! Bem-vinda à WaioPrime!\n\nEscolha uma das opções:\n*1* - Comercial 🏢\n*2* - Financeiro 💰\n*3* - Suporte técnico 🔧\n*0* - Falar com atendente', timestamp: daysAgo(1), status: 'read' },
    { id: 'm1-4', conversationId: 'conv-1', type: 'text', direction: 'in', body: '1', timestamp: minutesAgo(10), status: 'read' },
    { id: 'm1-5', conversationId: 'conv-1', type: 'text', direction: 'out', body: '*Setor Comercial*\n\nEscolha:\n*1* - Planos e preços\n*2* - Demonstração\n*3* - Voltar', timestamp: minutesAgo(10), status: 'read' },
    { id: 'm1-6', conversationId: 'conv-1', type: 'text', direction: 'in', body: '5', timestamp: minutesAgo(5), status: 'read' },
    { id: 'm1-7', conversationId: 'conv-1', type: 'text', direction: 'out', body: 'Opção inválida. Por favor, escolha uma das opções do menu.', timestamp: minutesAgo(3), status: 'delivered' },
  ],
  'conv-2': [
    { id: 'm2-1', conversationId: 'conv-2', type: 'text', direction: 'in', body: 'Oi, estou com um problema no envio de mensagens em massa.', timestamp: hoursAgo(3), status: 'read' },
    { id: 'm2-2', conversationId: 'conv-2', type: 'text', direction: 'out', body: 'Olá, Rubem! Pode me descrever melhor o problema? Está ocorrendo algum erro específico?', timestamp: hoursAgo(3), status: 'read' },
    { id: 'm2-3', conversationId: 'conv-2', type: 'text', direction: 'in', body: 'Quando tento importar a lista de contatos ele dá um erro de formato.', timestamp: hoursAgo(2), status: 'read' },
    { id: 'm2-4', conversationId: 'conv-2', type: 'text', direction: 'out', body: 'Entendido! Certifique-se de que o arquivo está no formato CSV com as colunas: nome, telefone, variavel1. O telefone deve estar sem formatação, ex: 5511999887766.', timestamp: hoursAgo(2), status: 'read' },
    { id: 'm2-5', conversationId: 'conv-2', type: 'text', direction: 'in', body: 'Entendi! Vou corrigir aqui.', timestamp: minutesAgo(30), status: 'read' },
    { id: 'm2-6', conversationId: 'conv-2', type: 'text', direction: 'in', body: 'Deu certo! Obrigado pelo atendimento! Ficou muito bom.', timestamp: minutesAgo(15), status: 'read' },
    { id: 'm2-7', conversationId: 'conv-2', type: 'event', direction: 'out', body: 'Atendimento encerrado por Adriel', timestamp: minutesAgo(14), status: 'sent', isEvent: true },
  ],
  'conv-3': [
    { id: 'm3-1', conversationId: 'conv-3', type: 'text', direction: 'in', body: 'Oi, quero saber sobre os planos disponíveis.', timestamp: minutesAgo(40), status: 'read' },
    { id: 'm3-2', conversationId: 'conv-3', type: 'event', direction: 'out', body: 'Aguardando atendente disponível na fila Vendas', timestamp: minutesAgo(39), status: 'sent', isEvent: true },
  ],
  'conv-4': [
    { id: 'm4-1', conversationId: 'conv-4', type: 'text', direction: 'in', body: 'Olá, preciso de uma nota fiscal da compra do mês passado.', timestamp: hoursAgo(3), status: 'read' },
    { id: 'm4-2', conversationId: 'conv-4', type: 'text', direction: 'out', body: 'Olá, Fernanda! Vou verificar e enviar por e-mail em instantes.', timestamp: hoursAgo(3), status: 'read' },
    { id: 'm4-3', conversationId: 'conv-4', type: 'text', direction: 'in', body: 'Ótimo, obrigada!', timestamp: hoursAgo(2), status: 'read' },
    { id: 'm4-4', conversationId: 'conv-4', type: 'event', direction: 'out', body: 'Atendimento encerrado por Ana Paula', timestamp: hoursAgo(2), status: 'sent', isEvent: true },
  ],
  'conv-5': [
    { id: 'm5-1', conversationId: 'conv-5', type: 'text', direction: 'in', body: 'Olá, o sistema está com lentidão desde ontem à tarde.', timestamp: hoursAgo(20), status: 'read' },
    { id: 'm5-2', conversationId: 'conv-5', type: 'text', direction: 'out', body: 'Oi, João! Vou verificar os logs do servidor agora.', timestamp: hoursAgo(19), status: 'read' },
    { id: 'm5-3', conversationId: 'conv-5', type: 'text', direction: 'in', body: 'Agora piorou. Está completamente fora do ar!', timestamp: minutesAgo(30), status: 'read' },
    { id: 'm5-4', conversationId: 'conv-5', type: 'text', direction: 'in', body: 'Nossos clientes não conseguem enviar nem receber mensagens.', timestamp: minutesAgo(20), status: 'read' },
    { id: 'm5-5', conversationId: 'conv-5', type: 'text', direction: 'in', body: 'Preciso de uma previsão de retorno com URGÊNCIA.', timestamp: minutesAgo(15), status: 'read' },
    { id: 'm5-6', conversationId: 'conv-5', type: 'text', direction: 'in', body: 'URGENTE: o sistema está fora do ar desde ontem!', timestamp: minutesAgo(8), status: 'delivered' },
  ],
  'conv-6': [
    { id: 'm6-1', conversationId: 'conv-6', type: 'text', direction: 'in', body: 'Boa tarde!', timestamp: hoursAgo(2), status: 'read' },
    { id: 'm6-2', conversationId: 'conv-6', type: 'text', direction: 'out', body: 'Olá! Sou o assistente virtual da WaioPrime. Como posso ajudar?\n\nEscolha uma opção:\n*1* - Suporte\n*2* - Vendas\n*3* - Financeiro', timestamp: hoursAgo(1), status: 'read' },
  ],
};
