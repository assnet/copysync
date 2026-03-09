export enum ChatMessageDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  SYSTEM = 'SYSTEM',
}

export enum ChatMessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  AUDIO = 'AUDIO',
  DOCUMENT = 'DOCUMENT',
  EVENT = 'EVENT',
  STICKER = 'STICKER',
}

export enum ChatMessageStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
}
