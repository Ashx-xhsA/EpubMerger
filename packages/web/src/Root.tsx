// 按网址的 # 决定显示哪一页：#privacy、#terms 是说明页，其他都是首页
// 只有三页，不值得引入路由库

import { useEffect, useState } from 'react';
import { App } from './App.tsx';
import { LegalPage } from './pages/LegalPage.tsx';
import type { LegalKind } from './pages/LegalPage.tsx';

function pageFromHash(): LegalKind | null {
  const hash = window.location.hash.slice(1);
  return hash === 'privacy' || hash === 'terms' ? hash : null;
}

export function Root() {
  const [page, setPage] = useState(pageFromHash);

  useEffect(() => {
    const onHashChange = () => {
      setPage(pageFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return page === null ? <App /> : <LegalPage kind={page} />;
}
