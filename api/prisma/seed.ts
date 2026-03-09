import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/shared/utils/hash';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱  Starting seed...');

  // ── Create default tenant ──────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      name: 'Default Tenant',
      slug: 'default',
      status: 'ACTIVE',
    },
  });

  console.log(`✅  Tenant: ${tenant.name} (${tenant.id})`);

  // ── Create super-admin user ────────────────────────────────────────────────
  // Default dev password: admin123 — change before deploying to production.
  const passwordHash = await hashPassword('admin123');

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@washoot.dev' },
    update: { passwordHash },
    create: {
      email: 'admin@washoot.dev',
      name: 'Super Admin',
      passwordHash,
      isSuperAdmin: true,
    },
  });

  console.log(`✅  Super admin: ${superAdmin.email} (${superAdmin.id})`);

  // ── Associate super-admin with default tenant ──────────────────────────────
  await prisma.userTenant.upsert({
    where: { userId_tenantId: { userId: superAdmin.id, tenantId: tenant.id } },
    update: {},
    create: {
      userId: superAdmin.id,
      tenantId: tenant.id,
      role: 'SUPER_ADMIN',
    },
  });

  console.log(`✅  UserTenant association created`);

  // ── Chat seed data ─────────────────────────────────────────────────────────
  // Verifica se já existe sessão para vincular
  const existingSession = await prisma.session.findFirst({
    where: { tenantId: tenant.id, deletedAt: null },
  });

  // Cria contatos de exemplo
  const now = new Date();
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  const hoursAgo   = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const daysAgo    = (d: number) => new Date(now.getTime() - d * 86_400_000);

  const contactsData = [
    { name: 'Geovana Silvestre',     phone: '554499881234' },
    { name: 'Rubem Lima',            phone: '554788990011' },
    { name: 'Carlos Mendonça',       phone: '5511987654321' },
    { name: 'Fernanda Rocha',        phone: '5521976543210' },
    { name: 'João Augusto Ferreira', phone: '5531944445555' },
    { name: 'Mariam El-Haddad',      phone: '5541988776655' },
  ];

  const contacts: { id: string; name: string }[] = [];

  for (const c of contactsData) {
    const contact = await prisma.chatContact.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone: c.phone } },
      update: { name: c.name },
      create: { tenantId: tenant.id, name: c.name, phone: c.phone },
    });
    contacts.push(contact);
  }

  console.log(`✅  ${contacts.length} chat contacts seeded`);

  // Dados de conversas de exemplo
  const conversationsData = [
    {
      contactIdx:  0,
      status:      'BOT'     as const,
      unreadCount: 3,
      lastPreview: 'Opção inválida. Por favor, escolha uma das opções do menu.',
      lastMsgAt:   minutesAgo(3),
      queueName:   'Atendimento Geral',
      tags:        ['comercial'],
      notes:       null,
      messages: [
        { direction: 'SYSTEM'   as const, type: 'EVENT'  as const, content: 'Conversa iniciada via bot',        at: daysAgo(1) },
        { direction: 'INBOUND'  as const, type: 'TEXT'   as const, content: 'Olá! Gostaria de saber mais sobre os planos.', at: daysAgo(1) },
        { direction: 'OUTBOUND' as const, type: 'TEXT'   as const, content: '👋 Olá! Bem-vinda à Washoot!\n\nEscolha uma das opções:\n*1* - Comercial\n*2* - Financeiro\n*3* - Suporte técnico\n*0* - Falar com atendente', at: daysAgo(1) },
        { direction: 'INBOUND'  as const, type: 'TEXT'   as const, content: '1',        at: minutesAgo(10) },
        { direction: 'OUTBOUND' as const, type: 'TEXT'   as const, content: '*Setor Comercial*\n\nEscolha:\n*1* - Planos e preços\n*2* - Demonstração\n*3* - Voltar', at: minutesAgo(10) },
        { direction: 'INBOUND'  as const, type: 'TEXT'   as const, content: '5',        at: minutesAgo(5) },
        { direction: 'OUTBOUND' as const, type: 'TEXT'   as const, content: 'Opção inválida. Por favor, escolha uma das opções do menu.', at: minutesAgo(3) },
      ],
    },
    {
      contactIdx:  1,
      status:      'OPEN'    as const,
      unreadCount: 0,
      lastPreview: 'Obrigado pelo atendimento! Ficou muito bom.',
      lastMsgAt:   minutesAgo(15),
      queueName:   'Suporte Técnico',
      tags:        ['suporte', 'resolvido'],
      notes:       'Cliente recorrente. Prefere contato via WhatsApp.',
      messages: [
        { direction: 'INBOUND'  as const, type: 'TEXT'  as const, content: 'Oi, estou com um problema no envio de mensagens em massa.', at: hoursAgo(3) },
        { direction: 'OUTBOUND' as const, type: 'TEXT'  as const, content: 'Olá, Rubem! Pode me descrever melhor o problema?', at: hoursAgo(3) },
        { direction: 'INBOUND'  as const, type: 'TEXT'  as const, content: 'Quando tento importar a lista de contatos ele dá um erro de formato.', at: hoursAgo(2) },
        { direction: 'OUTBOUND' as const, type: 'TEXT'  as const, content: 'Certifique-se de que o arquivo está no formato CSV com as colunas: nome, telefone.', at: hoursAgo(2) },
        { direction: 'INBOUND'  as const, type: 'TEXT'  as const, content: 'Deu certo! Obrigado pelo atendimento! Ficou muito bom.', at: minutesAgo(15) },
        { direction: 'SYSTEM'   as const, type: 'EVENT' as const, content: 'Atendimento encerrado por Super Admin', at: minutesAgo(14) },
      ],
    },
    {
      contactIdx:  2,
      status:      'WAITING' as const,
      unreadCount: 1,
      lastPreview: 'Oi, quero saber sobre os planos disponíveis.',
      lastMsgAt:   minutesAgo(40),
      queueName:   'Vendas',
      tags:        ['vendas'],
      notes:       null,
      messages: [
        { direction: 'INBOUND'  as const, type: 'TEXT'  as const, content: 'Oi, quero saber sobre os planos disponíveis.', at: minutesAgo(40) },
        { direction: 'SYSTEM'   as const, type: 'EVENT' as const, content: 'Aguardando atendente disponível na fila Vendas', at: minutesAgo(39) },
      ],
    },
    {
      contactIdx:  3,
      status:      'CLOSED'  as const,
      unreadCount: 0,
      lastPreview: 'Atendimento encerrado.',
      lastMsgAt:   hoursAgo(2),
      queueName:   null,
      tags:        ['financeiro', 'encerrado'],
      notes:       'Solicitou nota fiscal. Enviada por e-mail.',
      messages: [
        { direction: 'INBOUND'  as const, type: 'TEXT'  as const, content: 'Olá, preciso de uma nota fiscal da compra do mês passado.', at: hoursAgo(3) },
        { direction: 'OUTBOUND' as const, type: 'TEXT'  as const, content: 'Olá, Fernanda! Vou verificar e enviar por e-mail em instantes.', at: hoursAgo(3) },
        { direction: 'INBOUND'  as const, type: 'TEXT'  as const, content: 'Ótimo, obrigada!', at: hoursAgo(2).valueOf() + 10_000 },
        { direction: 'SYSTEM'   as const, type: 'EVENT' as const, content: 'Atendimento encerrado por Super Admin', at: hoursAgo(2) },
      ],
    },
    {
      contactIdx:  4,
      status:      'OPEN'    as const,
      unreadCount: 5,
      lastPreview: 'URGENTE: o sistema está fora do ar desde ontem!',
      lastMsgAt:   minutesAgo(8),
      queueName:   'Suporte Técnico',
      tags:        ['urgente', 'suporte'],
      notes:       'Cliente enterprise. Prioridade máxima.',
      messages: [
        { direction: 'INBOUND' as const, type: 'TEXT'  as const, content: 'Olá, o sistema está com lentidão desde ontem à tarde.', at: hoursAgo(20) },
        { direction: 'OUTBOUND' as const, type: 'TEXT' as const, content: 'Oi, João! Vou verificar os logs do servidor agora.', at: hoursAgo(19) },
        { direction: 'INBOUND' as const, type: 'TEXT'  as const, content: 'Agora piorou. Está completamente fora do ar!', at: minutesAgo(30) },
        { direction: 'INBOUND' as const, type: 'TEXT'  as const, content: 'Nossos clientes não conseguem enviar nem receber mensagens.', at: minutesAgo(20) },
        { direction: 'INBOUND' as const, type: 'TEXT'  as const, content: 'Preciso de uma previsão de retorno com URGÊNCIA.', at: minutesAgo(15) },
        { direction: 'INBOUND' as const, type: 'TEXT'  as const, content: 'URGENTE: o sistema está fora do ar desde ontem!', at: minutesAgo(8) },
      ],
    },
    {
      contactIdx:  5,
      status:      'BOT'     as const,
      unreadCount: 0,
      lastPreview: 'Olá! Sou o assistente virtual da Washoot. Como posso ajudar?',
      lastMsgAt:   hoursAgo(1),
      queueName:   'Atendimento Geral',
      tags:        ['bot', 'novo'],
      notes:       null,
      messages: [
        { direction: 'INBOUND'  as const, type: 'TEXT' as const, content: 'Boa tarde!', at: hoursAgo(2) },
        { direction: 'OUTBOUND' as const, type: 'TEXT' as const, content: 'Olá! Sou o assistente virtual da Washoot. Como posso ajudar?\n\nEscolha uma opção:\n*1* - Suporte\n*2* - Vendas\n*3* - Financeiro', at: hoursAgo(1) },
      ],
    },
  ];

  let convCount = 0;
  let msgCount  = 0;

  for (const convData of conversationsData) {
    const contact = contacts[convData.contactIdx];
    if (!contact) continue;

    // Evita duplicar conversas se já existirem no banco
    const existing = await prisma.chatConversation.findFirst({
      where: { tenantId: tenant.id, contactId: contact.id },
    });

    if (existing) {
      convCount++;
      continue;
    }

    const conv = await prisma.chatConversation.create({
      data: {
        tenantId:           tenant.id,
        sessionId:          existingSession?.id ?? null,
        contactId:          contact.id,
        channel:            'whatsapp',
        status:             convData.status,
        unreadCount:        convData.unreadCount,
        lastMessagePreview: convData.lastPreview,
        lastMessageAt:      convData.lastMsgAt,
        queueName:          convData.queueName,
        tags:               convData.tags,
        notes:              convData.notes,
      },
    });

    convCount++;

    for (const msg of convData.messages) {
      await prisma.chatMessage.create({
        data: {
          tenantId:       tenant.id,
          conversationId: conv.id,
          direction:      msg.direction,
          type:           msg.type,
          content:        msg.content,
          status:         msg.direction === 'INBOUND' ? 'READ' : 'DELIVERED',
          sentAt:         msg.at instanceof Date ? msg.at : new Date(msg.at),
          createdAt:      msg.at instanceof Date ? msg.at : new Date(msg.at),
        },
      });
      msgCount++;
    }
  }

  console.log(`✅  ${convCount} chat conversations seeded`);
  console.log(`✅  ${msgCount} chat messages seeded`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
