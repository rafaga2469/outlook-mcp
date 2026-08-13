const { EventEmitter } = require('events');

jest.mock('https');
jest.mock('../../config', () => ({
  USE_TEST_MODE: false,
  GRAPH_API_ENDPOINT: 'https://graph.example/v1.0/',
}));
jest.mock('../../utils/mock-data', () => ({
  simulateGraphAPIResponse: jest.fn(),
}));

const https = require('https');
const config = require('../../config');
const mockData = require('../../utils/mock-data');
const {
  callGraphAPI,
  callGraphAPIPaginated,
  callGraphAPIDownload,
} = require('../../utils/graph-api');

function response(statusCode, body = '', headers = {}) {
  return { statusCode, body, headers };
}

function mockRequests(...outcomes) {
  for (const outcome of outcomes) {
    https.request.mockImplementationOnce((url, options, callback) => {
      const request = new EventEmitter();
      request.write = jest.fn();
      request.end = jest.fn();

      process.nextTick(() => {
        if (outcome instanceof Error) {
          request.emit('error', outcome);
          return;
        }

        const res = new EventEmitter();
        res.statusCode = outcome.statusCode;
        res.headers = outcome.headers;
        callback(res);
        if (outcome.body) res.emit('data', Buffer.from(outcome.body));
        res.emit('end');
      });

      return request;
    });
  }
}

describe('Graph API helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.USE_TEST_MODE = false;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('callGraphAPI', () => {
    test('delegates test tokens to the mock-data simulator', async () => {
      config.USE_TEST_MODE = true;
      const data = { subject: 'Hello' };
      const query = { $select: 'id' };
      mockData.simulateGraphAPIResponse.mockReturnValue({ id: 'mock-id' });

      await expect(
        callGraphAPI('test_access_token_1', 'POST', 'me/messages', data, query)
      ).resolves.toEqual({
        id: 'mock-id',
      });
      expect(mockData.simulateGraphAPIResponse).toHaveBeenCalledWith(
        'POST',
        'me/messages',
        data,
        query
      );
      expect(https.request).not.toHaveBeenCalled();
    });

    test('encodes path segments and OData query parameters without mutating the caller input', async () => {
      mockRequests(response(200, '{"value":[]}'));
      const query = { $select: 'id,displayName', $top: 10, $filter: "subject eq 'A B'" };
      const original = { ...query };

      await callGraphAPI('token', 'GET', 'me/mail folders/Inbox', null, query);

      expect(https.request).toHaveBeenCalledWith(
        "https://graph.example/v1.0/me/mail%20folders/Inbox?%24select=id%2CdisplayName&%24top=10&$filter=subject%20eq%20'A%20B'",
        expect.objectContaining({ method: 'GET' }),
        expect.any(Function)
      );
      expect(query).toEqual(original);
    });

    test('uses a full nextLink unchanged and ignores query parameters', async () => {
      mockRequests(response(200, '{}'));
      const nextLink = 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=a%2Bb';

      await callGraphAPI('token', 'GET', nextLink, null, { $top: 2 });

      expect(https.request.mock.calls[0][0]).toBe(nextLink);
    });

    test('builds a query string containing only an OData filter', async () => {
      mockRequests(response(200, '{}'));

      await callGraphAPI('token', 'GET', 'me/messages', null, { $filter: 'isRead eq false' });

      expect(https.request.mock.calls[0][0]).toBe(
        'https://graph.example/v1.0/me/messages?$filter=isRead%20eq%20false'
      );
    });

    test('does not write a body for GET requests', async () => {
      mockRequests(response(200, '{}'));

      await callGraphAPI('token', 'GET', 'me', { ignored: true });

      const request = https.request.mock.results[0].value;
      expect(request.write).not.toHaveBeenCalled();
      expect(request.end).toHaveBeenCalledTimes(1);
    });

    test.each(['POST', 'PATCH', 'PUT'])('writes JSON for %s requests', async (method) => {
      mockRequests(response(200, '{}'));
      const data = { subject: 'Hello' };

      await callGraphAPI('token', method, 'me/messages', data);

      expect(https.request.mock.results[0].value.write).toHaveBeenCalledWith(JSON.stringify(data));
    });

    test('returns parsed JSON for successful responses', async () => {
      mockRequests(response(201, '{"id":"message-id"}'));

      await expect(callGraphAPI('token', 'POST', 'me/messages')).resolves.toEqual({
        id: 'message-id',
      });
    });

    test('returns an empty object for a successful empty response', async () => {
      mockRequests(response(204));

      await expect(callGraphAPI('token', 'DELETE', 'me/messages/id')).resolves.toEqual({});
    });

    test('rejects invalid JSON from a successful response', async () => {
      mockRequests(response(200, 'not-json'));

      await expect(callGraphAPI('token', 'GET', 'me')).rejects.toThrow(
        'Error parsing API response'
      );
    });

    test('maps 401 responses to UNAUTHORIZED', async () => {
      mockRequests(response(401, 'expired'));

      await expect(callGraphAPI('token', 'GET', 'me')).rejects.toThrow('UNAUTHORIZED');
    });

    test('includes status and response body for other failures', async () => {
      mockRequests(response(429, 'slow down'));

      await expect(callGraphAPI('token', 'GET', 'me')).rejects.toThrow(
        'API call failed with status 429: slow down'
      );
    });

    test('wraps request errors as network failures', async () => {
      mockRequests(new Error('socket closed'));

      await expect(callGraphAPI('token', 'GET', 'me')).rejects.toThrow(
        'Network error during API call: socket closed'
      );
    });
  });

  describe('callGraphAPIPaginated', () => {
    test('combines multiple pages and follows the full nextLink', async () => {
      const nextLink = 'https://graph.example/v1.0/me/messages?$skiptoken=next';
      mockRequests(
        response(200, JSON.stringify({ value: [{ id: 1 }], '@odata.nextLink': nextLink })),
        response(200, JSON.stringify({ value: [{ id: 2 }] }))
      );

      await expect(
        callGraphAPIPaginated('token', 'GET', 'me/messages', { $top: 1 })
      ).resolves.toEqual({
        value: [{ id: 1 }, { id: 2 }],
        '@odata.count': 2,
      });
      expect(https.request.mock.calls[1][0]).toBe(nextLink);
    });

    test('stops at maxCount and trims the final page', async () => {
      mockRequests(response(200, JSON.stringify({ value: [{ id: 1 }, { id: 2 }, { id: 3 }] })));

      await expect(callGraphAPIPaginated('token', 'GET', 'me/messages', {}, 2)).resolves.toEqual({
        value: [{ id: 1 }, { id: 2 }],
        '@odata.count': 2,
      });
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    test('rejects methods other than GET before making a request', async () => {
      await expect(callGraphAPIPaginated('token', 'POST', 'me/messages')).rejects.toThrow(
        'Pagination only supports GET requests'
      );
      expect(https.request).not.toHaveBeenCalled();
    });

    test('treats a response without value as an empty page', async () => {
      mockRequests(response(200, '{}'));

      await expect(callGraphAPIPaginated('token', 'GET', 'me/messages')).resolves.toEqual({
        value: [],
        '@odata.count': 0,
      });
    });

    test('propagates errors from an individual page', async () => {
      mockRequests(response(500, 'failure'));

      await expect(callGraphAPIPaginated('token', 'GET', 'me/messages')).rejects.toThrow(
        'API call failed with status 500: failure'
      );
    });
  });

  describe('callGraphAPIDownload', () => {
    test('returns a simulated URL for test tokens', async () => {
      config.USE_TEST_MODE = true;

      await expect(
        callGraphAPIDownload('test_access_token_1', 'me/drive/items/id/content')
      ).resolves.toMatch(/^https:\/\/example\.com\/download\/\d+$/);
      expect(https.request).not.toHaveBeenCalled();
    });

    test('returns the Location header from a 302 response', async () => {
      mockRequests(response(302, '', { location: 'https://download.example/file' }));

      await expect(callGraphAPIDownload('token', 'me/drive/items/id/content')).resolves.toBe(
        'https://download.example/file'
      );
    });

    test('returns a download URL from a successful JSON body', async () => {
      mockRequests(
        response(200, '{"@microsoft.graph.downloadUrl":"https://download.example/body"}')
      );

      await expect(callGraphAPIDownload('token', 'me/drive/items/id')).resolves.toBe(
        'https://download.example/body'
      );
    });

    test('rejects successful responses without a download URL', async () => {
      mockRequests(response(200, '{}'));

      await expect(callGraphAPIDownload('token', 'me/drive/items/id')).rejects.toThrow(
        'No download URL found in response'
      );
    });

    test('rejects invalid JSON in a successful response', async () => {
      mockRequests(response(200, 'not-json'));

      await expect(callGraphAPIDownload('token', 'me/drive/items/id')).rejects.toThrow(
        'Error parsing download response'
      );
    });

    test('maps 401 responses to UNAUTHORIZED', async () => {
      mockRequests(response(401));

      await expect(callGraphAPIDownload('token', 'me/drive/items/id')).rejects.toThrow(
        'UNAUTHORIZED'
      );
    });

    test('includes status and body for other failures', async () => {
      mockRequests(response(404, 'missing'));

      await expect(callGraphAPIDownload('token', 'me/drive/items/id')).rejects.toThrow(
        'Download request failed with status 404: missing'
      );
    });

    test('wraps request errors as network failures', async () => {
      mockRequests(new Error('reset'));

      await expect(callGraphAPIDownload('token', 'me/drive/items/id')).rejects.toThrow(
        'Network error during download request: reset'
      );
    });
  });
});
