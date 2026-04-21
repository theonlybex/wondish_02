import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

const VALID_LOCALES = ['en', 'ru', 'es'] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const cookieStore = cookies();
  const raw = requested ?? cookieStore.get('NEXT_LOCALE')?.value ?? 'en';
  const locale = (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'en';

  let messages;
  try {
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch {
    messages = (await import('../messages/en.json')).default;
  }

  return { locale, messages };
});
