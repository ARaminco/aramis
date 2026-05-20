import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router.js';
import './lib/i18n.js'; // applies lang/dir on load
import './lib/ui-scale.js'; // applies persisted UI font scale on load
import './style.css';

// Apply persisted theme before mount to avoid flash
const theme = localStorage.getItem('aramis_theme') || 'dark';
if (theme === 'dark') document.documentElement.classList.add('dark');

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
