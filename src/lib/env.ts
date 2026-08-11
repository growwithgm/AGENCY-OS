function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  get SUPABASE_URL() { return required('SUPABASE_URL'); },
  get SUPABASE_SERVICE_ROLE_KEY() { return required('SUPABASE_SERVICE_ROLE_KEY'); },
  get SUPABASE_ANON_KEY() { return required('SUPABASE_ANON_KEY'); },
  get SUPABASE_JWT_SECRET() { return required('SUPABASE_JWT_SECRET'); },
  get MOONSHOT_API_KEY() { return required('MOONSHOT_API_KEY'); },
  get BOT_SHARED_SECRET() { return required('BOT_SHARED_SECRET'); },
  get CRON_SECRET() { return required('CRON_SECRET'); },
  get APP_BASE_URL() { return process.env.APP_BASE_URL ?? 'http://localhost:3000'; },

  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
  WINDSOR_API_KEY: process.env.WINDSOR_API_KEY,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
  SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN,
  WASIFY_API_KEY: process.env.WASIFY_API_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
};
