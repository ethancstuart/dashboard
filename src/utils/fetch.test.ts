import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need a fresh module for each test group to avoid Map state leakage.
// We achieve this by using unique hostnames per test.

let fetchWithRetry: typeof import('./fetch.ts').fetchWithRetry;
let getCircuitState: typeof import('./fetch.ts').getCircuitState;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  // Re-import to get fresh module state
  const mod = await import('./fetch.ts');
  fetchWithRetry = mod.fetchWithRetry;
  getCircuitState = mod.getCircuitState;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function okResponse(body = '{}') {
  return new Response(body, { status: 200, statusText: 'OK' });
}

// Use mockImplementation returning a rejecting promise to avoid
// Node 25 PromiseRejectionHandledWarning caused by mockRejectedValue
function mockFetchFail(msg = 'fail') {
  vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error(msg)));
}

/** Trip the circuit breaker open for a given host. */
async function tripCircuit(host: string) {
  mockFetchFail();
  for (let i = 0; i < 3; i++) {
    const p = fetchWithRetry(`https://${host}/data`, undefined, 2).catch(() => {});
    await vi.advanceTimersByTimeAsync(2000);
    await p;
  }
}

describe('fetchWithRetry', () => {
  it('successful fetch returns response, circuit stays closed', async () => {
    const host = 'success-test.example.com';
    vi.mocked(fetch).mockResolvedValue(okResponse());

    const res = await fetchWithRetry(`https://${host}/data`);
    expect(res.ok).toBe(true);
    expect(getCircuitState(host)).toBe('closed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on failure up to maxRetries, succeeds on last attempt', async () => {
    const host = 'retry-success.example.com';
    vi.mocked(fetch)
      .mockImplementationOnce(() => Promise.reject(new Error('fail1')))
      .mockImplementationOnce(() => Promise.reject(new Error('fail2')))
      .mockResolvedValueOnce(okResponse());

    const promise = fetchWithRetry(`https://${host}/data`, undefined, 2);

    // Advance past retry delays
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(getCircuitState(host)).toBe('closed');
  });

  it('all retries exhausted increments failure count', async () => {
    const host = 'exhaust-retry.example.com';
    mockFetchFail();

    let caught: Error | undefined;
    const promise = fetchWithRetry(`https://${host}/data`, undefined, 2).catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toBe('fail');
    // Circuit should still be closed (only 1 failure set, threshold is 3)
    expect(getCircuitState(host)).toBe('closed');
  });

  it('3 full failure sets opens circuit', async () => {
    const host = 'open-circuit.example.com';
    await tripCircuit(host);
    expect(getCircuitState(host)).toBe('open');
  });

  it('open circuit throws without calling fetch', async () => {
    const host = 'open-nofetch.example.com';
    await tripCircuit(host);
    expect(getCircuitState(host)).toBe('open');

    vi.mocked(fetch).mockClear();
    await expect(fetchWithRetry(`https://${host}/data`)).rejects.toThrow(/Circuit open/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('after 5min circuit transitions to half-open', async () => {
    const host = 'halfopen-transition.example.com';
    await tripCircuit(host);
    expect(getCircuitState(host)).toBe('open');

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(getCircuitState(host)).toBe('half-open');
  });

  it('half-open allows first probe, success resets to closed', async () => {
    const host = 'halfopen-probe.example.com';
    await tripCircuit(host);

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(getCircuitState(host)).toBe('half-open');

    vi.mocked(fetch).mockResolvedValue(okResponse());
    const res = await fetchWithRetry(`https://${host}/data`);
    expect(res.ok).toBe(true);
    expect(getCircuitState(host)).toBe('closed');
  });

  it('half-open blocks concurrent second probe', async () => {
    const host = 'halfopen-block.example.com';
    await tripCircuit(host);

    vi.advanceTimersByTime(5 * 60 * 1000);

    // First probe: make fetch hang (never resolves)
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    void fetchWithRetry(`https://${host}/data`);

    // Second probe should be blocked immediately
    await expect(fetchWithRetry(`https://${host}/data`)).rejects.toThrow(/half-open/);

    // Clean up: we don't await probe1 since it never resolves
  });
});
