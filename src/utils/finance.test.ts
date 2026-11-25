import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVnd, parseVndInput, resolveDenominationForAmount } from './currency';
import { normalizeSerial, isValidSerialFormat, findSerialOwnerConflict } from './serial';
import { computeCashflowSummary } from './cashflow';
import { signSessionToken, verifySessionToken } from '../../server/auth';
import { extractJsonObject } from '../../server/ai';
import {
  formatReadablePlainText,
  parseChatBlocks,
  parseInlineSegments,
} from './chatMarkdown';
import {
  isValidSafeHttpUrl,
  parseStoredNoticeLinks,
  sanitizeNoticeLinks,
} from './notice';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateBase32Secret,
  generateTotpCode,
  verifyTotpCode,
} from '../../server/totp';
import { AuthRateLimiter } from '../../server/rateLimit';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from '../../server/cryptoVault';
import {
  canInspectUserCredentials,
  checkAdminSelfAction,
  requiresOldPasswordForAdminReset,
} from '../../server/adminPolicy';
import type { WalletTransaction } from '../types';

test('formatVnd formats integer VNĐ amounts with dot separators and ₫', () => {
  assert.equal(formatVnd(0), '0 ₫');
  assert.equal(formatVnd(1250000), '1.250.000 ₫');
  assert.equal(formatVnd(-500000), '-500.000 ₫');
  assert.equal(formatVnd(50000.89), '50.000 ₫');
});

test('parseVndInput parses formatted strings and rejects invalid numbers', () => {
  assert.equal(parseVndInput('1.250.000 ₫'), 1250000);
  assert.equal(parseVndInput('0'), null);
  assert.equal(parseVndInput('abc'), null);
  assert.equal(parseVndInput(200000), 200000);
});

test('normalizeSerial & findSerialOwnerConflict detect cross-user serial duplicates', () => {
  assert.equal(normalizeSerial(' ab-1234 5678 '), 'AB12345678');
  assert.equal(isValidSerialFormat('AB12345678'), true);
  assert.equal(isValidSerialFormat('123'), false);

  const existing = [{ userId: 'u1', serialNormalized: 'AB12345678' }];
  const sameUser = findSerialOwnerConflict('ab 1234-5678', 'u1', existing);
  assert.equal(sameUser.hasConflict, false);

  const otherUser = findSerialOwnerConflict('ab 1234-5678', 'u2', existing);
  assert.equal(otherUser.hasConflict, true);
  assert.equal(otherUser.ownerUserId, 'u1');
  assert.equal(otherUser.normalized, 'AB12345678');
});

test('computeCashflowSummary calculates net balance, today/month deposits, and positive bar heights on withdrawal days', () => {
  const now = new Date('2026-11-24T12:00:00.000Z');
  const txs: WalletTransaction[] = [
    {
      id: '1',
      userId: 'u1',
      type: 'deposit',
      amount: 500000,
      denomination: 500000,
      serialNumber: 'AA11111111',
      serialNormalized: 'AA11111111',
      method: 'ai_scan',
      note: '',
      aiConfidence: 0.96,
      createdAt: '2026-11-20T08:00:00.000Z',
      updatedAt: '2026-11-20T08:00:00.000Z',
    },
    {
      id: '2',
      userId: 'u1',
      type: 'withdraw',
      amount: 200000,
      denomination: 200000,
      serialNumber: null,
      serialNormalized: null,
      method: 'manual',
      note: 'Chi tiêu',
      aiConfidence: null,
      createdAt: '2026-11-22T09:00:00.000Z',
      updatedAt: '2026-11-22T09:00:00.000Z',
    },
    {
      id: '3',
      userId: 'u1',
      type: 'deposit',
      amount: 100000,
      denomination: 100000,
      serialNumber: 'BB22222222',
      serialNormalized: 'BB22222222',
      method: 'manual',
      note: '',
      aiConfidence: null,
      createdAt: '2026-11-24T10:00:00.000Z',
      updatedAt: '2026-11-24T10:00:00.000Z',
    },
  ];

  const summary = computeCashflowSummary(txs, now, 7, 3);
  assert.equal(summary.netBalance, 400000);
  assert.equal(summary.totalDeposits, 600000);
  assert.equal(summary.totalWithdrawals, 200000);
  assert.equal(summary.todayDeposits, 100000);
  assert.equal(summary.monthDeposits, 600000);

  for (const point of summary.dailySeries) {
    assert.ok(point.barAmount >= 0, 'barAmount must never be negative');
  }
  const lastDay = summary.dailySeries[summary.dailySeries.length - 1];
  assert.equal(lastDay.cumulativeBalance, 400000);
  assert.equal(summary.denominationBreakdown.length, 3);
});

test('TOTP RFC 6238 secret generation, Base32 round-trip, and ±30s verification work accurately', () => {
  // RFC 6238 test vector secret ("12345678901234567890" -> GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  assert.equal(rfcSecret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(rfcSecret).toString('ascii'), '12345678901234567890');

  // Known RFC 4226/6238 SHA1 value at t = 59s -> 287082 (last 6 digits of 94287082)
  assert.equal(generateTotpCode(rfcSecret, 59_000), '287082');

  const secret = generateBase32Secret(20);
  assert.equal(secret.length, 32);

  const t0 = 1_700_000_000_000;
  const codeNow = generateTotpCode(secret, t0);
  const codePrev = generateTotpCode(secret, t0 - 30_000);
  const codeOld = generateTotpCode(secret, t0 - 120_000);

  assert.equal(verifyTotpCode(secret, codeNow, t0), true);
  assert.equal(verifyTotpCode(secret, codePrev, t0), true);
  assert.equal(verifyTotpCode(secret, codeOld, t0), false);
  assert.equal(verifyTotpCode(secret, 'abcdef', t0), false);

  const uri = buildOtpAuthUri({
    issuer: 'Ví Tiết Kiệm Cá Nhân',
    accountName: 'admin',
    secret,
  });
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes(`secret=${secret}`));
});

test('notice helpers sanitize social links and block unsafe protocols', () => {
  assert.equal(isValidSafeHttpUrl('https://facebook.com/page'), true);
  assert.equal(isValidSafeHttpUrl('http://t.me/channel'), true);
  assert.equal(isValidSafeHttpUrl('javascript:alert(1)'), false);

  const sanitized = sanitizeNoticeLinks([
    { id: '1', platform: 'facebook', label: 'Facebook Admin', url: 'https://fb.com/admin' },
    { id: '2', platform: 'telegram', label: 'Bad', url: 'javascript:alert(1)' },
    { id: '3', platform: 'zalo', label: '', url: 'https://zalo.me/123' },
  ]);
  assert.equal(sanitized.length, 2);
  assert.equal(sanitized[0].platform, 'facebook');
  assert.equal(sanitized[1].label, 'Nhóm Zalo hỗ trợ');

  const migrated = parseStoredNoticeLinks('[]', 'https://discord.gg/abc', 'Discord Admin');
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].platform, 'discord');
  assert.equal(migrated[0].label, 'Discord Admin');
});

test('AuthRateLimiter blocks after threshold, clears on success, and resets after window', () => {
  const limiter = new AuthRateLimiter(3, 60_000);
  const key = 'login:127.0.0.1:admin';
  const t0 = 1_700_000_000_000;

  assert.deepEqual(limiter.check(key, t0), { allowed: true, retryAfterSeconds: 0 });
  limiter.recordFailure(key, t0);
  limiter.recordFailure(key, t0 + 1_000);
  assert.equal(limiter.check(key, t0 + 2_000).allowed, true);

  limiter.recordFailure(key, t0 + 2_000);
  const blocked = limiter.check(key, t0 + 5_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 55);

  // Sliding window expiry frees old attempts
  assert.equal(limiter.check(key, t0 + 61_000).allowed, true);

  // Clear resets immediately
  limiter.recordFailure(key, t0);
  limiter.recordFailure(key, t0);
  limiter.recordFailure(key, t0);
  assert.equal(limiter.check(key, t0 + 100).allowed, false);
  limiter.clear(key);
  assert.equal(limiter.check(key, t0 + 100).allowed, true);
});

test('cryptoVault encrypts/decrypts secrets with AES-256-GCM and preserves legacy fallback', () => {
  const c1 = encryptSecret('MatKhau@123');
  const c2 = encryptSecret('MatKhau@123');
  assert.equal(isEncryptedSecret(c1), true);
  assert.notEqual(c1, c2); // Random IV per encryption
  assert.equal(decryptSecret(c1), 'MatKhau@123');

  // Tampered auth tag or ciphertext returns null
  const tampered = c1.slice(0, -2) + (c1.endsWith('AA') ? 'BB' : 'AA');
  assert.equal(decryptSecret(tampered), null);

  // Legacy plaintext Base32 secret still decodes cleanly
  assert.equal(isEncryptedSecret('GEZDGNBVGY3TQOJQ'), false);
  assert.equal(decryptSecret('GEZDGNBVGY3TQOJQ'), 'GEZDGNBVGY3TQOJQ');
});

test('adminPolicy prevents self-destruction, requires old password for self reset, and enforces inspection ACL', () => {
  assert.equal(
    checkAdminSelfAction({ actorId: 'a1', targetId: 'a1', action: 'delete' }).allowed,
    false,
  );
  assert.equal(
    checkAdminSelfAction({ actorId: 'a1', targetId: 'a1', action: 'lock' }).allowed,
    false,
  );
  assert.equal(
    checkAdminSelfAction({ actorId: 'a1', targetId: 'a1', action: 'demote' }).allowed,
    false,
  );
  assert.equal(
    checkAdminSelfAction({ actorId: 'a1', targetId: 'u2', action: 'demote' }).allowed,
    true,
  );

  assert.equal(requiresOldPasswordForAdminReset('a1', 'a1'), true);
  assert.equal(requiresOldPasswordForAdminReset('a1', 'u2'), false);

  // Secondary admin cannot inspect root admin or another admin
  assert.equal(
    canInspectUserCredentials(
      { id: 'sec1', isRootAdmin: false },
      { id: 'root', role: 'admin', isRootAdmin: true },
    ).allowed,
    false,
  );
  assert.equal(
    canInspectUserCredentials(
      { id: 'sec1', isRootAdmin: false },
      { id: 'sec2', role: 'admin', isRootAdmin: false },
    ).allowed,
    false,
  );
  // Secondary admin can inspect regular user
  assert.equal(
    canInspectUserCredentials(
      { id: 'sec1', isRootAdmin: false },
      { id: 'u1', role: 'user', isRootAdmin: false },
    ).allowed,
    true,
  );
  // Root admin can inspect everyone
  assert.equal(
    canInspectUserCredentials(
      { id: 'root', isRootAdmin: true },
      { id: 'sec1', role: 'admin', isRootAdmin: false },
    ).allowed,
    true,
  );
});

test('resolveDenominationForAmount syncs denomination on valid VND bill values only', () => {
  assert.equal(resolveDenominationForAmount(500000), 500000);
  assert.equal(resolveDenominationForAmount(10000), 10000);
  assert.equal(resolveDenominationForAmount(150000), null);
  assert.equal(resolveDenominationForAmount(0), null);
  assert.equal(resolveDenominationForAmount(-50000), null);
});

test('signSessionToken and verifySessionToken preserve session_version and reject tampering', () => {
  const token = signSessionToken('user-123', 4);
  const verified = verifySessionToken(token);
  assert.ok(verified);
  assert.equal(verified.uid, 'user-123');
  assert.equal(verified.sv, 4);

  const tampered = token.slice(0, -3) + (token.endsWith('AAA') ? 'BBB' : 'AAA');
  assert.equal(verifySessionToken(tampered), null);
  assert.equal(verifySessionToken(undefined), null);
});

test('extractJsonObject parses fenced/embedded JSON and throws clean Vietnamese error on invalid output', () => {
  const fromFence = extractJsonObject('```json\n{"denomination": 100000, "confidence": 0.9}\n```');
  assert.equal(fromFence.denomination, 100000);

  const fromEmbedded = extractJsonObject('Kết quả nhận diện: {"denomination": 50000, "serialNumber": "AB 123456"} hết.');
  assert.equal(fromEmbedded.serialNumber, 'AB 123456');

  assert.throws(
    () => extractJsonObject('Không thể đọc ảnh này'),
    /không đúng định dạng JSON/i,
  );
});

test('chatMarkdown strips raw * and # markers and parses Markdown tables cleanly', () => {
  const sample = [
    '### Đánh giá ví hiện tại',
    '',
    'Chào bạn, bạn đang giữ **1.500.000 ₫** rất tốt! *Gợi ý nhỏ* cho tuần này #tietkiem:',
    '',
    '| Hạng mục | Số tiền | Tỷ lệ |',
    '| :--- | ---: | :---: |',
    '| Quỹ dự phòng | 1.000.000 ₫ | 67% |',
    '| Tiết kiệm **linh hoạt** | 500.000 ₫ | 33% |',
    '',
    '* Duy trì mức nạp đều mỗi tuần',
    '* Hạn chế rút tiền mặt không cần thiết',
  ].join('\n');

  const blocks = parseChatBlocks(sample);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(blocks[2].type, 'table');
  assert.equal(blocks[3].type, 'ul');

  if (blocks[2].type === 'table') {
    assert.deepEqual(blocks[2].headers, ['Hạng mục', 'Số tiền', 'Tỷ lệ']);
    assert.deepEqual(blocks[2].alignments, ['left', 'right', 'center']);
    assert.equal(blocks[2].rows.length, 2);
  }

  const inline = parseInlineSegments('Số dư **500.000 ₫** *ổn định* #abc *dư');
  assert.equal(inline.some((s) => s.type === 'bold' && s.text === '500.000 ₫'), true);
  assert.equal(inline.some((s) => s.text.includes('*') || s.text.includes('#')), false);

  const plain = formatReadablePlainText(sample);
  assert.equal(plain.includes('*'), false);
  assert.equal(plain.includes('#'), false);
  assert.ok(plain.includes('Quỹ dự phòng | 1.000.000 ₫ | 67%'));
});




