export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationPayload = Record<string, unknown>;

export type NotificationRow = {
  notificationId: string;
  templateCode: string;
  title: string;
  message: string;
  payload: NotificationPayload;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
};

export type NotificationDeliveryRow = {
  deliveryId: string;
  notificationId: string;
  templateCode: string;
  recipientEmail: string | null;
  recipientName: string;
  channel: NotificationChannel;
  status: string;
  attemptedAt: string;
  errorMessage: string | null;
  externalMessageId: string | null;
};

export type ClaimedNotification = {
  notificationId: string;
  templateCode: string;
  recipientUserId: string;
  recipientEmail: string | null;
  channel: NotificationChannel;
  payload: NotificationPayload;
};

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return undefined;
}

function nullableString(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : String(input);
}

function objectValue(input: unknown): NotificationPayload {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as NotificationPayload
    : {};
}

export function normalizeNotificationRow(row: Record<string, unknown>): NotificationRow {
  const readAt = nullableString(value(row, ['read_at', '읽은시각']));
  return {
    notificationId: String(value(row, ['notification_id', '알림ID']) ?? ''),
    templateCode: String(value(row, ['template_code', '템플릿코드']) ?? ''),
    title: String(value(row, ['title', '제목']) ?? '알림'),
    message: String(value(row, ['message', '내용']) ?? ''),
    payload: objectValue(value(row, ['payload', '상세내용'])),
    createdAt: String(value(row, ['created_at', '생성시각']) ?? ''),
    readAt,
    isRead: readAt !== null,
  };
}

export function normalizeDeliveryRow(row: Record<string, unknown>): NotificationDeliveryRow {
  const channelValue = value(row, ['channel', '채널']);
  return {
    deliveryId: String(value(row, ['delivery_id', '발송ID']) ?? ''),
    notificationId: String(value(row, ['notification_id', '알림ID']) ?? ''),
    templateCode: String(value(row, ['template_code', '템플릿코드']) ?? ''),
    recipientEmail: nullableString(value(row, ['recipient_email', '수신이메일'])),
    recipientName: String(value(row, ['recipient_name', '수신자명']) ?? ''),
    channel: channelValue === 'EMAIL' ? 'EMAIL' : 'IN_APP',
    status: String(value(row, ['status', '상태']) ?? ''),
    attemptedAt: String(value(row, ['attempted_at', '시도시각']) ?? ''),
    errorMessage: nullableString(value(row, ['error_message', '오류'])),
    externalMessageId: nullableString(value(row, ['external_message_id', '외부메시지ID'])),
  };
}

export function normalizeClaimedNotification(row: Record<string, unknown>): ClaimedNotification {
  const channelValue = row.channel;
  return {
    notificationId: String(row.notification_id ?? ''),
    templateCode: String(row.template_code ?? ''),
    recipientUserId: String(row.recipient_user_id ?? ''),
    recipientEmail: nullableString(row.recipient_email),
    channel: channelValue === 'EMAIL' ? 'EMAIL' : 'IN_APP',
    payload: objectValue(row.payload),
  };
}
