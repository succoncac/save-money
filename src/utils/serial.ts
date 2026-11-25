export function normalizeSerial(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isValidSerialFormat(normalized: string): boolean {
  if (!normalized) return false;
  return /^[A-Z0-9]{6,24}$/.test(normalized);
}

export interface SerialRecord {
  userId: string;
  serialNormalized: string | null;
}

export function findSerialOwnerConflict(
  candidateSerial: string | null | undefined,
  currentUserId: string,
  existingRecords: SerialRecord[],
): { hasConflict: boolean; normalized: string; ownerUserId: string | null } {
  const normalized = normalizeSerial(candidateSerial);
  if (!normalized) {
    return { hasConflict: false, normalized: '', ownerUserId: null };
  }
  const conflict = existingRecords.find(
    (rec) => rec.serialNormalized === normalized && rec.userId !== currentUserId,
  );
  if (conflict) {
    return {
      hasConflict: true,
      normalized,
      ownerUserId: conflict.userId,
    };
  }
  return { hasConflict: false, normalized, ownerUserId: null };
}
