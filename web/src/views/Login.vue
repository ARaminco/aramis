<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Card from '@/components/ui/Card.vue';
import { LockKeyhole, Loader2, Globe, Sun, Moon } from 'lucide-vue-next';

const router = useRouter();
const auth = useAuthStore();
const { t, locale, setLocale } = useI18n();
const password = ref('');
const loading = ref(false);
const error = ref('');

const dark = ref(document.documentElement.classList.contains('dark'));
function toggleDark() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle('dark', dark.value);
  localStorage.setItem('aramis_theme', dark.value ? 'dark' : 'light');
}

onMounted(async () => {
  const initialized = await auth.loadStatus();
  if (!initialized) router.replace('/setup');
});

async function submit() {
  error.value = ''; loading.value = true;
  try {
    await auth.login(password.value);
    router.replace('/chat');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-[100dvh] flex items-center justify-center p-4 bg-gradient-to-b from-background to-muted/30">
    <div class="absolute top-3 end-3 flex gap-1">
      <Button variant="ghost" size="icon" @click="setLocale(locale === 'fa' ? 'en' : 'fa')" :title="t('language')">
        <Globe class="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" @click="toggleDark">
        <Sun v-if="dark" class="h-4 w-4" />
        <Moon v-else class="h-4 w-4" />
      </Button>
    </div>
    <Card class="w-full max-w-sm p-5 sm:p-6 space-y-5 shadow-lg">
      <div class="flex items-center gap-3">
        <div class="rounded-xl bg-primary/10 p-2.5">
          <LockKeyhole class="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 class="text-lg font-semibold">{{ t('login_title') }}</h1>
          <p class="text-sm text-muted-foreground">{{ t('login_subtitle') }}</p>
        </div>
      </div>

      <form @submit.prevent="submit" class="space-y-4">
        <div class="space-y-1.5">
          <Label>{{ t('password') }}</Label>
          <Input type="password" v-model="password" autocomplete="current-password" required autofocus />
        </div>
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <Button type="submit" class="w-full" :disabled="loading">
          <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
          {{ t('login_submit') }}
        </Button>
      </form>
    </Card>
  </div>
</template>
