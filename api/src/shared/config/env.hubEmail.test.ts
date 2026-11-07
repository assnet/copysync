import { describe, expect, it } from 'vitest';
import { hubEmailPanelUrlIssue } from './env';

describe('hubEmailPanelUrlIssue', () => {
  it('só se aplica a EMAIL_SENDER=hub', () => {
    expect(hubEmailPanelUrlIssue({ EMAIL_SENDER: 'noop' })).toBeNull();
    expect(hubEmailPanelUrlIssue({ EMAIL_SENDER: 'smtp' })).toBeNull();
  });

  it('hub sem PANEL_URL ou com http → problema', () => {
    expect(hubEmailPanelUrlIssue({ EMAIL_SENDER: 'hub' })).toMatch(/PANEL_URL/);
    expect(hubEmailPanelUrlIssue({ EMAIL_SENDER: 'hub', PANEL_URL: 'http://app.example.com' })).toMatch(/https/);
  });

  it('hub com PANEL_URL https → ok', () => {
    expect(hubEmailPanelUrlIssue({ EMAIL_SENDER: 'hub', PANEL_URL: 'https://app.example.com' })).toBeNull();
  });
});
