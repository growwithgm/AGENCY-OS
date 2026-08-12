function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  get SUPABASE_URL() { return required('SUPABASE_URL'); },
  get SUPABASE_ANON_KEY() { return required('SUPABASE_ANON_KEY'); },
  get SUPABASE_SERVICE_ROLE_KEY() { return required('SUPABASE_SERVICE_ROLE_KEY'); },
  get SUPABASE_JWT_SECRET() { return required('SUPABASE_JWT_SECRET'); },
  get MOONSHOT_API_KEY() { return required('MOONSHOT_API_KEY'); },
  get CRON_SECRET() { return required('CRON_SECRET'); },
  get APP_BASE_URL() { return process.env.APP_BASE_URL ?? 'http://localhost:3000'; },
};
