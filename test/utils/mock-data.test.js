const { simulateGraphAPIResponse } = require('../../utils/mock-data');

describe('simulateGraphAPIResponse attachments', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('list attachments returns value array', () => {
    const result = simulateGraphAPIResponse(
      'GET',
      'me/messages/simulated-email-2/attachments',
      null,
      { $select: 'id,name,contentType,size,isInline' }
    );

    expect(result.value).toBeDefined();
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      contentType: expect.any(String),
      size: expect.any(Number),
      isInline: expect.any(Boolean),
      contentBytes: expect.any(String),
    });
  });

  test('single attachment returns attachment object', () => {
    const result = simulateGraphAPIResponse(
      'GET',
      'me/messages/simulated-email-2/attachments/att-1',
      null,
      { $select: 'id,name,contentType,size,contentBytes' }
    );

    expect(result).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      contentType: expect.any(String),
      size: expect.any(Number),
      contentBytes: expect.any(String),
    });
    expect(Array.isArray(result.value)).toBe(false);
  });
});

describe('simulateGraphAPIResponse native replies', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('supports createReply followed by a body-only draft update', () => {
    const created = simulateGraphAPIResponse(
      'POST',
      'me/messages/original%2Fid/createReply',
      undefined,
      {}
    );
    const updated = simulateGraphAPIResponse(
      'PATCH',
      `me/messages/${created.id}`,
      { body: { contentType: 'html', content: '<p>Reply</p>' } },
      {}
    );

    expect(created.id).toBe('simulated-reply-draft-id');
    expect(updated).toEqual({
      id: 'simulated-reply-draft-id',
      subject: 'RE: Simulated Email Subject',
      body: { contentType: 'html', content: '<p>Reply</p>' },
    });
  });

  test('supports sending a native reply', () => {
    expect(
      simulateGraphAPIResponse(
        'POST',
        'me/messages/original%2Fid/reply',
        { message: { body: { contentType: 'text', content: 'Reply' } } },
        {}
      )
    ).toEqual({});
  });
});
