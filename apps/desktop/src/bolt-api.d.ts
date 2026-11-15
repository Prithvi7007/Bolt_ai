interface Window {
  boltApi?: {
    request: (path: string, options?: {method?: 'GET' | 'POST'; body?: string}) =>
      Promise<{ok: boolean; status: number; data: unknown}>;
  };
}
