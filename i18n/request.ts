import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

const VALID_LOCALES = ['en', 'ru', 'es'] as const;

export default getRequestConfig(async () => {
  const cookieStore = cookies();
  const raw = cookieStore.get('NEXT_LOCALE')?.value ?? 'en';
  const locale = (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'en';

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
