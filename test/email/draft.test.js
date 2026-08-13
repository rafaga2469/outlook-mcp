const handleDraftEmail = require('../../email/draft');
const { emailTools } = require('../../email');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

describe('handleDraftEmail', () => {
  const accessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockReset();
    ensureAuthenticated.mockReset();
    ensureAuthenticated.mockResolvedValue(accessToken);
    callGraphAPI.mockResolvedValue({ id: 'draft-123', subject: 'Test subject' });
  });

  function createdMessage() {
    return callGraphAPI.mock.calls[0][3];
  }

  test('creates an HTML draft from a fragment when isHtml is true', async () => {
    await handleDraftEmail({ body: '<p>HTML fragment</p>', isHtml: true });

    expect(createdMessage().body).toEqual({
      contentType: 'html',
      content: '<p>HTML fragment</p>',
    });
  });

  test('forces plain text when isHtml is false even with an html tag', async () => {
    await handleDraftEmail({ body: '<html><p>Markup</p></html>', isHtml: false });

    expect(createdMessage().body.contentType).toBe('text');
  });

  test('auto-detects an html tag case-insensitively when isHtml is omitted', async () => {
    await handleDraftEmail({ body: '<HtMl><p>Markup</p></hTmL>' });

    expect(createdMessage().body.contentType).toBe('html');
  });

  test('keeps an HTML fragment as text when isHtml is omitted', async () => {
    await handleDraftEmail({ body: '<p>HTML fragment</p>' });

    expect(createdMessage().body.contentType).toBe('text');
  });

  test('builds recipients and preserves draft defaults', async () => {
    await handleDraftEmail({
      to: ' first@example.com, ,second@example.com ',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
    });

    expect(ensureAuthenticated).toHaveBeenCalledTimes(1);
    expect(callGraphAPI).toHaveBeenCalledWith(accessToken, 'POST', 'me/messages', {
      subject: '',
      body: { contentType: 'text', content: '' },
      toRecipients: [
        { emailAddress: { address: 'first@example.com' } },
        { emailAddress: { address: 'second@example.com' } },
      ],
      ccRecipients: [{ emailAddress: { address: 'cc@example.com' } }],
      bccRecipients: [{ emailAddress: { address: 'bcc@example.com' } }],
      importance: 'normal',
    });
  });

  test('omits empty recipient collections from the Graph payload', async () => {
    await handleDraftEmail({ to: ' ', cc: '', bcc: '' });

    expect(createdMessage()).toEqual({
      subject: '',
      body: { contentType: 'text', content: '' },
      toRecipients: undefined,
      ccRecipients: undefined,
      bccRecipients: undefined,
      importance: 'normal',
    });
  });

  test('returns the created draft details', async () => {
    const result = await handleDraftEmail({
      to: 'one@example.com,two@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      subject: 'Test subject',
      importance: 'high',
    });

    expect(result.content[0].text).toBe(
      'Draft created successfully!\n\nDraft ID: draft-123\nSubject: Test subject\nRecipients: 2 + 1 CC + 1 BCC'
    );
    expect(createdMessage().importance).toBe('high');
  });

  test('uses the no-subject label when Graph omits the draft subject', async () => {
    callGraphAPI.mockResolvedValue({ id: 'draft-123' });

    const result = await handleDraftEmail({});

    expect(result.content[0].text).toContain('Subject: (no subject)');
  });

  test('returns the authentication-required guidance', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleDraftEmail({});

    expect(result.content[0].text).toBe(
      "Authentication required. Please use the 'authenticate' tool first."
    );
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('returns the Mail.ReadWrite guidance for a 403 response', async () => {
    callGraphAPI.mockRejectedValue(new Error('API request failed with status 403: Forbidden'));

    const result = await handleDraftEmail({});

    expect(result.content[0].text).toContain('Draft creation was denied by Microsoft Graph (403).');
    expect(result.content[0].text).toContain('Mail.ReadWrite');
  });

  test('returns a generic draft error for other failures', async () => {
    callGraphAPI.mockRejectedValue(new Error('Network unavailable'));

    const result = await handleDraftEmail({});

    expect(result.content[0].text).toBe('Error creating draft email: Network unavailable');
  });
});

describe('draft-email tool schema', () => {
  test('declares the optional isHtml boolean with fallback behavior', () => {
    const draftTool = emailTools.find(({ name }) => name === 'draft-email');

    expect(draftTool.inputSchema.required).toEqual([]);
    expect(draftTool.inputSchema.properties.isHtml).toEqual({
      type: 'boolean',
      description:
        'Set to true to create as HTML, false for plain text. If not specified, auto-detects based on <html> tag presence.',
    });
  });
});
