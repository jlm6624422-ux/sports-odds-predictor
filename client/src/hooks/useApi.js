import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';

export function useApi(endpoint, options = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { immediate = true, method = 'GET', body = null } = options;

  const fetchData = useCallback(async (overrideBody = null) => {
    setLoading(true);
    setError(null);

    try {
      const fetchOptions = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };

      if (overrideBody || body) {
        fetchOptions.body = JSON.stringify(overrideBody || body);
      }

      const response = await fetch(`${API_BASE}${endpoint}`, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setData(result);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [endpoint, method, body]);

  useEffect(() => {
    if (immediate && method === 'GET') {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [endpoint, immediate]);

  return { data, loading, error, refetch: fetchData };
}

export async function apiPost(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function apiPatch(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function apiDelete(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}
