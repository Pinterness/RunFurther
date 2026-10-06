import { useCallback, useEffect, useState } from 'react';
import { api } from './clientApi';

/**
 * Loads an API path and keeps the latest answer. A response that arrives after the path changed,
 * after a reload or after unmount is ignored, so stale data never overwrites newer data.
 * @param {string | null} path Path below /api, e.g. "/wallet"; null skips loading.
 * @returns {{ data: any, error: (Error & { status?: number, code?: string }) | null, loading: boolean, reload: () => void }} Query state.
 */
export function useApiQuery(path) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState({ key: null, data: null, error: null });
  const key = path ? `${path}#${version}` : null;

  useEffect(() => {
    if (!path) {
      return undefined;
    }
    let active = true;
    api(path).then(
      (data) => {
        if (active) {
          setResult({ key, data, error: null });
        }
      },
      (error) => {
        if (active) {
          setResult((current) => ({ key, data: current.data, error }));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [path, key]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const loading = Boolean(key) && result.key !== key;
  return { data: result.data, error: result.error, loading, reload };
}
