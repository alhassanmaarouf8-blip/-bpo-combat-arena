export const PUBLIC_PREVIEW_REVALIDATE_MS = 30_000;
export const PUBLIC_PREVIEW_RETRY_DELAY_MS = 1_250;

const UNAVAILABLE_CODES = new Set([
  'feature_disabled',
  'feature_paused',
  'privacy_configuration_required',
]);

export function isPublicPreviewOn(status) {
  return status?.enabled === true && status?.mode === 'on';
}

export function isPreviewUnavailableError(error) {
  return UNAVAILABLE_CODES.has(error?.code);
}

function isTransientInitialFailure(error) {
  return !error?.code || error.code === 'network_error' || error.code === 'request_timeout';
}

// Small framework-neutral monitor so focus/visibility refresh behavior can be
// tested without mounting the application. It deduplicates in-flight probes,
// throttles passive refreshes, and retries only the initial transient failure.
export function createPublicPreviewMonitor({
  getStatus,
  onAvailability,
  now = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancelSchedule = (timer) => clearTimeout(timer),
  minIntervalMs = PUBLIC_PREVIEW_REVALIDATE_MS,
  retryDelayMs = PUBLIC_PREVIEW_RETRY_DELAY_MS,
} = {}) {
  if (typeof getStatus !== 'function' || typeof onAvailability !== 'function') {
    throw new TypeError('preview_monitor_configuration_required');
  }

  let stopped = false;
  let inFlight = null;
  let controller = null;
  let retryTimer = null;
  let initialRetryUsed = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let lastAvailability = 'off';

  const publish = (status) => {
    if (stopped) return;
    lastAvailability = isPublicPreviewOn(status) ? 'on' : 'off';
    onAvailability(lastAvailability);
  };

  const check = ({ force = false, retryKind = 'none' } = {}) => {
    if (stopped) return Promise.resolve(null);
    if (inFlight) return inFlight;

    const startedAt = Number(now());
    if (!force && Number.isFinite(startedAt)
      && startedAt - lastStartedAt < Math.max(0, minIntervalMs)) {
      return Promise.resolve(null);
    }
    lastStartedAt = Number.isFinite(startedAt) ? startedAt : Date.now();
    controller = new AbortController();

    inFlight = Promise.resolve()
      .then(() => getStatus({ signal:controller.signal }))
      .then((status) => { publish(status); return status; })
      .catch((error) => {
        if (stopped || error?.name === 'AbortError') return null;
        const transient = isTransientInitialFailure(error);
        const preserveVisibleForm = transient && lastAvailability === 'on';
        if (!preserveVisibleForm) publish(null);
        const retryInitial = retryKind === 'initial' && !initialRetryUsed && transient;
        const retryVisible = retryKind === 'passive' && preserveVisibleForm;
        if (retryTimer === null && (retryInitial || retryVisible)) {
          if (retryInitial) initialRetryUsed = true;
          retryTimer = schedule(() => {
            retryTimer = null;
            check({ force:true }).catch(() => {});
          }, Math.max(0, retryDelayMs));
        }
        return null;
      })
      .finally(() => {
        inFlight = null;
        controller = null;
      });
    return inFlight;
  };

  return Object.freeze({
    start: () => check({ force:true, retryKind:'initial' }),
    revalidate: () => check({ retryKind:'passive' }),
    stop: () => {
      stopped = true;
      controller?.abort();
      if (retryTimer !== null) cancelSchedule(retryTimer);
      retryTimer = null;
    },
  });
}
