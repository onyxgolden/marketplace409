import { describe, expect, it } from 'vitest';
import {
  FIELD_VERIFICATION_TRANSITIONS,
  canFieldVerificationTransition,
  computeHoursDifference,
  computeLineVariances,
  computeSourceStatus,
  isFieldVerificationTerminalPackageStatus,
  isValidDecimal,
  mapFieldVerificationRpcError,
  validateFieldVerificationCreate,
  validateFieldVerificationDecision,
  validateFieldVerificationLink,
  validateFieldVerificationRetire,
  validateFieldVerificationUpdate,
} from './fieldVerifications.js';

const baseStepCreate = {
  targetType: 'WORK_STEP',
  stepId: 'forge_step_1',
  workLocation: 'FIELD',
  inspectionDate: '2026-11-20',
  sourceCheckedAt: '2026-11-20T15:00:00.000Z',
  physicalCompletion: 'PARTIALLY_COMPLETE',
  observationNote: 'Spool welded and aligned against IFC revision R2.',
  evidenceRef: 'field-photo-2026-11-20-01.jpg',
  sourceFingerprint: 'a'.repeat(32),
};

const baseLineCreate = {
  targetType: 'TAKEOFF_LINE',
  takeoffLineId: 'forge_line_1',
  workLocation: 'SHOP',
  inspectionDate: '2026-11-20',
  sourceCheckedAt: '2026-11-20T15:00:00.000Z',
  observedInstalledQuantity: 8,
  observationNote: 'Eight of twelve 3-in elbows installed; four remain on the rack.',
  sourceFingerprint: 'b'.repeat(32),
};

describe('field verification state machine', () => {
  it('allows DRAFT -> SUBMITTED -> ACCEPTED and RETURNED -> SUBMITTED', () => {
    expect(canFieldVerificationTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canFieldVerificationTransition('SUBMITTED', 'ACCEPTED')).toBe(true);
    expect(canFieldVerificationTransition('RETURNED', 'SUBMITTED')).toBe(true);
    expect(canFieldVerificationTransition('SUBMITTED', 'RETURNED')).toBe(true);
    expect(canFieldVerificationTransition('SUBMITTED', 'REJECTED')).toBe(true);
  });

  it('forbids skipping review: DRAFT cannot be ACCEPTED and ACCEPTED cannot be resubmitted', () => {
    expect(canFieldVerificationTransition('DRAFT', 'ACCEPTED')).toBe(false);
    expect(canFieldVerificationTransition('ACCEPTED', 'SUBMITTED')).toBe(false);
    expect(canFieldVerificationTransition('REJECTED', 'SUBMITTED')).toBe(false);
    expect(canFieldVerificationTransition('RETIRED', 'SUBMITTED')).toBe(false);
  });

  it('retire is reachable from every live status', () => {
    for (const from of ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'RETURNED', 'REJECTED']) {
      expect(FIELD_VERIFICATION_TRANSITIONS[from]).toContain('RETIRED');
    }
  });

  it('treats cancelled and verified_closed packages as terminal', () => {
    expect(isFieldVerificationTerminalPackageStatus('cancelled')).toBe(true);
    expect(isFieldVerificationTerminalPackageStatus('verified_closed')).toBe(true);
    expect(isFieldVerificationTerminalPackageStatus('in_progress')).toBe(false);
    expect(isFieldVerificationTerminalPackageStatus('complete')).toBe(false);
  });
});

describe('validateFieldVerificationCreate', () => {
  it('accepts a complete step observation and a complete line observation', () => {
    expect(validateFieldVerificationCreate(baseStepCreate)).toEqual([]);
    expect(validateFieldVerificationCreate(baseLineCreate)).toEqual([]);
  });

  it('rejects a step observation without a completion finding', () => {
    const codes = validateFieldVerificationCreate({ ...baseStepCreate, physicalCompletion: null });
    expect(codes).toContain('WPPFV_INVALID_VALUE');
  });

  it('rejects a step marked COMPLETE without documented checked criteria', () => {
    const codes = validateFieldVerificationCreate({
      ...baseStepCreate,
      physicalCompletion: 'COMPLETE',
      acceptanceCriteriaChecked: '   ',
    });
    expect(codes).toContain('WPPFV_INVALID_VALUE');
  });

  it('rejects an observed quantity on a step target and a completion finding on a line target', () => {
    expect(
      validateFieldVerificationCreate({ ...baseStepCreate, observedInstalledQuantity: 3 }),
    ).toContain('WPPFV_INVALID_TARGET');
    expect(
      validateFieldVerificationCreate({ ...baseLineCreate, physicalCompletion: 'COMPLETE' }),
    ).toContain('WPPFV_INVALID_TARGET');
  });

  it('rejects field-reported hours without a stated source', () => {
    const codes = validateFieldVerificationCreate({
      ...baseStepCreate,
      fieldReportedHours: 6.5,
      fieldHoursSource: null,
    });
    expect(codes).toContain('WPPFV_INVALID_VALUE');
  });

  it('rejects a missing or short source fingerprint (the caller-reviewed source)', () => {
    expect(
      validateFieldVerificationCreate({ ...baseStepCreate, sourceFingerprint: null }),
    ).toContain('WPPFV_SOURCE_CHANGED');
    expect(
      validateFieldVerificationCreate({ ...baseStepCreate, sourceFingerprint: 'abc' }),
    ).toContain('WPPFV_SOURCE_CHANGED');
  });

  it('rejects a bad inspection date and a missing observation note', () => {
    expect(
      validateFieldVerificationCreate({ ...baseStepCreate, inspectionDate: '20-11-2026' }),
    ).toContain('WPPFV_INVALID_VALUE');
    expect(
      validateFieldVerificationCreate({ ...baseStepCreate, observationNote: '  ' }),
    ).toContain('WPPFV_INVALID_EVIDENCE');
  });
});

describe('validateFieldVerificationUpdate / decision / retire / link', () => {
  it('requires a reason on every update', () => {
    expect(validateFieldVerificationUpdate({ reason: '' })).toContain('WPPFV_REASON_REQUIRED');
    expect(validateFieldVerificationUpdate({ reason: 'Typo in the note', setObservationNote: true, observationNote: 'Fixed.' })).toEqual([]);
  });

  it('requires a review statement on accept and a reason on return/reject', () => {
    expect(
      validateFieldVerificationDecision({ action: 'accept', sourceFingerprint: 'a'.repeat(32), reviewNote: '' }),
    ).toContain('WPPFV_REVIEW_NOTE_REQUIRED');
    expect(
      validateFieldVerificationDecision({ action: 'return', sourceFingerprint: 'a'.repeat(32), reason: '' }),
    ).toContain('WPPFV_REASON_REQUIRED');
    expect(
      validateFieldVerificationDecision({ action: 'reject', sourceFingerprint: 'a'.repeat(32), reason: 'The drawing cited is the wrong revision.' }),
    ).toEqual([]);
    expect(
      validateFieldVerificationDecision({ action: 'submit', sourceFingerprint: 'a'.repeat(32) }),
    ).toEqual([]);
  });

  it('rejects submit/accept without the reviewed fingerprint', () => {
    expect(
      validateFieldVerificationDecision({ action: 'submit', sourceFingerprint: null }),
    ).toContain('WPPFV_SOURCE_CHANGED');
  });

  it('requires a reason to retire and a known kind + target to link', () => {
    expect(validateFieldVerificationRetire({ reason: '' })).toContain('WPPFV_REASON_REQUIRED');
    expect(validateFieldVerificationRetire({ reason: 'Recorded against the wrong step.' })).toEqual([]);
    expect(validateFieldVerificationLink({ targetKind: 'BUST', targetId: 'forge_bust_1' })).toEqual([]);
    expect(validateFieldVerificationLink({ targetKind: 'EMAIL', targetId: 'x' })).toContain('WPPFV_INVALID_TARGET');
    expect(validateFieldVerificationLink({ targetKind: 'DRAWING', targetId: '' })).toContain('WPPFV_INVALID_TARGET');
  });
});

describe('computeLineVariances', () => {
  it('derives observed-vs-plan and observed-vs-recorded variances from the snapshots', () => {
    const result = computeLineVariances({ plannedQuantity: 12, recordedQuantity: 8, observedQuantity: 9 });
    expect(result).toEqual({
      varianceVsPlan: -3,
      varianceVsRecorded: 1,
      percentVsPlan: -25,
      percentVsRecorded: 12.5,
    });
  });

  it('returns null variances when nothing was observed yet', () => {
    const result = computeLineVariances({ plannedQuantity: 12, recordedQuantity: 8, observedQuantity: null });
    expect(result).toEqual({
      varianceVsPlan: null,
      varianceVsRecorded: null,
      percentVsPlan: null,
      percentVsRecorded: null,
    });
  });

  it('returns null percents when the planned quantity is zero', () => {
    const result = computeLineVariances({ plannedQuantity: 0, recordedQuantity: 0, observedQuantity: 2 });
    expect(result.varianceVsPlan).toBe(2);
    expect(result.percentVsPlan).toBeNull();
  });
});

describe('computeHoursDifference', () => {
  it('labels over/under/match against planned hours', () => {
    expect(computeHoursDifference(11.5, 10)).toEqual({ hoursVsPlan: 1.5, label: 'OVER' });
    expect(computeHoursDifference(8, 10)).toEqual({ hoursVsPlan: -2, label: 'UNDER' });
    expect(computeHoursDifference(10, 10)).toEqual({ hoursVsPlan: 0, label: 'MATCH' });
    expect(computeHoursDifference(null, 10)).toBeNull();
  });
});

describe('computeSourceStatus', () => {
  it('is CURRENT only when the fingerprints match exactly', () => {
    expect(computeSourceStatus('a'.repeat(32), 'a'.repeat(32))).toBe('CURRENT');
    expect(computeSourceStatus('a'.repeat(32), 'b'.repeat(32))).toBe('CHANGED_SINCE_REVIEW');
    expect(computeSourceStatus(null, 'b'.repeat(32))).toBe('CHANGED_SINCE_REVIEW');
  });
});

describe('isValidDecimal', () => {
  it('enforces the scale: hours 2 decimals, quantities 4', () => {
    expect(isValidDecimal(10.5, 2)).toBe(true);
    expect(isValidDecimal(10.555, 2)).toBe(false);
    expect(isValidDecimal(8.1234, 4)).toBe(true);
    expect(isValidDecimal(8.12345, 4)).toBe(false);
    expect(isValidDecimal(-1, 2)).toBe(false);
    expect(isValidDecimal(null, 2)).toBe(false);
  });
});

describe('mapFieldVerificationRpcError', () => {
  it('maps a named WPPFV_* exception to its human message', () => {
    const mapped = mapFieldVerificationRpcError({ message: 'WPPFV_SELF_REVIEW' });
    expect(mapped.code).toBe('WPPFV_SELF_REVIEW');
    expect(mapped.message).toContain('different person');
  });

  it('extracts the existing id from a duplicate-active error', () => {
    const mapped = mapFieldVerificationRpcError({ message: 'WPPFV_DUPLICATE_ACTIVE:forge_wpfv_abc' });
    expect(mapped.code).toBe('WPPFV_DUPLICATE_ACTIVE');
    expect(mapped.existingId).toBe('forge_wpfv_abc');
  });

  it('falls back to the generic message for unknown errors', () => {
    const mapped = mapFieldVerificationRpcError({ message: 'boom' });
    expect(mapped.code).toBe('WPPFV_NOT_APPLIED');
  });
});
