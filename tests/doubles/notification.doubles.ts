// tests/doubles/notification.doubles.ts
//
// Dobles en memoria de los puertos de notification, para los tests de los casos de uso (sin jest.mock, sin Prisma,
// sin AWS ni Redis), y fábricas de entidades de ejemplo.
import type { PageRequest } from '../../src/shared/application/pagination';
import type {
  NotificationCategoryFilters,
  NotificationCategoryRepository,
  NotificationTypeFilters,
  NotificationTypeRepository
} from '../../src/modules/notification/application/ports/notification-catalog-repository.port';
import type {
  BroadcastProgress,
  GlobalNotificationRepository,
  PersonalNotificationRepository
} from '../../src/modules/notification/application/ports/inbox-repository.port';
import type { DeliveryFailure, DeliveryFilters, DeliveryRepository } from '../../src/modules/notification/application/ports/delivery-repository.port';
import type { NotificationPreferenceRepository } from '../../src/modules/notification/application/ports/preference-repository.port';
import type { PushDevice, PushTokenRepository } from '../../src/modules/notification/application/ports/push-token-repository.port';
import type { NewVerificationCode, VerificationCodeRepository } from '../../src/modules/notification/application/ports/verification-code-repository.port';
import type { EmailSuppressionRepository } from '../../src/modules/notification/application/ports/email-suppression-repository.port';
import type {
  BulkPushResult,
  EmailGateway,
  OutgoingEmail,
  OutgoingSms,
  ProviderErrorClassifier,
  PushGateway,
  PushMessage,
  SendRateLimiter,
  SmsGateway,
  SmsResult
} from '../../src/modules/notification/application/ports/channel-gateways.port';
import type { PhonePrefixes, Recipient, RecipientDirectory } from '../../src/modules/notification/application/ports/recipient-directory.port';
import type {
  BounceFeedVerifier,
  ContactCipher,
  TransactionProbe,
  UnreadCountChannel,
  UnreadCountEvent,
  VerificationCodeGenerator
} from '../../src/modules/notification/application/ports/runtime.port';
import type { ClaimedDelivery, DeliveryRecord } from '../../src/modules/notification/domain/delivery';
import type { BroadcastRecipient } from '../../src/modules/notification/domain/broadcast';
import type { EmailSuppression, HardBounceResult } from '../../src/modules/notification/domain/email-suppression';
import type {
  GlobalNotification,
  NewGlobalNotification,
  NewPersonalNotification,
  PersonalNotification
} from '../../src/modules/notification/domain/notification';
import type { NotificationPreference, PreferenceChanges } from '../../src/modules/notification/domain/notification-preference';
import type { CategoryChanges, Channel, NewCategory, NotificationCategory, NotificationType, TypeChanges } from '../../src/modules/notification/domain/notification-type';
import type { VerificationCode } from '../../src/modules/notification/domain/verification-code';

export const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const USER_ID = '6f1f0a7e-3b8a-4d63-9a59-2f0c2b9b1c11';
export const ADMIN_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const AT = new Date('2026-01-01T00:00:00Z');

// ── Fábricas ──────────────────────────────────────────────────

export const category = (over: Partial<NotificationCategory> = {}): NotificationCategory => ({
  notificationCategoryId: ID,
  code: 'SECURITY',
  name: 'Seguridad',
  description: null,
  supportsPush: true,
  supportsEmail: true,
  supportsSms: false,
  isCritical: false,
  emailLayoutTemplate: '<div>{{content}}<img src="{{logoUrl}}"></div>',
  isActive: true,
  createdAt: AT,
  updatedAt: AT,
  ...over
});

export const notificationType = (over: Partial<NotificationType> = {}): NotificationType => ({
  notificationTypeId: ID,
  code: 'OPERATION_APPROVED',
  name: 'Operación aprobada',
  description: null,
  notificationCategoryId: ID,
  titleTemplate: 'Hola {{nombre}}',
  bodyTemplate: 'Tu operación {{id}} fue aprobada',
  emailSubjectTemplate: 'Aprobada {{id}}',
  emailBodyTemplate: '<p>Hola {{nombre}}</p>',
  isActive: true,
  createdAt: AT,
  updatedAt: AT,
  category: category(),
  ...over
});

export const personalNotification = (over: Partial<PersonalNotification> = {}): PersonalNotification => ({
  notificationId: ID,
  userId: USER_ID,
  notificationTypeId: ID,
  title: 'Título',
  body: 'Cuerpo',
  relatedEntityType: null,
  relatedEntityId: null,
  metadata: {},
  isRead: false,
  readAt: null,
  createdAt: AT,
  updatedAt: AT,
  notificationType: notificationType(),
  ...over
});

export const globalNotification = (over: Partial<GlobalNotification> = {}): GlobalNotification => ({
  globalNotificationId: ID,
  notificationTypeId: ID,
  title: 'Aviso',
  body: 'Para todos',
  metadata: {},
  sendPush: true,
  sendEmail: true,
  status: 'processing',
  cursorUserId: null,
  lockedUntil: null,
  createdAt: AT,
  notificationType: notificationType(),
  ...over
});

export const preference = (over: Partial<NotificationPreference> = {}): NotificationPreference => ({
  userNotificationPreferenceId: ID,
  userId: USER_ID,
  allowPush: true,
  allowEmail: true,
  allowSms: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  originSessionId: null,
  createdAt: AT,
  updatedAt: AT,
  ...over
});

export const verificationCode = (over: Partial<VerificationCode> = {}): VerificationCode => ({
  verificationCodeId: ID,
  type: 'email',
  contactValue: 'ana@correo.co',
  code: '654321',
  attempts: 0,
  expiresAt: new Date(Date.now() + 60_000),
  verifiedAt: null,
  originSessionId: null,
  createdAt: AT,
  updatedAt: AT,
  ...over
});

export const deliveryRecord = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  notificationDeliveryId: ID,
  notificationId: ID,
  channel: 'email',
  status: 'failed',
  attempts: 6,
  nextAttemptAt: null,
  sentAt: null,
  lastError: 'Throttling',
  lastErrorCode: 'Throttling',
  createdAt: AT,
  updatedAt: AT,
  notification: {
    notificationId: ID,
    userId: USER_ID,
    title: 'Título',
    body: 'Cuerpo',
    metadata: { email: 'ana@correo.co' },
    relatedEntityType: null,
    relatedEntityId: null,
    createdAt: AT,
    notificationType: { code: 'OPERATION_APPROVED', name: 'Operación aprobada', category: { code: 'SECURITY', name: 'Seguridad', isCritical: false } }
  },
  ...over
});

const paginate = <T>(items: T[], page: PageRequest) => ({ rows: items.slice(page.offset, page.offset + page.limit), count: items.length });

// ── Persistencia ──────────────────────────────────────────────

export class InMemoryNotificationTypes implements NotificationTypeRepository {
  constructor(public types: NotificationType[] = [notificationType()]) {}

  async findActiveByCode(code: string) {
    return this.types.find(t => t.code === code && t.isActive) ?? null;
  }
  async findById(id: string) {
    return this.types.find(t => t.notificationTypeId === id) ?? null;
  }
  async countByCategory(categoryId: string) {
    return this.types.filter(t => t.notificationCategoryId === categoryId).length;
  }
  async list(_filters: NotificationTypeFilters, page: PageRequest) {
    return paginate(this.types, page);
  }
  async update(id: string, changes: TypeChanges) {
    const type = await this.findById(id);
    if (!type) {
      return null;
    }
    Object.assign(type, changes);
    return type;
  }
}

export class InMemoryCategories implements NotificationCategoryRepository {
  constructor(public categories: NotificationCategory[] = [category()]) {}
  private seq = 0;

  async findById(id: string) {
    return this.categories.find(c => c.notificationCategoryId === id) ?? null;
  }
  async codeExists(code: string) {
    return this.categories.some(c => c.code === code);
  }
  async list(_filters: NotificationCategoryFilters, page: PageRequest) {
    return paginate(this.categories, page);
  }
  async create(data: NewCategory) {
    const created = category({ ...data, notificationCategoryId: `cat-${++this.seq}` });
    this.categories.push(created);
    return created;
  }
  async update(id: string, changes: CategoryChanges) {
    const found = await this.findById(id);
    if (!found) {
      return null;
    }
    Object.assign(found, changes);
    return found;
  }
  async delete(id: string) {
    this.categories = this.categories.filter(c => c.notificationCategoryId !== id);
  }
}

export class InMemoryPersonalNotifications implements PersonalNotificationRepository {
  constructor(public notifications: PersonalNotification[] = []) {}
  private seq = 0;

  async create(data: NewPersonalNotification) {
    const created = personalNotification({ ...data, notificationId: `n-${++this.seq}`, notificationType: null, createdAt: new Date() });
    this.notifications.push(created);
    return { ...created };
  }
  async findWithType(id: string) {
    return this.notifications.find(n => n.notificationId === id) ?? null;
  }
  async listByUser(userId: string, page: PageRequest, search: string | null) {
    const own = this.notifications.filter(n => n.userId === userId && (!search || `${n.title} ${n.body}`.toLowerCase().includes(search.toLowerCase())));
    // Copias, como las filas de una consulta: marcar leídas después no las cambia
    return paginate(own.map(n => ({ ...n })), page);
  }
  async listAllByUser(userId: string) {
    return this.notifications
      .filter(n => n.userId === userId)
      .map(n => ({ ...n }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async countUnreadByUser(userId: string) {
    return this.notifications.filter(n => n.userId === userId && n.isRead === false).length;
  }
  async markAsRead(ids: readonly string[]) {
    const unread = this.notifications.filter(n => ids.includes(n.notificationId) && n.isRead === false);
    unread.forEach(n => Object.assign(n, { isRead: true, readAt: new Date() }));
    return unread.length;
  }
  async deleteReadOlderThan() {
    const before = this.notifications.length;
    this.notifications = this.notifications.filter(n => !n.isRead);
    return before - this.notifications.length;
  }
}

export class InMemoryGlobalNotifications implements GlobalNotificationRepository {
  constructor(public notifications: GlobalNotification[] = []) {}
  readonly reads = new Map<string, Set<string>>();
  readonly created: NewGlobalNotification[] = [];
  readonly progress: Array<{ id: string } & BroadcastProgress> = [];
  readonly finished: Array<{ id: string; status: string }> = [];
  claimable: GlobalNotification[] = [];
  private seq = 0;

  async create(data: NewGlobalNotification) {
    this.created.push(data);
    const created = globalNotification({
      ...data,
      globalNotificationId: `g-${++this.seq}`,
      status: data.reservedUntil ? 'processing' : 'pending',
      lockedUntil: data.reservedUntil ?? null,
      notificationType: null
    });
    this.notifications.push(created);
    return created;
  }
  async listAll() {
    return [...this.notifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async readIdsOf(userId: string) {
    return [...(this.reads.get(userId) ?? [])];
  }
  async countUnreadByUser(userId: string) {
    const read = this.reads.get(userId) ?? new Set();
    return this.notifications.filter(g => !read.has(g.globalNotificationId)).length;
  }
  async markAsRead(ids: readonly string[], userId: string) {
    const read = this.reads.get(userId) ?? new Set<string>();
    const fresh = ids.filter(id => !read.has(id));
    fresh.forEach(id => read.add(id));
    this.reads.set(userId, read);
    return fresh.length;
  }
  async claimDue() {
    const claimed = this.claimable;
    this.claimable = [];
    return claimed;
  }
  async recordProgress(id: string, progress: BroadcastProgress) {
    this.progress.push({ id, ...progress });
  }
  async finish(id: string, status: 'completed' | 'failed') {
    this.finished.push({ id, status });
  }
}

export class InMemoryDeliveries implements DeliveryRepository {
  readonly created: Array<{ notificationId: string; channels: readonly Channel[]; firstAttemptAt: Date }> = [];
  readonly outcomes: Array<{ id: string; result: 'sent' | 'skipped' | 'failure'; detail?: string | DeliveryFailure }> = [];
  /** Lo que devuelve cada toma del despachador, en orden. */
  batches: ClaimedDelivery[][] = [];
  records: DeliveryRecord[] = [];
  lastFilters: DeliveryFilters | null = null;
  private seq = 0;

  async createFor(notificationId: string, channels: readonly Channel[], firstAttemptAt: Date) {
    this.created.push({ notificationId, channels, firstAttemptAt });
    return channels.map(channel => ({ notificationDeliveryId: `d-${++this.seq}`, notificationId, channel, attempts: 0 }));
  }
  async claimDue() {
    return this.batches.shift() ?? [];
  }
  async markSent(id: string) {
    this.outcomes.push({ id, result: 'sent' });
  }
  async markSkipped(id: string, reason: string) {
    this.outcomes.push({ id, result: 'skipped', detail: reason });
  }
  async recordFailure(id: string, failure: DeliveryFailure) {
    this.outcomes.push({ id, result: 'failure', detail: failure });
  }
  async findRecord(id: string) {
    return this.records.find(r => r.notificationDeliveryId === id) ?? null;
  }
  async list(filters: DeliveryFilters, page: PageRequest) {
    this.lastFilters = filters;
    return paginate(this.records, page);
  }
}

export class InMemoryPreferences implements NotificationPreferenceRepository {
  constructor(public preferences: NotificationPreference[] = []) {}
  readonly upserts: Array<{ userId: string; changes: PreferenceChanges }> = [];

  async findByUser(userId: string) {
    return this.preferences.find(p => p.userId === userId) ?? null;
  }
  async findByUsers(userIds: readonly string[]) {
    return new Map(this.preferences.filter(p => userIds.includes(p.userId)).map(p => [p.userId, p]));
  }
  async findByIds(ids: readonly string[]) {
    return this.preferences.filter(p => ids.includes(p.userNotificationPreferenceId));
  }
  async upsert(userId: string, changes: PreferenceChanges) {
    this.upserts.push({ userId, changes });
    const existing = await this.findByUser(userId);
    if (existing) {
      return Object.assign(existing, changes);
    }
    const created = preference({ userId, ...changes });
    this.preferences.push(created);
    return created;
  }
}

export class InMemoryPushTokens implements PushTokenRepository {
  constructor(public devices: Array<PushDevice & { isActive: boolean }> = []) {}
  failDeactivate = false;

  async findActiveByUser(userId: string) {
    return this.devices.filter(d => d.userId === userId && d.isActive);
  }
  async findActiveByUsers(userIds: readonly string[]) {
    return this.devices.filter(d => userIds.includes(d.userId) && d.isActive);
  }
  async deactivate(tokens: readonly string[]) {
    if (this.failDeactivate) {
      throw new Error('db down');
    }
    const hit = this.devices.filter(d => tokens.includes(d.token) && d.isActive);
    hit.forEach(d => (d.isActive = false));
    return hit.length;
  }
  async upsertToken(userId: string, token: string) {
    this.devices.push({ userId, token, isActive: true });
    return null;
  }
  async deleteInactiveOlderThan() {
    const before = this.devices.length;
    this.devices = this.devices.filter(d => d.isActive);
    return before - this.devices.length;
  }
}

export class InMemoryVerificationCodes implements VerificationCodeRepository {
  constructor(public codes: VerificationCode[] = []) {}
  waitSeconds = 0;
  private seq = 0;

  async findActiveByContact(type: string, contactValue: string) {
    return [...this.codes].reverse().find(c => c.type === type && c.contactValue === contactValue && !c.verifiedAt) ?? null;
  }
  async secondsUntilNewCode() {
    return this.waitSeconds;
  }
  async create(data: NewVerificationCode) {
    const created = verificationCode({ ...data, verificationCodeId: `vc-${++this.seq}`, attempts: 0 });
    this.codes.push(created);
    return created;
  }
  async incrementAttempts(id: string) {
    const code = this.codes.find(c => c.verificationCodeId === id);
    if (!code) {
      return 0;
    }
    code.attempts = (code.attempts ?? 0) + 1;
    return 1;
  }
  async findVerifiedByContact(type: string, contactValue: string) {
    return this.codes.find(c => c.type === type && c.contactValue === contactValue && c.verifiedAt) ?? null;
  }
  async deleteVerifiedByContact(type: string, contactValue: string) {
    const before = this.codes.length;
    this.codes = this.codes.filter(c => !(c.type === type && c.contactValue === contactValue && c.verifiedAt));
    return before - this.codes.length;
  }
  async markAsVerified(id: string) {
    const code = this.codes.find(c => c.verificationCodeId === id) ?? null;
    if (code) {
      code.verifiedAt = new Date();
    }
    return code;
  }
  async deleteExpired() {
    return 2;
  }
  async deleteOldVerified() {
    return 1;
  }
}

export class InMemorySuppressions implements EmailSuppressionRepository {
  readonly counts = new Map<string, number>();
  readonly suppressed = new Set<string>();

  async isSuppressed(emailHash: string) {
    return this.suppressed.has(emailHash);
  }
  async registerHardBounce(emailHash: string, { threshold }: { threshold: number }): Promise<HardBounceResult> {
    const alreadySuppressed = this.suppressed.has(emailHash);
    const bounceCount = (this.counts.get(emailHash) ?? 0) + 1;
    this.counts.set(emailHash, bounceCount);
    const reached = bounceCount >= threshold;
    if (reached) {
      this.suppressed.add(emailHash);
    }
    return { bounceCount, suppressed: reached, alreadySuppressed };
  }
  async lift(): Promise<EmailSuppression | null> {
    return null;
  }
}

// ── Proveedores y entorno ─────────────────────────────────────

/** Error de proveedor con su código (como los del SDK de AWS: el código va en `name`). */
export const providerError = (code: string, message = code) => Object.assign(new Error(message), { name: code });

export class FakeEmailGateway implements EmailGateway {
  readonly sent: OutgoingEmail[] = [];
  failWith: Error | null = null;
  async send(email: OutgoingEmail) {
    if (this.failWith) {
      throw this.failWith;
    }
    this.sent.push(email);
    return { messageId: `m-${this.sent.length}` };
  }
}

export class FakePushGateway implements PushGateway {
  readonly sent: Array<{ endpoint: string; message: PushMessage; notificationId?: string | null }> = [];
  /** endpoint → error con que falla. */
  readonly failures = new Map<string, Error>();
  readonly bulk: Array<{ endpoints: readonly string[]; message: PushMessage }> = [];
  bulkResult: Partial<BulkPushResult> = {};

  async sendToDevice(endpoint: string, message: PushMessage, notificationId?: string | null) {
    const failure = this.failures.get(endpoint);
    if (failure) {
      throw failure;
    }
    this.sent.push({ endpoint, message, notificationId });
  }
  async registerDevice(deviceToken: string) {
    return `arn:endpoint:${deviceToken}`;
  }
  async sendToMany(endpoints: readonly string[], message: PushMessage) {
    this.bulk.push({ endpoints, message });
    return { success: endpoints.length, failed: 0, disabledEndpoints: [], ...this.bulkResult };
  }
}

export class FakeSmsGateway implements SmsGateway {
  readonly sent: OutgoingSms[] = [];
  result: Partial<SmsResult> = {};
  async send(sms: OutgoingSms) {
    this.sent.push(sms);
    return { success: true, attemptId: `sms-${this.sent.length}`, ...this.result };
  }
}

/** Como el de AWS: el código es el `name`; MessageRejected y EndpointDisabled son definitivos. */
export const fakeClassifier: ProviderErrorClassifier = {
  codeOf: error => {
    const name = (error as { name?: string } | null)?.name;
    return !name || name === 'Error' ? null : name;
  },
  isHardBounce: (channel, code) => (channel === 'email' && code === 'MessageRejected') || (channel === 'push' && code === 'EndpointDisabled'),
  isEndpointDisabled: code => code === 'EndpointDisabled'
};

export class FakeUnreadChannel implements UnreadCountChannel {
  readonly published: UnreadCountEvent[] = [];
  private listeners: Array<(event: UnreadCountEvent) => void> = [];
  publish(event: UnreadCountEvent) {
    this.published.push(event);
    this.listeners.forEach(l => l(event));
  }
  subscribe(listener: (event: UnreadCountEvent | null | undefined) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  listenerCount() {
    return this.listeners.length;
  }
  transport() {
    return 'local' as const;
  }
}

/** "Cifrado" de prueba: enc:<valor>. El hash es h(<valor>). */
export const fakeCipher: ContactCipher = {
  reveal: value => (value.startsWith('enc:') ? value.slice(4) : value),
  hash: value => `h(${value})`
};

export class FakeRecipients implements RecipientDirectory {
  constructor(
    public recipients: Recipient[] = [],
    public clients: BroadcastRecipient[] = []
  ) {}
  readonly pages: Array<{ after: string | null; limit: number }> = [];

  async findRecipient(userId: string) {
    return this.recipients.find(r => r.userId === userId) ?? null;
  }
  async activeClientsAfter(after: string | null, limit: number) {
    this.pages.push({ after, limit });
    const start = after ? this.clients.findIndex(c => c.userId === after) + 1 : 0;
    return this.clients.slice(start, start + limit);
  }
}

export const recipient = (over: Partial<Recipient> = {}): Recipient => ({
  userId: USER_ID,
  isActive: true,
  email: 'ana@correo.co',
  phone: { number: '912345678', prefixId: 'pref-cl' },
  ...over
});

export const fakePrefixes: PhonePrefixes = { prefixOf: async id => (id === 'pref-cl' ? '+56' : null) };

export class FakeTransaction implements TransactionProbe {
  active = false;
  inTransaction() {
    return this.active;
  }
}

export class RecordingRateLimiter implements SendRateLimiter {
  readonly taken: Array<{ provider: string; amount: number }> = [];
  async acquire(provider: 'push' | 'email', amount: number) {
    this.taken.push({ provider, amount });
  }
}

export const fixedCodes = (code = '654321'): VerificationCodeGenerator => ({ next: () => code });

export class FakeFeedVerifier implements BounceFeedVerifier {
  valid = true;
  confirmed = 0;
  async verify() {
    return this.valid;
  }
  async confirmSubscription() {
    this.confirmed++;
  }
}

/** Deja correr lo que se lanzó con setImmediate (envíos y refrescos en segundo plano). */
export const flushBackground = () =>
  new Promise<void>(resolve => {
    setImmediate(() => setImmediate(resolve));
  });
