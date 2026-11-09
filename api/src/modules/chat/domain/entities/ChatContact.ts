export interface ChatContactProps {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  /** LID do WhatsApp (dígitos), quando já visto em 1:1. Não é chave: a única continua tenant+telefone. */
  lid?: string | null;
  avatarUrl: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ChatContact {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly phone: string;
  readonly lid: string | null;
  readonly avatarUrl: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: ChatContactProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.name = props.name;
    this.phone = props.phone;
    this.lid = props.lid ?? null;
    this.avatarUrl = props.avatarUrl;
    this.notes = props.notes;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /** Retorna iniciais do nome (até 2 caracteres) */
  get initials(): string {
    const parts = this.name.trim().split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
}
