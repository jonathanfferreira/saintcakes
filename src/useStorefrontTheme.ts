import { useEffect } from 'react';
import type { Storefront } from './storefront';

export function useStorefrontTheme(storefront: Storefront | null) {
  useEffect(() => {
    if (!storefront) return;
    document.documentElement.dataset.shopTheme = storefront.theme;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) { icon.removeAttribute('type'); icon.href = storefront.logoUrl || '/icons/encomendas.svg'; }
    return () => {
      delete document.documentElement.dataset.shopTheme;
      if (icon) icon.href = '/icons/encomendas.svg';
    };
  }, [storefront?.theme, storefront?.logoUrl]);
}
