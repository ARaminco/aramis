import { defineStore } from 'pinia';
import { api, setToken } from '@/lib/api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('aramis_token') || '',
    initialized: null,
  }),
  actions: {
    async loadStatus() {
      const { initialized } = await api.authStatus();
      this.initialized = initialized;
      return initialized;
    },
    async setup(password) {
      const { token } = await api.setup(password);
      this.token = token; setToken(token); this.initialized = true;
    },
    async login(password) {
      const { token } = await api.login(password);
      this.token = token; setToken(token);
    },
    logout() {
      this.token = ''; setToken('');
    },
  },
});
