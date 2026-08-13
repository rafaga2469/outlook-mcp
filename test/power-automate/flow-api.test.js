const { EventEmitter } = require('events');

const mockRequest = jest.fn();
const mockConfig = {
  USE_TEST_MODE: false,
  FLOW_API_ENDPOINT: 'https://flow.example.test',
};

jest.mock('https', () => ({ request: mockRequest }));
jest.mock('../../config', () => mockConfig);

const { callFlowAPI } = require('../../power-automate/flow-api');

function arrangeResponse(statusCode, body = '') {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  const request = new EventEmitter();
  request.write = jest.fn();
  request.end = jest.fn();
  mockRequest.mockImplementation((_options, callback) => {
    callback(response);
    return request;
  });

  return {
    request,
    respond() {
      if (body) response.emit('data', body);
      response.emit('end');
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.USE_TEST_MODE = false;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Flow API test mode', () => {
  beforeEach(() => {
    mockConfig.USE_TEST_MODE = true;
  });

  it.each([
    ['/environments', 'Default-12345'],
    ['/environments/env/flows', 'flow-123'],
    ['/environments/env/flows/flow/runs', 'run-123'],
  ])('simulates %s without network traffic', async (path, expectedName) => {
    const response = await callFlowAPI('test_token', 'GET', path);

    expect(response.value[0].name).toBe(expectedName);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns an empty fallback for unsupported paths', async () => {
    await expect(callFlowAPI('test_token', 'POST', '/unsupported')).resolves.toEqual({});
  });

  it('does not simulate non-test tokens', () => {
    const { respond } = arrangeResponse(200, '{}');
    const result = callFlowAPI('real-token', 'GET', '/environments');
    respond();

    return expect(result).resolves.toEqual({});
  });
});

describe('Flow API HTTP requests', () => {
  it('builds the endpoint, API version, method, and bearer auth', async () => {
    const { request, respond } = arrangeResponse(200, '{"value":[]}');

    const result = callFlowAPI('secret-token', 'GET', '/environments/env/flows');
    respond();

    await expect(result).resolves.toEqual({ value: [] });
    expect(mockRequest).toHaveBeenCalledWith(
      {
        hostname: 'flow.example.test',
        path: '/providers/Microsoft.ProcessSimple/environments/env/flows?api-version=2016-11-01',
        method: 'GET',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
      },
      expect.any(Function)
    );
    expect(request.end).toHaveBeenCalledTimes(1);
  });

  it.each(['POST', 'PATCH', 'PUT'])('serializes a body for %s', async (method) => {
    const { request, respond } = arrangeResponse(204);

    const result = callFlowAPI('token', method, '/resource', { enabled: true });
    respond();

    await expect(result).resolves.toEqual({});
    expect(request.write).toHaveBeenCalledWith('{"enabled":true}');
  });

  it.each(['GET', 'DELETE'])('does not write a body for %s', async (method) => {
    const { request, respond } = arrangeResponse(200, '{}');

    const result = callFlowAPI('token', method, '/resource', { ignored: true });
    respond();

    await result;
    expect(request.write).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON from a successful response', async () => {
    const { respond } = arrangeResponse(200, 'not-json');

    const result = callFlowAPI('token', 'GET', '/resource');
    respond();

    await expect(result).rejects.toThrow('Error parsing Flow API response');
  });

  it('reports unauthorized responses with the stable auth sentinel', async () => {
    const { respond } = arrangeResponse(401, 'unauthorized');

    const result = callFlowAPI('token', 'GET', '/resource');
    respond();

    await expect(result).rejects.toThrow('FLOW_UNAUTHORIZED');
  });

  it('reports forbidden responses with a stable code and human message', async () => {
    const { respond } = arrangeResponse(403, 'forbidden');

    const result = callFlowAPI('token', 'GET', '/resource');
    respond();

    await expect(result).rejects.toMatchObject({
      code: 'FLOW_FORBIDDEN',
      message:
        'Access denied. Ensure your account has Power Automate access and the flow is solution-aware.',
    });
  });

  it('includes status and response data for other failures', async () => {
    const { respond } = arrangeResponse(429, 'slow down');

    const result = callFlowAPI('token', 'GET', '/resource');
    respond();

    await expect(result).rejects.toThrow('Flow API call failed with status 429: slow down');
  });

  it('wraps network errors with Flow API context', async () => {
    const request = new EventEmitter();
    request.write = jest.fn();
    request.end = jest.fn();
    mockRequest.mockReturnValue(request);

    const result = callFlowAPI('token', 'GET', '/resource');
    request.emit('error', new Error('socket closed'));

    await expect(result).rejects.toThrow('Network error during Flow API call: socket closed');
  });
});
