import { createRouter, createWebHashHistory } from 'vue-router';
import { api } from '@/lib/api';

const routes = [
  { path: '/', redirect: '/chat' },
  { path: '/setup', name: 'setup', component: () => import('./views/Setup.vue'), meta: { public: true } },
  { path: '/login', name: 'login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/chat/:id?', name: 'chat', component: () => import('./views/Chat.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') },
  { path: '/changelog', name: 'changelog', component: () => import('./views/Changelog.vue') },
];

export const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach(async (to) => {
  const token = localStorage.getItem('aramis_token');
  if (to.meta.public) return true;
  if (!token) {
    // Decide whether to send to setup or login.
    try {
      const { initialized } = await api.authStatus();
      return initialized ? { name: 'login' } : { name: 'setup' };
    } catch {
      return { name: 'login' };
    }
  }
  return true;
});
