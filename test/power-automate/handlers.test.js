const mockCallFlowAPI = jest.fn();
const mockGetValidFlowAccessToken = jest.fn();

jest.mock('../../power-automate/flow-api', () => ({
  callFlowAPI: mockCallFlowAPI,
}));

jest.mock('../../auth/index', () => ({
  tokenStorage: {
    getValidFlowAccessToken: mockGetValidFlowAccessToken,
  },
}));

const handleListEnvironments = require('../../power-automate/list-environments');
const handleListFlows = require('../../power-automate/list-flows');
const handleListRuns = require('../../power-automate/list-runs');
const handleRunFlow = require('../../power-automate/run-flow');
const handleToggleFlow = require('../../power-automate/toggle-flow');
const { powerAutomateTools } = require('../../power-automate');

const flowArgs = { environmentId: 'Default-12345', flowId: 'flow-123' };
const textOf = (result) => result.content[0].text;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetValidFlowAccessToken.mockResolvedValue('flow-token');
});

describe('Power Automate tool registry', () => {
  it('exports the five handlers with their required argument contracts', () => {
    expect(
      powerAutomateTools.map(({ name, inputSchema, handler }) => ({
        name,
        required: inputSchema.required,
        handler,
      }))
    ).toEqual([
      { name: 'flow-list-environments', required: [], handler: handleListEnvironments },
      { name: 'flow-list', required: ['environmentId'], handler: handleListFlows },
      { name: 'flow-run', required: ['environmentId', 'flowId'], handler: handleRunFlow },
      { name: 'flow-list-runs', required: ['environmentId', 'flowId'], handler: handleListRuns },
      { name: 'flow-toggle', required: ['environmentId', 'flowId'], handler: handleToggleFlow },
    ]);
  });
});

describe('list environments', () => {
  it('requires Power Automate authentication', async () => {
    mockGetValidFlowAccessToken.mockResolvedValue(null);

    expect(textOf(await handleListEnvironments({}))).toMatch(/authentication required/);
    expect(mockCallFlowAPI).not.toHaveBeenCalled();
  });

  it('reports an expired Flow token', async () => {
    mockCallFlowAPI.mockRejectedValue(new Error('FLOW_UNAUTHORIZED'));

    expect(textOf(await handleListEnvironments({}))).toMatch(/authentication expired/);
  });

  it('reports an empty environment result', async () => {
    mockCallFlowAPI.mockResolvedValue({});

    expect(textOf(await handleListEnvironments({}))).toBe('No Power Platform environments found.');
  });

  it('formats default, region, and fallback environment fields', async () => {
    mockCallFlowAPI.mockResolvedValue({
      value: [
        {
          name: 'Default-12345',
          properties: {
            displayName: 'Production',
            isDefault: true,
            azureRegionHint: 'europe',
          },
        },
        { name: 'fallback-name' },
      ],
    });

    const text = textOf(await handleListEnvironments({}));

    expect(mockCallFlowAPI).toHaveBeenCalledWith('flow-token', 'GET', '/environments');
    expect(text).toContain('Found 2 environment(s)');
    expect(text).toContain('Production [DEFAULT]');
    expect(text).toContain('Region: europe');
    expect(text).toContain('fallback-name');
    expect(text).toContain('Region: Unknown region');
  });

  it('returns API errors with context', async () => {
    mockCallFlowAPI.mockRejectedValue(new Error('service unavailable'));

    expect(textOf(await handleListEnvironments({}))).toBe(
      'Error listing environments: service unavailable'
    );
  });
});

describe('list flows', () => {
  it('requires an environment ID before authenticating', async () => {
    expect(textOf(await handleListFlows({}))).toMatch(/Environment ID is required/);
    expect(mockGetValidFlowAccessToken).not.toHaveBeenCalled();
  });

  it('requires Power Automate authentication', async () => {
    mockGetValidFlowAccessToken.mockResolvedValue(null);

    expect(textOf(await handleListFlows({ environmentId: 'env' }))).toMatch(
      /authentication required/
    );
  });

  it('reports an empty flow result', async () => {
    mockCallFlowAPI.mockResolvedValue({ value: [] });

    expect(textOf(await handleListFlows({ environmentId: 'env' }))).toMatch(
      /No flows found in environment env/
    );
  });

  it('formats state, trigger, created date, and fallback fields', async () => {
    mockCallFlowAPI.mockResolvedValue({
      value: [
        {
          name: 'flow-1',
          properties: {
            displayName: 'Daily sync',
            state: 'Started',
            createdTime: '2024-01-02T00:00:00Z',
            definition: { triggers: { recurrence: {} } },
          },
        },
        { name: 'flow-2', properties: { state: 'Stopped' } },
        { name: 'flow-3' },
      ],
    });

    const text = textOf(await handleListFlows({ environmentId: 'env' }));

    expect(mockCallFlowAPI).toHaveBeenCalledWith('flow-token', 'GET', '/environments/env/flows');
    expect(text).toContain('[ON] Daily sync');
    expect(text).toContain('Trigger: recurrence');
    expect(text).toContain('[OFF] flow-2');
    expect(text).toContain('[OFF] flow-3');
    expect(text).toContain('Trigger: Unknown');
    expect(text).toContain('Created: Unknown');
  });

  it.each([
    ['FLOW_UNAUTHORIZED', /authentication expired/],
    ['service unavailable', /Error listing flows: service unavailable/],
  ])('handles %s errors', async (message, expected) => {
    mockCallFlowAPI.mockRejectedValue(new Error(message));

    expect(textOf(await handleListFlows({ environmentId: 'env' }))).toMatch(expected);
  });
});

describe('list runs', () => {
  it.each([{ environmentId: 'env' }, { flowId: 'flow' }, {}])(
    'requires both IDs for $args',
    async (args) => {
      expect(textOf(await handleListRuns(args))).toBe(
        'Both environmentId and flowId are required.'
      );
      expect(mockGetValidFlowAccessToken).not.toHaveBeenCalled();
    }
  );

  it('requires Power Automate authentication', async () => {
    mockGetValidFlowAccessToken.mockResolvedValue(null);

    expect(textOf(await handleListRuns(flowArgs))).toMatch(/authentication required/);
  });

  it('reports empty run history', async () => {
    mockCallFlowAPI.mockResolvedValue({});

    expect(textOf(await handleListRuns(flowArgs))).toBe('No run history found for this flow.');
  });

  it('limits and formats statuses, dates, and every duration range', async () => {
    const start = '2024-01-01T00:00:00.000Z';
    mockCallFlowAPI.mockResolvedValue({
      value: [
        {
          name: 'r1',
          properties: {
            status: 'Succeeded',
            startTime: start,
            endTime: '2024-01-01T00:00:00.500Z',
          },
        },
        {
          name: 'r2',
          properties: { status: 'Failed', startTime: start, endTime: '2024-01-01T00:00:01.500Z' },
        },
        {
          name: 'r3',
          properties: { status: 'Running', startTime: start, endTime: '2024-01-01T00:01:05.000Z' },
        },
        {
          name: 'r4',
          properties: {
            status: 'Cancelled',
            startTime: start,
            endTime: '2024-01-01T01:05:00.000Z',
          },
        },
        { name: 'r5', properties: { status: 'TimedOut' } },
        { name: 'r6' },
        { name: 'not-included', properties: { status: 'Succeeded' } },
      ],
    });

    const text = textOf(await handleListRuns({ ...flowArgs, count: 6 }));

    expect(mockCallFlowAPI).toHaveBeenCalledWith(
      'flow-token',
      'GET',
      '/environments/Default-12345/flows/flow-123/runs'
    );
    expect(text).toContain('Recent 6 run(s)');
    expect(text).toContain('[OK] Succeeded');
    expect(text).toContain('[FAIL] Failed');
    expect(text).toContain('[...] Running');
    expect(text).toContain('[X] Cancelled');
    expect(text).toContain('[TIMEOUT] TimedOut');
    expect(text).toContain('[?] Unknown');
    expect(text).toContain('Duration: 500ms');
    expect(text).toContain('Duration: 1.5s');
    expect(text).toContain('Duration: 1m 5s');
    expect(text).toContain('Duration: 1h 5m');
    expect(text).toContain('Started: Unknown');
    expect(text).toContain('Duration: N/A');
    expect(text).not.toContain('not-included');
  });

  it.each([
    ['FLOW_UNAUTHORIZED', /authentication expired/],
    ['service unavailable', /Error listing flow runs: service unavailable/],
  ])('handles %s errors', async (message, expected) => {
    mockCallFlowAPI.mockRejectedValue(new Error(message));

    expect(textOf(await handleListRuns(flowArgs))).toMatch(expected);
  });
});

describe('run flow', () => {
  it('requires both IDs before authenticating', async () => {
    expect(textOf(await handleRunFlow({ environmentId: 'env' }))).toMatch(/Both .* required/);
    expect(mockGetValidFlowAccessToken).not.toHaveBeenCalled();
  });

  it('requires Power Automate authentication', async () => {
    mockGetValidFlowAccessToken.mockResolvedValue(null);

    expect(textOf(await handleRunFlow(flowArgs))).toMatch(/authentication required/);
  });

  it('rejects invalid JSON inputs without calling the API', async () => {
    expect(textOf(await handleRunFlow({ ...flowArgs, inputs: '{bad' }))).toMatch(
      /Invalid inputs format/
    );
    expect(mockCallFlowAPI).not.toHaveBeenCalled();
  });

  it.each([
    [
      'JSON string inputs and response name',
      '{"answer":42}',
      { name: 'run-name' },
      { answer: 42 },
      'run-name',
    ],
    ['object inputs and response ID', { answer: 42 }, { id: 'run-id' }, { answer: 42 }, 'run-id'],
    ['no inputs and acknowledgment fallback', undefined, {}, null, 'initiated'],
  ])('%s', async (_name, inputs, response, expectedData, expectedRunId) => {
    mockCallFlowAPI.mockResolvedValue(response);

    const text = textOf(await handleRunFlow({ ...flowArgs, inputs }));

    expect(mockCallFlowAPI).toHaveBeenCalledWith(
      'flow-token',
      'POST',
      '/environments/Default-12345/flows/flow-123/triggers/manual/run',
      expectedData
    );
    expect(text).toContain(`Run ID: ${expectedRunId}`);
  });

  it('uses the structured forbidden code for actionable guidance', async () => {
    const error = new Error('Access denied without a status number');
    error.code = 'FLOW_FORBIDDEN';
    mockCallFlowAPI.mockRejectedValue(error);

    expect(textOf(await handleRunFlow(flowArgs))).toMatch(/Cannot trigger this flow/);
  });

  it.each([
    [
      Object.assign(new Error('expired'), { message: 'FLOW_UNAUTHORIZED' }),
      /authentication expired/,
    ],
    [new Error('HTTP 403 from another source'), /Error running flow: HTTP 403/],
    [new Error('service unavailable'), /Error running flow: service unavailable/],
  ])('handles API error %# without brittle status-text matching', async (error, expected) => {
    mockCallFlowAPI.mockRejectedValue(error);

    expect(textOf(await handleRunFlow(flowArgs))).toMatch(expected);
  });
});

describe('toggle flow', () => {
  it('requires both IDs before authenticating', async () => {
    expect(textOf(await handleToggleFlow({ flowId: 'flow' }))).toMatch(/Both .* required/);
    expect(mockGetValidFlowAccessToken).not.toHaveBeenCalled();
  });

  it('requires Power Automate authentication', async () => {
    mockGetValidFlowAccessToken.mockResolvedValue(null);

    expect(textOf(await handleToggleFlow(flowArgs))).toMatch(/authentication required/);
  });

  it.each([
    ['enables by default', undefined, 'start', 'enabled', 'Started'],
    ['enables explicitly', true, 'start', 'enabled', 'Started'],
    ['disables explicitly', false, 'stop', 'disabled', 'Stopped'],
  ])('%s', async (_name, enable, endpoint, action, state) => {
    mockCallFlowAPI.mockResolvedValue({});

    const text = textOf(await handleToggleFlow({ ...flowArgs, enable }));

    expect(mockCallFlowAPI).toHaveBeenCalledWith(
      'flow-token',
      'POST',
      `/environments/Default-12345/flows/flow-123/${endpoint}`
    );
    expect(text).toContain(`successfully ${action}`);
    expect(text).toContain(`New State: ${state}`);
  });

  it('uses the structured forbidden code for actionable guidance', async () => {
    const error = new Error('Access denied without a status number');
    error.code = 'FLOW_FORBIDDEN';
    mockCallFlowAPI.mockRejectedValue(error);

    expect(textOf(await handleToggleFlow(flowArgs))).toMatch(/Cannot modify this flow/);
  });

  it.each([
    [
      Object.assign(new Error('expired'), { message: 'FLOW_UNAUTHORIZED' }),
      /authentication expired/,
    ],
    [new Error('HTTP 403 from another source'), /Error toggling flow: HTTP 403/],
    [new Error('service unavailable'), /Error toggling flow: service unavailable/],
  ])('handles API error %# without brittle status-text matching', async (error, expected) => {
    mockCallFlowAPI.mockRejectedValue(error);

    expect(textOf(await handleToggleFlow(flowArgs))).toMatch(expected);
  });
});
