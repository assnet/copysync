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
  VIDEO = 'VIDEO',
  STICKER = 'STICKER',
  LOCATION = 'LOCATION',
  VCARD = 'VCARD',
  CALL_LOG = 'CALL_LOG',
  EVENT = 'EVENT',
}

export enum ChatMessageStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
}
