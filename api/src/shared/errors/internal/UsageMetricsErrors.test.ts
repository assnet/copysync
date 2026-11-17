import { describe, it, expect } from 'vitest';
import { AppError } from '../AppError';
import {
  UsageMetricsCursorInvalidError,
  UsageMetricsFeatureNotFoundError,
  UsageMetricsRangeInvalidError,
  UsageMetricsReadUnavailableError,
} from './UsageMetricsErrors';

describe('UsageMetricsErrors', () => {
  it.each([
    [new UsageMetricsRangeInvalidError('from after to'), 'USAGE_METRICS_RANGE_INVALID', 400],
    [new UsageMetricsFeatureNotFoundError(), 'USAGE_METRICS_FEATURE_NOT_FOUND', 404],
    [new UsageMetricsCursorInvalidError(), 'USAGE_METRICS_CURSOR_INVALID', 400],
    [new UsageMetricsReadUnavailableError(), 'USAGE_METRICS_READ_UNAVAILABLE', 503],
  ])('%s responde com o código e o HTTP do contrato', (error, code, status) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
  });

  it('informa o teto em vigor quando o período passa dele', () => {
    expect(new UsageMetricsRangeInvalidError('above max', 90).meta).toEqual({ field: 'range', maxDays: 90 });
    expect(new UsageMetricsRangeInvalidError('future').meta).toEqual({ field: 'range' });
  });
});
